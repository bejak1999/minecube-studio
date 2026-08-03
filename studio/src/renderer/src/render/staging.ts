/**
 * Off-screen staging area.
 *
 * Chromium only advances animated GIFs and decodes video for elements that are
 * part of the layout tree. `display:none` or a detached element stops both, so
 * media elements live here: laid out at full size, just pushed outside the
 * viewport where nothing can see them.
 */
let host: HTMLDivElement | null = null;

function ensureHost(): HTMLDivElement {
  if (host) return host;
  host = document.createElement('div');
  host.id = 'minecube-staging';
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: '1px',
    height: '1px',
    overflow: 'visible',
    pointerEvents: 'none',
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(host);
  return host;
}

export function stage<T extends HTMLElement>(element: T): T {
  ensureHost().appendChild(element);
  return element;
}

export function unstage(element: HTMLElement): void {
  element.remove();
}

/**
 * Local files go through the app's `media://` scheme -- see
 * ../../../main/media-protocol.ts for why `file://` cannot be used directly.
 * Anything that already carries a scheme (http, https, blob, data) is left alone.
 */
export function toMediaUrl(pathOrUrl: string): string {
  // Two or more characters before the colon: a Windows drive letter ("C:") is
  // not a scheme, and treating it as one leaves the path to be resolved as
  // file:///C:/... , which Chromium refuses to load from an http origin.
  if (/^[a-z][a-z0-9+.-]+:/i.test(pathOrUrl)) return pathOrUrl;
  return `media://local/${encodeURIComponent(pathOrUrl)}`;
}
