// Conversão frequência <-> nota musical, com A4 de referência configurável.

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export interface NoteInfo {
  noteName: string; // ex.: "E2"
  /** Semitons de distância do A4 (pode ser fracionário antes de arredondar) */
  semitoneFromA4: number;
  centsDeviation: number;
  frequencyHz: number;
}

/** Converte frequência em Hz para a nota temperada mais próxima, dado A4 de referência. */
export function frequencyToNote(freqHz: number, a4Hz: number): NoteInfo {
  if (freqHz <= 0) {
    return { noteName: "-", semitoneFromA4: 0, centsDeviation: 0, frequencyHz: freqHz };
  }
  const n = 12 * Math.log2(freqHz / a4Hz);
  const rounded = Math.round(n);
  const centsDeviation = (n - rounded) * 100;
  // A4 = índice 9 na oitava 4. MIDI-like: octava = 4 + floor((rounded+9)/12)
  const noteIndex = (((rounded + 9) % 12) + 12) % 12;
  const octave = 4 + Math.floor((rounded + 9) / 12);
  const noteName = `${NOTE_NAMES[noteIndex]}${octave}`;
  return { noteName, semitoneFromA4: rounded, centsDeviation, frequencyHz: freqHz };
}

/** Converte nota (ex.: "E2") + A4 de referência para frequência em Hz. */
export function noteToFrequency(noteName: string, a4Hz: number): number {
  const match = /^([A-G]#?)(-?\d+)$/.exec(noteName.trim());
  if (!match) throw new Error(`Nota inválida: ${noteName}`);
  const [, pitch, octaveStr] = match;
  const octave = parseInt(octaveStr!, 10);
  const noteIndex = NOTE_NAMES.indexOf(pitch!);
  if (noteIndex < 0) throw new Error(`Nota inválida: ${noteName}`);
  const semitoneFromA4 = noteIndex - 9 + (octave - 4) * 12;
  return a4Hz * Math.pow(2, semitoneFromA4 / 12);
}

/** Desloca uma nota por um número de semitons (usado na varredura cromática). */
export function transposeNote(noteName: string, semitones: number, a4Hz: number): string {
  const freq = noteToFrequency(noteName, a4Hz) * Math.pow(2, semitones / 12);
  return frequencyToNote(freq, a4Hz).noteName;
}

export function amplitudeToDb(amplitude: number, reference = 1): number {
  const safe = Math.max(amplitude, 1e-12);
  return 20 * Math.log10(safe / reference);
}

export function dbToAmplitude(db: number, reference = 1): number {
  return reference * Math.pow(10, db / 20);
}
