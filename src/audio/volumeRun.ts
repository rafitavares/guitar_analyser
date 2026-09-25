// Motor do Teste 2 (Volume): mede o nível (dB) de cada canal do microfone
// disponível (1 ou 2, dependendo do aparelho) em tempo real, e mantém o
// valor máximo já alcançado por canal (peak-hold), como um medidor de VU.

import { computeRms } from "./capture.ts";
import type { CaptureHandle } from "./capture.ts";

export interface VolumeChannelLiveState {
  channelIndex: number;
  currentDb: number;
  peakDb: number;
}

export interface VolumeRunOptions {
  capture: CaptureHandle;
  onUpdate?: (channels: VolumeChannelLiveState[], elapsedSec: number) => void;
  pollIntervalMs?: number;
  windowSize?: number;
}

export interface VolumeRunController {
  stop: () => void;
  reset: () => void;
  getState: () => VolumeChannelLiveState[];
  getElapsedSec: () => number;
}

const DEFAULT_POLL_INTERVAL_MS = 90;
const DEFAULT_WINDOW_SIZE = 2048;
const MIN_DB = -90;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function startVolumeMonitoring(options: VolumeRunOptions): VolumeRunController {
  const {
    capture,
    onUpdate,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    windowSize = DEFAULT_WINDOW_SIZE,
  } = options;

  let aborted = false;
  const startTime = performance.now();
  const state: VolumeChannelLiveState[] = Array.from({ length: capture.channelCount }, (_, i) => ({
    channelIndex: i,
    currentDb: MIN_DB,
    peakDb: MIN_DB,
  }));

  async function loop() {
    await capture.ensureRunning();
    while (!aborted) {
      for (let c = 0; c < capture.channelCount; c++) {
        const samples = capture.getLatestSamples(windowSize, c);
        const rms = computeRms(samples);
        const db = Math.max(MIN_DB, 20 * Math.log10(Math.max(rms, 1e-9)));
        state[c]!.currentDb = db;
        if (db > state[c]!.peakDb) state[c]!.peakDb = db;
      }
      onUpdate?.(
        state.map((s) => ({ ...s })),
        (performance.now() - startTime) / 1000
      );
      await sleep(pollIntervalMs);
    }
  }

  void loop();

  return {
    stop: () => {
      aborted = true;
    },
    reset: () => {
      for (const s of state) {
        s.currentDb = MIN_DB;
        s.peakDb = MIN_DB;
      }
    },
    getState: () => state.map((s) => ({ ...s })),
    getElapsedSec: () => (performance.now() - startTime) / 1000,
  };
}
