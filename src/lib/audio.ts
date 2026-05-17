import { Howl, Howler } from "howler";
import { toAssetUrl } from "./assetUrl";
import { ensureAnalyser } from "./audioAnalyser";

let sound: Howl | null = null;
let endCallback: (() => void) | null = null;

function formatFromPath(path: string): string | undefined {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (!ext) return undefined;
  if (ext === "m4a") return "mp4";
  return ext;
}

export function load(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    unload();
    void toAssetUrl(path).then((src) => {
      loadHowl(src, path, resolve, reject);
    }, reject);
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
      onload: () => resolve(),
      onloaderror: (_id, err) => {
        reject(new Error(`Failed to load audio (${src}): ${String(err)}`));
      },
      onplayerror: (_id, err) => {
        reject(new Error(`Failed to play audio (${src}): ${String(err)}`));
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
