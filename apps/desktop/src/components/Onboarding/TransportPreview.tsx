import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { RepeatMode } from "../../types/track";
import { TransportButtons } from "../playback/PlaybackTransport/TransportButtons";

const NEXT_REPEAT: Record<RepeatMode, RepeatMode> = {
  off: "all",
  all: "one",
  one: "off",
};

/**
 * The library header's transport controls, driven by local state so they react
 * and play their cues but never touch the player. Shows how the chosen theme
 * dresses a core part of the app.
 */
export function TransportPreview() {
  const { t } = useTranslation("common");
  const [playing, setPlaying] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("off");

  return (
    <section className="onboarding-transport">
      <h2 className="onboarding-transport__heading">
        {t("onboarding.style.transportPreview")}
      </h2>
      <TransportButtons
        shuffle={shuffle}
        repeatMode={repeatMode}
        playing={playing}
        canPlay
        canGoPrevious
        canGoNext
        onShuffle={() => setShuffle((on) => !on)}
        onPrevious={() => {}}
        onPlayPause={() => setPlaying((on) => !on)}
        onNext={() => {}}
        onRepeat={() => setRepeatMode((mode) => NEXT_REPEAT[mode])}
      />
    </section>
  );
}
