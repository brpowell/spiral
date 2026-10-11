import { emit, listen } from "@tauri-apps/api/event";
import type { RepeatMode, Track } from "../types/track";
import type { PlaybackState } from "../types/track";
import * as audio from "./playback";
import { setLivePositionPublisher } from "./livePosition";
import {
  seekPositionMatchesRatio,
  seekRatioToPositionSeconds,
} from "./playbackSeek";
import { usePlayerStore } from "../store/usePlayerStore";
import {
  pickPlaybackSettingsSnapshot,
  usePlaybackSettingsStore,
} from "../store/usePlaybackSettingsStore";
import type { WindowRole } from "./windowRole";
import { pickAndImportLibraryPaths } from "./libraryImport";

export const PLAYER_STATE_EVENT = "player://state";
export const PLAYER_ACTION_EVENT = "player://action";
export const PLAYER_REQUEST_STATE_EVENT = "player://request-state";

export interface PlayerStateSnapshot {
  library: Track[];
  playbackTracks: Track[];
  playContextIds: number[];
  manualQueueIds: number[];
  currentTrackId: number | null;
  playbackState: PlaybackState;
  positionSeconds: number;
  volume: number;
  muted: boolean;
  balance: number;
  repeatMode: RepeatMode;
  shuffle: boolean;
  crossfadeEnabled: boolean;
  crossfadeSeconds: number;
  crossfadeOnSkip: boolean;
  crossfadeVisualEnabled: boolean;
}

export type PlayerRemoteAction =
  | { type: "togglePlayPause" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "previousTrack" }
  | { type: "nextTrack" }
  | { type: "cycleRepeat" }
  | { type: "toggleRepeat" }
  | { type: "toggleShuffle" }
  | { type: "seek"; ratio: number }
  | { type: "seekRelative"; deltaSeconds: number }
  | { type: "setVolume"; volume: number }
  | { type: "setBalance"; balance: number }
  | { type: "toggleMute" }
  | { type: "playTrack"; id: number }
  | { type: "playTracks"; ids: number[]; startId: number }
  | { type: "addToQueue"; ids: number[] }
  | { type: "removeFromQueue"; id: number }
  | { type: "clearSetList" }
  | { type: "importFromPaths"; paths: string[] }
  | { type: "toggleCrossfade" };

const PLAYER_SYNC_KEYS = [
  "library",
  "playbackTracks",
  "playContextIds",
  "manualQueueIds",
  "currentTrackId",
  "playbackState",
  "positionSeconds",
  "volume",
  "muted",
  "balance",
  "repeatMode",
  "shuffle",
] as const;

const PLAYBACK_SETTINGS_SYNC_KEYS = [
  "crossfadeEnabled",
  "crossfadeSeconds",
  "crossfadeOnSkip",
  "crossfadeVisualEnabled",
] as const;

const SYNC_KEYS: (keyof PlayerStateSnapshot)[] = [
  ...PLAYER_SYNC_KEYS,
  ...PLAYBACK_SETTINGS_SYNC_KEYS,
];

type PlayerSyncPatch = Partial<
  Pick<PlayerStateSnapshot, (typeof PLAYER_SYNC_KEYS)[number]>
>;

/** Keys that differ by reference/value. IPC must send only these so remote
 *  array identities (library, queues) stay stable across volume/balance ticks. */
export function changedPlayerSnapshotFields(
  prev: PlayerStateSnapshot,
  next: PlayerStateSnapshot,
): Partial<PlayerStateSnapshot> | null {
  const patch: Partial<PlayerStateSnapshot> = {};
  let changed = false;
  for (const key of SYNC_KEYS) {
    if (prev[key] !== next[key]) {
      Object.assign(patch, { [key]: next[key] });
      changed = true;
    }
  }
  return changed ? patch : null;
}

function pickPlayerSyncPatch(
  snapshot: Partial<PlayerStateSnapshot>,
): PlayerSyncPatch {
  const patch: PlayerSyncPatch = {};
  for (const key of PLAYER_SYNC_KEYS) {
    if (Object.hasOwn(snapshot, key)) {
      Object.assign(patch, { [key]: snapshot[key] });
    }
  }
  return patch;
}

function snapshotHasPlaybackSettings(
  snapshot: Partial<PlayerStateSnapshot>,
): boolean {
  return PLAYBACK_SETTINGS_SYNC_KEYS.some((key) =>
    Object.hasOwn(snapshot, key),
  );
}

