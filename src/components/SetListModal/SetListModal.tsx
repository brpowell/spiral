import { useId, useMemo, useRef } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { buildPlaybackOrder } from "../../lib/playbackOrder";
import { formatTime } from "../../lib/format";
import { findPlaybackTrack } from "../../lib/playbackTrack";
import { isTrackKnownUnplayable } from "../../lib/playbackSkip";
import { usePlayerStore } from "../../store/usePlayerStore";
import type { Track } from "../../types/track";
import { Button } from "../common/Button/Button";
import {
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalHeader,
  ModalHeaderActions,
  ModalTitle,
} from "../common/Modal/Modal";
import { TrackItemTitle } from "../TrackItemTitle/TrackItemTitle";
import { EntityArt } from "../EntityArt/EntityArt";
import "./SetListModal.css";

interface SetListModalProps {
  open: boolean;
  onClose: () => void;
}

export function SetListModal({ open, onClose }: SetListModalProps) {
  const library = usePlayerStore((s) => s.library);
  const playbackTracks = usePlayerStore((s) => s.playbackTracks);
  const cdQueueContext = usePlayerStore((s) => s.cdQueueContext);
  const playContextIds = usePlayerStore((s) => s.playContextIds);
  const manualQueueIds = usePlayerStore((s) => s.manualQueueIds);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const clearSetList = usePlayerStore((s) => s.clearSetList);

  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open);

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
    const playableUpNext = (ids: number[]) =>
      ids.filter((id) => {
        const track = library.find((item) => item.id === id);
        return !isTrackKnownUnplayable(track);
      });

    if (activeIds.length === 0) {
      return { nowPlayingId: null, upNextIds: [] as number[] };
    }
    if (currentTrackId === null) {
      return { nowPlayingId: null, upNextIds: playableUpNext(activeIds) };
    }
    const idx = activeIds.indexOf(currentTrackId);
    if (idx < 0) {
      return {
        nowPlayingId: currentTrackId,
        upNextIds: playableUpNext(activeIds),
      };
    }
    return {
      nowPlayingId: currentTrackId,
      upNextIds: playableUpNext(activeIds.slice(idx + 1)),
    };
  }, [activeIds, currentTrackId, library]);

  const nowPlaying = nowPlayingId
    ? findPlaybackTrack({
        library,
        playbackTracks,
        cdQueueTracks: cdQueueContext?.tracks,
        currentTrackId: nowPlayingId,
      })
    : undefined;

  const handlePlay = (id: number) => {
    void playTrack(id);
  };

  const handleClear = () => {
    clearSetList();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      panelRef={panelRef}
      labelledBy={titleId}
    >
      <ModalHeader>
        <ModalTitle id={titleId}>Set list</ModalTitle>
        <ModalHeaderActions>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            disabled={activeIds.length === 0}
          >
            Clear
          </Button>
          <ModalCloseButton onClick={onClose} />
        </ModalHeaderActions>
      </ModalHeader>

      <ModalBody>
        {activeIds.length === 0 ? (
          <p className="set-list-modal__empty">Nothing on the set list.</p>
        ) : (
          <>
            <section className="set-list-modal__section">
              <h3 className="set-list-modal__section-title">Now playing</h3>
              {nowPlaying ? (
                <SetListRow
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
                <p className="set-list-modal__empty-section">Nothing playing</p>
              )}
            </section>

            <section className="set-list-modal__section">
              <h3 className="set-list-modal__section-title">Up next</h3>
              {upNextIds.length === 0 ? (
                <p className="set-list-modal__empty-section">
                  No more tracks
                </p>
              ) : (
                <ul className="set-list-modal__list">
                  {upNextIds.map((id) => {
                    const track = findPlaybackTrack({
                      library,
                      playbackTracks,
                      cdQueueTracks: cdQueueContext?.tracks,
                      currentTrackId: id,
                    });
                    if (!track) return null;
                    const queued = manualQueueSet.has(id);
                    return (
                      <li key={id}>
                        <SetListRow
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
      </ModalBody>
    </Modal>
  );
}

interface SetListRowProps {
  track: Track;
  playing?: boolean;
  queued?: boolean;
  onPlay: () => void;
  onRemoveFromQueue?: () => void;
}

function SetListRow({
  track,
  playing = false,
  queued = false,
  onPlay,
  onRemoveFromQueue,
}: SetListRowProps) {
  const subtitle = [track.artist, track.album].filter(Boolean).join(" — ");

  return (
    <div
      className={`set-list-modal__row${playing ? " set-list-modal__row--playing" : ""
        }${queued ? " set-list-modal__row--queued" : ""}`}
    >
      <button type="button" className="set-list-modal__row-main" onClick={onPlay}>
        <EntityArt
          artPath={track.artPath}
          alt=""
          className="set-list-modal__row-art album-art--row"
          variant="row"
        />
        <span className="set-list-modal__row-title">
          <TrackItemTitle
            track={track}
            className="set-list-modal__row-title-inner"
          />
        </span>
        {subtitle ? (
          <span className="set-list-modal__row-subtitle">{subtitle}</span>
        ) : null}
        {track.durationSeconds != null && (
          <span className="set-list-modal__row-duration">
            {formatTime(track.durationSeconds)}
          </span>
        )}
      </button>
      {onRemoveFromQueue ? (
        <Button
          variant="ghost"
          size="sm"
          className="set-list-modal__row-remove"
          onClick={onRemoveFromQueue}
          aria-label="Remove from set list"
        >
          Remove
        </Button>
      ) : null}
    </div>
  );
}
