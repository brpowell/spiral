import { useCallback } from "react";
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
import type { SkinActionId } from "../types/skin";
import { useSkinStore } from "../store/useSkinStore";
import { useVisualizerStore } from "../store/useVisualizerStore";
import { useEqualizerStore } from "../store/useEqualizerStore";

export function runSkinAction(
  actionId: string | undefined,
  payload?: {
    ratio?: number;
    volume?: number;
    balance?: number;
    albumKey?: string;
    panelId?: string;
    sourceId?: string;
    trackId?: number;
    band?: number;
    gain?: number;
    enabled?: boolean;
    presetId?: string;
  },
): void {
  if (!actionId) return;

  switch (actionId as SkinActionId) {
    case "player.togglePlayPause":
      usePlayerStore.getState().togglePlayPause();
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
    case "player.toggleShuffle":
      usePlayerStore.getState().toggleShuffle();
      break;
    case "player.seek":
      if (payload?.ratio !== undefined) {
        usePlayerStore.getState().seek(payload.ratio);
      }
      break;
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
    case "player.clearTrackList":
      usePlayerStore.getState().clearTrackList();
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
    case "queue.openTrackList":
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
    default:
      break;
  }
}

export function useSkinAction(actionId: string | undefined, panelId?: string) {
  return useCallback(
    (payload?: {
      ratio?: number;
      volume?: number;
    balance?: number;
      albumKey?: string;
      panelId?: string;
      sourceId?: string;
      trackId?: number;
      band?: number;
      gain?: number;
      enabled?: boolean;
      presetId?: string;
    }) => {
      runSkinAction(actionId, {
        ...payload,
        panelId: payload?.panelId ?? panelId,
      });
    },
    [actionId, panelId],
  );
}
