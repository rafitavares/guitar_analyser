// Sessão de escuta contínua para o teste de Sustentação: o usuário toca as
// cordas livremente, em qualquer ordem, quantas vezes quiser — o app
// escuta o tempo todo, detecta sozinho qual corda foi tocada, mede o
// decaimento até o som sumir, e acumula os resultados por corda. Nenhum
// botão precisa ser apertado entre tomadas.

import { captureNoteTake } from "./noteCapture.ts";
import type { CaptureTarget, CaptureCancelToken, CaptureStatus, EnvelopeFrame } from "./noteCapture.ts";
import { analyzeTake, selectMedianTakeIndex } from "./takeAnalyzer.ts";
import type { CaptureHandle } from "./capture.ts";
import type { NoiseFloorProfile, StringSustainMeasurement, NoteTakeResult } from "../types/index.ts";

export interface ContinuousSustainCallbacks {
  onStatusChange?: (status: CaptureStatus) => void;
  onEnvelopeUpdate?: (frame: EnvelopeFrame) => void;
  onTakeCompleted?: (stringNumber: number, take: NoteTakeResult, measurement: StringSustainMeasurement) => void;
  onDiscarded?: (reason: string) => void;
}

export interface ContinuousSustainController {
  stop: () => void;
  getMeasurements: () => StringSustainMeasurement[];
}

export function startContinuousSustainSession(
  targets: CaptureTarget[],
  sampleRate: number,
  capture: CaptureHandle,
  noiseFloor: NoiseFloorProfile,
  callbacks: ContinuousSustainCallbacks
): ContinuousSustainController {
  const cancelToken: CaptureCancelToken = { aborted: false };
  const measurementsByString = new Map<number, StringSustainMeasurement>();
  for (const t of targets) {
    measurementsByString.set(t.stringNumber, {
      stringNumber: t.stringNumber,
      noteName: t.noteName,
      expectedFrequencyHz: t.frequencyHz,
      takes: [],
      medianTakeIndex: null,
    });
  }

  async function loop() {
    while (!cancelToken.aborted) {
      const raw = await captureNoteTake({
        targets,
        sampleRate,
        capture,
        noiseFloor,
        cancelToken,
        onStatusChange: callbacks.onStatusChange,
        onEnvelopeUpdate: callbacks.onEnvelopeUpdate,
      });

      if (cancelToken.aborted || raw.aborted) break;

      if (!raw.valid || !raw.matchedTarget) {
        if (raw.discardReason) callbacks.onDiscarded?.(raw.discardReason);
        continue;
      }

      const measurement = measurementsByString.get(raw.matchedTarget.stringNumber);
      if (!measurement) continue;

      const take = analyzeTake(raw, measurement.takes.length, noiseFloor.dbLevel);
      measurement.takes.push(take);
      measurement.medianTakeIndex = selectMedianTakeIndex(measurement.takes);

      callbacks.onTakeCompleted?.(raw.matchedTarget.stringNumber, take, measurement);
    }
  }

  void loop();

  return {
    stop: () => {
      cancelToken.aborted = true;
    },
    getMeasurements: () =>
      Array.from(measurementsByString.values()).sort((a, b) => b.stringNumber - a.stringNumber),
  };
}
