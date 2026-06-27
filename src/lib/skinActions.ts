import { useCallback } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { albumKey as albumKeyFromTrack } from "./albums";
import { useNavigationStore } from "../store/useNavigationStore";
import { findPlaybackTrack } from "./playbackTrack";
import {
  resolveSkinPlaylistTrackIds,
  shouldReplacePlayContextForSkinPlaylistSource,
} from "./skinPlaylist";
import { usePlayerStore } from "../store/usePlayerStore";
import { usePlaylistStore } from "../store/usePlaylistStore";
import { openAppearanceWindow } from "./appearanceWindow";
import {
  exitSkinMode,
  minimizeSkinMode,
  quitApplication,
  readSkinModeAlwaysOnTop,
  restoreMainWindow,
  setSkinModeAlwaysOnTop,
} from "./skinModeWindow";
import type { SkinActionId, SkinActionPayloadFields } from "../types/skin";
import { useSkinStore } from "../store/useSkinStore";
import { useSkinPreferencesStore } from "../store/useSkinPreferencesStore";
import { useVisualizerStore } from "../store/useVisualizerStore";
import { useEqualizerStore } from "../store/useEqualizerStore";
import { pickAndImportLibraryPaths } from "./libraryImport";
import { getSkinAuxContext } from "./windowRole";
import { getSkinSlideshowStateApi } from "./skinSlideshowContext";
import { toggleShutter } from "./skinShutter";
import { getSkinViewStateApi } from "./skinViewStateContext";

export type SkinActionPayload = SkinActionPayloadFields;

export function skinControlPayload(source: {
  panelId?: string;
  viewId?: string;
  url?: string;
}): SkinActionPayload {
  return {
    panelId: source.panelId,
    viewId: source.viewId,
    url: source.url,
  };
}

