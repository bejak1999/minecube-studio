/**
 * Network throughput and GPU stats, read straight from the same OS APIs
 * Task Manager itself uses -- `pdh.dll` (Performance Data Helper) and
 * `nvml.dll` (NVIDIA Management Library) -- via Koffi FFI. No subprocess is
 * ever spawned; both are direct in-process calls into DLLs the OS/driver
 * already loaded.
 *
 * This replaces `systeminformation`'s `networkStats()` / `graphics()` on
 * Windows, which shell out to PowerShell (`Get-NetAdapterStatistics`,
 * `Get-CimInstance`, `nvidia-smi`) on every call -- confirmed by measuring
 * `Win32_Process` children spawned per invocation. The FFI calls below were
 * verified the same way (0 children spawned across repeated 1s polls).
 *
 * `PdhAddEnglishCounterW` + wildcard instance (`Network Interface(*)`) is
 * used instead of `PdhExpandWildCardPathW` + per-instance counters because
 * the latter expects *localized* object/counter names (fails with
 * PDH_CSTATUS_NO_OBJECT on non-English Windows); the "English" counter
 * functions work regardless of system locale.
 *
 * Struct fields that are string pointers (`szName` in
 * `PDH_FMT_COUNTERVALUE_ITEM_W`) must be declared with Koffi's `str16` type
 * so Koffi resolves the pointer during decode -- decoding a raw
 * pointer/bigint manually via `koffi.decode(ptr, 'str16')` segfaults.
 */
import koffi from 'koffi';
import type { LibraryHandle } from 'koffi';

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// -- Network throughput via PDH ----------------------------------------------

const PDH_FMT_DOUBLE = 0x00000200;

let pdhLib: LibraryHandle | null = null;
function pdh(): LibraryHandle {
  if (!pdhLib) pdhLib = koffi.load('pdh.dll');
  return pdhLib;
}

const PdhFmtCounterValue = koffi.struct('PDH_FMT_COUNTERVALUE', {
  CStatus: 'uint32',
  doubleValue: 'double',
});
const PdhFmtCounterValueItem = koffi.struct('PDH_FMT_COUNTERVALUE_ITEM_W', {
  szName: 'str16',
  FmtValue: PdhFmtCounterValue,
});
const ITEM_SIZE = koffi.sizeof(PdhFmtCounterValueItem);

const SKIP_INTERFACE = /isatap|loopback|teredo|kernel debug|qos packet|wan miniport/i;

export interface NetworkMonitor {
  /** null until the second successful collect (PDH rate counters need two samples). */
  read(): { rxKbps: number; txKbps: number } | null;
  close(): void;
}

export function openNetworkMonitor(): NetworkMonitor | null {
  try {
    const lib = pdh();
    const PdhOpenQueryW = lib.func('long PdhOpenQueryW(str16 szDataSource, void* dwUserData, _Out_ void **phQuery)');
    const PdhAddEnglishCounterW = lib.func(
      'long PdhAddEnglishCounterW(void* hQuery, str16 szFullCounterPath, void* dwUserData, _Out_ void **phCounter)',
    );
    const PdhCollectQueryData = lib.func('long PdhCollectQueryData(void* hQuery)');
    const PdhGetFormattedCounterArrayW = lib.func(
      'long PdhGetFormattedCounterArrayW(void* hCounter, uint32 dwFormat, _Inout_ uint32 *lpdwBufferSize, _Inout_ uint32 *lpdwItemCount, _Out_ uint8_t *ItemBuffer)',
    );
    const PdhCloseQuery = lib.func('long PdhCloseQuery(void* hQuery)');

    const check = (name: string, status: number): void => {
      if (status !== 0) throw new Error(`${name} failed: 0x${(status >>> 0).toString(16)}`);
    };

    const queryOut: (unknown | null)[] = [null];
    check('PdhOpenQueryW', PdhOpenQueryW(null, null, queryOut) as number);
    const hQuery = queryOut[0];

    const rxOut: (unknown | null)[] = [null];
    const txOut: (unknown | null)[] = [null];
    check(
      'PdhAddEnglishCounterW(rx)',
      PdhAddEnglishCounterW(hQuery, '\\Network Interface(*)\\Bytes Received/sec', null, rxOut) as number,
    );
    check(
      'PdhAddEnglishCounterW(tx)',
      PdhAddEnglishCounterW(hQuery, '\\Network Interface(*)\\Bytes Sent/sec', null, txOut) as number,
    );
    const hRx = rxOut[0];
    const hTx = txOut[0];

    const readSum = (hCounter: unknown): number | null => {
      const sizeOut = [0];
      const countOut = [0];
      PdhGetFormattedCounterArrayW(hCounter, PDH_FMT_DOUBLE, sizeOut, countOut, null);
      if (sizeOut[0] === 0) return null;
      const buf = Buffer.alloc(sizeOut[0]);
      const status = PdhGetFormattedCounterArrayW(hCounter, PDH_FMT_DOUBLE, sizeOut, countOut, buf) as number;
      if (status !== 0) return null;

      let sum = 0;
      let sawValid = false;
      for (let i = 0; i < countOut[0]; i++) {
        const item = koffi.decode(buf.subarray(i * ITEM_SIZE, (i + 1) * ITEM_SIZE), PdhFmtCounterValueItem) as {
          szName: string;
          FmtValue: { CStatus: number; doubleValue: number };
        };
        if (SKIP_INTERFACE.test(item.szName)) continue;
        // CStatus is nonzero (e.g. PDH_CSTATUS_INVALID_DATA) on the very
        // first collect, before a rate has anything to diff against.
        if (item.FmtValue.CStatus !== 0) continue;
        sawValid = true;
        sum += item.FmtValue.doubleValue;
      }
      return sawValid ? sum : null;
    };

    return {
      read(): { rxKbps: number; txKbps: number } | null {
        check('PdhCollectQueryData', PdhCollectQueryData(hQuery) as number);
        const rx = readSum(hRx);
        const tx = readSum(hTx);
        if (rx === null || tx === null) return null;
        return { rxKbps: round1(rx / 1024), txKbps: round1(tx / 1024) };
      },
      close(): void {
        PdhCloseQuery(hQuery);
      },
    };
  } catch (err) {
    console.warn('[metrics] network monitor unavailable:', err instanceof Error ? err.message : err);
    return null;
  }
}

