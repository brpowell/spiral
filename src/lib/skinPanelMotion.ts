import type { LoadedSkinPack, SkinPanel, SkinView } from "../types/skin";
import {
  defaultPanelOpenState,
  defaultPanelRevealedState,
  defaultPanelSettledState,
  type PanelOpenState,
} from "./skinPanels";
import { applyPanelWindowSize } from "./skinPanelWindowResize";

function panelMotionMs(panel: SkinPanel | undefined): number {
  return panel?.motion?.durationMs ?? 120;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait two animation frames so closed bounds paint before opening motion starts. */
function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

export interface PanelMotionState {
  panelOpen: PanelOpenState;
  panelRevealed: PanelOpenState;
  panelSettled: PanelOpenState;
}

export function panelMotionStateForView(view: SkinView): PanelMotionState {
  const panelOpen = defaultPanelOpenState(view);
  return {
    panelOpen,
    panelRevealed: defaultPanelRevealedState(view, panelOpen),
    panelSettled: defaultPanelSettledState(view),
  };
}

let panelMotionToken = 0;

export async function runPanelToggle(
  pack: LoadedSkinPack,
  view: SkinView,
  panelId: string,
  nextOpen: boolean,
  state: PanelMotionState,
  setState: (patch: Partial<PanelMotionState>) => void,
): Promise<void> {
  const panel = view.panels?.[panelId];
  if (!panel) return;

  const token = ++panelMotionToken;
  const stale = () => token !== panelMotionToken;

  const motionMs = panelMotionMs(panel);
  const nextPanelOpen = { ...state.panelOpen, [panelId]: nextOpen };

  if (nextOpen) {
    if (panel.windowWhenOpen) {
      await applyPanelWindowSize(view, nextPanelOpen);
      if (stale()) return;
    }

    // Mount panel content at closed bounds before opening motion starts.
    setState({
      panelRevealed: { ...state.panelRevealed, [panelId]: true },
      panelSettled: { ...state.panelSettled, [panelId]: false },
    });

    await waitForPaint();
    if (stale()) return;

    setState({ panelOpen: nextPanelOpen });

    await delay(motionMs);
    if (stale()) return;

    setState({
      panelSettled: { ...state.panelSettled, [panelId]: true },
    });
    return;
  }

  setState({
    panelOpen: nextPanelOpen,
    panelSettled: { ...state.panelSettled, [panelId]: false },
  });

  await waitForPaint();
  if (stale()) return;

  await delay(motionMs);
  if (stale()) return;

  if (panel.windowWhenOpen) {
    await applyPanelWindowSize(view, nextPanelOpen);
  }

  setState({
    panelRevealed: { ...state.panelRevealed, [panelId]: false },
    panelSettled: { ...state.panelSettled, [panelId]: true },
  });
}

export async function runPanelOpen(
  pack: LoadedSkinPack,
  view: SkinView,
  panelId: string,
  state: PanelMotionState,
  setState: (patch: Partial<PanelMotionState>) => void,
): Promise<void> {
  if (state.panelOpen[panelId]) return;
  await runPanelToggle(pack, view, panelId, true, state, setState);
}

export async function runPanelClose(
  pack: LoadedSkinPack,
  view: SkinView,
  panelId: string,
  state: PanelMotionState,
  setState: (patch: Partial<PanelMotionState>) => void,
): Promise<void> {
  if (!state.panelOpen[panelId]) return;
  await runPanelToggle(pack, view, panelId, false, state, setState);
}
