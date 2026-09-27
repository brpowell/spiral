import { AnimatePresence, motion } from "framer-motion";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { subscribePlaybackClock } from "../../lib/playbackClock";
import * as audio from "../../lib/playback";
import { plainTextToLines } from "../../lib/lyrics";
import {
  findScrollLineIndex,
  findSingingLineIndex,
  getLyricsPrerollState,
  hasSyncedTimestamps,
  scrollLineIntoView,
} from "../../lib/lyricsScroll";
import type { LightboxCompanionMotionProps } from "../../lib/motion";
import {
  LYRICS_FETCH_INSTRUMENTAL,
  type LyricsFetchFeedback,
} from "../../lib/lyricsFetch";
import type { TrackLyrics } from "../../types/lyrics";
import { Button } from "../common/Button/Button";
import { EmptyState } from "../common/EmptyState/EmptyState";
import { Skeleton } from "../common/Skeleton/Skeleton";
import { IconMicrophone } from "../icons";
import "./LyricsPanel.css";

interface LyricsPanelProps {
  lyrics: TrackLyrics;
  reduceMotion?: boolean;
  companionMotion: LightboxCompanionMotionProps;
}

interface LyricsPrerollIndicatorProps {
  progress: number;
  reduceMotion: boolean;
}

const PREROLL_EXIT_DURATION = 0.45;

function LyricsPrerollIndicator({
  progress,
  reduceMotion,
}: LyricsPrerollIndicatorProps) {
  return (
    <motion.div
      className="album-art-lightbox__lyrics-preroll"
      aria-hidden
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1, marginBottom: "1.1rem" }}
      exit={
        reduceMotion
          ? { opacity: 0, marginBottom: 0 }
          : { opacity: 0, filter: "blur(3px)", marginBottom: 0 }
      }
      transition={{
        duration: reduceMotion ? 0 : PREROLL_EXIT_DURATION,
        ease: "easeOut",
      }}
    >
      <div className="album-art-lightbox__lyrics-preroll-track">
        <div
          className="album-art-lightbox__lyrics-preroll-fill"
          style={{ transform: `scaleX(${progress})` }}
        />
        <span
          className="album-art-lightbox__lyrics-preroll-beacon"
          style={{ left: `${progress * 100}%` }}
        />
      </div>
    </motion.div>
  );
}

interface LyricsEmptyPanelProps {
  onFetchLyrics: () => void;
  onAddManually?: () => void;
  companionMotion: LightboxCompanionMotionProps;
  feedback?: LyricsFetchFeedback | null;
}

export function LyricsEmptyPanel({
  onFetchLyrics,
  onAddManually,
  companionMotion,
  feedback = null,
}: LyricsEmptyPanelProps) {
  const hasFeedback = feedback != null;
  const isInstrumental = feedback?.text === LYRICS_FETCH_INSTRUMENTAL.text;
  const title = isInstrumental
    ? "Instrumental"
    : hasFeedback
      ? "No lyrics found"
      : "Sing along";
  const description = hasFeedback
    ? feedback.text
    : "Look up synced lyrics from LRCLIB for this track.";

  return (
    <motion.aside
      className="album-art-lightbox__lyrics album-art-lightbox__lyrics--empty"
      aria-label="Lyrics"
      {...companionMotion}
    >
      <EmptyState
        icon={<IconMicrophone />}
        title={title}
        description={description}
        action={
          hasFeedback && onAddManually ? (
            <Button variant="secondary" size="sm" onClick={onAddManually}>
              {isInstrumental ? "Edit lyrics" : "Add Manually"}
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={onFetchLyrics}>
              Fetch lyrics
            </Button>
          )
        }
      />
    </motion.aside>
  );
}

const LYRICS_SKELETON_LINE_WIDTHS = [
  "92%",
  "78%",
  "88%",
  "64%",
  "84%",
  "72%",
  "56%",
  "80%",
] as const;

interface LyricsLoadingPanelProps {
  companionMotion: LightboxCompanionMotionProps;
}

export function LyricsLoadingPanel({
  companionMotion,
}: LyricsLoadingPanelProps) {
  return (
    <motion.aside
      className="album-art-lightbox__lyrics album-art-lightbox__lyrics--loading"
      aria-label="Lyrics"
      aria-busy
      {...companionMotion}
    >
      <div
        className="album-art-lightbox__lyrics-scroll album-art-lightbox__lyrics-scroll--loading"
        aria-hidden
      >
        {LYRICS_SKELETON_LINE_WIDTHS.map((width, index) => (
          <Skeleton
            key={index}
            className="album-art-lightbox__lyrics-skeleton-line"
            width={width}
            height="1.15em"
            radius="pill"
          />
        ))}
      </div>
      <span className="album-art-lightbox__lyrics-loading-label">
        Fetching lyrics…
      </span>
    </motion.aside>
  );
}

