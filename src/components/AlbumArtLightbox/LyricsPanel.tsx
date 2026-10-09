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
import { resolvePlaybackDisplaySeconds } from "../../lib/playbackClockPin";
import {
  createPlayheadGlide,
  type PlayheadGlide,
} from "../../lib/playheadGlide";
import * as audio from "../../lib/playback";
import { plainTextToLines } from "../../lib/lyrics";
import {
  findScrollLineIndex,
  findSingingLineIndex,
  getLyricsPrerollState,
  hasSyncedTimestamps,
  nextLyricCueMs,
  scrollLineIntoView,
} from "../../lib/lyricsScroll";
import { usePlayerStore } from "../../store/usePlayerStore";
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
  /** Milliseconds from track start to the first lyric line. */
  leadMs: number;
  playing: boolean;
  reduceMotion: boolean;
}

const PREROLL_EXIT_DURATION = 0.45;

function LyricsPrerollIndicator({
  progress,
  leadMs,
  playing,
  reduceMotion,
}: LyricsPrerollIndicatorProps) {
  const fillRef = useRef<HTMLDivElement>(null);
  const beaconRef = useRef<HTMLDivElement>(null);
  const glideRef = useRef<PlayheadGlide | null>(null);

  useLayoutEffect(() => {
    const fill = fillRef.current;
    const beacon = beaconRef.current;
    if (!fill || !beacon) return;
    const glide = createPlayheadGlide(
      [
        { el: fill, transform: (ratio) => `scaleX(${ratio})` },
        {
          el: beacon,
          transform: (ratio) => `translateX(${(ratio - 1) * 100}%)`,
        },
      ],
      { animate: !reduceMotion },
    );
    glideRef.current = glide;
    return () => {
      glide.dispose();
      glideRef.current = null;
    };
  }, [reduceMotion]);

  useLayoutEffect(() => {
    // Glide across the lead-in on the compositor; each clock sample re-anchors
    // it, so a seek or pause lands exactly without per-frame React work.
    glideRef.current?.sync((progress * leadMs) / 1000, leadMs / 1000, playing);
  }, [progress, leadMs, playing, reduceMotion]);

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
          ref={fillRef}
          className="album-art-lightbox__lyrics-preroll-fill"
        />
        <div
          ref={beaconRef}
          className="album-art-lightbox__lyrics-preroll-beacon-rail"
        >
          <span className="album-art-lightbox__lyrics-preroll-beacon" />
        </div>
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
  const playing = usePlayerStore((s) => s.playbackState === "playing");
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
    let timer = 0;

    const adopt = (seconds: number) => {
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
    };

    const clearCue = () => {
      window.clearTimeout(timer);
      timer = 0;
    };

    const arm = (seconds: number) => {
      clearCue();
      if (usePlayerStore.getState().playbackState !== "playing") return;
      const cueMs = nextLyricCueMs(seconds * 1000, lines);
      if (cueMs == null) return;
      const delay = cueMs - seconds * 1000;
      if (delay <= 0 || delay > 1100) return;
      timer = window.setTimeout(
        () => {
          const live = resolvePlaybackDisplaySeconds(
            audio.getPositionSeconds(),
          );
          adopt(live);
          if (live > seconds + 0.005) arm(live);
        },
        Math.max(delay, 16),
      );
    };

    adopt(resolvePlaybackDisplaySeconds(audio.getPositionSeconds()));
    arm(resolvePlaybackDisplaySeconds(audio.getPositionSeconds()));
    const unsubscribeClock = subscribePlaybackClock((seconds) => {
      adopt(seconds);
      arm(seconds);
    });
    const unsubscribeStore = usePlayerStore.subscribe((state, prev) => {
      if (state.playbackState === prev.playbackState) return;
      const live = resolvePlaybackDisplaySeconds(audio.getPositionSeconds());
      adopt(live);
      arm(live);
    });

    return () => {
      clearCue();
      unsubscribeClock();
      unsubscribeStore();
    };
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
    // Line nodes are recorded by callback refs during commit, before this
    // effect. Clearing the array here drops them until the next render, so
    // opening mid-lyric stays at the top until the following cue.
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

    const place = () => {
      if (cancelled) return true;
      if (scrollLineIndex === previousScrollLineRef.current) return true;

      const lineEl = lineRefs.current[scrollLineIndex];
      if (!lineEl || container.clientHeight <= 0) return false;

      previousScrollLineRef.current = scrollLineIndex;
      const instant = isInitialScrollRef.current;
      isInitialScrollRef.current = false;
      cancelScroll = scrollLineIntoView(container, lineEl, {
        reduceMotion,
        instant,
      });
      return true;
    };

    let observer: ResizeObserver | undefined;
    if (!place()) {
      observer = new ResizeObserver(() => {
        if (place()) observer?.disconnect();
      });
      observer.observe(container);
    }

    return () => {
      cancelled = true;
      observer?.disconnect();
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
                  leadMs={preroll.leadMs}
                  playing={playing}
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
