import { useSkinStore } from "../store/useSkinStore";
import { useThemeStore } from "../store/useThemeStore";
import { useVisualizerStore } from "../store/useVisualizerStore";
import type {
  ListenCompletion,
  ListenEventPayload,
  ListenUiMode,
} from "../types/listenEvent";

export type { ListenCompletion, ListenEventPayload, ListenUiMode };

interface ActiveListen {
  trackId: number;
  startedAt: string;
  trackDurationSeconds: number | null;
  librarySeconds: number;
  skinSeconds: number;
  /** Mode that the current `playingSince` segment belongs to. */
  segmentMode: ListenUiMode;
  /** `performance.now()` when currently playing; null while paused. */
  playingSince: number | null;
}

/** Near-end handoff (crossfade) counts as natural end at this fraction of duration. */
const HANDOFF_NATURAL_END_RATIO = 0.85;
/** Or when position is within this many seconds of the track end. */
const HANDOFF_NATURAL_END_REMAINING_SECONDS = 15;

let active: ActiveListen | null = null;
/** True while skin mode is the visible listening surface (main still owns audio). */
let skinModeSessionActive = false;

function nowIso(): string {
  return new Date().toISOString();
}

function currentUiMode(): ListenUiMode {
  return skinModeSessionActive ? "skin" : "library";
}

function addSeconds(listen: ActiveListen, mode: ListenUiMode, seconds: number): void {
  if (mode === "skin") {
    listen.skinSeconds += seconds;
  } else {
    listen.librarySeconds += seconds;
  }
}

function foldPlayingTime(listen: ActiveListen, atMs: number): void {
  if (listen.playingSince === null) return;
  const delta = Math.max(0, (atMs - listen.playingSince) / 1000);
  addSeconds(listen, listen.segmentMode, delta);
  listen.playingSince = null;
}

function totalSeconds(listen: ActiveListen): number {
  return listen.librarySeconds + listen.skinSeconds;
}

function currentListenedSeconds(listen: ActiveListen, atMs = performance.now()): number {
  let listened = totalSeconds(listen);
  if (listen.playingSince !== null) {
    listened += Math.max(0, (atMs - listen.playingSince) / 1000);
  }
  return listened;
}

function majorityUiMode(librarySeconds: number, skinSeconds: number): ListenUiMode {
  return skinSeconds > librarySeconds ? "skin" : "library";
}

function switchListenUiModeBucket(): void {
  if (!active) return;

  const next = currentUiMode();
  if (next === active.segmentMode) return;

  const wasPlaying = active.playingSince !== null;
  foldPlayingTime(active, performance.now());
  active.segmentMode = next;
  if (wasPlaying) {
    active.playingSince = performance.now();
  }
}

/**
 * Track whether skin mode is the active UI. Mid-listen switches fold wall time
 * into `library_listened_seconds` / `skin_listened_seconds`.
 */
export function setSkinModeSessionActive(nextActive: boolean): void {
  if (skinModeSessionActive === nextActive) return;
  skinModeSessionActive = nextActive;
  switchListenUiModeBucket();
}

export function getActiveListenTrackId(): number | null {
  return active?.trackId ?? null;
}

/**
 * Crossfade / skip handoff: treat near-complete listens as natural_end so
 * auto-advance near the end is not recorded as skipped.
 */
export function inferHandoffCompletion(
  listenedSeconds: number,
  trackDurationSeconds: number | null,
  positionSeconds?: number,
  audioDurationSeconds?: number,
): ListenCompletion {
  const duration =
    trackDurationSeconds && trackDurationSeconds > 0
      ? trackDurationSeconds
      : audioDurationSeconds && audioDurationSeconds > 0
        ? audioDurationSeconds
        : null;

  if (duration !== null) {
    if (listenedSeconds / duration >= HANDOFF_NATURAL_END_RATIO) {
      return "natural_end";
    }
    if (
      positionSeconds !== undefined &&
      positionSeconds >= duration - HANDOFF_NATURAL_END_REMAINING_SECONDS
    ) {
      return "natural_end";
    }
  }

  return "skipped";
}

function snapshotAppearance(): Pick<
  ListenEventPayload,
  | "themeId"
  | "themeName"
  | "skinId"
  | "skinName"
  | "visualizerId"
  | "visualizerName"
> {
  const theme = useThemeStore.getState();
  const skin = useSkinStore.getState();
  const visualizer = useVisualizerStore.getState();

  const themeName =
    theme.themes.find((t) => t.id === theme.activeThemeId)?.name ?? null;
  const skinName =
    skin.activePack?.summary.name ??
    skin.skins.find((s) => s.id === skin.activeSkinId)?.name ??
    null;
  const visualizerName =
    visualizer.visualizers.find((p) => p.id === visualizer.activeVisualizerId)
      ?.name ?? null;

  return {
    themeId: theme.activeThemeId || null,
    themeName,
    skinId: skin.activeSkinId || null,
    skinName,
    visualizerId: visualizer.activeVisualizerId || null,
    visualizerName,
  };
}

/**
 * Start tracking a library listen. Closes any previous open listen as `skipped`
 * (caller should persist that payload). Returns the previous payload if any.
 */
export function openListen(
  trackId: number,
  trackDurationSeconds: number | null,
  isPlaying: boolean,
): ListenEventPayload | null {
  const previous = closeListen("skipped");
  active = {
    trackId,
    startedAt: nowIso(),
    trackDurationSeconds,
    librarySeconds: 0,
    skinSeconds: 0,
    segmentMode: currentUiMode(),
    playingSince: isPlaying ? performance.now() : null,
  };
  return previous;
}

export function pauseListenAccumulation(): void {
  if (!active) return;
  foldPlayingTime(active, performance.now());
}

export function resumeListenAccumulation(): void {
  if (!active || active.playingSince !== null) return;
  active.segmentMode = currentUiMode();
  active.playingSince = performance.now();
}

/**
 * Close the active listen. Idempotent: returns null if nothing is open.
 */
export function closeListen(
  completion: ListenCompletion,
): ListenEventPayload | null {
  if (!active) return null;

  const listen = active;
  active = null;
  foldPlayingTime(listen, performance.now());

  return {
    trackId: listen.trackId,
    startedAt: listen.startedAt,
    endedAt: nowIso(),
    listenedSeconds: totalSeconds(listen),
    libraryListenedSeconds: listen.librarySeconds,
    skinListenedSeconds: listen.skinSeconds,
    trackDurationSeconds: listen.trackDurationSeconds,
    completion,
    source: "library",
    uiMode: majorityUiMode(listen.librarySeconds, listen.skinSeconds),
    ...snapshotAppearance(),
  };
}

/**
 * Close for crossfade / track handoff, inferring natural_end vs skipped.
 */
export function closeListenForHandoff(
  positionSeconds?: number,
  audioDurationSeconds?: number,
): ListenEventPayload | null {
  if (!active) return null;

  const listened = currentListenedSeconds(active);
  const completion = inferHandoffCompletion(
    listened,
    active.trackDurationSeconds,
    positionSeconds,
    audioDurationSeconds,
  );
  return closeListen(completion);
}

/** Test helper: clear module state. */
export function resetListenSessionForTests(): void {
  active = null;
  skinModeSessionActive = false;
}
