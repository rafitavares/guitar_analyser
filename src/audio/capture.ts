// Captura de áudio via getUserMedia com todos os processamentos do navegador
// desligados (CRÍTICO: echoCancellation/noiseSuppression/autoGainControl
// distorcem a medição acústica). Mantém um ring buffer por canal — a
// maioria dos celulares só tem microfone mono (os dois canais vêm
// idênticos), mas alguns aparelhos/microfones externos fornecem estéreo
// de verdade, então expomos o que o hardware realmente entregar.

import { nextPowerOfTwo } from "./fft.ts";

export interface CaptureHandle {
  audioContext: AudioContext;
  sampleRate: number;
  stream: MediaStream;
  channelCount: number;
  /** Lê as N amostras mais recentes do canal indicado (0 = esquerdo/único, 1 = direito). */
  getLatestSamples: (windowSizeSamples: number, channel?: number) => Float64Array;
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
      channelCount: { ideal: 2 },
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

  const track = stream.getAudioTracks()[0];
  const settings = track?.getSettings?.();
  const channelCount = Math.max(1, Math.min(2, settings?.channelCount ?? sourceNode.channelCount ?? 1));

  const ringSize = nextPowerOfTwo(sampleRate * RING_BUFFER_SECONDS);
  const ringBuffers = Array.from({ length: channelCount }, () => new Float64Array(ringSize));
  let writeIndex = 0;

  const bufferSize = 4096;
  const processor = audioContext.createScriptProcessor(bufferSize, channelCount, channelCount);
  processor.onaudioprocess = (event) => {
    const inputBuffer = event.inputBuffer;
    const availableChannels = Math.min(channelCount, inputBuffer.numberOfChannels);
    const channelData: Float32Array[] = [];
    for (let c = 0; c < availableChannels; c++) {
      channelData.push(inputBuffer.getChannelData(c));
    }
    const frameLength = channelData[0]?.length ?? 0;
    let localWrite = writeIndex;
    for (let i = 0; i < frameLength; i++) {
      for (let c = 0; c < channelCount; c++) {
        const source = channelData[c] ?? channelData[0]!;
        ringBuffers[c]![localWrite] = source[i]!;
      }
      localWrite = (localWrite + 1) % ringSize;
    }
    writeIndex = localWrite;
  };

  sourceNode.connect(processor);
  // Nó de destino silencioso é necessário para o ScriptProcessor rodar em
  // alguns navegadores, sem produzir áudio audível.
  const silentGain = audioContext.createGain();
  silentGain.gain.value = 0;
  processor.connect(silentGain);
  silentGain.connect(audioContext.destination);

  function getLatestSamples(windowSizeSamples: number, channel = 0): Float64Array {
    const buffer = ringBuffers[Math.min(channel, ringBuffers.length - 1)]!;
    const size = Math.min(windowSizeSamples, ringSize);
    const out = new Float64Array(size);
    let readIndex = (writeIndex - size + ringSize) % ringSize;
    for (let i = 0; i < size; i++) {
      out[i] = buffer[readIndex]!;
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
      silentGain.disconnect();
    } catch {
      // ignore
    }
    for (const t of stream.getTracks()) t.stop();
    void audioContext.close();
  }

  return { audioContext, sampleRate, stream, channelCount, getLatestSamples, ensureRunning, stop };
}

/** Calcula o RMS linear de um buffer de amostras. */
export function computeRms(samples: Float64Array): number {
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    sumSq += samples[i]! * samples[i]!;
  }
  return Math.sqrt(sumSq / samples.length);
}

/** Amplitude de pico (valor absoluto máximo) de um buffer de amostras. */
export function computePeakAmplitude(samples: Float64Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]!);
    if (abs > peak) peak = abs;
  }
  return peak;
}
