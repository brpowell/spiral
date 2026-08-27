import {
  memo,
  useCallback,
  useId,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { isCdTrackListId } from "../../lib/cdTracks";
import { formatTime } from "../../lib/format";
import { buildPlaybackOrder } from "../../lib/playbackOrder";
import { isTrackKnownUnplayable } from "../../lib/playbackSkip";
import { indexPlaybackTracks } from "../../lib/playbackTrack";
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
import { EntityArt } from "../EntityArt/EntityArt";
import { IconClose } from "../icons";
import { TrackItemTitle } from "../TrackItemTitle/TrackItemTitle";
import { usePrefetchVirtualRowArt } from "../TrackList/usePrefetchVirtualRowArt";
import { useTrackListVirtualizer } from "../TrackList/useTrackListVirtualizer";
import "./SetListModal.css";

/** Same cutoff as TrackList — a shuffled library is well past this. */
export const SET_LIST_VIRTUALIZE_AFTER = 40;

/** Art (36px) + 0.5rem vertical padding on each side. */
const SET_LIST_ROW_HEIGHT = 52;

interface SetListModalProps {
  open: boolean;
  onClose: () => void;
}

export function SetListModal({ open, onClose }: SetListModalProps) {
  const { t } = useTranslation("playback");
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
  const scrollRef = useRef<HTMLDivElement>(null);
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

  const libraryById = useMemo(() => {
    const map = new Map<number, Track>();
    for (const track of library) {
      map.set(track.id, track);
    }
    return map;
  }, [library]);

  const trackById = useMemo(
    () =>
      indexPlaybackTracks({
        library,
        playbackTracks,
        cdQueueTracks: cdQueueContext?.tracks,
      }),
    [library, playbackTracks, cdQueueContext],
  );

  const { nowPlaying, queuedTracks, laterTracks } = useMemo(() => {
    const isPlayable = (id: number) => {
      if (isCdTrackListId(id)) return true;
      return !isTrackKnownUnplayable(libraryById.get(id));
    };

    const resolvePlayable = (ids: number[]) => {
      const tracks: Track[] = [];
      for (const id of ids) {
        if (!isPlayable(id)) continue;
        const track = trackById.get(id);
        if (track) tracks.push(track);
      }
      return tracks;
    };

    const splitUpcoming = (ids: number[]) => {
      const upcoming = resolvePlayable(ids);
      const queued: Track[] = [];
      const later: Track[] = [];
      for (const track of upcoming) {
        if (manualQueueSet.has(track.id)) queued.push(track);
        else later.push(track);
      }
      return { queuedTracks: queued, laterTracks: later };
    };

    if (activeIds.length === 0) {
      return {
        nowPlaying: undefined,
        queuedTracks: [],
        laterTracks: [],
      };
    }

    if (currentTrackId === null) {
      return {
        nowPlaying: undefined,
        ...splitUpcoming(activeIds),
      };
    }

    const idx = activeIds.indexOf(currentTrackId);
    const upcomingIds = idx < 0 ? activeIds : activeIds.slice(idx + 1);

    return {
      nowPlaying: trackById.get(currentTrackId),
      ...splitUpcoming(upcomingIds),
    };
  }, [activeIds, currentTrackId, libraryById, manualQueueSet, trackById]);

  const handlePlay = useCallback(
    (id: number) => {
      void playTrack(id);
    },
    [playTrack],
  );

  const handleClear = () => {
    clearSetList();
    onClose();
  };

  const showQueuedSection = queuedTracks.length > 0;
  const upcomingTitle = showQueuedSection
    ? t("queue.later")
    : t("queue.upNext");

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      panelClassName="set-list-modal"
      panelRef={panelRef}
      labelledBy={titleId}
    >
      <ModalHeader>
        <ModalTitle id={titleId}>{t("queue.title")}</ModalTitle>
        <ModalHeaderActions>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            disabled={activeIds.length === 0}
          >
            {t("queue.clear")}
          </Button>
          <ModalCloseButton onClick={onClose} />
        </ModalHeaderActions>
      </ModalHeader>

      <ModalBody className="set-list-modal__body">
        {activeIds.length === 0 ? (
          <p className="set-list-modal__empty">{t("queue.empty")}</p>
        ) : (
          <div ref={scrollRef} className="set-list-modal__scroller">
            <SetListSection title={t("queue.nowPlaying")}>
              {nowPlaying ? (
                <SetListRow track={nowPlaying} playing onPlay={handlePlay} />
              ) : (
                <p className="set-list-modal__empty-section">
                  {t("queue.nothingPlaying")}
                </p>
              )}
            </SetListSection>

            {showQueuedSection ? (
              <SetListSection title={t("queue.queued")}>
                <SetListStaticList
                  tracks={queuedTracks}
                  removable
                  onPlay={handlePlay}
                  onRemoveFromQueue={removeFromQueue}
                />
              </SetListSection>
            ) : null}

            <SetListSection title={upcomingTitle}>
              {laterTracks.length === 0 ? (
                <p className="set-list-modal__empty-section">
                  {t("queue.noMore")}
                </p>
              ) : (
                <SetListUpcomingList
                  tracks={laterTracks}
                  scrollRef={scrollRef}
                  onPlay={handlePlay}
                />
              )}
            </SetListSection>
          </div>
        )}
      </ModalBody>
    </Modal>
  );
}

function SetListSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="set-list-modal__section">
      <h3 className="set-list-modal__section-title">{title}</h3>
      {children}
    </section>
  );
}

function SetListStaticList({
  tracks,
  removable = false,
  onPlay,
  onRemoveFromQueue,
}: {
  tracks: Track[];
  removable?: boolean;
  onPlay: (id: number) => void;
  onRemoveFromQueue?: (id: number) => void;
}) {
  return (
    <ul className="set-list-modal__list">
      {tracks.map((track) => (
        <li key={track.id}>
          <SetListRow
            track={track}
            showRemove={removable}
            onPlay={onPlay}
            onRemoveFromQueue={onRemoveFromQueue}
          />
        </li>
      ))}
    </ul>
  );
}

function SetListUpcomingList({
  tracks,
  scrollRef,
  onPlay,
}: {
  tracks: Track[];
  scrollRef: RefObject<HTMLDivElement | null>;
  onPlay: (id: number) => void;
}) {
  const useVirtualRows = tracks.length > SET_LIST_VIRTUALIZE_AFTER;
  const listRef = useRef<HTMLUListElement>(null);
  const getItemKey = useCallback(
    (index: number) => tracks[index]?.id ?? index,
    [tracks],
  );

  const virtualizer = useTrackListVirtualizer({
    enabled: useVirtualRows,
    count: tracks.length,
    listRef,
    bodyRef: listRef,
    scrollRef,
    estimateSize: SET_LIST_ROW_HEIGHT,
    getItemKey,
    initialRect: { width: 432, height: 320 },
  });

  const virtualRows = virtualizer.getVirtualItems();

  usePrefetchVirtualRowArt({
    enabled: useVirtualRows,
    tracks,
    virtualRows,
    isScrolling: virtualizer.isScrolling,
  });

  if (!useVirtualRows) {
    return <SetListStaticList tracks={tracks} onPlay={onPlay} />;
  }

  return (
    <ul
      ref={listRef}
      className="set-list-modal__list set-list-modal__list--virtual"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualRows.map((virtualRow) => {
        const track = tracks[virtualRow.index];
        if (!track) return null;
        return (
          <li
            key={virtualRow.key}
            className="set-list-modal__item"
            style={{
              height: virtualRow.size,
              transform: `translate3d(0, ${virtualRow.start - virtualizer.options.scrollMargin}px, 0)`,
            }}
          >
            <SetListRow track={track} onPlay={onPlay} />
          </li>
        );
      })}
    </ul>
  );
}

interface SetListRowProps {
  track: Track;
  playing?: boolean;
  showRemove?: boolean;
  onPlay: (id: number) => void;
  onRemoveFromQueue?: (id: number) => void;
}

const SetListRow = memo(function SetListRow({
  track,
  playing = false,
  showRemove = false,
  onPlay,
  onRemoveFromQueue,
}: SetListRowProps) {
  const { t } = useTranslation("playback");
  const subtitle = [track.artist, track.album].filter(Boolean).join(" — ");

  return (
    <div
      className={`set-list-modal__row${
        playing ? " set-list-modal__row--playing" : ""
      }`}
    >
      <button
        type="button"
        className="set-list-modal__row-main"
        onClick={() => onPlay(track.id)}
      >
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
      </button>
      <span className="set-list-modal__row-duration">
        {track.durationSeconds != null ? formatTime(track.durationSeconds) : ""}
      </span>
      <span className="set-list-modal__row-action">
        {showRemove && onRemoveFromQueue ? (
          <Button
            variant="ghost"
            size="xs"
            iconOnly
            onClick={() => onRemoveFromQueue(track.id)}
            aria-label={t("queue.removeAria")}
          >
            <IconClose />
          </Button>
        ) : null}
      </span>
    </div>
  );
});
