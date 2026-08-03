import { describe, expect, it } from 'vitest';

import { toMediaUrl } from './staging';

describe('toMediaUrl', () => {
  it('wraps a Windows path, drive letter and all', () => {
    // "C:" must not be mistaken for a URL scheme.
    expect(toMediaUrl('C:\\Users\\me\\bild.jpg')).toBe(
      'media://local/C%3A%5CUsers%5Cme%5Cbild.jpg',
    );
  });

  it('wraps a POSIX path', () => {
    expect(toMediaUrl('/home/me/bild.jpg')).toBe('media://local/%2Fhome%2Fme%2Fbild.jpg');
  });

  it('escapes spaces and umlauts', () => {
    const url = toMediaUrl('C:\\Bilder\\mein bild ä.png');
    expect(url.startsWith('media://local/')).toBe(true);
    expect(url).not.toContain(' ');
    expect(decodeURIComponent(url.slice('media://local/'.length))).toBe(
      'C:\\Bilder\\mein bild ä.png',
    );
  });

  it.each([
    'http://example.com/a.jpg',
    'https://example.com/a.jpg',
    'blob:http://localhost/abc',
    'data:image/png;base64,AAAA',
    'media://local/already',
  ])('leaves %s untouched', (url) => {
    expect(toMediaUrl(url)).toBe(url);
  });
});
