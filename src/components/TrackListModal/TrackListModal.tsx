import { useEffect, useId, useMemo, useRef } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { buildPlaybackOrder } from "../../lib/activeTrackList";
import { formatTime } from "../../lib/format";
import { usePlayerStore } from "../../store/usePlayerStore";
import type { Track } from "../../types/track";
import { AnimatedModal } from "../AnimatedModal/AnimatedModal";
import { IconClose } from "../icons";
import "./TrackListModal.css";

interface TrackListModalProps {
  open: boolean;
  onClose: () => void;
}

function trackById(library: Track[], id: number): Track | undefined {
  return library.find((t) => t.id === id);
}

export function TrackListModal({ open, onClose }: TrackListModalProps) {
  const library = usePlayerStore((s) => s.library);
  const playContextIds = usePlayerStore((s) => s.playContextIds);
  const manualQueueIds = usePlayerStore((s) => s.manualQueueIds);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);

  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const activeIds = useMemo(
    () =>
      buildPlaybackOrder(
        manualQueueIds,
        playContextIds,
        library,
        currentTrackId,
      ),
    [manualQueueIds, playContextIds, library, currentTrackId],
  );

  const manualQueueSet = useMemo(
    () => new Set(manualQueueIds),
    [manualQueueIds],
  );

  const { nowPlayingId, upNextIds } = useMemo(() => {
    if (activeIds.length === 0) {
      return { nowPlayingId: null, upNextIds: [] as number[] };
    }
    if (currentTrackId === null) {
      return { nowPlayingId: null, upNextIds: activeIds };
    }
    const idx = activeIds.indexOf(currentTrackId);
    if (idx < 0) {
      return { nowPlayingId: currentTrackId, upNextIds: activeIds };
    }
    return {
      nowPlayingId: currentTrackId,
      upNextIds: activeIds.slice(idx + 1),
    };
  }, [activeIds, currentTrackId]);

  const nowPlaying = nowPlayingId
    ? trackById(library, nowPlayingId)
    : undefined;

  const handlePlay = (id: number) => {
    void playTrack(id);
  };

  return (
    <AnimatedModal
      open={open}
      backdropClassName="track-list-backdrop"
      panelClassName="track-list-modal"
      panelRef={panelRef}
      labelledBy={titleId}
      onBackdropClick={onClose}
    >
      <header className="track-list-modal__header">
        <h2 id={titleId} className="track-list-modal__title">
          Track list
        </h2>
        <button
          type="button"
          className="track-list-modal__close"
          onClick={onClose}
          aria-label="Close"
        >
          <IconClose />
        </button>
      </header>

      <div className="track-list-modal__body">
        {activeIds.length === 0 ? (
          <p className="track-list-modal__empty">No tracks in the list.</p>
        ) : (
          <>
            <section className="track-list-modal__section">
              <h3 className="track-list-modal__section-title">Now playing</h3>
              {nowPlaying ? (
                <TrackListRow
                  track={nowPlaying}
                  playing
                  queued={manualQueueSet.has(nowPlaying.id)}
                  onPlay={() => handlePlay(nowPlaying.id)}
                  onRemoveFromQueue={
                    manualQueueSet.has(nowPlaying.id)
                      ? () => removeFromQueue(nowPlaying.id)
                      : undefined
                  }
                />
              ) : (
                <p className="track-list-modal__empty-section">Nothing playing</p>
              )}
            </section>

            <section className="track-list-modal__section">
              <h3 className="track-list-modal__section-title">Up next</h3>
              {upNextIds.length === 0 ? (
                <p className="track-list-modal__empty-section">
                  No more tracks
                </p>
              ) : (
                <ul className="track-list-modal__list">
                  {upNextIds.map((id) => {
                    const track = trackById(library, id);
                    if (!track) return null;
                    const queued = manualQueueSet.has(id);
                    return (
                      <li key={id}>
                        <TrackListRow
                          track={track}
                          queued={queued}
                          onPlay={() => handlePlay(id)}
                          onRemoveFromQueue={
                            queued ? () => removeFromQueue(id) : undefined
                          }
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </AnimatedModal>
  );
}

interface TrackListRowProps {
  track: Track;
  playing?: boolean;
  queued?: boolean;
  onPlay: () => void;
  onRemoveFromQueue?: () => void;
}

function TrackListRow({
  track,
  playing = false,
  queued = false,
  onPlay,
  onRemoveFromQueue,
}: TrackListRowProps) {
  const subtitle = [track.artist, track.album].filter(Boolean).join(" — ");

  return (
    <div
      className={`track-list-modal__row${
        playing ? " track-list-modal__row--playing" : ""
      }${queued ? " track-list-modal__row--queued" : ""}`}
    >
      <button type="button" className="track-list-modal__row-main" onClick={onPlay}>
        <span className="track-list-modal__row-title">{track.title}</span>
        {subtitle ? (
          <span className="track-list-modal__row-subtitle">{subtitle}</span>
        ) : null}
        {track.durationSeconds != null && (
          <span className="track-list-modal__row-duration">
            {formatTime(track.durationSeconds)}
          </span>
        )}
      </button>
      {onRemoveFromQueue ? (
        <button
          type="button"
          className="track-list-modal__row-remove"
          onClick={onRemoveFromQueue}
          aria-label="Remove from queue"
        >
          Remove
        </button>
      ) : null}
    </div>
  );
}
