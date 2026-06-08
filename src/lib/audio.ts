import { Howl, Howler } from "howler";
import { toAssetUrl } from "./assetUrl";
import { ensureAnalyser } from "./audioAnalyser";

let sound: Howl | null = null;
let endCallback: (() => void) | null = null;
let loadPending = false;

export interface RecoverAfterWakeOptions {
  wasPlaying: boolean;
  positionSeconds: number;
  filePath: string | null;
}

export interface RecoverAfterWakeResult {
  restarted: boolean;
  reloaded: boolean;
}

function formatFromPath(path: string): string | undefined {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (!ext) return undefined;
  if (ext === "m4a") return "mp4";
  return ext;
}

export function load(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    unload();
    loadPending = true;
    void toAssetUrl(path).then((src) => {
      loadHowl(src, path, resolve, reject);
    }, (err) => {
      loadPending = false;
      reject(err);
    });
  });
}

function loadHowl(
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
        loadPending = false;
        resolve();
      },
      onloaderror: (_id, err) => {
        loadPending = false;
        reject(new Error(`Failed to load audio (${src}): ${String(err)}`));
      },
      onplayerror: (_id, err) => {
        const error = new Error(`Failed to play audio (${src}): ${String(err)}`);
        if (loadPending) {
          loadPending = false;
          reject(error);
        } else {
          console.error(error);
        }
      },
      onend: () => {
        endCallback?.();
      },
    };

    if (format) {
      howlOptions.format = [format];
    }

    sound = new Howl(howlOptions);
}

export function unload(): void {
  if (sound) {
    sound.unload();
    sound = null;
  }
}

export function play(): void {
  ensureAnalyser();
  sound?.play();
}

export function pause(): void {
  sound?.pause();
}

export function seek(ratio: number): void {
  if (!sound) return;
  const duration = sound.duration();
  if (!duration || !Number.isFinite(duration)) return;
  sound.seek(Math.max(0, Math.min(1, ratio)) * duration);
}

export function getPositionSeconds(): number {
  if (!sound) return 0;
  const pos = sound.seek();
  return typeof pos === "number" ? pos : 0;
}

export function getDurationSeconds(): number {
  if (!sound) return 0;
  const duration = sound.duration();
  return Number.isFinite(duration) ? duration : 0;
}

export function isPlaying(): boolean {
  return sound?.playing() ?? false;
}

export function onEnd(callback: () => void): void {
  endCallback = callback;
}

export function setVolume(volume: number): void {
  Howler.volume(Math.max(0, Math.min(1, volume)));
}

export function getVolume(): number {
  return Howler.volume();
}

export function setMuted(muted: boolean): void {
  Howler.mute(muted);
}

function contextNeedsResume(): boolean {
  const ctx = Howler.ctx;
  if (!ctx) return false;
  const state = ctx.state as string;
  return state === "suspended" || state === "interrupted";
}

export async function resumeAudioContext(): Promise<void> {
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
export function restartPlaybackAt(positionSeconds: number): void {
  if (!sound) return;

  sound.pause();
  const duration = sound.duration();
  if (positionSeconds > 0 && Number.isFinite(duration) && duration > 0) {
    sound.seek(positionSeconds);
  }
  ensureAnalyser();
  sound.play();
}

const RECOVERY_PLAY_CHECK_MS = 100;

export async function recoverAfterWake(
  options: RecoverAfterWakeOptions,
): Promise<RecoverAfterWakeResult> {
  await resumeAudioContext();

  if (!sound || !options.filePath || !options.wasPlaying) {
    return { restarted: false, reloaded: false };
  }

  restartPlaybackAt(options.positionSeconds);
  await new Promise((resolve) => setTimeout(resolve, RECOVERY_PLAY_CHECK_MS));

  if (isPlaying()) {
    return { restarted: true, reloaded: false };
  }

  try {
    const positionSeconds = options.positionSeconds;
    await load(options.filePath);
    const duration = getDurationSeconds();
    if (positionSeconds > 0 && duration > 0) {
      seek(positionSeconds / duration);
    }
    play();
    return { restarted: true, reloaded: true };
  } catch (err) {
    console.error("Audio wake recovery reload failed:", err);
    return { restarted: false, reloaded: false };
  }
}
