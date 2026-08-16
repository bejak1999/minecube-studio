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

/** Make a response usable as a canvas source from the renderer's origin. */
function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
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
      if (!res.ok) console.error(`[media] ${res.status} for ${target}`);
      return withCors(res);
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
