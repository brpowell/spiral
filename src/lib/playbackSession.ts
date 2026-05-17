import type { PlaybackSession } from "../types/playbackSession";
import type { RepeatMode, Track } from "../types/track";

const REPEAT_MODES: RepeatMode[] = ["off", "all", "one"];

export function parseRepeatMode(value: unknown): RepeatMode {
  if (typeof value === "string" && REPEAT_MODES.includes(value as RepeatMode)) {
    return value as RepeatMode;
  }
  return "off";
}
import * as audio from "./audio";
import { usePlayerStore } from "../store/usePlayerStore";

export function collectPlaybackSession(): PlaybackSession {
  const state = usePlayerStore.getState();
  const positionSeconds =
    state.playbackState === "playing"
      ? audio.getPositionSeconds()
      : state.positionSeconds;

  return {
    playContextIds: state.playContextIds,
    manualQueueIds: state.manualQueueIds,
    currentTrackId: state.currentTrackId,
    positionSeconds,
    shuffle: state.shuffle,
    repeatMode: state.repeatMode,
  };
}

export function sessionHasContent(session: PlaybackSession): boolean {
  return (
    session.currentTrackId !== null ||
    session.playContextIds.length > 0 ||
    session.manualQueueIds.length > 0
  );
}

export function prunePlaybackSession(
  session: PlaybackSession,
  library: Track[],
): PlaybackSession | null {
  const libraryIds = new Set(library.map((t) => t.id));
  const filterIds = (ids: number[]) => ids.filter((id) => libraryIds.has(id));

  const playContextIds = filterIds(session.playContextIds);
  const manualQueueIds = filterIds(session.manualQueueIds);
  const currentTrackId =
    session.currentTrackId !== null && libraryIds.has(session.currentTrackId)
      ? session.currentTrackId
      : null;

  const pruned: PlaybackSession = {
    playContextIds,
    manualQueueIds,
    currentTrackId,
    positionSeconds: Math.max(0, session.positionSeconds),
    shuffle: session.shuffle,
    repeatMode: parseRepeatMode(session.repeatMode),
  };

  return sessionHasContent(pruned) ? pruned : null;
}
