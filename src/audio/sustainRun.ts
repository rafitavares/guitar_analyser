// Motor do Teste 1 (Sustentação): mede o ruído ambiente, espera o som
// ultrapassar um limiar em dB acima desse piso, e grava o envelope de
// decaimento (RMS de banda larga, sem depender de nenhum pente harmônico)
// até o som realmente sumir.

import { computeRms } from "./capture.ts";
import type { CaptureHandle } from "./capture.ts";
import { measureNoiseFloor } from "./calibration.ts";
import { analyzeSustain } from "./sustainAnalysis.ts";
import type { RawEnvelopePoint } from "./sustainAnalysis.ts";
import type { NoiseFloorProfile, SustainRunResult } from "../types/index.ts";

export type SustainRunStatus = "calibrando" | "aguardando" | "medindo" | "concluido";

export interface SustainRunOptions {
  capture: CaptureHandle;
  /** Margem acima do piso de ruído (dB) para disparar a medição. */
  thresholdDb?: number;
  onStatusChange?: (status: SustainRunStatus) => void;
  onEnvelopeUpdate?: (point: RawEnvelopePoint) => void;
  /** Duração máxima de rastreamento do decaimento, em ms — bem generosa para não cortar o som antes de acabar. */
  maxDecayMs?: number;
  cancelToken?: { aborted: boolean };
}

export interface SustainRunOutcome {
  noiseFloor: NoiseFloorProfile;
  result: SustainRunResult;
}

const ONSET_WINDOW = 2048;
const POLL_INTERVAL_MS = 40;
const ATTACK_WINDOW_MS = 180; // janela pra achar o verdadeiro pico logo após cruzar o limiar
const QUIET_CONFIRM_CYCLES = 5;
const QUIET_MARGIN_DB = 1.5; // quão perto do piso de ruído antes de considerar "sumiu"
const MIN_DECAY_TRACK_SEC = 0.3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runSustainMeasurement(options: SustainRunOptions): Promise<SustainRunOutcome> {
  const { capture, thresholdDb = 10, onStatusChange, onEnvelopeUpdate, maxDecayMs = 25000, cancelToken } = options;

  onStatusChange?.("calibrando");
  const noiseFloor = await measureNoiseFloor(capture);
  if (cancelToken?.aborted) throw new Error("cancelado");

  onStatusChange?.("aguardando");
  const thresholdRms = Math.max(noiseFloor.rmsLevel, 1e-9) * Math.pow(10, thresholdDb / 20);

  while (!cancelToken?.aborted) {
    const samples = capture.getLatestSamples(ONSET_WINDOW);
    if (computeRms(samples) >= thresholdRms) break;
    await sleep(POLL_INTERVAL_MS);
  }
  if (cancelToken?.aborted) throw new Error("cancelado");

  onStatusChange?.("medindo");

  // Fase de ataque: o som ainda está subindo nos primeiros milissegundos
  // depois de cruzar o limiar — acha o pico de verdade nessa janela curta
  // antes de usá-lo como referência de 0dB do envelope de decaimento.
  const attackDeadline = performance.now() + ATTACK_WINDOW_MS;
  let peakRms = thresholdRms;
  while (performance.now() < attackDeadline) {
    const samples = capture.getLatestSamples(ONSET_WINDOW);
    const rms = computeRms(samples);
    if (rms > peakRms) peakRms = rms;
    await sleep(15);
  }

  const envelope: RawEnvelopePoint[] = [];
  const startTime = performance.now();
  const decayDeadline = startTime + maxDecayMs;
  let quietStreak = 0;

  while (!cancelToken?.aborted && performance.now() < decayDeadline) {
    const samples = capture.getLatestSamples(ONSET_WINDOW);
    const rms = Math.max(computeRms(samples), 1e-9);
    const timeSec = (performance.now() - startTime) / 1000;
    const db = 20 * Math.log10(rms / peakRms);
    const point: RawEnvelopePoint = { timeSec, db };
    envelope.push(point);
    onEnvelopeUpdate?.(point);

    if (rms < noiseFloor.rmsLevel * Math.pow(10, QUIET_MARGIN_DB / 20)) {
      quietStreak++;
    } else {
      quietStreak = 0;
    }
    if (quietStreak >= QUIET_CONFIRM_CYCLES && timeSec > MIN_DECAY_TRACK_SEC) {
      break;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  onStatusChange?.("concluido");

  const result = analyzeSustain(envelope, noiseFloor.dbLevel, thresholdDb);
  return { noiseFloor, result };
}
