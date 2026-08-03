import type { MediaServer, SourceConfig, SourceKind } from '@shared/types';

/**
 * A thing that can supply pixels for a panel.
 *
 * Adding a new content type means implementing this and calling
 * {@link registerSource} -- nothing else in the pipeline needs to change.
 * That is the extension point for live streams, dashboards and so on.
 */
export interface FrameSource {
  readonly kind: SourceKind;

  /** Natural pixel size, or null while unknown (e.g. before a video loads). */
  readonly size: { w: number; h: number } | null;

  /**
   * Bumped whenever the visible content changed. The compositor redraws and
   * re-encodes only when this moves, so a still image costs nothing per frame.
   */
  readonly revision: number;

  /** Non-null once there is something to draw. */
  readonly frame: CanvasImageSource | null;

  /** Human-readable problem, shown in the UI. */
  readonly error: string | null;

  /**
   * True once a finite source has played through. The carousel uses it to move
   * on when a video ends rather than cutting it off mid-way. Sources that never
   * end (streams, stills, looping video) leave it false.
   */
  readonly finished?: boolean;

  start(): Promise<void>;
  stop(): void;
}

/** Everything a source may need beyond its own config. */
export interface SourceContext {
  servers: MediaServer[];
}

export type SourceFactory = (config: SourceConfig, ctx: SourceContext) => FrameSource;

const registry = new Map<SourceKind, SourceFactory>();

export function registerSource(kind: SourceKind, factory: SourceFactory): void {
  registry.set(kind, factory);
}

export function createSource(config: SourceConfig, ctx: SourceContext): FrameSource {
  const factory = registry.get(config.kind);
  if (!factory) throw new Error(`no source registered for kind '${config.kind}'`);
  return factory(config, ctx);
}

export function registeredKinds(): SourceKind[] {
  return [...registry.keys()];
}

/**
 * True when two configs would produce an identical source, so it can be reused.
 * Deliberately ignores `crop` and `fit` -- those only change how the existing
 * frames are drawn, and rebuilding a stream to move a crop box would be awful.
 */
export function sameSource(a: SourceConfig, b: SourceConfig): boolean {
  return (
    a.kind === b.kind &&
    a.src === b.src &&
    a.color === b.color &&
    a.loop === b.loop &&
    a.muted === b.muted &&
    a.rate === b.rate &&
    a.serverId === b.serverId &&
    a.camera === b.camera &&
    a.streamMode === b.streamMode &&
    a.desktopSourceId === b.desktopSourceId
  );
}
