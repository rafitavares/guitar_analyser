import { startCapture } from "../audio/capture.ts";
import type { CaptureHandle } from "../audio/capture.ts";

class AppState {
  capture: CaptureHandle | null = null;

  async ensureCapture(): Promise<CaptureHandle> {
    if (this.capture) return this.capture;
    this.capture = await startCapture();
    return this.capture;
  }

  stopCapture(): void {
    this.capture?.stop();
    this.capture = null;
  }
}

export const appState = new AppState();
