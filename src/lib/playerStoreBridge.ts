import { emit, listen } from "@tauri-apps/api/event";
import type { RepeatMode, Track } from "../types/track";
import type { PlaybackState } from "../types/track";
import {
  seekPositionMatchesRatio,
  seekRatioToPositionSeconds,
} from "./playbackSeek";
import { usePlayerStore } from "../store/usePlayerStore";
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
  | { type: "importFromPaths"; paths: string[] };

const SYNC_KEYS: (keyof PlayerStateSnapshot)[] = [
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
];

function pickSnapshot(state: ReturnType<typeof usePlayerStore.getState>): PlayerStateSnapshot {
  return {
    library: state.library,
    playbackTracks: state.playbackTracks,
    playContextIds: state.playContextIds,
    manualQueueIds: state.manualQueueIds,
    currentTrackId: state.currentTrackId,
    playbackState: state.playbackState,
    positionSeconds: state.positionSeconds,
    volume: state.volume,
    muted: state.muted,
    balance: state.balance,
    repeatMode: state.repeatMode,
    shuffle: state.shuffle,
  };
}

function snapshotChanged(
  prev: PlayerStateSnapshot,
  next: PlayerStateSnapshot,
): boolean {
  return SYNC_KEYS.some((key) => prev[key] !== next[key]);
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
      setVolume: (volume) => emitRemoteAction({ type: "setVolume", volume }),
      setBalance: (balance) => emitRemoteAction({ type: "setBalance", balance }),
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
}

async function initMainBridge(): Promise<() => void> {
  let lastSnapshot = pickSnapshot(usePlayerStore.getState());

  const emitSnapshot = (snapshot: PlayerStateSnapshot) => {
    void emit(PLAYER_STATE_EVENT, { snapshot });
  };

  const unsubscribe = usePlayerStore.subscribe((state) => {
    const snapshot = pickSnapshot(state);
    if (!snapshotChanged(lastSnapshot, snapshot)) return;
    lastSnapshot = snapshot;
    emitSnapshot(snapshot);
  });

  const unlistenAction = await listen<{ action: PlayerRemoteAction }>(
    PLAYER_ACTION_EVENT,
    (event) => {
      dispatchRemoteAction(event.payload.action);
    },
  );

  const unlistenRequest = await listen(PLAYER_REQUEST_STATE_EVENT, () => {
    emitSnapshot(pickSnapshot(usePlayerStore.getState()));
  });

  return () => {
    unsubscribe();
    unlistenAction();
    unlistenRequest();
  };
}

async function initRemoteBridge(): Promise<() => void> {
  installRemoteActions();

  const unlistenState = await listen<{ snapshot: PlayerStateSnapshot }>(
    PLAYER_STATE_EVENT,
    (event) => {
      const snapshot = event.payload.snapshot;
      usePlayerStore.setState((state) => {
        if (state.seekPreviewRatio === null) {
          return snapshot;
        }

        const pendingRatio = state.seekPreviewRatio;
        const expected = seekRatioToPositionSeconds(
          state.library,
          state.currentTrackId,
          pendingRatio,
          state.playbackTracks,
        );

        if (
          seekPositionMatchesRatio(
            snapshot.library,
            snapshot.currentTrackId,
            snapshot.positionSeconds,
            pendingRatio,
            1,
            snapshot.playbackTracks,
          )
        ) {
          return { ...snapshot, seekPreviewRatio: null };
        }

        return {
          ...snapshot,
          positionSeconds: expected,
          seekPreviewRatio: pendingRatio,
        };
      }, false);
    },
  );

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
