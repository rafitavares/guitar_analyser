// Tipos centrais do domínio do Analisador Acústico de Violão.
// Todas as sessões salvas devem incluir sampleRate e protocolVersion
// para que comparações futuras permaneçam válidas.

export const PROTOCOL_VERSION = 2;

export type InstrumentType = "nylon" | "aco";

export interface StringTuning {
  /** 1 = corda mais aguda (mi agudo), 6 = corda mais grave (mi grave), etc. */
  stringNumber: number;
  /** Nome da nota, ex.: "E2" */
  noteName: string;
  /** Frequência alvo em Hz, derivada de noteName + A4 de referência */
  frequencyHz: number;
}

export interface Instrument {
  id: string;
  nickname: string;
  type: InstrumentType;
  topWood: string;
  backSidesWood: string;
  neckWood: string;
  fretboardWood: string;
  stringCount: number;
  tuning: StringTuning[];
  stringBrand: string;
  stringGauge: string;
  stringChangeDate: string; // ISO date
  a4ReferenceHz: number;
  notes: string;
  createdAt: string; // ISO datetime
}

export interface CaptureConditions {
  distanceCm: number;
  roomDescription: string;
  temperatureC: number | null;
  humidityPct: number | null;
  measurementDate: string; // ISO datetime
}

export interface NoiseFloorProfile {
  /** Energia média (RMS linear, 0-1) do piso de ruído */
  rmsLevel: number;
  /** dB relativo do piso de ruído (referência 1.0 = 0dB) */
  dbLevel: number;
  /** Espectro médio do ambiente (magnitude linear por bin) para referência */
  spectrum: Float32Array;
  sampleRate: number;
  fftSize: number;
  measuredAt: string;
}

export interface SustainResult {
  t60EstimatedSec: number;
  method: "T20" | "T30";
  decayCurve: { timeSec: number; db: number }[];
  noiseFloorDb: number;
  fitR2: number;
}

export interface HnrResult {
  hnrDb: number;
  isClean: boolean;
}

export interface NoteTakeResult {
  takeIndex: number;
  valid: boolean;
  discardReason?: string;
  detectedFundamentalHz: number;
  peakAmplitude: number;
  capturedAt: string;
  sustain?: SustainResult;
  hnr?: HnrResult;
}

export interface StringSustainMeasurement {
  stringNumber: number;
  noteName: string;
  expectedFrequencyHz: number;
  takes: NoteTakeResult[];
  /** Índice da tomada usada como mediana/representativa */
  medianTakeIndex: number | null;
}

export interface SustainSessionResult {
  strings: StringSustainMeasurement[];
  completedAt: string;
}

export interface ResonancePeak {
  freqHz: number;
  noteName: string;
  centsDeviation: number;
  /** dB relativo ao pico mais forte detectado (0 = o mais forte) */
  amplitudeDb: number;
}

export interface ResonanceOverlapPair {
  peakAIndex: number;
  peakBIndex: number;
  centsApart: number;
}

export interface ResonanceResult {
  capturedAt: string;
  peaks: ResonancePeak[];
  overlaps: ResonanceOverlapPair[];
  verdict: "separado" | "sobreposto";
}

export type TestId = "sustain" | "resonance";

export interface Session {
  id: string;
  instrumentId: string;
  instrumentSnapshot: Instrument;
  conditions: CaptureConditions;
  noiseFloor: NoiseFloorProfile | null;
  sampleRate: number;
  protocolVersion: number;
  tests: {
    sustain?: SustainSessionResult;
    resonance?: ResonanceResult;
  };
  createdAt: string;
  updatedAt: string;
}

export interface ComparisonWeights {
  sustain: { weight: number; direction: "more" | "less" };
  uniformity: { weight: number }; // sempre "mais é melhor"
  clarity: { weight: number }; // separação harmônica na ressonância, sempre "mais é melhor"
}
