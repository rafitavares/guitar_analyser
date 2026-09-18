// Cálculo de T60 estimado via integração de Schroeder (backward integration)
// + ajuste linear na região de -5dB a -25/-35dB, extrapolado para -60dB.

import type { EnvelopeFrame } from "./noteCapture.ts";
import type { SustainResult } from "../types/index.ts";

/**
 * Integração de Schroeder: E(t) = integral de t até o fim de p(τ)² dτ,
 * em escala de energia (não dB). Aqui trabalhamos a partir do envelope em dB
 * relativo ao pico, convertendo de volta para energia linear antes de integrar.
 */
function schroederIntegration(envelope: EnvelopeFrame[]): { timeSec: number; db: number }[] {
  if (envelope.length === 0) return [];
  const energies = envelope.map((f) => Math.pow(10, f.combEnergyDb / 10));
  const n = energies.length;
  const cumulative = new Array<number>(n);
  let sum = 0;
  for (let i = n - 1; i >= 0; i--) {
    sum += energies[i]!;
    cumulative[i] = sum;
  }
  const total = cumulative[0]! || 1e-12;
  return envelope.map((f, i) => ({
    timeSec: f.timeSec,
    db: 10 * Math.log10(Math.max(cumulative[i]! / total, 1e-12)),
  }));
}

/** Regressão linear simples (mínimos quadrados) de y sobre x. Retorna slope, intercept, R². */
function linearRegression(
  points: { x: number; y: number }[]
): { slope: number; intercept: number; r2: number } {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: 0, r2: 0 };
  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumXX = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumXX += p.x * p.x;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  const denom = sumXX - n * meanX * meanX;
  const slope = denom === 0 ? 0 : (sumXY - n * meanX * meanY) / denom;
  const intercept = meanY - slope * meanX;
  let ssRes = 0,
    ssTot = 0;
  for (const p of points) {
    const predicted = slope * p.x + intercept;
    ssRes += (p.y - predicted) ** 2;
    ssTot += (p.y - meanY) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  return { slope, intercept, r2 };
}

export function analyzeSustain(envelope: EnvelopeFrame[], noiseFloorDb: number): SustainResult {
  const schroederCurve = schroederIntegration(envelope);

  // Tenta T30 (-5 a -35dB) primeiro; cai para T20 (-5 a -25dB) se não houver
  // decaimento suficiente antes do piso de ruído.
  const tryFit = (
    fromDb: number,
    toDb: number
  ): { slope: number; intercept: number; r2: number; count: number } => {
    const points = schroederCurve
      .filter((p) => p.db <= fromDb && p.db >= toDb)
      .map((p) => ({ x: p.timeSec, y: p.db }));
    const fit = linearRegression(points);
    return { ...fit, count: points.length };
  };

  const fit30 = tryFit(-5, -35);
  const fit20 = tryFit(-5, -25);

  let method: "T20" | "T30" = "T30";
  let fit = fit30;
  if (fit30.count < 4) {
    method = "T20";
    fit = fit20;
  }

  let t60EstimatedSec = 0;
  if (fit.slope < 0) {
    // dB(t) = slope*t + intercept; queremos t onde dB = -60
    t60EstimatedSec = (-60 - fit.intercept) / fit.slope;
  }
  t60EstimatedSec = Math.max(0, t60EstimatedSec);

  return {
    t60EstimatedSec,
    method,
    decayCurve: schroederCurve,
    noiseFloorDb,
    fitR2: fit.r2,
  };
}
