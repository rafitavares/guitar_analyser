import type { CaptureHandle } from "./capture.ts";
import { computeRms } from "./capture.ts";
import type { NoiseFloorProfile } from "../types/index.ts";

const DEFAULT_CALIBRATION_SECONDS = 2;

/** Mede o piso de ruído do ambiente por alguns segundos de silêncio, antes de cada teste. */
export async function measureNoiseFloor(
  capture: CaptureHandle,
  seconds: number = DEFAULT_CALIBRATION_SECONDS
): Promise<NoiseFloorProfile> {
  const { sampleRate } = capture;
  const sampleCount = Math.round(sampleRate * seconds);

  await capture.ensureRunning();
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000 + 100));

  const samples = capture.getLatestSamples(sampleCount);
  const rmsLevel = computeRms(samples);
  const dbLevel = 20 * Math.log10(Math.max(rmsLevel, 1e-9));

  return {
    rmsLevel,
    dbLevel,
    sampleRate,
    measuredAt: new Date().toISOString(),
  };
}

export function isEnvironmentNoisy(noiseFloor: NoiseFloorProfile): boolean {
  // Limiar prático: acima de ~-40dB RMS já é considerado ruidoso para este protocolo.
  return noiseFloor.dbLevel > -40;
}
