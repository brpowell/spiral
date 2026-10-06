import { emit } from "@tauri-apps/api/event";
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
import { usePlaybackSettingsStore } from "../store/usePlaybackSettingsStore";
import { pickAndImportLibraryPaths } from "./libraryImport";
import { confirmAndOpenSkinUrl } from "./skinOpenUrl";
import {
  SKIN_PREFERENCES_ACTION_EVENT,
  type SkinPreferencesActionPayload,
} from "./skinBridge";
import { getSkinAuxContext, getWindowRole } from "./windowRole";
import { getSkinSlideshowStateApi } from "./skinSlideshowContext";
import { getSkinScrollStripStateApi } from "./skinScrollStripContext";
import { getSkinViewStateApi } from "./skinViewStateContext";
import { applyViewStateEvent } from "./skinViewStateEvents";
import { playOrResume } from "./playbackStart";

export type SkinActionPayload = SkinActionPayloadFields;

function dispatchSkinPreferencesAction(
  payload: SkinPreferencesActionPayload,
): void {
  if (getWindowRole() === "main") {
    const store = useSkinPreferencesStore.getState();
    const skinId = useSkinStore.getState().activeSkinId;
    switch (payload.type) {
      case "toggleSoundEffects":
        void store.toggleSoundEffects(skinId);
        break;
      case "togglePref":
        void store.togglePref(payload.settingId, skinId);
        break;
      case "setPref":
        void store.setPref(payload.settingId, payload.value, skinId);
        break;
    }
    return;
  }
  void emit(SKIN_PREFERENCES_ACTION_EVENT, payload);
}

export function runSkinAction(
  actionId: string | undefined,
  payload?: SkinActionPayload,
): boolean {
  if (!actionId) return false;

  if ((actionId as SkinActionId) === "state.applyEvent") {
    const api = getSkinViewStateApi();
    const { variable, event } = payload ?? {};
    if (!api || !variable || !event) return false;
    const { activePack, activeViewId } = useSkinStore.getState();
    const stateSpec = activePack?.manifest.views[activeViewId]?.state;
    return applyViewStateEvent(variable, event, stateSpec, api);
  }

  switch (actionId as SkinActionId) {
    case "player.togglePlayPause":
      usePlayerStore.getState().togglePlayPause();
      break;
    case "player.play":
      playOrResume();
      break;
    case "player.pause":
      if (usePlayerStore.getState().playbackState === "playing") {
        usePlayerStore.getState().pause();
      }
      break;
    case "player.stop":
      usePlayerStore.getState().clearSetList();
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
    case "player.toggleCrossfade":
      usePlaybackSettingsStore.getState().toggleCrossfade();
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
      dispatchSkinPreferencesAction({ type: "toggleSoundEffects" });
      break;
    case "skin.togglePref": {
      const settingId = payload?.settingId;
      if (settingId) {
        dispatchSkinPreferencesAction({ type: "togglePref", settingId });
      }
      break;
    }
    case "skin.setPref": {
      const settingId = payload?.settingId;
      if (settingId && payload?.value !== undefined) {
        dispatchSkinPreferencesAction({
          type: "setPref",
          settingId,
          value: payload.value,
        });
      }
      break;
    }
    case "visualizer.previous":
      void useVisualizerStore.getState().cycleActiveVisualizer("prev");
      break;
    case "visualizer.next":
      void useVisualizerStore.getState().cycleActiveVisualizer("next");
      break;
    case "playlist.setSource": {
      const sourceId = payload?.sourceId;
      if (sourceId) useSkinStore.getState().setPlaylistSource(sourceId);
      break;
    }
    case "playlist.setFilter": {
      useSkinStore.getState().setPlaylistFilter(payload?.query ?? "");
      break;
    }
    case "playlist.playTrack": {
      const trackId = payload?.trackId;
      if (trackId === undefined) break;

      const skin = useSkinStore.getState();
      const sourceId = skin.playlistSourceId;
      const player = usePlayerStore.getState();
      const playlists = usePlaylistStore.getState().playlists;

      if (shouldReplacePlayContextForSkinPlaylistSource(sourceId)) {
        // Search filters the visible list only — play context is the full
        // source, same as library TracksView.
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
        void confirmAndOpenSkinUrl(payload.url);
      }
      break;
    case "app.openFile":
      void pickAndImportLibraryPaths();
      break;
    case "state.setVariable": {
      const api = getSkinViewStateApi();
      if (!api || !payload) break;
      const { variable, value, when } = payload;
      if (variable === undefined || value === undefined) break;
      if (when !== undefined && api.values[variable] !== when) break;
      api.setVariable(variable, value);
      break;
    }
    case "slideshow.setDeck": {
      const slideshowId = payload?.id;
      const deck = payload?.deck;
      if (slideshowId && deck) {
        getSkinSlideshowStateApi()?.setDeck(slideshowId, deck);
      }
      if (payload?.screen) {
        getSkinViewStateApi()?.setVariable("screen", payload.screen);
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
    case "scrollStrip.prev":
      if (payload?.id) {
        getSkinScrollStripStateApi()?.prev(payload.id);
      }
      break;
    case "scrollStrip.next":
      if (payload?.id) {
        getSkinScrollStripStateApi()?.next(payload.id);
      }
      break;
    case "scrollStrip.setSlide": {
      const stripId = payload?.id;
      const slide = payload?.slide;
      if (stripId && slide !== undefined) {
        getSkinScrollStripStateApi()?.setSlide(stripId, slide);
      }
      break;
    }
    default:
      break;
  }
  return true;
}
