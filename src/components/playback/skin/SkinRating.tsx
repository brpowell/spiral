import { useCallback, useMemo } from "react";
import { applyTrackRating } from "../../../lib/applyTrackRating";
import { findPlaybackTrack } from "../../../lib/playbackTrack";
import { skinDragRegionNoneProps } from "../../../lib/skinDragRegion";
import { useSkinControlEnabled } from "../../../lib/skinBinds";
import {
  styleFromSkinNode,
  useResolvedNodeStyle,
} from "../../../lib/skinNodeStyle";
import { useSkinTooltip } from "../../../lib/skinTooltips";
import { UNRATED } from "../../../lib/trackRating";
import { usePlayerStore } from "../../../store/usePlayerStore";
import type { RatingNode } from "../../../types/skin";
import { TrackRating } from "../../TrackRating/TrackRating";
import "./SkinRating.css";

export function SkinRating({ node }: { node: RatingNode }) {
  const interactionEnabled = useSkinControlEnabled(node.enabledWhen);
  const resolvedStyle = useResolvedNodeStyle(node.style, node.styleWhen);
  const css = styleFromSkinNode(resolvedStyle, {
    omitOpacity: node.bounds !== undefined,
  });
  const tooltip = useSkinTooltip({
    tooltip: node.tooltip,
    tooltipWhen: node.tooltipWhen,
  });

  const library = usePlayerStore((s) => s.library);
  const playbackTracks = usePlayerStore((s) => s.playbackTracks);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const updateTrackInLibrary = usePlayerStore((s) => s.updateTrackInLibrary);

  const track = useMemo(
    () => findPlaybackTrack({ library, playbackTracks, currentTrackId }),
    [library, playbackTracks, currentTrackId],
  );

  const onChange = useCallback(
    (rating: number) => {
      if (!track) return;
      applyTrackRating(track, rating, updateTrackInLibrary);
    },
    [track, updateTrackInLibrary],
  );

  return (
    <div
      className={["skin-rating", node.className].filter(Boolean).join(" ")}
      data-node-id={node.id}
      style={css}
      title={tooltip || undefined}
      {...skinDragRegionNoneProps()}
    >
      <TrackRating
        value={track?.rating ?? UNRATED}
        size="fill"
        disabled={!interactionEnabled || !track}
        onChange={onChange}
      />
    </div>
  );
}
