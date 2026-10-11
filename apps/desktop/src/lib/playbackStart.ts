import { isPendingTrackId } from "./pendingImportTrack";
import { isPlaybackIdKnownUnplayable } from "./playbackSkip";
import { resolveIdlePlaybackTrackIds } from "./skinPlaylist";
import { usePlayerStore } from "../store/usePlayerStore";
import { usePlaylistStore } from "../store/usePlaylistStore";
import { useSkinStore } from "../store/useSkinStore";

function playFromClearedSetList(): void {
  const player = usePlayerStore.getState();
  const ids = resolveIdlePlaybackTrackIds(
    useSkinStore.getState().playlistSourceId,
    {
      library: player.library,
      playbackTracks: player.playbackTracks,
      cdQueueTracks: player.cdQueueContext?.tracks,
      playContextIds: player.playContextIds,
      manualQueueIds: player.manualQueueIds,
      currentTrackId: player.currentTrackId,
      playlists: usePlaylistStore.getState().playlists,
    },
  );
  const startId = ids.find(
    (id) =>
      !isPendingTrackId(id) && !isPlaybackIdKnownUnplayable(id, player.library),
  );
  if (startId === undefined) return;
  void player.playTracks(ids, startId);
}

/** Start or resume playback, including after stop has cleared the set list. */
export function playOrResume(): void {
  const { playbackState, currentTrackId } = usePlayerStore.getState();
  if (playbackState === "playing") return;
  if (currentTrackId && playbackState === "paused") {
    usePlayerStore.getState().resume();
    return;
  }
  if (currentTrackId) {
    void usePlayerStore.getState().playTrack(currentTrackId);
    return;
  }
  playFromClearedSetList();
}
