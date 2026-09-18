import { computeSpectrum } from "./fft.ts";
import type { CaptureHandle } from "./capture.ts";
import { computeRms } from "./capture.ts";
import type { NoiseFloorProfile } from "../types/index.ts";

const CALIBRATION_SECONDS = 3;
const CALIBRATION_FFT_SIZE = 8192;

/** Mede o piso de ruído do ambiente por ~3 segundos de silêncio. */
export async function measureNoiseFloor(capture: CaptureHandle): Promise<NoiseFloorProfile> {
  const { sampleRate } = capture;
  const sampleCount = Math.round(sampleRate * CALIBRATION_SECONDS);

  await new Promise((resolve) => setTimeout(resolve, CALIBRATION_SECONDS * 1000 + 100));

  const samples = capture.getLatestSamples(sampleCount);
  const rmsLevel = computeRms(samples);

  const fftSamples = samples.subarray(samples.length - CALIBRATION_FFT_SIZE);
  const spectrum = computeSpectrum(new Float64Array(fftSamples), sampleRate);

  const dbLevel = 20 * Math.log10(Math.max(rmsLevel, 1e-9));

  return {
    rmsLevel,
    dbLevel,
    spectrum: new Float32Array(spectrum.magnitudes),
    sampleRate,
    fftSize: CALIBRATION_FFT_SIZE,
    measuredAt: new Date().toISOString(),
  };
}

export function isEnvironmentNoisy(noiseFloor: NoiseFloorProfile): boolean {
  // Limiar prático: acima de ~-40dB RMS já é considerado ruidoso para este protocolo.
  return noiseFloor.dbLevel > -40;
}
