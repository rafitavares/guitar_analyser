// Captura de áudio via getUserMedia com todos os processamentos do navegador
// desligados (CRÍTICO: echoCancellation/noiseSuppression/autoGainControl
// distorcem a medição acústica).

import { nextPowerOfTwo } from "./fft.ts";

export interface CaptureHandle {
  audioContext: AudioContext;
  sampleRate: number;
  stream: MediaStream;
  analyserNode: AnalyserNode;
  sourceNode: MediaStreamAudioSourceNode;
  /** Lê os N amostras mais recentes do buffer circular (janela de análise). */
  getLatestSamples: (windowSizeSamples: number) => Float64Array;
  /** Garante que o AudioContext esteja rodando (retoma se estiver suspenso). */
  ensureRunning: () => Promise<void>;
  stop: () => void;
}

const RING_BUFFER_SECONDS = 4;

export async function startCapture(): Promise<CaptureHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
  });

  const audioContext = new AudioContext();
  // Em vários navegadores móveis (especialmente iOS Safari) o AudioContext
  // pode nascer suspenso, ou ser suspenso automaticamente pelo sistema.
  // Enquanto suspenso, nenhum callback de processamento roda — o buffer
  // fica sempre zerado e nenhuma nota é detectada, sem erro nenhum
  // aparecer. Resume explícito aqui e a cada nova tomada evita esse
  // travamento silencioso.
  if (audioContext.state !== "running") {
    await audioContext.resume();
  }
  const sampleRate = audioContext.sampleRate;
  const sourceNode = audioContext.createMediaStreamSource(stream);

  const analyserNode = audioContext.createAnalyser();
  analyserNode.fftSize = 32768;
  analyserNode.smoothingTimeConstant = 0;

  // Buffer circular alimentado por um ScriptProcessor/AudioWorklet-like via
  // captura periódica do analyser não é suficiente para janelas longas
  // contínuas; usamos um ScriptProcessorNode simples (amplamente suportado)
  // para acumular amostras cruas em um ring buffer.
  const ringSize = nextPowerOfTwo(sampleRate * RING_BUFFER_SECONDS);
  const ringBuffer = new Float64Array(ringSize);
  let writeIndex = 0;

  const bufferSize = 4096;
  const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);
  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    for (let i = 0; i < input.length; i++) {
      ringBuffer[writeIndex] = input[i]!;
      writeIndex = (writeIndex + 1) % ringSize;
    }
  };

  sourceNode.connect(analyserNode);
  sourceNode.connect(processor);
  // Nó de destino silencioso é necessário para o ScriptProcessor rodar em
  // alguns navegadores, sem produzir áudio audível.
  const silentGain = audioContext.createGain();
  silentGain.gain.value = 0;
  processor.connect(silentGain);
  silentGain.connect(audioContext.destination);

  function getLatestSamples(windowSizeSamples: number): Float64Array {
    const size = Math.min(windowSizeSamples, ringSize);
    const out = new Float64Array(size);
    let readIndex = (writeIndex - size + ringSize) % ringSize;
    for (let i = 0; i < size; i++) {
      out[i] = ringBuffer[readIndex]!;
      readIndex = (readIndex + 1) % ringSize;
    }
    return out;
  }

  async function ensureRunning(): Promise<void> {
    if (audioContext.state !== "running") {
      await audioContext.resume();
    }
  }

  function stop() {
    try {
      processor.disconnect();
      sourceNode.disconnect();
      analyserNode.disconnect();
      silentGain.disconnect();
    } catch {
      // ignore
    }
    for (const track of stream.getTracks()) track.stop();
    void audioContext.close();
  }

  return { audioContext, sampleRate, stream, analyserNode, sourceNode, getLatestSamples, ensureRunning, stop };
}

/** Calcula o RMS linear de um buffer de amostras. */
export function computeRms(samples: Float64Array): number {
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    sumSq += samples[i]! * samples[i]!;
  }
  return Math.sqrt(sumSq / samples.length);
}