export function LyricsPanel({
  lyrics,
  reduceMotion = false,
  companionMotion,
}: LyricsPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  const previousScrollLineRef = useRef(-1);
  const [playbackPositionSeconds, setPlaybackPositionSeconds] = useState(() =>
    audio.getPositionSeconds(),
  );
  const previousPositionRef = useRef(playbackPositionSeconds);
  const isInitialScrollRef = useRef(true);

  const lines = useMemo(
    () =>
      lyrics.lines.length > 0
        ? lyrics.lines
        : plainTextToLines(lyrics.plainText),
    [lyrics.lines, lyrics.plainText],
  );

  const isSynced = lyrics.format !== "plain" && hasSyncedTimestamps(lines);

  useEffect(() => {
    if (!isSynced) return;
    return subscribePlaybackClock((seconds) => {
      setPlaybackPositionSeconds((prev) => {
        if (Math.abs(seconds - prev) > 0.25) return seconds;
        const prevMs = prev * 1000;
        const nextMs = seconds * 1000;
        if (
          findSingingLineIndex(prevMs, lines) !==
          findSingingLineIndex(nextMs, lines)
        ) {
          return seconds;
        }
        if (
          findScrollLineIndex(prevMs, lines) !==
          findScrollLineIndex(nextMs, lines)
        ) {
          return seconds;
        }
        const prevPreroll = getLyricsPrerollState(prevMs, lines);
        const nextPreroll = getLyricsPrerollState(nextMs, lines);
        if (
          nextPreroll &&
          (!prevPreroll ||
            Math.abs(nextPreroll.progress - prevPreroll.progress) >= 0.02)
        ) {
          return seconds;
        }
        return prev;
      });
    });
  }, [isSynced, lines]);
  const positionMs = playbackPositionSeconds * 1000;
  const singingLineIndex = isSynced
    ? findSingingLineIndex(positionMs, lines)
    : -1;
  const scrollLineIndex = isSynced
    ? findScrollLineIndex(positionMs, lines)
    : -1;
  const preroll = isSynced ? getLyricsPrerollState(positionMs, lines) : null;

  useLayoutEffect(() => {
    previousScrollLineRef.current = -1;
    previousPositionRef.current = 0;
    isInitialScrollRef.current = true;
    lineRefs.current = [];
    const container = scrollRef.current;
    if (container) {
      container.scrollTop = 0;
    }
  }, [lyrics.trackId]);

  useLayoutEffect(() => {
    if (!isSynced) return;

    const previousPosition = previousPositionRef.current;
    previousPositionRef.current = playbackPositionSeconds;

    if (playbackPositionSeconds < previousPosition - 0.25) {
      previousScrollLineRef.current = -1;
      const container = scrollRef.current;
      if (container && playbackPositionSeconds < 1) {
        container.scrollTop = 0;
      }
    }
  }, [playbackPositionSeconds, isSynced]);

  useLayoutEffect(() => {
    if (!isSynced) return;
    if (scrollLineIndex < 0) return;

    const container = scrollRef.current;
    if (!container) return;
    if (scrollLineIndex === previousScrollLineRef.current) return;

    let cancelled = false;
    let cancelScroll: (() => void) | undefined;
    let frameId = 0;
    const startedAt = performance.now();

    const tryScroll = () => {
      if (cancelled) return;
      if (scrollLineIndex === previousScrollLineRef.current) return;

      const lineEl = lineRefs.current[scrollLineIndex];
      if (!lineEl) {
        if (performance.now() - startedAt < 500) {
          frameId = requestAnimationFrame(tryScroll);
        }
        return;
      }

      previousScrollLineRef.current = scrollLineIndex;
      const instant = isInitialScrollRef.current;
      isInitialScrollRef.current = false;
      cancelScroll = scrollLineIntoView(container, lineEl, {
        reduceMotion,
        instant,
      });
    };

    tryScroll();
    const timeoutId = setTimeout(tryScroll, 400);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
      clearTimeout(timeoutId);
      cancelScroll?.();
    };
  }, [scrollLineIndex, isSynced, reduceMotion]);

  return (
    <motion.aside
      className={[
        "album-art-lightbox__lyrics",
        isSynced && "album-art-lightbox__lyrics--synced",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label="Lyrics"
      {...companionMotion}
    >
      <div
        ref={scrollRef}
        className="album-art-lightbox__lyrics-scroll"
        data-context-menu-ignore-scroll=""
      >
        {lines.map((line, index) => (
          <Fragment key={index}>
            <AnimatePresence>
              {preroll?.firstLineIndex === index ? (
                <LyricsPrerollIndicator
                  key="lyrics-preroll"
                  progress={preroll.progress}
                  reduceMotion={reduceMotion}
                />
              ) : null}
            </AnimatePresence>
            <p
              ref={
                isSynced
                  ? (element) => {
                      lineRefs.current[index] = element;
                    }
                  : undefined
              }
              className={[
                "album-art-lightbox__lyrics-line",
                isSynced &&
                  index === singingLineIndex &&
                  "album-art-lightbox__lyrics-line--active",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {line.text || "\u00a0"}
            </p>
          </Fragment>
        ))}
      </div>
    </motion.aside>
  );
}
