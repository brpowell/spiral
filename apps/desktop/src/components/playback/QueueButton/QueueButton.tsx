import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { buildPlaybackOrder } from "../../../lib/playbackOrder";
import { usePlayerStore } from "../../../store/usePlayerStore";
import { Button } from "../../common/Button/Button";
import { IconSetList } from "../../icons";
import "../playbackControl.css";
import "./QueueButton.css";

interface QueueButtonProps {
  onClick: () => void;
  className?: string;
  nodeId?: string;
  interactionEnabled?: boolean;
}

export function QueueButton({
  onClick,
  className,
  nodeId,
  interactionEnabled = true,
}: QueueButtonProps) {
  const { t } = useTranslation("playback");
  const library = usePlayerStore((s) => s.library);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const playContextIds = usePlayerStore((s) => s.playContextIds);
  const manualQueueIds = usePlayerStore((s) => s.manualQueueIds);

  const activeQueue = useMemo(
    () =>
      buildPlaybackOrder(
        manualQueueIds,
        playContextIds,
        library,
        currentTrackId,
      ),
    [manualQueueIds, playContextIds, library, currentTrackId],
  );

  return (
    <Button
      variant="ghost"
      size="md"
      iconOnly
      className={["playback-btn", className].filter(Boolean).join(" ")}
      data-node-id={nodeId}
      onClick={onClick}
      disabled={!interactionEnabled || activeQueue.length === 0}
      aria-label={t("queue.view")}
      title={t("queue.view")}
    >
      <IconSetList />
    </Button>
  );
}
