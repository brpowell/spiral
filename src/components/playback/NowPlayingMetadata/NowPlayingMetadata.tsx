import { LayoutGroup, motion } from "framer-motion";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAssetUrl } from "../../../hooks/useAssetUrl";
import { usePlaybackProgress } from "../../../hooks/usePlaybackProgress";
import { t } from "../../../lib/i18n";
import { findPlaybackTrack } from "../../../lib/playbackTrack";
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
import { usePlaybackSettingsStore } from "../../../store/usePlaybackSettingsStore";
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
import { IconAlbumPlaceholder } from "../../icons";
import "./NowPlayingMetadata.css";

/** Stable fallback so Zustand selectors don't return a fresh `[]` each read. */
const EMPTY_LYRICS_CANDIDATES: LyricsSearchCandidate[] = [];

interface NowPlayingMetadataProps {
  className?: string;
  showArt?: boolean;
  showText?: boolean;
}

function trackSubtitle(track: Track | undefined): string | null {
  if (!track) return null;
  return [track.artist, track.album].filter(Boolean).join(" — ");
}

function CrossfadeOpacity({
  progress,
  role,
  reduceMotion,
  children,
}: {
  progress: number;
  role: "outgoing" | "incoming";
  reduceMotion: boolean;
  children: ReactNode;
}) {
  if (reduceMotion) {
    const showIncoming = progress >= 0.5;
    const visible = role === "incoming" ? showIncoming : !showIncoming;
    if (!visible) return null;
    return <>{children}</>;
  }

  const opacity = role === "incoming" ? progress : 1 - progress;
  if (opacity <= 0.01) return null;

  return (
    <div
      className="now-playing-metadata__crossfade-layer"
      style={{ opacity }}
      aria-hidden={opacity < 0.5}
    >
      {children}
    </div>
  );
}

function AlbumArtImage({ src }: { src: string }) {
  return <img src={src} alt="" className="now-playing-metadata__art-img" />;
}

