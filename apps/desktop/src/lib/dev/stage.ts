// Dev-only: capture and re-apply a staged app state for marketing shots.
// Installed as `window.__stage` by main.tsx only in dev builds that also run
// the agent bridge (`window.__agent`). `scripts/stage.mjs` is the client.
import { useNavigationStore } from "@/store/useNavigationStore";
import { usePlayerStore } from "@/store/usePlayerStore";
import { usePlaylistStore } from "@/store/usePlaylistStore";
import { useSkinStore } from "@/store/useSkinStore";
import { useThemeStore } from "@/store/useThemeStore";
import { useVisualizerStore } from "@/store/useVisualizerStore";
import {
  STAGE_DEVICE_SELECTOR,
  STAGE_SCROLL_SELECTORS,
  findTrack,
  missingDevices,
  trackRef,
  type StageAppState,
  type StageNav,
} from "./stageState";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const DEVICE_WAIT_MS = 30_000;

function visibleDevices(): string[] {
  return [...document.querySelectorAll(STAGE_DEVICE_SELECTOR)]
    .map((el) => (el.textContent ?? "").trim())
    .filter(Boolean);
}

/** Poll until the sidebar satisfies `wanted`; returns what is still missing, or null. */
async function waitForDevices(
  wanted: number | string[],
): Promise<string | null> {
  const deadline = Date.now() + DEVICE_WAIT_MS;
  let missing = missingDevices(wanted, visibleDevices());
  while (missing && Date.now() < deadline) {
    await sleep(250);
    missing = missingDevices(wanted, visibleDevices());
  }
  return missing;
}

function captureNav(): StageNav {
  const nav = useNavigationStore.getState();
  if (nav.albumKey) return { view: nav.view, albumKey: nav.albumKey };
  if (nav.artistKey) return { view: nav.view, artistKey: nav.artistKey };
  if (nav.playlistId !== null) {
    const playlist = usePlaylistStore
      .getState()
      .playlists.find((p) => p.id === nav.playlistId);
    if (playlist) return { view: nav.view, playlist: playlist.title };
  }
  return { view: nav.view };
}

export function capture(): { state: StageAppState; warnings: string[] } {
  const warnings: string[] = [];
  const player = usePlayerStore.getState();
  const current = player.library.find((t) => t.id === player.currentTrackId);
  const scroll: Record<string, number> = {};
  for (const selector of STAGE_SCROLL_SELECTORS) {
    const el = document.querySelector(selector);
    if (el && el.scrollTop > 0) scroll[selector] = Math.round(el.scrollTop);
  }
  if (player.currentPlayable?.type === "cd") {
    warnings.push("playing from a CD; playback not captured");
  }
  if (player.editingTrackIds.length || player.editingAlbumKey) {
    warnings.push("an editor is open; modals are not captured");
  }
  const skin = useSkinStore.getState();
  return {
    warnings,
    state: {
      nav: captureNav(),
      theme: useThemeStore.getState().activeThemeId,
      skin: skin.activeSkinId,
      skinView: skin.activeViewId,
      visualizer: useVisualizerStore.getState().activeVisualizerId,
      playback: current
        ? {
            track: trackRef(current),
            positionSeconds: Math.round(player.positionSeconds * 10) / 10,
            state: player.playbackState === "playing" ? "playing" : "paused",
            muted: player.muted,
          }
        : { track: null, positionSeconds: 0, state: "paused" },
      scroll,
      devices: visibleDevices().length,
      selection: player.library
        .filter((t) => player.selectedTrackIds.includes(t.id))
        .map(trackRef),
    },
  };
}

/** Wait for fonts, images and two frames so a shot does not catch a transition. */
async function settle(extraMs = 400) {
  await document.fonts.ready;
  for (let i = 0; i < 20; i++) {
    const pending = [...document.images].filter((img) => !img.complete);
    if (!pending.length) break;
    await sleep(100);
  }
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  await sleep(extraMs);
}

export async function apply(state: StageAppState): Promise<string[]> {
  const warnings: string[] = [];

  if (state.theme && useThemeStore.getState().activeThemeId !== state.theme) {
    await useThemeStore.getState().setTheme(state.theme);
  }
  if (state.skin && useSkinStore.getState().activeSkinId !== state.skin) {
    await useSkinStore.getState().setSkin(state.skin);
  }
  if (
    state.skinView &&
    useSkinStore.getState().activeViewId !== state.skinView
  ) {
    await useSkinStore.getState().setView(state.skinView);
  }
  if (
    state.visualizer &&
    useVisualizerStore.getState().activeVisualizerId !== state.visualizer
  ) {
    await useVisualizerStore.getState().setActiveVisualizer(state.visualizer);
  }

  const nav = useNavigationStore.getState();
  if (state.nav) {
    nav.setView(state.nav.view);
    if ("albumKey" in state.nav)
      useNavigationStore.getState().openAlbum(state.nav.albumKey);
    else if ("artistKey" in state.nav)
      useNavigationStore.getState().openArtist(state.nav.artistKey);
    else if ("playlist" in state.nav) {
      const wanted = state.nav.playlist.toLowerCase();
      const playlist = usePlaylistStore
        .getState()
        .playlists.find((p) => p.title.toLowerCase() === wanted);
      if (playlist) useNavigationStore.getState().openPlaylist(playlist.id);
      else warnings.push(`playlist "${state.nav.playlist}" not found`);
    }
    await settle(150);
  }

  if (state.devices !== undefined) {
    const missing = await waitForDevices(state.devices);
    if (missing) {
      warnings.push(`${missing} within ${DEVICE_WAIT_MS / 1000}s`);
    }
  }

  const wanted = state.playback;
  if (wanted?.track) {
    const player = usePlayerStore.getState();
    const track = findTrack(player.library, wanted.track);
    if (!track) {
      warnings.push(`track "${wanted.track.title}" not found in the library`);
    } else {
      await player.playTrack(track.id);
      const duration = track.durationSeconds ?? 0;
      if (duration > 0) {
        usePlayerStore
          .getState()
          .seek(Math.min(wanted.positionSeconds / duration, 0.999));
      }
      if (
        wanted.muted !== undefined &&
        usePlayerStore.getState().muted !== wanted.muted
      ) {
        usePlayerStore.getState().toggleMute();
      }
      if (wanted.state === "paused") usePlayerStore.getState().pause();
    }
  }

  if (wanted && !wanted.track) {
    // The state being restored had nothing loaded; at least stop playback.
    usePlayerStore.getState().pause();
  }

  if (state.selection?.length) {
    const library = usePlayerStore.getState().library;
    const ids = state.selection
      .map((ref) => findTrack(library, ref)?.id)
      .filter((id): id is number => id !== undefined);
    usePlayerStore.setState({
      selectedTrackIds: ids,
      selectionAnchorId: ids[0] ?? null,
    });
  }

  await settle();
  // Scroll last: layout above (route change, track list mount) resets it.
  for (const [selector, top] of Object.entries(state.scroll ?? {})) {
    const el = document.querySelector(selector);
    if (el) el.scrollTop = top;
    else warnings.push(`scroll container ${selector} not found`);
  }
  // WebKit gives the first control (the shuffle button) focus when the window
  // activates, which draws a focus ring into the shot. Shots never want one.
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  await settle(250);
  return warnings;
}

export function installStage() {
  if (!(window as unknown as { __agent?: unknown }).__agent) return;
  (window as unknown as { __stage: unknown }).__stage = { capture, apply };
}
