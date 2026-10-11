import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { findPlaybackTrack } from "../../lib/playbackTrack";
import { usePlayerStore } from "../../store/usePlayerStore";
import {
  NowPlayingMetadata,
  PlaybackTransport,
  QueueButton,
  SeekBar,
  VisualizerSlot,
  VolumeControl,
} from "../playback";
import { SkinModeOpenButton } from "../playback/SkinModeOpenButton/SkinModeOpenButton";
import { SetListModal } from "../SetListModal/SetListModal";
import { TrackRowMenu } from "../TrackRowMenu/TrackRowMenu";
import "./NowPlayingBar.css";

interface NowPlayingBarProps {
  visualizerExpanded: boolean;
  onToggleVisualizer: () => void;
}

export function NowPlayingBar({
  visualizerExpanded,
  onToggleVisualizer,
}: NowPlayingBarProps) {
  const { t } = useTranslation("playback");
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const library = usePlayerStore((s) => s.library);
  const playbackTracks = usePlayerStore((s) => s.playbackTracks);
  const currentTrack = useMemo(
    () => findPlaybackTrack({ library, playbackTracks, currentTrackId }),
    [library, playbackTracks, currentTrackId],
  );

  const [setListOpen, setSetListOpen] = useState(false);

  const widget = (
    <>
      <NowPlayingMetadata className="now-playing-bar__metadata" />
      <SeekBar className="now-playing-bar__seek" />
    </>
  );

  return (
    <div className="now-playing-bar" aria-label={t("nowPlaying.aria")}>
      <div
        className="now-playing-bar__left"
        style={{ opacity: currentTrackId ? 1 : 0.5 }}
      >
        <PlaybackTransport />
        <VolumeControl />
      </div>

      <div
        className="now-playing-bar__center"
        style={{ opacity: currentTrack ? 1 : 0.55 }}
      >
        <div className="now-playing-bar__center-inner">
          <SkinModeOpenButton />
          {currentTrack ? (
            <TrackRowMenu
              track={currentTrack}
              className="now-playing-bar__widget"
            >
              {widget}
            </TrackRowMenu>
          ) : (
            <div className="now-playing-bar__widget">{widget}</div>
          )}

          <QueueButton onClick={() => setSetListOpen(true)} />
        </div>
      </div>

      <div className="now-playing-bar__right">
        <VisualizerSlot
          variant="mini"
          expanded={visualizerExpanded}
          onToggleExpand={onToggleVisualizer}
        />
      </div>

      <SetListModal open={setListOpen} onClose={() => setSetListOpen(false)} />
    </div>
  );
}
