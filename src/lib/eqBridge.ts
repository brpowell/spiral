import { emit, listen } from "@tauri-apps/api/event";
import type { EqualizerRemoteAction, EqualizerStateSnapshot } from "./equalizer/types";
import { useEqualizerStore } from "../store/useEqualizerStore";
import type { WindowRole } from "./windowRole";
import { isSkinModeWindow } from "./windowRole";

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
  };
}

function shouldSyncEqualizer(role: WindowRole): boolean {
  return role === "main" || isSkinModeWindow();
}

function dispatchRemoteAction(action: EqualizerRemoteAction): void {
  const store = useEqualizerStore.getState();
  switch (action.type) {
    case "setBand":
      store.setBand(action.band, action.gain);
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
  }
}

function emitRemoteAction(action: EqualizerRemoteAction): void {
  void emit(EQ_ACTION_EVENT, { action });
}

function installRemoteActions(): void {
  useEqualizerStore.setState(
    {
      setBand: (band, gain) => emitRemoteAction({ type: "setBand", band, gain }),
      applyPreset: (presetId) =>
        emitRemoteAction({ type: "applyPreset", presetId }),
      reset: () => emitRemoteAction({ type: "reset" }),
      setEnabled: (enabled) =>
        emitRemoteAction({ type: "setEnabled", enabled }),
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
      snapshot.bands.every((gain, index) => gain === lastSnapshot.bands[index])
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
