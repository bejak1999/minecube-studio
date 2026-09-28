/**
 * Facts about this process that Electron does not expose but the diagnostics
 * log needs: how many OS handles it holds, and which foreign DLLs other
 * programs have injected into it.
 *
 * Both exist because of one finding. The main process's working set was
 * growing ~70 MB an hour, and the memory map showed why: thousands of views of
 * the same few 2 MiB shared-memory sections -- MP4 file data this app never
 * creates -- each with its own open section handle, mapped again every couple
 * of minutes and never released. None of the app's own processes shared those
 * sections, and the one module present only in this process and not in a
 * clean reproduction was NVIDIA's capture hook (nvspcap64.dll). Logging the
 * handle count and the injected modules lets the next log say directly
 * whether a leak follows a hook, instead of taking another afternoon of
 * memory forensics.
 */
import koffi from 'koffi';

/** DLLs that other programs inject into every process they fancy, by file-name prefix. */
const KNOWN_HOOKS: Array<[prefix: string, what: string]> = [
  ['nvspcap64', 'NVIDIA capture/overlay (ShadowPlay)'],
  ['apphook64_', 'DisplayFusion'],
  ['windhawk', 'Windhawk'],
  ['rtsshooks', 'RivaTuner overlay'],
  ['gameoverlayrenderer', 'Steam overlay'],
  ['discordhook', 'Discord overlay'],
  ['graphics-hook', 'OBS capture'],
  ['tv_x64', 'TeamViewer'],
];

let handleCountFn: ((process: unknown, out: number[]) => boolean) | null | undefined;
let currentProcessFn: (() => unknown) | null = null;

/** Open OS handles of this process, or null where that cannot be asked. */
export function processHandleCount(): number | null {
  if (process.platform !== 'win32') return null;
  if (handleCountFn === undefined) {
    try {
      const kernel32 = koffi.load('kernel32.dll');
      currentProcessFn = kernel32.func('void* __stdcall GetCurrentProcess()') as () => unknown;
      handleCountFn = kernel32.func(
        'bool __stdcall GetProcessHandleCount(void* hProcess, _Out_ uint32* count)',
      ) as (process: unknown, out: number[]) => boolean;
    } catch {
      handleCountFn = null;
    }
  }
  if (!handleCountFn || !currentProcessFn) return null;
  const out = [0];
  return handleCountFn(currentProcessFn(), out) ? out[0] : null;
}

/** Foreign hooks currently loaded into this process, as "file (what)". */
export function injectedHooks(): string[] {
  let libs: string[];
  try {
    const report = process.report?.getReport() as { sharedObjects?: string[] } | undefined;
    libs = report?.sharedObjects ?? [];
  } catch {
    return [];
  }
  const found = new Set<string>();
  for (const lib of libs) {
    const file = lib.split(/[\\/]/).pop()!.toLowerCase();
    const hook = KNOWN_HOOKS.find(([prefix]) => file.startsWith(prefix));
    if (hook) found.add(`${file} (${hook[1]})`);
  }
  return [...found].sort();
}
