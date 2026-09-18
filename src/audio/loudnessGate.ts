// Piso de volume compartilhado: o som precisa estar claramente acima do
// ruído de fundo calibrado antes de contar como "aconteceu alguma coisa" —
// usado tanto para filtrar ataques na Sustentação quanto para disparar
// cada ciclo de captura na Ressonância.

import { computeRms } from "./capture.ts";
import type { CaptureHandle } from "./capture.ts";
import type { NoiseFloorProfile } from "../types/index.ts";

export const LOUDNESS_GATE_DB = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function loudnessThresholdRms(noiseFloor: NoiseFloorProfile, marginDb: number = LOUDNESS_GATE_DB): number {
  return Math.max(noiseFloor.rmsLevel, 1e-9) * Math.pow(10, marginDb / 20);
}

export function isAboveLoudnessGate(
  samples: Float64Array,
  noiseFloor: NoiseFloorProfile,
  marginDb: number = LOUDNESS_GATE_DB
): boolean {
  return computeRms(samples) >= loudnessThresholdRms(noiseFloor, marginDb);
}

/** Espera até o som ficar claramente acima do piso de ruído calibrado. Retorna false se abortado antes disso. */
export async function waitForLoudOnset(
  capture: CaptureHandle,
  noiseFloor: NoiseFloorProfile,
  windowSize: number,
  isAborted: () => boolean,
  pollIntervalMs = 45
): Promise<boolean> {
  const threshold = loudnessThresholdRms(noiseFloor);
  while (!isAborted()) {
    const samples = capture.getLatestSamples(windowSize);
    if (computeRms(samples) >= threshold) return true;
    await sleep(pollIntervalMs);
  }
  return false;
}
