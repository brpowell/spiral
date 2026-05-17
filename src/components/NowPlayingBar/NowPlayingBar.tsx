import { convertFileSrc } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import { albumKey } from "../../lib/albums";
import { getActiveTrackIds } from "../../lib/activeTrackList";
import * as audio from "../../lib/audio";
import { formatRemainingTime, formatTime } from "../../lib/format";
import {
  getManualNextId,
  getManualPreviousId,
} from "../../lib/playbackQueue";
import { useNavigationStore } from "../../store/useNavigationStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import type { RepeatMode } from "../../types/track";
import { AudioVisualizer } from "../AudioVisualizer/AudioVisualizer";
import { TrackListModal } from "../TrackListModal/TrackListModal";
import {
  IconAlbumPlaceholder,
  IconNext,
  IconPause,
  IconPlay,
  IconPrevious,
  IconRepeat,
  IconRepeatOne,
  IconShuffle,
  IconTrackList,
  IconVolume,
  IconVolumeMute,
} from "../icons";
import "./NowPlayingBar.css";

interface NowPlayingBarProps {
  visualizerExpanded: boolean;
  onToggleVisualizer: () => void;
}

export function NowPlayingBar({
  visualizerExpanded,
  onToggleVisualizer,
}: NowPlayingBarProps) {
  const library = usePlayerStore((s) => s.library);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const playbackState = usePlayerStore((s) => s.playbackState);
  const positionSeconds = usePlayerStore((s) => s.positionSeconds);
  const queue = usePlayerStore((s) => s.queue);
  const repeatMode = usePlayerStore((s) => s.repeatMode);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);
  const togglePlayPause = usePlayerStore((s) => s.togglePlayPause);
  const seek = usePlayerStore((s) => s.seek);
  const previousTrack = usePlayerStore((s) => s.previousTrack);
  const nextTrack = usePlayerStore((s) => s.nextTrack);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleMute = usePlayerStore((s) => s.toggleMute);
  const openAlbum = useNavigationStore((s) => s.openAlbum);

  const currentTrack = useMemo(
    () => library.find((t) => t.id === currentTrackId),
    [library, currentTrackId],
  );

  const [isSeeking, setIsSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState(0);
  const [livePosition, setLivePosition] = useState(0);
  const [trackListOpen, setTrackListOpen] = useState(false);

  const durationSeconds =
    currentTrack?.durationSeconds ?? audio.getDurationSeconds();

  const activeQueue = useMemo(
    () => getActiveTrackIds(queue, library),
    [queue, library],
  );

  const canGoPrevious =
    currentTrackId !== null &&
    activeQueue.length > 0 &&
    getManualPreviousId(activeQueue, currentTrackId, repeatMode) !== null;

  const canGoNext =
    currentTrackId !== null &&
    activeQueue.length > 0 &&
    getManualNextId(activeQueue, currentTrackId, repeatMode) !== null;

  const repeatLabel: Record<RepeatMode, string> = {
    off: "Repeat off",
    all: "Repeat all",
    one: "Repeat one",
  };

  useEffect(() => {
    if (!isSeeking) {
      setSeekValue(
        durationSeconds > 0 ? positionSeconds / durationSeconds : 0,
      );
    }
  }, [positionSeconds, durationSeconds, isSeeking]);

  useEffect(() => {
    if (playbackState !== "playing" || isSeeking) {
      setLivePosition(positionSeconds);
      return;
    }

    let frame = 0;
    const tick = () => {
      setLivePosition(audio.getPositionSeconds());
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playbackState, isSeeking, positionSeconds, currentTrackId]);

  const displayPosition = isSeeking
    ? seekValue * durationSeconds
    : playbackState === "playing"
      ? livePosition
      : positionSeconds;

  const progress = durationSeconds > 0 ? displayPosition / durationSeconds : 0;

  const artSrc = currentTrack?.artPath
    ? convertFileSrc(currentTrack.artPath)
    : null;

  const subtitle = currentTrack
    ? [currentTrack.artist, currentTrack.album].filter(Boolean).join(" — ")
    : null;

  const handlePlayPause = useCallback(() => {
    togglePlayPause();
  }, [togglePlayPause]);

  const handleSeekStart = () => setIsSeeking(true);

  const handleSeekChange = (value: number) => {
    setSeekValue(value);
  };

  const handleSeekEnd = (value: number) => {
    setIsSeeking(false);
    seek(value);
  };

  const handleArtClick = useCallback(() => {
    if (currentTrack) {
      openAlbum(albumKey(currentTrack));
    }
  }, [currentTrack, openAlbum]);

  const artLabel = currentTrack?.album
    ? `View album ${currentTrack.album}`
    : "View album";

  return (
    <div className="now-playing-bar" aria-label="Now playing">
      <div
        className="now-playing-bar__left"
        style={{ opacity: currentTrackId ? 1 : 0.5 }}
      >
        <div className="now-playing-bar__transport">
          <button
            type="button"
            className={`now-playing-bar__btn now-playing-bar__btn--shuffle${
              shuffle ? " now-playing-bar__btn--shuffle-active" : ""
            }`}
            onClick={toggleShuffle}
            aria-label={shuffle ? "Shuffle on" : "Shuffle off"}
            title={shuffle ? "Shuffle on" : "Shuffle off"}
          >
            <IconShuffle />
          </button>

          <button
            type="button"
            className={`now-playing-bar__btn now-playing-bar__btn--repeat${
              repeatMode !== "off"
                ? " now-playing-bar__btn--repeat-active"
                : ""
            }`}
            onClick={cycleRepeat}
            aria-label={repeatLabel[repeatMode]}
            title={repeatLabel[repeatMode]}
          >
            {repeatMode === "one" ? <IconRepeatOne /> : <IconRepeat />}
          </button>

          <button
            type="button"
            className="now-playing-bar__btn"
            onClick={previousTrack}
            disabled={!canGoPrevious}
            aria-label="Previous track"
          >
            <IconPrevious />
          </button>

          <button
            type="button"
            className="now-playing-bar__btn now-playing-bar__btn--play"
            onClick={handlePlayPause}
            disabled={!currentTrackId}
            aria-label={playbackState === "playing" ? "Pause" : "Play"}
          >
            <AnimatePresence mode="wait" initial={false}>
              {playbackState === "playing" ? (
                <motion.span
                  key="pause"
                  className="now-playing-bar__play-icon"
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.6, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <IconPause />
                </motion.span>
              ) : (
                <motion.span
                  key="play"
                  className="now-playing-bar__play-icon"
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.6, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <IconPlay />
                </motion.span>
              )}
            </AnimatePresence>
          </button>

          <button
            type="button"
            className="now-playing-bar__btn"
            onClick={nextTrack}
            disabled={!canGoNext}
            aria-label="Next track"
          >
            <IconNext />
          </button>
        </div>

        <div className="now-playing-bar__volume">
          <button
            type="button"
            className="now-playing-bar__btn now-playing-bar__btn--volume"
            onClick={toggleMute}
            aria-label={muted ? "Unmute" : "Mute"}
          >
            {muted ? <IconVolumeMute /> : <IconVolume />}
          </button>
          <input
            type="range"
            className="now-playing-bar__volume-input"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            aria-label="Volume"
            onChange={(e) => setVolume(Number(e.currentTarget.value))}
          />
        </div>
      </div>

      <div
        className="now-playing-bar__center"
        style={{ opacity: currentTrack ? 1 : 0.55 }}
      >
        <div className="now-playing-bar__center-inner">
        <div className="now-playing-bar__widget">
          <button
            type="button"
            className="now-playing-bar__art"
            onClick={handleArtClick}
            disabled={!currentTrack}
            aria-label={artLabel}
          >
            {artSrc ? (
              <img src={artSrc} alt="" className="now-playing-bar__art-img" />
            ) : (
              <div className="now-playing-bar__art-placeholder" aria-hidden>
                <IconAlbumPlaceholder />
              </div>
            )}
          </button>

          <div className="now-playing-bar__track-text">
            <span className="now-playing-bar__title">
              {currentTrack?.title ?? "No track selected"}
            </span>
            <span className="now-playing-bar__subtitle">
              {subtitle ?? "Unknown artist"}
            </span>
          </div>

          <div className="now-playing-bar__progress-row">
            <span className="now-playing-bar__time">
              {formatTime(displayPosition)}
            </span>
            <input
              type="range"
              className="now-playing-bar__seek-input"
              min={0}
              max={1}
              step={0.001}
              value={isSeeking ? seekValue : progress}
              disabled={!currentTrackId}
              aria-label="Seek"
              onPointerDown={handleSeekStart}
              onChange={(e) =>
                handleSeekChange(Number(e.currentTarget.value))
              }
              onPointerUp={(e) =>
                handleSeekEnd(Number(e.currentTarget.value))
              }
              onKeyUp={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  handleSeekEnd(Number(e.currentTarget.value));
                }
              }}
            />
            <span className="now-playing-bar__time now-playing-bar__time--remaining">
              {formatRemainingTime(displayPosition, durationSeconds)}
            </span>
          </div>
          </div>

          <button
            type="button"
            className="now-playing-bar__btn now-playing-bar__btn--track-list"
            onClick={() => setTrackListOpen(true)}
            disabled={activeQueue.length === 0}
            aria-label="View track list"
            title="View track list"
          >
            <IconTrackList />
          </button>
        </div>
      </div>

      <div className="now-playing-bar__right">
        <AudioVisualizer
          variant="mini"
          expanded={visualizerExpanded}
          onToggleExpand={onToggleVisualizer}
        />
      </div>

      <TrackListModal
        open={trackListOpen}
        onClose={() => setTrackListOpen(false)}
      />
    </div>
  );
}