function applyRemotePlayerSnapshot(
  state: ReturnType<typeof usePlayerStore.getState>,
  snapshot: Partial<PlayerStateSnapshot>,
): PlayerSyncPatch & { seekPreviewRatio?: number | null } {
  const patch = pickPlayerSyncPatch(snapshot);
  if (state.seekPreviewRatio === null) {
    return patch;
  }

  const library = patch.library ?? state.library;
  const playbackTracks = patch.playbackTracks ?? state.playbackTracks;
  const currentTrackId = patch.currentTrackId ?? state.currentTrackId;
  const positionSeconds = patch.positionSeconds ?? state.positionSeconds;
  const pendingRatio = state.seekPreviewRatio;
  const expected = seekRatioToPositionSeconds(
    library,
    currentTrackId,
    pendingRatio,
    playbackTracks,
  );

  if (
    seekPositionMatchesRatio(
      library,
      currentTrackId,
      positionSeconds,
      pendingRatio,
      1,
      playbackTracks,
    )
  ) {
    return { ...patch, seekPreviewRatio: null };
  }

  return {
    ...patch,
    positionSeconds: expected,
    seekPreviewRatio: pendingRatio,
  };
}

function pickSnapshot(
  playerState: ReturnType<typeof usePlayerStore.getState>,
  playbackSettings: ReturnType<typeof usePlaybackSettingsStore.getState>,
): PlayerStateSnapshot {
  return {
    library: playerState.library,
    playbackTracks: playerState.playbackTracks,
    playContextIds: playerState.playContextIds,
    manualQueueIds: playerState.manualQueueIds,
    currentTrackId: playerState.currentTrackId,
    playbackState: playerState.playbackState,
    positionSeconds:
      playerState.playbackState === "playing" && audio.getDurationSeconds() > 0
        ? audio.getPositionSeconds()
        : playerState.positionSeconds,
    volume: playerState.volume,
    muted: playerState.muted,
    balance: playerState.balance,
    repeatMode: playerState.repeatMode,
    shuffle: playerState.shuffle,
    ...pickPlaybackSettingsSnapshot(playbackSettings),
  };
}

function dispatchRemoteAction(action: PlayerRemoteAction): void {
  const store = usePlayerStore.getState();
  switch (action.type) {
    case "togglePlayPause":
      store.togglePlayPause();
      break;
    case "pause":
      store.pause();
      break;
    case "resume":
      store.resume();
      break;
    case "previousTrack":
      store.previousTrack();
      break;
    case "nextTrack":
      store.nextTrack();
      break;
    case "cycleRepeat":
      store.cycleRepeat();
      break;
    case "toggleRepeat":
      store.toggleRepeat();
      break;
    case "toggleShuffle":
      store.toggleShuffle();
      break;
    case "seek":
      store.seek(action.ratio);
      break;
    case "seekRelative":
      store.seekRelative(action.deltaSeconds);
      break;
    case "setVolume":
      store.setVolume(action.volume);
      break;
    case "setBalance":
      store.setBalance(action.balance);
      break;
    case "toggleMute":
      store.toggleMute();
      break;
    case "playTrack":
      void store.playTrack(action.id);
      break;
    case "playTracks":
      void store.playTracks(action.ids, action.startId);
      break;
    case "addToQueue":
      store.addToQueue(action.ids);
      break;
    case "removeFromQueue":
      store.removeFromQueue(action.id);
      break;
    case "clearSetList":
      store.clearSetList();
      break;
    case "importFromPaths":
      store.importFromPaths(action.paths);
      break;
    case "toggleCrossfade":
      usePlaybackSettingsStore.getState().toggleCrossfade();
      break;
  }
}

function emitRemoteAction(action: PlayerRemoteAction): void {
  void emit(PLAYER_ACTION_EVENT, { action });
}