export function runSkinAction(
  actionId: string | undefined,
  payload?: SkinActionPayload,
): void {
  if (!actionId) return;

  switch (actionId as SkinActionId) {
    case "player.togglePlayPause":
      usePlayerStore.getState().togglePlayPause();
      break;
    case "player.play": {
      const { playbackState, currentTrackId } = usePlayerStore.getState();
      if (playbackState === "playing") break;
      if (currentTrackId && playbackState === "paused") {
        usePlayerStore.getState().resume();
      } else if (currentTrackId) {
        void usePlayerStore.getState().playTrack(currentTrackId);
      }
      break;
    }
    case "player.pause":
      if (usePlayerStore.getState().playbackState === "playing") {
        usePlayerStore.getState().pause();
      }
      break;
    case "player.previousTrack":
      usePlayerStore.getState().previousTrack();
      break;
    case "player.nextTrack":
      usePlayerStore.getState().nextTrack();
      break;
    case "player.cycleRepeat":
      usePlayerStore.getState().cycleRepeat();
      break;
    case "player.toggleRepeat":
      usePlayerStore.getState().toggleRepeat();
      break;
    case "player.toggleShuffle":
      usePlayerStore.getState().toggleShuffle();
      break;
    case "player.seek":
      if (payload?.ratio !== undefined) {
        usePlayerStore.getState().seek(payload.ratio);
      }
      break;
    case "player.seekForward":
      usePlayerStore.getState().seekRelative(10);
      break;
    case "player.seekBackward":
      usePlayerStore.getState().seekRelative(-10);
      break;
    case "player.volumeUp": {
      const { volume, setVolume } = usePlayerStore.getState();
      setVolume(volume < 0.95 ? volume + 0.05 : 1);
      break;
    }
    case "player.volumeDown": {
      const { volume, setVolume } = usePlayerStore.getState();
      setVolume(volume > 0.05 ? volume - 0.05 : 0);
      break;
    }
    case "player.setVolume":
      if (payload?.volume !== undefined) {
        usePlayerStore.getState().setVolume(payload.volume);
      }
      break;
    case "player.setBalance":
      if (payload?.balance !== undefined) {
        usePlayerStore.getState().setBalance(payload.balance);
      }
      break;
    case "player.toggleMute":
      usePlayerStore.getState().toggleMute();
      break;
    case "player.clearSetList":
      usePlayerStore.getState().clearSetList();
      break;
    case "navigation.openAlbum": {
      const { library, playbackTracks, currentTrackId } =
        usePlayerStore.getState();
      const track = findPlaybackTrack({
        library,
        playbackTracks,
        currentTrackId,
      });
      if (track) {
        useNavigationStore.getState().openAlbum(albumKeyFromTrack(track));
      }
      break;
    }
    case "queue.openSetList":
      break;
    case "skin.openPicker":
      void openAppearanceWindow("skins");
      break;
    case "skin.exit":
      void exitSkinMode();
      break;
    case "skin.restoreMainWindow":
      void restoreMainWindow();
      break;
    case "skin.minimize":
      void minimizeSkinMode();
      break;
    case "app.quit":
      void quitApplication();
      break;
    case "skin.toggleAlwaysOnTop":
      void readSkinModeAlwaysOnTop().then((on) => setSkinModeAlwaysOnTop(!on));
      break;
    case "skin.togglePanel": {
      const panelId = payload?.panelId;
      if (panelId) void useSkinStore.getState().togglePanel(panelId);
      break;
    }
    case "skin.openPanel": {
      const panelId = payload?.panelId;
      if (panelId) void useSkinStore.getState().openPanel(panelId);
      break;
    }
    case "skin.closePanel": {
      const panelId = payload?.panelId;
      if (panelId) void useSkinStore.getState().closePanel(panelId);
      break;
    }
    case "skin.switchView": {
      const viewId = payload?.viewId;
      if (viewId) void useSkinStore.getState().switchView(viewId);
      break;
    }
    case "skin.openView": {
      const viewId = payload?.viewId;
      if (viewId) void useSkinStore.getState().openView(viewId);
      break;
    }
    case "skin.closeView": {
      const viewId = payload?.viewId ?? getSkinAuxContext()?.viewId;
      if (viewId) void useSkinStore.getState().closeView(viewId);
      break;
    }
    case "skin.toggleView": {
      const viewId = payload?.viewId;
      if (viewId) void useSkinStore.getState().toggleView(viewId);
      break;
    }
    case "skin.toggleSoundEffects":
      void useSkinPreferencesStore.getState().toggleSoundEffects();
      break;
    case "visualizer.previous":
      void useVisualizerStore.getState().cycleActivePack("prev");
      break;
    case "visualizer.next":
      void useVisualizerStore.getState().cycleActivePack("next");
      break;
    case "playlist.setSource": {
      const sourceId = payload?.sourceId;
      if (sourceId) useSkinStore.getState().setPlaylistSource(sourceId);
      break;
    }
    case "playlist.playTrack": {
      const trackId = payload?.trackId;
      if (trackId === undefined) break;

      const sourceId = useSkinStore.getState().playlistSourceId;
      const player = usePlayerStore.getState();
      const playlists = usePlaylistStore.getState().playlists;

      if (shouldReplacePlayContextForSkinPlaylistSource(sourceId)) {
        const ids = resolveSkinPlaylistTrackIds(sourceId, {
          library: player.library,
          playbackTracks: player.playbackTracks,
          cdQueueTracks: player.cdQueueContext?.tracks,
          playContextIds: player.playContextIds,
          manualQueueIds: player.manualQueueIds,
          currentTrackId: player.currentTrackId,
          playlists,
        });
        void player.playTracks(ids, trackId);
      } else {
        void player.playTrack(trackId);
      }
      break;
    }
    case "eq.setBand":
      if (payload?.band !== undefined && payload?.gain !== undefined) {
        useEqualizerStore.getState().setBand(payload.band - 1, payload.gain);
      }
      break;
    case "eq.applyPreset":
      if (payload?.presetId) {
        useEqualizerStore.getState().applyPreset(payload.presetId);
      }
      break;
    case "eq.reset":
      useEqualizerStore.getState().reset();
      break;
    case "eq.setEnabled":
      if (payload?.enabled !== undefined) {
        useEqualizerStore.getState().setEnabled(payload.enabled);
      }
      break;
    case "eq.previousPreset":
      useEqualizerStore.getState().cyclePreset("prev");
      break;
    case "eq.nextPreset":
      useEqualizerStore.getState().cyclePreset("next");
      break;
    case "app.openUrl":
      if (payload?.url) {
        void openUrl(payload.url);
      }
      break;
    case "app.openFile":
      void pickAndImportLibraryPaths();
      break;
    case "view.setScreen":
      if (payload?.screen) {
        getSkinViewStateApi()?.setScreen(payload.screen);
      }
      break;
    case "view.setVariable": {
      const api = getSkinViewStateApi();
      if (!api || !payload) break;
      const { variable, value, when } = payload;
      if (variable === undefined || value === undefined) break;
      if (when !== undefined && api.values[variable] !== when) break;
      api.setVariable(variable, value);
      break;
    }
    case "view.toggleShutter":
      toggleShutter();
      break;
    case "slideshow.setDeck": {
      const slideshowId = payload?.id;
      const deck = payload?.deck;
      if (slideshowId && deck) {
        getSkinSlideshowStateApi()?.setDeck(slideshowId, deck);
      }
      if (payload?.screen) {
        getSkinViewStateApi()?.setScreen(payload.screen);
      }
      break;
    }
    case "slideshow.prev":
      if (payload?.id) {
        getSkinSlideshowStateApi()?.prev(payload.id);
      }
      break;
    case "slideshow.next":
      if (payload?.id) {
        getSkinSlideshowStateApi()?.next(payload.id);
      }
      break;
    default:
      break;
  }
}

export function useSkinAction(
  actionId: string | undefined,
  source?: { panelId?: string; viewId?: string; url?: string },
) {
  return useCallback(
    (payload?: SkinActionPayload) => {
      runSkinAction(actionId, { ...skinControlPayload(source ?? {}), ...payload });
    },
    [actionId, source?.panelId, source?.viewId, source?.url],
  );
}
