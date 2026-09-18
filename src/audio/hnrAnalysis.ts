// HNR (Harmonic-to-Noise Ratio): razão entre energia harmônica (pente
// esperado) e energia de ruído (fora do pente), em dB, medida na região
// estável da nota (logo após o ataque, antes do decaimento profundo).

import type { EnvelopeFrame } from "./noteCapture.ts";
import type { HnrResult } from "../types/index.ts";

const CLEAN_THRESHOLD_DB = 10;

export function analyzeHnr(envelope: EnvelopeFrame[]): HnrResult {
  if (envelope.length === 0) {
    return { hnrDb: 0, isClean: false };
  }

  // Usa a região estável: do início até -10dB relativo ao pico (evita medir
  // ruído residual no final do decaimento, quando a razão fica instável).
  const stableFrames = envelope.filter((f) => f.combEnergyDb >= -10);
  const frames = stableFrames.length >= 3 ? stableFrames : envelope;

  const ratiosDb = frames.map((f) => f.combEnergyDb - f.outsideEnergyDb);
  const hnrDb = ratiosDb.reduce((a, b) => a + b, 0) / ratiosDb.length;

  return { hnrDb, isClean: hnrDb >= CLEAN_THRESHOLD_DB };
}
