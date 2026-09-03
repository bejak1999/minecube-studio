/**
 * A `media://` scheme for anything the renderer needs to display.
 *
 * Two reasons it exists:
 *
 * 1. The renderer is served from http://localhost during development, and
 *    Chromium refuses `file://` subresources from an http origin. Rather than
 *    switching off webSecurity, local media goes through this scheme.
 * 2. Remote media (an MJPEG camera on the LAN) would taint the canvas, and a
 *    tainted canvas cannot be encoded -- `toBlob` throws. Proxying it here and
 *    answering with `Access-Control-Allow-Origin: *` keeps the canvas clean.
 *
 * URL shapes:
 *   media://local/<uri-encoded absolute path>
 *   media://proxy/<uri-encoded absolute http(s) URL>
 */
import { pathToFileURL } from 'node:url';
import { net, protocol } from 'electron';

import { logDiag } from './diagnostics';

export const MEDIA_SCHEME = 'media';

export function toLocalUrl(path: string): string {
  return `${MEDIA_SCHEME}://local/${encodeURIComponent(path)}`;
}

export function toProxyUrl(url: string): string {
  return `${MEDIA_SCHEME}://proxy/${encodeURIComponent(url)}`;
}

/** Must run before `app.whenReady()`. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        // Videos and MJPEG need byte ranges and long-lived bodies.
        stream: true,
        corsEnabled: true,
      },
    },
  ]);
}

/**
 * Proxied bodies currently open. An MJPEG stream never ends by itself, so this
 * should sit at one per live camera -- if it climbs, streams are being replaced
 * without the old one being released, which is what exhausts the main process
 * ("Array buffer allocation failed", seen twice in the diagnostics log).
 */
let openBodies = 0;
let peakBodies = 0;

/**
 * Re-serve an upstream body through a pull-based stream.
 *
 * Two reasons not to hand `res.body` straight to the Response:
 *
 * 1. Backpressure. Pulling only when the consumer asks means a slow reader
 *    cannot make the upstream pile data up in the main process. The crash
 *    stack showed exactly that -- chunks being pushed into a Node readable
 *    nobody was draining.
 * 2. Cancellation. This gives a definite point at which the upstream reader is
 *    released, rather than relying on the request's own abort signal, which
 *    the earlier attempt at this assumed would fire and evidently did not.
 */
function trackedBody(body: ReadableStream<Uint8Array>, label: string): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let released = false;
  const release = (why: string): void => {
    if (released) return;
    released = true;
    openBodies--;
    if (openBodies > 4) logDiag(`[media] ${label} ${why}; ${openBodies} still open`);
  };

  openBodies++;
  if (openBodies > peakBodies) {
    peakBodies = openBodies;
    // Only ever grows, so this is a handful of lines, not a flood -- and it is
    // the number that says whether streams are leaking.
    if (peakBodies > 4) logDiag(`[media] ${peakBodies} proxied bodies open at once (${label})`);
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          release('ended');
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (err) {
        release('failed');
        controller.error(err);
      }
    },
    cancel(reason) {
      release('cancelled');
      return reader.cancel(reason);
    },
  });
}

/** Make a response usable as a canvas source from the renderer's origin. */
function withCors(res: Response, label: string): Response {
  const headers = new Headers(res.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  const body = res.body ? trackedBody(res.body, label) : null;
  return new Response(body, { status: res.status, statusText: res.statusText, headers });
}

/** Must run after `app.whenReady()`. */
export function handleMediaScheme(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    let host: string;
    let target: string;
    try {
      const url = new URL(request.url);
      host = url.hostname;
      target = decodeURIComponent(url.pathname.replace(/^\//, ''));
    } catch (err) {
      console.error(`[media] unparseable url ${request.url}: ${String(err)}`);
      return new Response('bad media url', { status: 400 });
    }
    if (!target) return new Response('empty target', { status: 400 });

    let upstream: string;
    if (host === 'proxy') {
      if (!/^https?:\/\//i.test(target)) {
        return new Response('only http(s) may be proxied', { status: 400 });
      }
      upstream = target;
    } else {
      upstream = pathToFileURL(target).toString();
    }

    try {
      const res = await net.fetch(upstream, {
        bypassCustomProtocolHandlers: true,
        // Hand the caller's cancellation through to the upstream connection.
        // Without this an MJPEG stream -- which never ends on its own -- keeps
        // running in the main process after the renderer dropped it (a stopped
        // camera, a source swap, a reconnect after resume), buffering into a
        // body nobody reads. Each restart then adds another one, and the main
        // process eventually dies on "Array buffer allocation failed".
        signal: request.signal,
        // Forward Range so seeking in a local video keeps working.
        headers: request.headers.has('range')
          ? { Range: request.headers.get('range')! }
          : undefined,
      });
      if (!res.ok) logDiag(`[media] ${res.status} for ${target}`);
      return withCors(res, host === 'proxy' ? upstream : 'local file');
    } catch (err) {
      // An abort is the normal way a stream ends here, not a failure.
      if (err instanceof Error && err.name === 'AbortError') {
        return new Response(null, { status: 499, statusText: 'client closed request' });
      }
      console.error(`[media] failed ${request.url} -> ${upstream}: ${String(err)}`);
      return new Response('not reachable', { status: 502 });
    }
  });
}
