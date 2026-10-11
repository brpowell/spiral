import { LayoutGroup, motion } from "framer-motion";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNowPlayingDisplay } from "../../../hooks/useNowPlayingDisplay";
import { t } from "../../../lib/i18n";
import { getTrackLyrics } from "../../../lib/tauri";
import {
  canFetchLyricsForTrack,
  prepareLyricsFetchForLightbox,
  startLyricsFetchForTrack,
} from "../../../lib/lyricsFetchToast";
import { commitFetchedLyricsForTrack } from "../../../lib/lyricsFetchCommit";
import {
  createLyricsFetchFeedback,
  LYRICS_FETCH_INSTRUMENTAL,
  LYRICS_FETCH_NOT_FOUND,
  type LyricsLibraryTrackRef,
} from "../../../lib/lyricsFetch";
import { missingFileErrorDetail } from "../../../lib/missingFileTrack";
import { useLibrarySettingsStore } from "../../../store/useLibrarySettingsStore";
import { useLyricsFetchStore } from "../../../store/useLyricsFetchStore";
import { usePlayerStore } from "../../../store/usePlayerStore";
import type { LyricsSearchCandidate, TrackLyrics } from "../../../types/lyrics";
import type { Track } from "../../../types/track";
import {
  AlbumArtLightbox,
  albumArtLayoutTransition,
  NOW_PLAYING_ART_LAYOUT_ID,
  NOW_PLAYING_ART_RADIUS,
} from "../../AlbumArtLightbox/AlbumArtLightbox";
import { LyricsCandidatePicker } from "../../LyricsCandidatePicker/LyricsCandidatePicker";
import { ScrollingText } from "../../ScrollingText/ScrollingText";
import {
  CrossfadeOpacity,
  NowPlayingArtVisual,
} from "../NowPlayingArt/NowPlayingArt";
import {
  NowPlayingSubtitle,
  nowPlayingSubtitleText,
} from "./NowPlayingSubtitle";
import "./NowPlayingMetadata.css";

/** Stable fallback so Zustand selectors don't return a fresh `[]` each read. */
const EMPTY_LYRICS_CANDIDATES: LyricsSearchCandidate[] = [];

interface NowPlayingMetadataProps {
  className?: string;
}

/** Reserves bar space; unmounts the shared-layout node while the lightbox owns it. */
function SharedArtSlot({
  artOpen,
  children,
}: {
  artOpen: boolean;
  children: ReactNode;
}) {
  return (
    <div className="now-playing-metadata__art-slot">
      <div className="now-playing-metadata__art-sizer" aria-hidden />
      {!artOpen ? children : null}
    </div>
  );
}