function installRemoteActions(): void {
  usePlayerStore.setState(
    {
      togglePlayPause: () => emitRemoteAction({ type: "togglePlayPause" }),
      pause: () => emitRemoteAction({ type: "pause" }),
      resume: () => emitRemoteAction({ type: "resume" }),
      previousTrack: () => emitRemoteAction({ type: "previousTrack" }),
      nextTrack: () => emitRemoteAction({ type: "nextTrack" }),
      cycleRepeat: () => emitRemoteAction({ type: "cycleRepeat" }),
      toggleRepeat: () => emitRemoteAction({ type: "toggleRepeat" }),
      toggleShuffle: () => emitRemoteAction({ type: "toggleShuffle" }),
      seek: (ratio) => {
        const state = usePlayerStore.getState();
        const positionSeconds = seekRatioToPositionSeconds(
          state.library,
          state.currentTrackId,
          ratio,
          state.playbackTracks,
        );
        emitRemoteAction({ type: "seek", ratio });
        usePlayerStore.setState({
          positionSeconds,
          seekPreviewRatio: ratio,
        });
      },
      seekRelative: (deltaSeconds) =>
        emitRemoteAction({ type: "seekRelative", deltaSeconds }),
      setVolume: (volume) => {
        const clamped = Math.max(0, Math.min(1, volume));
        const muted = usePlayerStore.getState().muted;
        if (clamped > 0 && muted) {
          usePlayerStore.setState({ volume: clamped, muted: false });
        } else {
          usePlayerStore.setState({ volume: clamped });
        }
        emitRemoteAction({ type: "setVolume", volume });
      },
      setBalance: (balance) => {
        const clamped = Math.max(-1, Math.min(1, balance));
        usePlayerStore.setState({ balance: clamped });
        emitRemoteAction({ type: "setBalance", balance });
      },
      toggleMute: () => emitRemoteAction({ type: "toggleMute" }),
      playTrack: async (id) => {
        emitRemoteAction({ type: "playTrack", id });
      },
      playTracks: async (ids, startId) => {
        emitRemoteAction({ type: "playTracks", ids, startId });
      },
      addToQueue: (ids) => emitRemoteAction({ type: "addToQueue", ids }),
      removeFromQueue: (id) =>
        emitRemoteAction({ type: "removeFromQueue", id }),
      clearSetList: () => emitRemoteAction({ type: "clearSetList" }),
      loadLibrary: async () => {},
      addToLibrary: async () => {
        await pickAndImportLibraryPaths();
      },
      importFromPaths: (paths) =>
        emitRemoteAction({ type: "importFromPaths", paths }),
    },
    false,
  );

  usePlaybackSettingsStore.setState(
    {
      toggleCrossfade: () => emitRemoteAction({ type: "toggleCrossfade" }),
    },
    false,
  );
}

async function initMainBridge(): Promise<() => void> {
  let lastSnapshot = pickSnapshot(
    usePlayerStore.getState(),
    usePlaybackSettingsStore.getState(),
  );

  const emitSnapshot = (snapshot: Partial<PlayerStateSnapshot>) => {
    void emit(PLAYER_STATE_EVENT, { snapshot });
  };

  const publishSnapshot = () => {
    const snapshot = pickSnapshot(
      usePlayerStore.getState(),
      usePlaybackSettingsStore.getState(),
    );
    const patch = changedPlayerSnapshotFields(lastSnapshot, snapshot);
    if (!patch) return;
    lastSnapshot = snapshot;
    emitSnapshot(patch);
  };

  setLivePositionPublisher((positionSeconds) => {
    if (Object.is(lastSnapshot.positionSeconds, positionSeconds)) return;
    lastSnapshot = { ...lastSnapshot, positionSeconds };
    emitSnapshot({ positionSeconds });
  });

  const unsubscribePlayer = usePlayerStore.subscribe(() => {
    publishSnapshot();
  });

  const unsubscribePlaybackSettings = usePlaybackSettingsStore.subscribe(() => {
    publishSnapshot();
  });

  const unlistenAction = await listen<{ action: PlayerRemoteAction }>(
    PLAYER_ACTION_EVENT,
    (event) => {
      dispatchRemoteAction(event.payload.action);
    },
  );

  const unlistenRequest = await listen(PLAYER_REQUEST_STATE_EVENT, () => {
    lastSnapshot = pickSnapshot(
      usePlayerStore.getState(),
      usePlaybackSettingsStore.getState(),
    );
    emitSnapshot(lastSnapshot);
  });

  return () => {
    setLivePositionPublisher(null);
    unsubscribePlayer();
    unsubscribePlaybackSettings();
    unlistenAction();
    unlistenRequest();
  };
}

async function initRemoteBridge(): Promise<() => void> {
  installRemoteActions();

  const unlistenState = await listen<{
    snapshot: Partial<PlayerStateSnapshot>;
  }>(PLAYER_STATE_EVENT, (event) => {
    const snapshot = event.payload.snapshot;
    if (snapshotHasPlaybackSettings(snapshot)) {
      const current = usePlaybackSettingsStore.getState();
      usePlaybackSettingsStore.getState().applySnapshot({
        crossfadeEnabled: snapshot.crossfadeEnabled ?? current.crossfadeEnabled,
        crossfadeSeconds: snapshot.crossfadeSeconds ?? current.crossfadeSeconds,
        crossfadeOnSkip: snapshot.crossfadeOnSkip ?? current.crossfadeOnSkip,
        crossfadeVisualEnabled:
          snapshot.crossfadeVisualEnabled ?? current.crossfadeVisualEnabled,
      });
    }
    const playerPatch = pickPlayerSyncPatch(snapshot);
    if (Object.keys(playerPatch).length === 0) return;
    usePlayerStore.setState(
      (state) => applyRemotePlayerSnapshot(state, snapshot),
      false,
    );
  });

  void emit(PLAYER_REQUEST_STATE_EVENT, {});

  return () => {
    unlistenState();
  };
}

export async function initPlayerStoreBridge(
  role: WindowRole,
): Promise<() => void> {
  if (role === "main") {
    return initMainBridge();
  }
  return initRemoteBridge();
}
