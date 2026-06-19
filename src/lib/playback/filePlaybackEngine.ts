import { Howl, Howler } from "howler";
import { toAssetUrl } from "../assetUrl";
import { connectEngineOutput, disconnectEngineOutput } from "./audioOutput";
import type {
  PlaybackCapabilities,
  PlaybackEngine,
  PlaybackSource,
  RecoverOptions,
  RecoverResult,
} from "./types";

const FILE_CAPABILITIES: PlaybackCapabilities = {
  seek: true,
  scrubPreview: true,
  gapless: false,
  visualizer: true,
  recoverAfterWake: true,
};

const RECOVERY_PLAY_CHECK_MS = 100;

function formatFromPath(path: string): string | undefined {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (!ext) return undefined;
  if (ext === "m4a") return "mp4";
  return ext;
}

function contextNeedsResume(): boolean {
  const ctx = Howler.ctx;
  if (!ctx) return false;
  const state = ctx.state as string;
  return state === "suspended" || state === "interrupted";
}

export class FilePlaybackEngine implements PlaybackEngine {
  readonly capabilities = FILE_CAPABILITIES;

  private sound: Howl | null = null;
  private endCallback: (() => void) | null = null;
  private loadPending = false;
  private balance = 0;

  async load(source: PlaybackSource): Promise<void> {
    if (source.kind !== "file") {
      throw new Error(`FilePlaybackEngine cannot load source kind: ${source.kind}`);
    }

    return new Promise((resolve, reject) => {
      this.unload();
      this.loadPending = true;

      void toAssetUrl(source.path).then(
        (src) => {
          this.loadHowl(src, source.path, resolve, reject);
        },
        (err) => {
          this.loadPending = false;
          reject(err);
        },
      );
    });
  }

  private loadHowl(
    src: string,
    path: string,
    resolve: () => void,
    reject: (reason: Error) => void,
  ): void {
    const format = formatFromPath(path);

    const howlOptions: {
      src: string[];
      html5: boolean;
      format?: string[];
      onload: () => void;
      onloaderror: (_id: number, err: unknown) => void;
      onplayerror: (_id: number, err: unknown) => void;
      onend: () => void;
    } = {
      src: [src],
      html5: false,
      onload: () => {
        this.loadPending = false;
        resolve();
      },
      onloaderror: (_id, err) => {
        this.loadPending = false;
        reject(new Error(`Failed to load audio (${src}): ${String(err)}`));
      },
      onplayerror: (_id, err) => {
        const error = new Error(`Failed to play audio (${src}): ${String(err)}`);
        if (this.loadPending) {
          this.loadPending = false;
          reject(error);
        } else {
          console.error(error);
        }
      },
      onend: () => {
        this.endCallback?.();
      },
    };

    if (format) {
      howlOptions.format = [format];
    }

    this.sound = new Howl(howlOptions);
  }

  private unload(): void {
    if (this.sound) {
      this.sound.unload();
      this.sound = null;
    }
  }

  play(): void {
    this.connectToOutputBus();
    this.sound?.play();
  }

  pause(): void {
    this.sound?.pause();
  }

  seek(seconds: number): void {
    if (!this.sound) return;
    const duration = this.sound.duration();
    if (!duration || !Number.isFinite(duration)) return;
    this.sound.seek(Math.max(0, Math.min(seconds, duration)));
  }

  getPositionSeconds(): number {
    if (!this.sound) return 0;
    const pos = this.sound.seek();
    return typeof pos === "number" ? pos : 0;
  }

  getDurationSeconds(): number {
    if (!this.sound) return 0;
    const duration = this.sound.duration();
    return Number.isFinite(duration) ? duration : 0;
  }

  isPlaying(): boolean {
    return this.sound?.playing() ?? false;
  }

  onEnd(callback: () => void): void {
    this.endCallback = callback;
  }

  setVolume(volume: number): void {
    Howler.volume(Math.max(0, Math.min(1, volume)));
  }

  getVolume(): number {
    return Howler.volume();
  }

  setBalance(balance: number): void {
    this.balance = Math.max(-1, Math.min(1, balance));
    Howler.stereo(this.balance);
  }

  getBalance(): number {
    return this.balance;
  }

  setMuted(muted: boolean): void {
    Howler.mute(muted);
  }

  destroy(): void {
    this.unload();
    disconnectEngineOutput();
  }

  connectToOutputBus(): AnalyserNode | null {
    const masterGain = Howler.masterGain;
    if (!masterGain) return null;
    return connectEngineOutput(masterGain);
  }

  async resumeAudioContext(): Promise<void> {
    const ctx = Howler.ctx;
    if (!ctx || typeof ctx.resume !== "function" || !contextNeedsResume()) {
      return;
    }

    try {
      await ctx.resume();
    } catch (err) {
      console.warn("AudioContext resume failed:", err);
    }
  }

  /** Pause and replay so Howler does not no-op when it still thinks a track is playing. */
  restartPlaybackAt(positionSeconds: number): void {
    if (!this.sound) return;

    this.sound.pause();
    const duration = this.sound.duration();
    if (positionSeconds > 0 && Number.isFinite(duration) && duration > 0) {
      this.sound.seek(positionSeconds);
    }
    this.connectToOutputBus();
    this.sound.play();
  }

  async recover(options: RecoverOptions): Promise<RecoverResult> {
    const neededResume = contextNeedsResume();
    await this.resumeAudioContext();

    const filePath =
      options.source?.kind === "file" ? options.source.path : null;

    if (!this.sound || !filePath || !options.wasPlaying) {
      return { restarted: false, reloaded: false };
    }

    // Keepalive likely kept output alive — skip pause/seek/play that causes audible skip.
    if (!neededResume && this.isPlaying()) {
      return { restarted: false, reloaded: false, alreadyHealthy: true };
    }

    const livePosition = this.getPositionSeconds();
    const positionSeconds =
      livePosition > 0 ? livePosition : options.positionSeconds;
    this.restartPlaybackAt(positionSeconds);
    await new Promise((resolve) => setTimeout(resolve, RECOVERY_PLAY_CHECK_MS));

    if (this.isPlaying()) {
      return { restarted: true, reloaded: false };
    }

    try {
      await this.load({ kind: "file", path: filePath });
      const duration = this.getDurationSeconds();
      if (positionSeconds > 0 && duration > 0) {
        this.seek(positionSeconds);
      }
      this.play();
      return { restarted: true, reloaded: true };
    } catch (err) {
      console.error("Audio wake recovery reload failed:", err);
      return { restarted: false, reloaded: false };
    }
  }
}
