// FFT radix-2 (Cooley-Tukey) própria, sem dependências externas.
// N deve ser potência de 2. Opera in-place sobre arrays de reais/imaginários.

export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * FFT radix-2 in-place (decimação no tempo, iterativa).
 * re/im devem ter comprimento igual a uma potência de 2.
 */
export function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n <= 1) return;
  if ((n & (n - 1)) !== 0) {
    throw new Error("fftInPlace: comprimento deve ser potência de 2");
  }

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curWr = 1;
      let curWi = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k]!;
        const uIm = im[i + k]!;
        const vRe = re[i + k + len / 2]! * curWr - im[i + k + len / 2]! * curWi;
        const vIm = re[i + k + len / 2]! * curWi + im[i + k + len / 2]! * curWr;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;
        const nextWr = curWr * wr - curWi * wi;
        const nextWi = curWr * wi + curWi * wr;
        curWr = nextWr;
        curWi = nextWi;
      }
    }
  }
}

/** Aplica janela de Hann in-place a um buffer de amostras. */
export function applyHannWindow(samples: Float64Array): void {
  const n = samples.length;
  for (let i = 0; i < n; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    samples[i] = samples[i]! * w;
  }
}

export interface SpectrumResult {
  /** Magnitude linear por bin, comprimento N/2 */
  magnitudes: Float64Array;
  /** Resolução em Hz por bin */
  binHz: number;
  sampleRate: number;
  fftSize: number;
}

/**
 * Calcula o espectro de magnitude de um buffer de amostras (aplica Hann internamente).
 * O buffer de entrada NÃO é modificado.
 */
export function computeSpectrum(samples: Float64Array, sampleRate: number): SpectrumResult {
  const n = samples.length;
  const re = new Float64Array(n);
  re.set(samples);
  applyHannWindow(re);
  const im = new Float64Array(n);
  fftInPlace(re, im);
  const half = n / 2;
  const magnitudes = new Float64Array(half);
  // Normalização pela metade da janela de Hann (soma dos coeficientes ~ n/2)
  const norm = 2 / (n * 0.5);
  for (let i = 0; i < half; i++) {
    magnitudes[i] = Math.sqrt(re[i]! * re[i]! + im[i]! * im[i]!) * norm;
  }
  return { magnitudes, binHz: sampleRate / n, sampleRate, fftSize: n };
}

/**
 * Interpolação parabólica de 3 pontos ao redor de um bin de pico para refinar
 * a estimativa de frequência além da resolução do bin.
 * Retorna { freqHz, magnitude } refinados.
 */
export function parabolicPeakInterpolation(
  magnitudes: Float64Array,
  peakBin: number,
  binHz: number
): { freqHz: number; magnitude: number } {
  const n = magnitudes.length;
  if (peakBin <= 0 || peakBin >= n - 1) {
    return { freqHz: peakBin * binHz, magnitude: magnitudes[peakBin] ?? 0 };
  }
  const yLeft = magnitudes[peakBin - 1]!;
  const yCenter = magnitudes[peakBin]!;
  const yRight = magnitudes[peakBin + 1]!;
  // Interpolação em escala log evita viés perto de picos assimétricos.
  const a = Math.log(Math.max(yLeft, 1e-12));
  const b = Math.log(Math.max(yCenter, 1e-12));
  const c = Math.log(Math.max(yRight, 1e-12));
  const denom = a - 2 * b + c;
  const p = denom === 0 ? 0 : (0.5 * (a - c)) / denom;
  const clampedP = Math.max(-1, Math.min(1, p));
  const refinedBin = peakBin + clampedP;
  const freqHz = refinedBin * binHz;
  const magnitude = yCenter - 0.25 * (yLeft - yRight) * p;
  return { freqHz, magnitude };
}
