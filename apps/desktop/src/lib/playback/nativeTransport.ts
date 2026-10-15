import type { PlaybackSource } from "./types";

/** Commands and events that belong to one medium of native playback. */
export interface NativeTransport {
  readonly kind: "file" | "cd";
  accepts(source: PlaybackSource): boolean;
  startArgs(source: PlaybackSource): Record<string, unknown>;
  /**
   * Seconds short of the end that seeks stop at. Symphonia rejects exact-EOS
   * seeks (files); CD seeks can land on the last frame.
   */
  readonly seekEndMarginSeconds: number;
  readonly commands: {
    start: string;
    pause: string;
    resume: string;
    seek: string;
    stop: string;
    gain: string;
    balance: string;
    ramp: string;
    link: string;
  };
  readonly events: {
    position: string;
    ended: string;
    gaplessStarted: string;
    error?: string;
  };
}

export const FILE_NATIVE_TRANSPORT: NativeTransport = {
  kind: "file",
  accepts: (source) => source.kind === "file",
  startArgs: (source) => ({
    path: source.kind === "file" ? source.path : "",
  }),
  seekEndMarginSeconds: 0.05,
  commands: {
    start: "start_native_file_playback",
    pause: "pause_file_playback",
    resume: "resume_file_playback",
    seek: "seek_file_playback",
    stop: "stop_file_playback",
    gain: "set_file_playback_gain",
    balance: "set_file_playback_balance",
    ramp: "ramp_file_playback_gain",
    link: "link_gapless_playback",
  },
  events: {
    position: "file-playback-position",
    ended: "file-playback-ended",
    gaplessStarted: "file-playback-gapless-started",
  },
};

export const CD_NATIVE_TRANSPORT: NativeTransport = {
  kind: "cd",
  accepts: (source) => source.kind === "cd",
  startArgs: (source) =>
    source.kind === "cd"
      ? {
          driveId: source.driveId,
          trackNumber: source.trackNumber,
          native: true,
        }
      : {},
  seekEndMarginSeconds: 0,
  commands: {
    start: "start_cd_playback",
    pause: "pause_cd_playback",
    resume: "resume_cd_playback",
    seek: "seek_cd_playback",
    stop: "stop_cd_playback",
    gain: "set_cd_playback_gain",
    balance: "set_cd_playback_balance",
    ramp: "ramp_cd_playback_gain",
    link: "link_cd_gapless_playback",
  },
  events: {
    position: "cd-playback-position",
    ended: "cd-playback-ended",
    gaplessStarted: "cd-playback-gapless-started",
    error: "cd-playback-error",
  },
};