export function NowPlayingMetadata({ className }: NowPlayingMetadataProps) {
  const display = useNowPlayingDisplay();
  const {
    currentTrack,
    outgoingTrack,
    incomingTrack,
    displayTrack,
    showCrossfadeVisual,
    reduceMotion,
    artSrc,
    outgoingArtSrc,
    incomingArtSrc,
  } = display;
  const [artOpen, setArtOpen] = useState(false);
  const [trackLyrics, setTrackLyrics] = useState<TrackLyrics | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const autoFetchedTrackIdRef = useRef<number | null>(null);

  const displayTrackId = displayTrack?.id ?? null;
  const lyricsRevision = usePlayerStore((s) =>
    displayTrackId != null
      ? (s.lyricsRevisionByTrackId[displayTrackId] ?? 0)
      : 0,
  );
  const librarySettings = useLibrarySettingsStore((s) => s.settings);
  const openTrackEditor = usePlayerStore((s) => s.openTrackEditor);
  const lyricsAutoFetchInLightbox =
    librarySettings?.lyricsAutoFetchInLightbox ?? true;
  const fetchingLyrics = useLyricsFetchStore((s) =>
    displayTrackId != null ? s.fetchingTrackIds.has(displayTrackId) : false,
  );
  const lyricsQueued = useLyricsFetchStore((s) =>
    displayTrackId != null ? s.queuedTrackIds.has(displayTrackId) : false,
  );
  const [prepareInFlight, setPrepareInFlight] = useState(false);
  const isInstrumental =
    displayTrack?.lyricsFormat === "instrumental" ||
    trackLyrics?.format === "instrumental";
  const canFetchLyrics =
    displayTrack != null &&
    !lyricsLoading &&
    !isInstrumental &&
    !trackLyrics?.plainText.trim() &&
    canFetchLyricsForTrack(displayTrack);
  const autoFetchEligible =
    artOpen &&
    canFetchLyrics &&
    displayTrackId != null &&
    lyricsAutoFetchInLightbox &&
    !lyricsQueued &&
    !fetchingLyrics &&
    autoFetchedTrackIdRef.current !== displayTrackId;
  const lyricsFetchPending =
    fetchingLyrics || lyricsQueued || prepareInFlight || autoFetchEligible;
  const lyricsFetchFeedbackFromStore = useLyricsFetchStore((s) =>
    displayTrackId != null
      ? (s.pendingByTrackId[displayTrackId]?.feedback ?? null)
      : null,
  );
  const lyricsCandidates = useLyricsFetchStore((s) =>
    displayTrackId != null
      ? (s.pendingByTrackId[displayTrackId]?.candidates ??
        EMPTY_LYRICS_CANDIDATES)
      : EMPTY_LYRICS_CANDIDATES,
  );
  const lyricsFetchFeedback = isInstrumental
    ? LYRICS_FETCH_INSTRUMENTAL
    : lyricsFetchFeedbackFromStore;
  const showLyricsCandidatePicker = artOpen && lyricsCandidates.length > 1;
  const lyricsLibraryTrack = useMemo((): LyricsLibraryTrackRef | null => {
    if (!displayTrack) return null;
    return {
      title: displayTrack.title,
      artist: displayTrack.artist?.trim() || "",
      album: displayTrack.album?.trim() || "",
      durationSeconds: displayTrack.durationSeconds ?? null,
    };
  }, [displayTrack]);
  const subtitle = nowPlayingSubtitleText(displayTrack);
  const noTrackLabel = t("playback:nowPlaying.noTrack");
  const unknownArtistLabel = t("playback:nowPlaying.unknownArtist");

  useEffect(() => {
    if (!displayTrackId) {
      setTrackLyrics(null);
      setLyricsLoading(false);
      return;
    }

    setTrackLyrics(null);
    setLyricsLoading(true);
    let cancelled = false;
    void getTrackLyrics(displayTrackId).then((lyrics) => {
      if (!cancelled) {
        setTrackLyrics(lyrics);
        setLyricsLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [displayTrackId, lyricsRevision]);

  useEffect(() => {
    if (!currentTrack) {
      setArtOpen(false);
    }
  }, [currentTrack]);

  const handleArtClick = useCallback(() => {
    if (artSrc && !showCrossfadeVisual) {
      setArtOpen(true);
    }
  }, [artSrc, showCrossfadeVisual]);

  const handleFetchLyrics = useCallback(() => {
    if (!displayTrack || lyricsFetchPending) return;
    startLyricsFetchForTrack(displayTrack);
  }, [lyricsFetchPending, displayTrack]);

  const handleSelectLyricsCandidate = useCallback(
    async (candidate: LyricsSearchCandidate) => {
      if (!displayTrack) return;
      useLyricsFetchStore.getState().clearPending(displayTrack.id);
      const result = await commitFetchedLyricsForTrack(displayTrack, {
        plainText: candidate.lyrics.plainText,
        lines: candidate.lyrics.lines,
        format: candidate.lyrics.format,
      });
      if (result.status === "ok") return;
      if (result.status === "missing_file") {
        useLyricsFetchStore.getState().applyOutcome(displayTrack.id, {
          feedback: createLyricsFetchFeedback(
            missingFileErrorDetail(displayTrack),
          ),
          candidates: [],
        });
        return;
      }
      useLyricsFetchStore.getState().applyOutcome(displayTrack.id, {
        feedback: createLyricsFetchFeedback(
          "Fetched lyrics couldn't be saved. Try again or use Save.",
        ),
        candidates: [],
      });
    },
    [displayTrack],
  );

  const handleDismissLyricsCandidates = useCallback(() => {
    if (displayTrackId == null) return;
    useLyricsFetchStore.getState().applyOutcome(displayTrackId, {
      feedback: LYRICS_FETCH_NOT_FOUND,
      candidates: [],
    });
  }, [displayTrackId]);

  const handleAddLyricsManually = useCallback(() => {
    if (displayTrackId == null) return;
    setArtOpen(false);
    openTrackEditor(displayTrackId, { tab: "lyrics" });
  }, [displayTrackId, openTrackEditor]);

  useEffect(() => {
    if (!artOpen) {
      autoFetchedTrackIdRef.current = null;
    }
  }, [artOpen]);

  useEffect(() => {
    if (
      !artOpen ||
      !canFetchLyrics ||
      !displayTrack ||
      displayTrackId == null ||
      !lyricsAutoFetchInLightbox
    ) {
      setPrepareInFlight(false);
      return;
    }
    if (lyricsQueued || fetchingLyrics) return;
    if (autoFetchedTrackIdRef.current === displayTrackId) return;

    const trackId = displayTrackId;
    const trackSnapshot = displayTrack;
    const timer = window.setTimeout(() => {
      if (autoFetchedTrackIdRef.current === trackId) return;
      autoFetchedTrackIdRef.current = trackId;
      setPrepareInFlight(true);
      void prepareLyricsFetchForLightbox(trackSnapshot, {
        autoFetch: lyricsAutoFetchInLightbox,
      }).finally(() => {
        setPrepareInFlight(false);
      });
    }, 500);

    return () => {
      window.clearTimeout(timer);
      setPrepareInFlight(false);
    };
  }, [
    artOpen,
    canFetchLyrics,
    fetchingLyrics,
    lyricsAutoFetchInLightbox,
    lyricsQueued,
    displayTrack,
    displayTrackId,
  ]);

  const artLabel = displayTrack?.album
    ? t("playback:nowPlaying.viewAlbumArtFor", { album: displayTrack.album })
    : t("playback:nowPlaying.viewAlbumArt");

  const renderArt = () => {
    const crossfadingArt =
      showCrossfadeVisual && (outgoingArtSrc || incomingArtSrc);

    if (crossfadingArt) {
      return (
        <SharedArtSlot artOpen={artOpen}>
          <motion.button
            type="button"
            className="now-playing-art now-playing-art--shared"
            layoutId={NOW_PLAYING_ART_LAYOUT_ID}
            layoutCrossfade={false}
            transition={albumArtLayoutTransition}
            style={{ borderRadius: NOW_PLAYING_ART_RADIUS }}
            disabled
            aria-label={t("playback:nowPlaying.crossfading")}
          >
            <NowPlayingArtVisual display={display} />
          </motion.button>
        </SharedArtSlot>
      );
    }

    if (artSrc) {
      return (
        <SharedArtSlot artOpen={artOpen}>
          <motion.button
            type="button"
            className="now-playing-art now-playing-art--zoomable now-playing-art--shared"
            layoutId={NOW_PLAYING_ART_LAYOUT_ID}
            layoutCrossfade={false}
            transition={albumArtLayoutTransition}
            style={{ borderRadius: NOW_PLAYING_ART_RADIUS }}
            onClick={handleArtClick}
            disabled={!currentTrack}
            aria-label={artLabel}
          >
            <NowPlayingArtVisual display={display} />
          </motion.button>
        </SharedArtSlot>
      );
    }

    return (
      <div
        className={[
          "now-playing-art",
          !currentTrack && "now-playing-art--inactive",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-hidden
      >
        <NowPlayingArtVisual display={display} />
      </div>
    );
  };

  const renderTextLayer = (
    track: Track | undefined,
    fallbackTitle: string,
    fallbackSubtitle: string,
    interactive: boolean,
  ) => (
    <>
      <ScrollingText
        className="now-playing-metadata__title"
        text={track?.title ?? fallbackTitle}
      />
      <NowPlayingSubtitle
        track={track}
        fallback={fallbackSubtitle}
        interactive={interactive}
      />
    </>
  );

  const sizerTrack = showCrossfadeVisual
    ? (outgoingTrack ?? incomingTrack ?? currentTrack)
    : currentTrack;

  return (
    <LayoutGroup>
      <div
        className={[
          "now-playing-metadata",
          showCrossfadeVisual && "now-playing-metadata--crossfading",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {renderArt()}
        <div className="now-playing-metadata__text">
          <div className="now-playing-metadata__text-sizer" aria-hidden>
            {renderTextLayer(
              sizerTrack,
              noTrackLabel,
              unknownArtistLabel,
              false,
            )}
          </div>
          <div className="now-playing-metadata__text-overlay">
            {showCrossfadeVisual && (outgoingTrack || incomingTrack) ? (
              <>
                <CrossfadeOpacity role="outgoing" reduceMotion={reduceMotion}>
                  {renderTextLayer(
                    outgoingTrack,
                    noTrackLabel,
                    unknownArtistLabel,
                    false,
                  )}
                </CrossfadeOpacity>
                <CrossfadeOpacity role="incoming" reduceMotion={reduceMotion}>
                  {renderTextLayer(
                    incomingTrack,
                    noTrackLabel,
                    unknownArtistLabel,
                    false,
                  )}
                </CrossfadeOpacity>
              </>
            ) : (
              renderTextLayer(
                currentTrack,
                noTrackLabel,
                unknownArtistLabel,
                true,
              )
            )}
          </div>
        </div>
      </div>

      {artSrc ? (
        <AlbumArtLightbox
          open={artOpen}
          onClose={() => setArtOpen(false)}
          artSrc={artSrc}
          alt={displayTrack?.album ?? ""}
          title={displayTrack?.title}
          caption={subtitle ?? undefined}
          lyrics={trackLyrics}
          lyricsLoading={lyricsLoading}
          reduceMotion={reduceMotion}
          canFetchLyrics={canFetchLyrics}
          fetchingLyrics={lyricsFetchPending}
          lyricsFetchFeedback={lyricsFetchFeedback}
          onFetchLyrics={handleFetchLyrics}
          onAddLyricsManually={handleAddLyricsManually}
          dismissible={!showLyricsCandidatePicker}
        />
      ) : null}

      <LyricsCandidatePicker
        open={showLyricsCandidatePicker}
        candidates={lyricsCandidates}
        libraryTrack={lyricsLibraryTrack}
        onSelect={handleSelectLyricsCandidate}
        onClose={handleDismissLyricsCandidates}
      />
    </LayoutGroup>
  );
}
