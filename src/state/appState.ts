import { startCapture } from "../audio/capture.ts";
import type { CaptureHandle } from "../audio/capture.ts";
import type { CaptureConditions, Instrument, NoiseFloorProfile, Session } from "../types/index.ts";

export interface DraftSessionState {
  instrument: Instrument;
  conditions: CaptureConditions;
  noiseFloor: NoiseFloorProfile | null;
  session: Session | null;
}

class AppState {
  capture: CaptureHandle | null = null;
  draft: DraftSessionState | null = null;

  async ensureCapture(): Promise<CaptureHandle> {
    if (this.capture) return this.capture;
    this.capture = await startCapture();
    return this.capture;
  }

  stopCapture(): void {
    this.capture?.stop();
    this.capture = null;
  }

  reset(): void {
    this.draft = null;
  }
}

export const appState = new AppState();
