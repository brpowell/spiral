import { usePlayerStore } from "@/store/usePlayerStore";
import { t } from "@/lib/i18n";
import { Button } from "@/components/common/Button/Button";
import { Slider } from "@/components/common/Slider/Slider";
import { IconVolume, IconVolumeMute } from "@/components/icons";
import "@/components/playback/playbackControl.css";
import "./VolumeControl.css";

interface VolumeControlProps {
  className?: string;
  nodeId?: string;
  interactionEnabled?: boolean;
}

export function VolumeControl({
  className,
  nodeId,
  interactionEnabled = true,
}: VolumeControlProps) {
  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleMute = usePlayerStore((s) => s.toggleMute);

  return (
    <div
      className={["volume-control", className].filter(Boolean).join(" ")}
      data-node-id={nodeId}
      aria-disabled={interactionEnabled ? undefined : true}
      style={interactionEnabled ? undefined : { pointerEvents: "none" }}
    >
      <Button
        variant="ghost"
        size="md"
        iconOnly
        className="playback-btn"
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
