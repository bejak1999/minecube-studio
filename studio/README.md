# Minecube Studio — technical notes

This is the engineering companion to the [project README](../README.md) —
architecture, extension points, and the bugs that cost real debugging time.
For features, screenshots, install instructions and the demo video, see the
root README. The panel wire protocol itself is documented separately in
[`PROTOCOL.md`](../PROTOCOL.md).

## Development

Requires **Node 20+** and, for `node-hid`'s native module, the
[Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
(Desktop development with C++ workload).

```bash
npm install     # also rebuilds node-hid against Electron's own ABI
npm run dev     # start the app with hot reload
npm run check   # typecheck + test suite
npm run dist    # build a Windows installer into dist/
```

Press `F12` in the running app to toggle DevTools.

## Architecture

```
src/
├─ main/                    Electron main process
│  ├─ index.ts              window, IPC, lifecycle
│  ├─ config.ts             persistence (JSON in userData)
│  ├─ metrics.ts            CPU/RAM/GPU/disk/network polling, subprocess-free
│  ├─ mqtt.ts               MQTT client for Frigate event triggers
│  ├─ media-protocol.ts     media:// scheme for local files
│  ├─ protocol/             the reverse-engineered wire protocol
│  │  ├─ frames.ts          0x5A text frames, byte-stuffing, checksum
│  │  ├─ image.ts           0x5C image chunks
│  │  └─ panel.ts           one panel, via node-hid
│  └─ hid/
│     ├─ service.ts         runs as a utilityProcess, owns every HID handle
│     └─ host.ts            its counterpart in the main process
├─ preload/                 contextBridge API surface
├─ shared/                  types, constants, the metrics catalog, JPEG trimming
└─ renderer/src/
   ├─ render/
   │  ├─ sources/           FrameSource registry — new content types plug in here
   │  ├─ dashboard/         dashboard widget rendering + editor registry
   │  ├─ compositor.ts      draws one source into a 720×720 canvas
   │  ├─ pipeline.ts        the frame loop
   │  └─ frigate-events.ts  event-rule state machine for camera pop-ups
   ├─ stores/studio.ts      Pinia store
   ├─ i18n/                 English/German translation tables
   └─ components/           CubeView, PanelCard, dashboard editor, etc.
```

### Why HID lives in its own process

Every `hidapi` read/write is a blocking syscall, and one frame set for four
panels is roughly 200 reports. Doing that on the main process would freeze the
UI. A dedicated `utilityProcess` owns all HID handles and receives frames
straight from the renderer over a `MessagePort`, so ~80 frames/s never touch
the main process at all.

### Why a panel is only re-encoded when something actually changed

The panels **hold whatever image they last received** until new data arrives —
measured directly. The compositor therefore builds a key from the source's
revision, viewport, crop and fit; if that key hasn't changed, nothing is
redrawn, re-encoded, or sent. A static image costs about 2.5% of one CPU core
instead of 100%.

### Adding a new content type

Implement `FrameSource` in `render/sources/types.ts` and register it with
`registerSource(kind, factory)`. The pipeline itself needs no changes — this is
exactly how live streams, dashboards, and desktop capture were each added.

## Hard-won lessons

A handful of bugs cost real debugging time, mostly because they failed
**silently** — the panel just went black, with no error anywhere:

1. **Transfer lists over the frame port.** An `ArrayBuffer` transferred over a
   `MessagePort` connected to a `MessagePortMain` in a utility process arrives
   as an **empty message** instead of failing loudly. Frames are sent without
   a transfer list and cloned normally instead.
2. **Vue proxies through IPC.** `structuredClone` refuses to clone a Proxy:
   *"An object could not be cloned."* Config now goes through a JSON round
   trip before it's sent.
3. **`file://` from the dev renderer.** Dev mode serves the renderer from
   `http://localhost:5173`, and Chromium blocks `file://` subresources from an
   HTTP origin. Rather than disabling `webSecurity`, local media is served
   through a custom `media://` scheme.
4. **A Windows drive letter looks like a URL scheme.** The "does this string
   already have a scheme?" check was `/^[a-z][a-z0-9+.-]*:/i`, which also
   matches `C:`. The path went out unmodified and became
   `file:///C:/...` — see the point above. Now requires `+` instead of `*`
   (at least two characters before the colon); pinned by a test.
5. **`null` overwrites defaults.** A saved `"color": null` beat the default in
   a spread and rendered as black. Config merging now ignores `null` and
   `undefined` — except for fields where `null` is the deliberate "cleared"
   sentinel (panel assignment, dashboard overlay, MQTT settings).
6. **A BOM in `config.json`.** `JSON.parse` throws on a UTF-8 BOM, which
   PowerShell 5.1 and some editors write. This used to be swallowed silently
   and fall back to defaults — indistinguishable from the app ignoring your
   settings. The BOM is now stripped, and a genuine parse error is logged
   instead of hidden.
7. **GIFs don't animate in an `<img>`.** Chromium only advances image
   animations for elements it actually paints, and ours live off-screen. GIFs
   are now decoded frame-by-frame with the WebCodecs `ImageDecoder` API,
   using each frame's own display duration instead of riding the render loop.
8. **`ImageDecoder.completed` isn't enough.** `tracks` can still be empty
   right after — `await decoder.tracks.ready` is also required, or a
   `frameCount ?? 1` fallback silently turns a 20-frame GIF into a still image.
9. **`aspect-ratio` + `width: 100%` + `max-height` distorts.** Once the height
   clamp kicks in, the width stays at 100% and the image stretches. A replaced
   element (canvas, image) with `width/height: auto` and both maxima set
   scales without distortion instead.
10. **A noisy Chromium log line that looked like a bug.**
    `ffmpeg_common.cc: Unsupported pixel format: -1` is internal Chromium media
    pipeline logging (unrelated to this app's own `console.log`), usually
    harmless. Silenced via `app.commandLine.appendSwitch('log-level', '3')`.

What turned out **not** to be a problem, despite looking like one: Chromium
attaches an sRGB ICC profile (APP2 segment) to every canvas-exported JPEG,
which the original vendor software never sends. Tested: the panel firmware
accepts it without complaint regardless. It's stripped anyway — 472 bytes
saved per frame, for free.

## Tests

```bash
npm test
```

`src/main/protocol/protocol.test.ts` checks the TypeScript port byte-for-byte
against `vectors.json` — the same frames extracted from a Wireshark capture
that the original protocol reverse-engineering was validated against.
