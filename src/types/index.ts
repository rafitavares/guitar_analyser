// Tipos centrais do Analisador Acústico de Violão. O app é uma coleção de
// 3 ferramentas de medição independentes (não mais uma "sessão" guiada):
// Sustentação, Volume e Harmônicos. Cada medição pode ser salva localmente
// com um rótulo simples de instrumento, para consulta/exportação futura.

export const PROTOCOL_VERSION = 3;

export interface NoiseFloorProfile {
  /** RMS linear (0-1) do piso de ruído ambiente */
  rmsLevel: number;
  /** dB relativo do piso de ruído (20*log10, referência 1.0 = 0dB) */
  dbLevel: number;
  sampleRate: number;
  measuredAt: string;
}

export interface SustainRunResult {
  /** Margem acima do piso de ruído usada para disparar a medição (dB) */
  thresholdDb: number;
  decayCurve: { timeSec: number; db: number }[];
  t60EstimatedSec: number;
  method: "T20" | "T30";
  fitR2: number;
  noiseFloorDb: number;
}

export interface VolumeChannelResult {
  channelIndex: number;
  channelLabel: string;
  peakDb: number;
  finalDb: number;
}

export interface VolumeRunResult {
  channels: VolumeChannelResult[];
  durationSec: number;
}

export interface HarmonicPeakResult {
  freqHz: number;
  noteName: string;
  centsDeviation: number;
  /** dB relativo ao pico mais forte do peak-hold (0 = o mais forte) */
  amplitudeDb: number;
}

export interface HarmonicsRunResult {
  /** Rótulo livre da nota/corda selecionada antes de tocar (ex.: "E2 (corda 6)") */
  noteLabel: string;
  a4ReferenceHz: number;
  /** Envelope de peak-hold (máximo já observado por bin), reduzido para poucos pontos */
  peakHoldSpectrum: { freqHz: number; db: number }[];
  peaks: HarmonicPeakResult[];
  durationSec: number;
}

export type TestKind = "sustain" | "volume" | "harmonics";

export interface SavedTestResult {
  id: string;
  testKind: TestKind;
  instrumentName: string;
  sampleRate: number;
  noiseFloorDb: number;
  createdAt: string;
  protocolVersion: number;
  sustain?: SustainRunResult;
  volume?: VolumeRunResult;
  harmonics?: HarmonicsRunResult;
}
