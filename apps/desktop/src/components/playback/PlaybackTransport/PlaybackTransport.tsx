import { useMemo } from "react";
import { buildPlaybackOrder } from "../../../lib/playbackOrder";
import { getManualNextId } from "../../../lib/playbackQueue";
import { getNextSkippingKnownUnplayable } from "../../../lib/playbackSkip";
import { isTrackImporting } from "../../../lib/pendingImportTrack";
import { usePlayerStore } from "../../../store/usePlayerStore";
import { TransportButtons } from "./TransportButtons";

interface PlaybackTransportProps {
  className?: string;
  nodeId?: string;
  interactionEnabled?: boolean;
}

export function PlaybackTransport({
  className,
  nodeId,
  interactionEnabled = true,
}: PlaybackTransportProps) {
  const library = usePlayerStore((s) => s.library);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const playbackState = usePlayerStore((s) => s.playbackState);
  const playContextIds = usePlayerStore((s) => s.playContextIds);
  const manualQueueIds = usePlayerStore((s) => s.manualQueueIds);
  const repeatMode = usePlayerStore((s) => s.repeatMode);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const togglePlayPause = usePlayerStore((s) => s.togglePlayPause);
  const previousTrack = usePlayerStore((s) => s.previousTrack);
  const nextTrack = usePlayerStore((s) => s.nextTrack);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);

  const activeQueue = useMemo(
    () =>
      buildPlaybackOrder(
        manualQueueIds,
        playContextIds,
        library,
        currentTrackId,
      ),
    [manualQueueIds, playContextIds, library, currentTrackId],
  );

  const canPlay =
    currentTrackId !== null ||
    library.some((track) => !isTrackImporting(track));

  const canGoPrevious = currentTrackId !== null;

  const canGoNext =
    currentTrackId !== null &&
    activeQueue.length > 0 &&
    getNextSkippingKnownUnplayable(
      activeQueue,
      currentTrackId,
      repeatMode,
      library,
      getManualNextId,
    ) !== null;

  return (
    <TransportButtons
      className={className}
      nodeId={nodeId}
      interactionEnabled={interactionEnabled}
      shuffle={shuffle}
      repeatMode={repeatMode}
      playing={playbackState === "playing"}
      canPlay={canPlay}
      canGoPrevious={canGoPrevious}
      canGoNext={canGoNext}
      onShuffle={toggleShuffle}
      onPrevious={previousTrack}
      onPlayPause={togglePlayPause}
      onNext={nextTrack}
      onRepeat={cycleRepeat}
    />
  );
}
