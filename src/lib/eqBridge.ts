import { emit, listen } from "@tauri-apps/api/event";
import type {
  EqualizerPreset,
  EqualizerRemoteAction,
  EqualizerStateSnapshot,
} from "./equalizer/types";
import { useEqualizerStore } from "../store/useEqualizerStore";
import type { WindowRole } from "./windowRole";

export const EQ_STATE_EVENT = "eq://state";
export const EQ_ACTION_EVENT = "eq://action";
export const EQ_REQUEST_STATE_EVENT = "eq://request-state";

function pickEqualizerSnapshot(
  state: ReturnType<typeof useEqualizerStore.getState>,
): EqualizerStateSnapshot {
  return {
    enabled: state.enabled,
    presetId: state.presetId,
    bands: state.bands,
    preampGain: state.preampGain,
    customPresets: state.customPresets,
  };
}

function presetsEqual(
  left: readonly EqualizerPreset[],
  right: readonly EqualizerPreset[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((preset, index) => {
    const other = right[index];
    return (
      preset.id === other.id &&
      preset.name === other.name &&
      preset.bands.every((gain, bandIndex) => gain === other.bands[bandIndex])
    );
  });
}

function shouldSyncEqualizer(role: WindowRole): boolean {
  return role === "main" || role === "skin-mode" || role === "equalizer";
}

function dispatchRemoteAction(action: EqualizerRemoteAction): void {
  const store = useEqualizerStore.getState();
  switch (action.type) {
    case "setBand":
      store.setBand(action.band, action.gain);
      break;
    case "setPreampGain":
      store.setPreampGain(action.gain);
      break;
    case "applyPreset":
      store.applyPreset(action.presetId);
      break;
    case "reset":
      store.reset();
      break;
    case "setEnabled":
      store.setEnabled(action.enabled);
      break;
    case "saveCustomPreset":
      store.saveCurrentAsPreset(action.name);
      break;
    case "renameCustomPreset":
      store.renameCustomPreset(action.id, action.name);
      break;
    case "deleteCustomPreset":
      store.deleteCustomPreset(action.id);
      break;
  }
}

function emitRemoteAction(action: EqualizerRemoteAction): void {
  void emit(EQ_ACTION_EVENT, { action });
}

function installRemoteActions(): void {
  useEqualizerStore.setState(
    {
      setBand: (band, gain) => emitRemoteAction({ type: "setBand", band, gain }),
      setPreampGain: (gain) =>
        emitRemoteAction({ type: "setPreampGain", gain }),
      applyPreset: (presetId) =>
        emitRemoteAction({ type: "applyPreset", presetId }),
      reset: () => emitRemoteAction({ type: "reset" }),
      setEnabled: (enabled) =>
        emitRemoteAction({ type: "setEnabled", enabled }),
      saveCurrentAsPreset: (name) =>
        emitRemoteAction({ type: "saveCustomPreset", name }),
      renameCustomPreset: (id, name) =>
        emitRemoteAction({ type: "renameCustomPreset", id, name }),
      deleteCustomPreset: (id) =>
        emitRemoteAction({ type: "deleteCustomPreset", id }),
    },
    false,
  );
}

async function initMainBridge(): Promise<() => void> {
  let lastSnapshot = pickEqualizerSnapshot(useEqualizerStore.getState());

  const emitSnapshot = () => {
    const snapshot = pickEqualizerSnapshot(useEqualizerStore.getState());
    void emit(EQ_STATE_EVENT, { snapshot });
  };

  const unsubscribe = useEqualizerStore.subscribe((state) => {
    const snapshot = pickEqualizerSnapshot(state);
    if (
      snapshot.enabled === lastSnapshot.enabled &&
      snapshot.presetId === lastSnapshot.presetId &&
      snapshot.preampGain === lastSnapshot.preampGain &&
      snapshot.bands.every((gain, index) => gain === lastSnapshot.bands[index]) &&
      presetsEqual(snapshot.customPresets, lastSnapshot.customPresets)
    ) {
      return;
    }
    lastSnapshot = snapshot;
    emitSnapshot();
  });

  const unlistenAction = await listen<{ action: EqualizerRemoteAction }>(
    EQ_ACTION_EVENT,
    (event) => {
      dispatchRemoteAction(event.payload.action);
    },
  );

  const unlistenRequest = await listen(EQ_REQUEST_STATE_EVENT, () => {
    emitSnapshot();
  });

  return () => {
    unsubscribe();
    unlistenAction();
    unlistenRequest();
  };
}

async function initRemoteBridge(): Promise<() => void> {
  installRemoteActions();

  const unlistenState = await listen<{ snapshot: EqualizerStateSnapshot }>(
    EQ_STATE_EVENT,
    (event) => {
      useEqualizerStore.getState().applySnapshot(event.payload.snapshot);
    },
  );

  void emit(EQ_REQUEST_STATE_EVENT, {});

  return () => {
    unlistenState();
  };
}

export async function initEqBridge(role: WindowRole): Promise<() => void> {
  if (!shouldSyncEqualizer(role)) {
    return async () => {};
  }

  if (role === "main") {
    return initMainBridge();
  }
  return initRemoteBridge();
}
