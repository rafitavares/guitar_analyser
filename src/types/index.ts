// Tipos centrais do domínio do Analisador Acústico de Violão.
// Todas as sessões salvas devem incluir sampleRate e protocolVersion
// para que comparações futuras permaneçam válidas.

export const PROTOCOL_VERSION = 1;

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

export interface HarmonicPeak {
  partialNumber: number;
  expectedHz: number;
  measuredHz: number;
  amplitudeDb: number; // relativo à fundamental (0 = igual à fundamental)
  noteName: string;
  centsDeviation: number;
  inharmonicityCents: number; // desvio do harmônico perfeito n*f0
}

export interface SustainResult {
  t60EstimatedSec: number;
  method: "T20" | "T30";
  decayCurve: { timeSec: number; db: number }[];
  noiseFloorDb: number;
  fitR2: number;
}

export interface HarmonicPortraitResult {
  fundamentalHz: number;
  spectralCentroidHz: number;
  peaks: HarmonicPeak[];
  spectrumSnapshot: { freqHz: number; db: number }[];
}

export interface InharmonicityResult {
  peaks: HarmonicPeak[];
  bCoefficient: number | null;
}

export interface BeatingResult {
  detected: boolean;
  modulationFreqHz: number | null;
  depthDb: number | null;
  involvedFreqsHz: [number, number] | null;
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
  /** Envelope bruto (dB relativo ao pico) x tempo, sem integração de Schroeder — usado no gráfico de batimento. */
  rawEnvelope?: { timeSec: number; db: number }[];
  sustain?: SustainResult;
  portrait?: HarmonicPortraitResult;
  inharmonicity?: InharmonicityResult;
  beating?: BeatingResult;
  hnr?: HnrResult;
}

export interface NoteMeasurement {
  stringNumber: number;
  noteName: string;
  fret: number;
  expectedFrequencyHz: number;
  takes: NoteTakeResult[];
  /** Índice da tomada usada como mediana/representativa */
  medianTakeIndex: number | null;
}

export type TestId =
  | "sustain"
  | "harmonicPortrait"
  | "inharmonicity"
  | "beating"
  | "hnr"
  | "semitoneSweep";

export interface TestRunResult {
  testId: TestId;
  measurements: NoteMeasurement[];
  completedAt: string;
}

export interface Session {
  id: string;
  instrumentId: string;
  instrumentSnapshot: Instrument;
  conditions: CaptureConditions;
  noiseFloor: NoiseFloorProfile | null;
  sampleRate: number;
  protocolVersion: number;
  tests: Partial<Record<TestId, TestRunResult>>;
  createdAt: string;
  updatedAt: string;
}

export interface ComparisonWeights {
  sustain: { weight: number; direction: "more" | "less" };
  brightness: { weight: number; direction: "more" | "less" };
  balance: { weight: number; direction: "more" | "less" };
  hnr: { weight: number }; // sempre "mais é melhor"
  inharmonicity: { weight: number }; // sempre "menos é melhor"
  uniformity: { weight: number }; // sempre "mais é melhor"
  wolfNotes: { weight: number }; // sempre "menos é melhor"
}
