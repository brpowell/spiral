import { useCallback, useMemo } from "react";
import { confirmAndApplyTrackRatings } from "@/lib/tracks/applyTrackRating";
import { findPlaybackTrack } from "@/lib/playback/playbackTrack";
import { skinDragRegionNoneProps } from "@/lib/skin/skinDragRegion";
import { useSkinControlEnabled } from "@/lib/skin/skinBinds";
import {
  styleFromSkinNode,
  useResolvedNodeStyle,
} from "@/lib/skin/skinNodeStyle";
import { useSkinTooltip } from "@/lib/skin/skinTooltips";
import { UNRATED } from "@/lib/tracks/trackRating";
import { usePlayerStore } from "@/store/usePlayerStore";
import type { RatingNode } from "@/types/skin";
import { TrackRating } from "@/components/TrackRating/TrackRating";
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
      void confirmAndApplyTrackRatings([track], rating, updateTrackInLibrary, {
        native: true,
      });
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
