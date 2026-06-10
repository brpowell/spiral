import { useCallback } from "react";
import { albumKey as albumKeyFromTrack } from "./albums";
import { useNavigationStore } from "../store/useNavigationStore";
import { findPlaybackTrack } from "./playbackTrack";
import { usePlayerStore } from "../store/usePlayerStore";
import { openSkinPickerWindow } from "./skinPickerWindow";
import {
  exitSkinMode,
  minimizeSkinMode,
  quitApplication,
  readSkinModeAlwaysOnTop,
  restoreMainWindow,
  setSkinModeAlwaysOnTop,
} from "./skinModeWindow";
import type { SkinActionId } from "../types/skin";

export function runSkinAction(
  actionId: string | undefined,
  payload?: { ratio?: number; volume?: number; albumKey?: string },
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
      void openSkinPickerWindow();
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
    default:
      break;
  }
}

export function useSkinAction(actionId: string | undefined) {
  return useCallback(
    (payload?: { ratio?: number; volume?: number; albumKey?: string }) => {
      runSkinAction(actionId, payload);
    },
    [actionId],
  );
}