function AlbumArtPlaceholder({ inactive }: { inactive?: boolean }) {
  return (
    <div
      className={[
        "now-playing-metadata__art",
        inactive && "now-playing-metadata__art--inactive",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-hidden
    >
      <div className="now-playing-metadata__art-placeholder" aria-hidden>
        <IconAlbumPlaceholder />
      </div>
    </div>
  );
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

export function NowPlayingMetadata({
  className,
  showArt = true,
  showText = true,
}: NowPlayingMetadataProps) {
  const library = usePlayerStore((s) => s.library);
  const playbackTracks = usePlayerStore((s) => s.playbackTracks);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const crossfadeVisual = usePlayerStore((s) => s.crossfadeVisual);
  const crossfadeVisualEnabled = usePlaybackSettingsStore(
    (s) => s.crossfadeVisualEnabled,
  );
  const showCrossfadeVisual =
    crossfadeVisual !== null && crossfadeVisualEnabled;
  const crossfadeProgress = crossfadeVisual?.progress ?? 0;
  const [artOpen, setArtOpen] = useState(false);
  const [trackLyrics, setTrackLyrics] = useState<TrackLyrics | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const autoFetchedTrackIdRef = useRef<number | null>(null);
  const [reduceMotion, setReduceMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduceMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const currentTrack = useMemo(
    () => findPlaybackTrack({ library, playbackTracks, currentTrackId }),
    [library, playbackTracks, currentTrackId],
  );

  const outgoingTrack = useMemo(
    () =>
      showCrossfadeVisual && crossfadeVisual
        ? findPlaybackTrack({
            library,
            playbackTracks,
            currentTrackId: crossfadeVisual.outgoingTrackId,
          })
        : undefined,
    [showCrossfadeVisual, crossfadeVisual, library, playbackTracks],
  );

  const incomingTrack = useMemo(
    () =>
      showCrossfadeVisual && crossfadeVisual
        ? findPlaybackTrack({
            library,
            playbackTracks,
            currentTrackId: crossfadeVisual.incomingTrackId,
          })
        : undefined,
    [showCrossfadeVisual, crossfadeVisual, library, playbackTracks],
  );

  const displayTrack = showCrossfadeVisual
    ? crossfadeProgress >= 0.5
      ? (incomingTrack ?? currentTrack)
      : (outgoingTrack ?? currentTrack)
    : currentTrack;

  const outgoingArtSrc = useAssetUrl(
    showCrossfadeVisual ? outgoingTrack?.artPath : null,
  );
  const incomingArtSrc = useAssetUrl(
    showCrossfadeVisual ? incomingTrack?.artPath : null,
  );
  const metadataTrack = showCrossfadeVisual ? displayTrack : currentTrack;
  const metadataTrackId = metadataTrack?.id ?? null;
  const lyricsRevision = usePlayerStore((s) =>
    metadataTrackId != null
      ? (s.lyricsRevisionByTrackId[metadataTrackId] ?? 0)
      : 0,
  );
  const librarySettings = useLibrarySettingsStore((s) => s.settings);
  const openTrackEditor = usePlayerStore((s) => s.openTrackEditor);
  const lyricsAutoFetchInLightbox =
    librarySettings?.lyricsAutoFetchInLightbox ?? true;
  const fetchingLyrics = useLyricsFetchStore((s) =>
    metadataTrackId != null ? s.fetchingTrackIds.has(metadataTrackId) : false,
  );
  const lyricsQueued = useLyricsFetchStore((s) =>
    metadataTrackId != null ? s.queuedTrackIds.has(metadataTrackId) : false,
  );
  const [prepareInFlight, setPrepareInFlight] = useState(false);
  const isInstrumental =
    metadataTrack?.lyricsFormat === "instrumental" ||
    trackLyrics?.format === "instrumental";
  const canFetchLyrics =
    metadataTrack != null &&
    !lyricsLoading &&
    !isInstrumental &&
    !trackLyrics?.plainText.trim() &&
    canFetchLyricsForTrack(metadataTrack);
  const autoFetchEligible =
    artOpen &&
    canFetchLyrics &&
    metadataTrackId != null &&
    lyricsAutoFetchInLightbox &&
    !lyricsQueued &&
    !fetchingLyrics &&
    autoFetchedTrackIdRef.current !== metadataTrackId;
  const lyricsFetchPending =
    fetchingLyrics || lyricsQueued || prepareInFlight || autoFetchEligible;
  const lyricsFetchFeedbackFromStore = useLyricsFetchStore((s) =>
    metadataTrackId != null
      ? (s.pendingByTrackId[metadataTrackId]?.feedback ?? null)
      : null,
  );
  const lyricsCandidates = useLyricsFetchStore((s) =>
    metadataTrackId != null
      ? (s.pendingByTrackId[metadataTrackId]?.candidates ??
        EMPTY_LYRICS_CANDIDATES)
      : EMPTY_LYRICS_CANDIDATES,
  );
  const lyricsFetchFeedback = isInstrumental
    ? LYRICS_FETCH_INSTRUMENTAL
    : lyricsFetchFeedbackFromStore;
  const showLyricsCandidatePicker = artOpen && lyricsCandidates.length > 1;
  const lyricsLibraryTrack = useMemo((): LyricsLibraryTrackRef | null => {
    if (!metadataTrack) return null;
    return {
      title: metadataTrack.title,
      artist: metadataTrack.artist?.trim() || "",
      album: metadataTrack.album?.trim() || "",
      durationSeconds: metadataTrack.durationSeconds ?? null,
    };
  }, [metadataTrack]);
  const artSrc = useAssetUrl(metadataTrack?.artPath);
  const { displayPosition } = usePlaybackProgress(
    metadataTrack?.durationSeconds ?? 0,
  );

  const subtitle = trackSubtitle(metadataTrack);

  useEffect(() => {
    if (!metadataTrackId) {
      setTrackLyrics(null);
      setLyricsLoading(false);
      return;
    }

    setTrackLyrics(null);
    setLyricsLoading(true);
    let cancelled = false;
    void getTrackLyrics(metadataTrackId).then((lyrics) => {
      if (!cancelled) {
        setTrackLyrics(lyrics);
        setLyricsLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [metadataTrackId, lyricsRevision]);

  useEffect(() => {
    if (currentTrackId === null) {
      setArtOpen(false);
    }
  }, [currentTrackId]);

  const handleArtClick = useCallback(() => {
    if (artSrc && !showCrossfadeVisual) {
      setArtOpen(true);
    }
  }, [artSrc, showCrossfadeVisual]);

  const handleFetchLyrics = useCallback(() => {
    if (!metadataTrack || lyricsFetchPending) return;
    startLyricsFetchForTrack(metadataTrack);
  }, [lyricsFetchPending, metadataTrack]);

  const handleSelectLyricsCandidate = useCallback(
    async (candidate: LyricsSearchCandidate) => {
      if (!metadataTrack) return;
      useLyricsFetchStore.getState().clearPending(metadataTrack.id);
      const result = await commitFetchedLyricsForTrack(metadataTrack, {
        plainText: candidate.lyrics.plainText,
        lines: candidate.lyrics.lines,
        format: candidate.lyrics.format,
      });
      if (result.status === "ok") return;
      if (result.status === "missing_file") {
        useLyricsFetchStore.getState().applyOutcome(metadataTrack.id, {
          feedback: createLyricsFetchFeedback(
            missingFileErrorDetail(metadataTrack),
          ),
          candidates: [],
        });
        return;
      }
      useLyricsFetchStore.getState().applyOutcome(metadataTrack.id, {
        feedback: createLyricsFetchFeedback(
          "Fetched lyrics couldn't be saved. Try again or use Save.",
        ),
        candidates: [],
      });
    },
    [metadataTrack],
  );

  const handleDismissLyricsCandidates = useCallback(() => {
    if (metadataTrackId == null) return;
    useLyricsFetchStore.getState().applyOutcome(metadataTrackId, {
      feedback: LYRICS_FETCH_NOT_FOUND,
      candidates: [],
    });
  }, [metadataTrackId]);

  const handleAddLyricsManually = useCallback(() => {
    if (metadataTrackId == null) return;
    setArtOpen(false);
    openTrackEditor(metadataTrackId, { tab: "lyrics" });
  }, [metadataTrackId, openTrackEditor]);

  useEffect(() => {
    if (!artOpen) {
      autoFetchedTrackIdRef.current = null;
    }
  }, [artOpen]);

  useEffect(() => {
    if (
      !artOpen ||
      !canFetchLyrics ||
      !metadataTrack ||
      metadataTrackId == null ||
      !lyricsAutoFetchInLightbox
    ) {
      setPrepareInFlight(false);
      return;
    }
    if (lyricsQueued || fetchingLyrics) return;
    if (autoFetchedTrackIdRef.current === metadataTrackId) return;

    const trackId = metadataTrackId;
    const trackSnapshot = metadataTrack;
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
    metadataTrack,
    metadataTrackId,
  ]);

  const artLabel = metadataTrack?.album
    ? t("playback:nowPlaying.viewAlbumArtFor", { album: metadataTrack.album })
    : t("playback:nowPlaying.viewAlbumArt");

  const renderArt = () => {
    if (!showArt) return null;

    if (showCrossfadeVisual && (outgoingArtSrc || incomingArtSrc)) {
      return (
        <SharedArtSlot artOpen={artOpen}>
          <motion.button
            type="button"
            className="now-playing-metadata__art now-playing-metadata__art--shared"
            layoutId={NOW_PLAYING_ART_LAYOUT_ID}
            layoutCrossfade={false}
            transition={albumArtLayoutTransition}
            style={{ borderRadius: NOW_PLAYING_ART_RADIUS }}
            disabled
            aria-label={t("playback:nowPlaying.crossfading")}
          >
            <div className="now-playing-metadata__art-stack">
              {outgoingArtSrc ? (
                <CrossfadeOpacity
                  progress={crossfadeProgress}
                  role="outgoing"
                  reduceMotion={reduceMotion}
                >
                  <AlbumArtImage src={outgoingArtSrc} />
                </CrossfadeOpacity>
              ) : null}
              {incomingArtSrc ? (
                <CrossfadeOpacity
                  progress={crossfadeProgress}
                  role="incoming"
                  reduceMotion={reduceMotion}
                >
                  <AlbumArtImage src={incomingArtSrc} />
                </CrossfadeOpacity>
              ) : null}
            </div>
          </motion.button>
        </SharedArtSlot>
      );
    }

    if (artSrc) {
      return (
        <SharedArtSlot artOpen={artOpen}>
          <motion.button
            type="button"
            className="now-playing-metadata__art now-playing-metadata__art--zoomable now-playing-metadata__art--shared"
            layoutId={NOW_PLAYING_ART_LAYOUT_ID}
            layoutCrossfade={false}
            transition={albumArtLayoutTransition}
            style={{ borderRadius: NOW_PLAYING_ART_RADIUS }}
            onClick={handleArtClick}
            disabled={!currentTrack}
            aria-label={artLabel}
          >
            <AlbumArtImage src={artSrc} />
          </motion.button>
        </SharedArtSlot>
      );
    }

    return <AlbumArtPlaceholder inactive={!currentTrack} />;
  };

  const renderTextLayer = (
    track: Track | undefined,
    fallbackTitle: string,
    fallbackSubtitle: string,
  ) => (
    <>
      <ScrollingText
        className="now-playing-metadata__title"
        text={track?.title ?? fallbackTitle}
      />
      <ScrollingText
        className="now-playing-metadata__subtitle"
        text={trackSubtitle(track) ?? fallbackSubtitle}
      />
    </>
  );

  const renderText = () => {
    if (!showText) return null;

    const sizerTrack = showCrossfadeVisual
      ? (outgoingTrack ?? incomingTrack ?? currentTrack)
      : currentTrack;

    return (
      <div className="now-playing-metadata__text">
        <div className="now-playing-metadata__text-sizer" aria-hidden>
          {renderTextLayer(
            sizerTrack,
            t("playback:nowPlaying.noTrack"),
            t("playback:nowPlaying.unknownArtist"),
          )}
        </div>
        <div className="now-playing-metadata__text-overlay">
          {showCrossfadeVisual && (outgoingTrack || incomingTrack) ? (
            <>
              <CrossfadeOpacity
                progress={crossfadeProgress}
                role="outgoing"
                reduceMotion={reduceMotion}
              >
                {renderTextLayer(
                  outgoingTrack,
                  t("playback:nowPlaying.noTrack"),
                  t("playback:nowPlaying.unknownArtist"),
                )}
              </CrossfadeOpacity>
              <CrossfadeOpacity
                progress={crossfadeProgress}
                role="incoming"
                reduceMotion={reduceMotion}
              >
                {renderTextLayer(
                  incomingTrack,
                  t("playback:nowPlaying.noTrack"),
                  t("playback:nowPlaying.unknownArtist"),
                )}
              </CrossfadeOpacity>
            </>
          ) : (
            renderTextLayer(
              currentTrack,
              t("playback:nowPlaying.noTrack"),
              t("playback:nowPlaying.unknownArtist"),
            )
          )}
        </div>
      </div>
    );
  };

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
        {renderText()}
      </div>

      {artSrc ? (
        <AlbumArtLightbox
          open={artOpen}
          onClose={() => setArtOpen(false)}
          artSrc={artSrc}
          alt={metadataTrack?.album ?? ""}
          title={metadataTrack?.title}
          caption={subtitle ?? undefined}
          lyrics={trackLyrics}
          lyricsLoading={lyricsLoading}
          playbackPositionSeconds={displayPosition}
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
