import { Howl, Howler } from "howler";
import { formatAssetForDisplay, toAssetUrl } from "../assetUrl";
import {
  connectDeckOutput,
  disconnectDeckOutput,
  getAnalyser,
  getDeckGainNode,
  setDeckGain,
  type DeckId,
} from "./audioOutput";
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

interface HowlSoundInternal {
  _id?: number;
  _node?: GainNode;
}

interface HowlInternal extends Howl {
  _sounds?: HowlSoundInternal[];
}

function formatFromPath(path: string): string | undefined {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (!ext) return undefined;
  if (ext === "m4a" || ext === "mp4") return "mp4";
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
  private loadGeneration = 0;
  private balance = 0;
  private deckId: DeckId = "a";
  private playId: number | null = null;
  private suppressEndCallback = false;
  private routedSource: AudioNode | null = null;
  private userVolume = 1;
  private userMuted = false;
  private crossfadeMix = 1;

  setDeckId(deckId: DeckId): void {
    this.deckId = deckId;
  }

  getDeckId(): DeckId {
    return this.deckId;
  }

  /** Suppress the next onEnd notification (outgoing deck during crossfade). */
  setSuppressEndCallback(suppress: boolean): void {
    this.suppressEndCallback = suppress;
  }

  /** Crossfade mix level (0–1) on the deck gain; user volume is on the Howl. */
  setCrossfadeMix(mix: number): void {
    this.crossfadeMix = Math.max(0, Math.min(1, mix));
    if (getDeckGainNode(this.deckId)) {
      setDeckGain(this.deckId, this.crossfadeMix);
    }
  }

  private getPlayingSoundNode(): GainNode | null {
    if (!this.sound) return null;
    const howl = this.sound as HowlInternal;
    const sounds = howl._sounds ?? [];
    if (this.playId !== null) {
      const match = sounds.find((entry) => entry._id === this.playId);
      if (match?._node) return match._node;
    }
    const playing = sounds.find((entry) => entry._node);
    return playing?._node ?? null;
  }

  getOutputNode(): AudioNode | null {
    return this.getPlayingSoundNode() ?? Howler.masterGain ?? null;
  }

  async load(source: PlaybackSource): Promise<void> {
    if (source.kind !== "file") {
      throw new Error(`FilePlaybackEngine cannot load source kind: ${source.kind}`);
    }

    const generation = ++this.loadGeneration;

    return new Promise((resolve, reject) => {
      this.unload();
      this.loadPending = true;

      const finishSuperseded = () => {
        this.loadPending = false;
        resolve();
      };

      void toAssetUrl(source.path).then(
        (src) => {
          if (generation !== this.loadGeneration) {
            finishSuperseded();
            return;
          }
          this.loadHowl(
            src,
            source.path,
            generation,
            resolve,
            reject,
            finishSuperseded,
          );
        },
        (err) => {
          if (generation !== this.loadGeneration) {
            finishSuperseded();
            return;
          }
          this.loadPending = false;
          reject(err);
        },
      );
    });
  }

  private loadHowl(
    src: string,
    path: string,
    generation: number,
    resolve: () => void,
    reject: (reason: Error) => void,
    finishSuperseded: () => void,
  ): void {
    if (generation !== this.loadGeneration) {
      finishSuperseded();
      return;
    }

    const format = formatFromPath(path);
    const label = formatAssetForDisplay(path);

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
        if (generation !== this.loadGeneration) {
          finishSuperseded();
          return;
        }
        this.loadPending = false;
        resolve();
      },
      onloaderror: (_id, err) => {
        if (generation !== this.loadGeneration) {
          finishSuperseded();
          return;
        }
        this.loadPending = false;
        reject(new Error(`Failed to load audio (${label}): ${String(err)}`));
      },
      onplayerror: (_id, err) => {
        if (generation !== this.loadGeneration) {
          return;
        }
        const error = new Error(`Failed to play audio (${label}): ${String(err)}`);
        if (this.loadPending) {
          this.loadPending = false;
          reject(error);
        } else {
          console.error(error);
        }
      },
      onend: () => {
        if (this.suppressEndCallback) return;
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
    this.routedSource = null;
    this.playId = null;
    this.crossfadeMix = 1;
  }

  play(): void {
    if (this.sound) {
      this.playId = this.sound.play();
    } else {
      this.playId = null;
    }
    this.connectToOutputBus();
    this.applyHowlVolume();
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
    this.userVolume = Math.max(0, Math.min(1, volume));
    this.applyHowlVolume();
  }

  getVolume(): number {
    return this.userVolume;
  }

  private applyHowlVolume(): void {
    Howler.volume(1);
    Howler.mute(false);
    const effective = this.userMuted ? 0 : this.userVolume;
    if (this.sound && this.playId !== null) {
      this.sound.volume(effective, this.playId);
    }
  }

  setBalance(balance: number): void {
    this.balance = Math.max(-1, Math.min(1, balance));
    Howler.stereo(this.balance);
  }

  getBalance(): number {
    return this.balance;
  }

  setMuted(muted: boolean): void {
    this.userMuted = muted;
    this.applyHowlVolume();
  }

  destroy(): void {
    this.unload();
    disconnectDeckOutput(this.deckId);
    this.routedSource = null;
  }

  connectToOutputBus(): AnalyserNode | null {
    const soundNode = this.getPlayingSoundNode();
    const source = soundNode ?? Howler.masterGain;
    if (!source) return null;

    if (this.routedSource === source) {
      return getAnalyser() ?? connectDeckOutput(this.deckId, source);
    }

    if (soundNode) {
      try {
        soundNode.disconnect();
      } catch {
        // already disconnected from Howler master bus
      }
    }

    this.routedSource = source;
    const analyser = connectDeckOutput(this.deckId, source);
    this.setCrossfadeMix(this.crossfadeMix);
    return analyser;
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

    this.routedSource = null;
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
