import { usePlayerStore } from "../../../store/usePlayerStore";
import { t } from "../../../lib/i18n";
import { Button } from "../../common/Button/Button";
import { Slider } from "../../common/Slider/Slider";
import { IconVolume, IconVolumeMute } from "../../icons";
import "../playbackControl.css";
import "./VolumeControl.css";

interface VolumeControlProps {
  className?: string;
}

export function VolumeControl({ className }: VolumeControlProps) {
  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleMute = usePlayerStore((s) => s.toggleMute);

  return (
    <div className={["volume-control", className].filter(Boolean).join(" ")}>
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        className="playback-btn playback-btn--volume"
        onClick={toggleMute}
        aria-label={
          muted ? t("playback:volume.unmute") : t("playback:volume.mute")
        }
      >
        {muted ? <IconVolumeMute /> : <IconVolume />}
      </Button>
      <Slider
        className="volume-control__slider"
        min={0}
        max={1}
        step={0.01}
        value={volume}
        aria-label={t("playback:volume.slider")}
        onChange={(e) => setVolume(Number(e.currentTarget.value))}
      />
    </div>
  );
}
