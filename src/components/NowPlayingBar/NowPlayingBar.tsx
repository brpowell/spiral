import { useState } from "react";
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
import { TrackListModal } from "../TrackListModal/TrackListModal";
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
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const library = usePlayerStore((s) => s.library);
  const currentTrack = library.find((t) => t.id === currentTrackId);

  const [trackListOpen, setTrackListOpen] = useState(false);

  const widget = (
    <>
      <NowPlayingMetadata className="now-playing-bar__metadata" />
      <SeekBar className="now-playing-bar__seek" />
    </>
  );

  return (
    <div className="now-playing-bar" aria-label="Now playing">
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
            <TrackRowMenu track={currentTrack} className="now-playing-bar__widget">
              {widget}
            </TrackRowMenu>
          ) : (
            <div className="now-playing-bar__widget">{widget}</div>
          )}

          <QueueButton onClick={() => setTrackListOpen(true)} />
        </div>
      </div>

      <div className="now-playing-bar__right">
        <VisualizerSlot
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