// -- GPU stats via NVML --------------------------------------------------------

let nvmlLib: LibraryHandle | null = null;
function nvml(): LibraryHandle {
  if (!nvmlLib) nvmlLib = koffi.load('nvml.dll');
  return nvmlLib;
}

const NvmlUtilization = koffi.struct('nvmlUtilization_t', { gpu: 'uint32', memory: 'uint32' });
const NvmlMemory = koffi.struct('nvmlMemory_t', { total: 'uint64', free: 'uint64', used: 'uint64' });

export interface GpuMonitor {
  read(): { load: number; temp: number; memUsedPercent: number } | null;
  close(): void;
}

/** Only NVIDIA GPUs are supported (NVML is NVIDIA-only); anything else degrades to no GPU metrics. */
export function openGpuMonitor(): GpuMonitor | null {
  try {
    const lib = nvml();
    const nvmlInit_v2 = lib.func('int nvmlInit_v2()');
    const nvmlDeviceGetHandleByIndex_v2 = lib.func(
      'int nvmlDeviceGetHandleByIndex_v2(uint32 index, _Out_ void **device)',
    );
    const nvmlDeviceGetUtilizationRates = lib.func(
      `int nvmlDeviceGetUtilizationRates(void* device, _Out_ ${NvmlUtilization.name} *util)`,
    );
    const nvmlDeviceGetTemperature = lib.func(
      'int nvmlDeviceGetTemperature(void* device, uint32 sensorType, _Out_ uint32 *temp)',
    );
    const nvmlDeviceGetMemoryInfo = lib.func(`int nvmlDeviceGetMemoryInfo(void* device, _Out_ ${NvmlMemory.name} *mem)`);
    const nvmlShutdown = lib.func('int nvmlShutdown()');

    const check = (name: string, code: number): void => {
      if (code !== 0) throw new Error(`${name} failed: code ${code}`);
    };

    check('nvmlInit_v2', nvmlInit_v2() as number);
    const devOut: (unknown | null)[] = [null];
    check('nvmlDeviceGetHandleByIndex_v2', nvmlDeviceGetHandleByIndex_v2(0, devOut) as number);
    const device = devOut[0];

    return {
      read(): { load: number; temp: number; memUsedPercent: number } | null {
        const util: { gpu?: number; memory?: number } = {};
        const tempOut = [0];
        const mem: { total?: bigint; used?: bigint } = {};
        const ok =
          (nvmlDeviceGetUtilizationRates(device, util) as number) === 0 &&
          (nvmlDeviceGetTemperature(device, 0, tempOut) as number) === 0 &&
          (nvmlDeviceGetMemoryInfo(device, mem) as number) === 0;
        if (!ok || util.gpu === undefined || !mem.total || !mem.used) return null;
        return {
          load: util.gpu,
          temp: tempOut[0],
          memUsedPercent: round1((Number(mem.used) / Number(mem.total)) * 100),
        };
      },
      close(): void {
        nvmlShutdown();
      },
    };
  } catch (err) {
    console.warn('[metrics] GPU monitor unavailable (no NVIDIA GPU/driver?):', err instanceof Error ? err.message : err);
    return null;
  }
}
