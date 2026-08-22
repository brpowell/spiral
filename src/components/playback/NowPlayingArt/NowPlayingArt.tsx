import type { CSSProperties, ReactNode } from "react";
import {
  useNowPlayingDisplay,
  type NowPlayingDisplay,
} from "../../../hooks/useNowPlayingDisplay";
import { styleFromSkinNode } from "../../../lib/skinNodeStyle";
import type { ArtworkNode, NodeStyle } from "../../../types/skin";
import { IconAlbumPlaceholder } from "../../icons";
import "./NowPlayingArt.css";

export function CrossfadeOpacity({
  progress,
  role,
  reduceMotion,
  children,
}: {
  progress: number;
  role: "outgoing" | "incoming";
  reduceMotion: boolean;
  children: ReactNode;
}) {
  if (reduceMotion) {
    const showIncoming = progress >= 0.5;
    const visible = role === "incoming" ? showIncoming : !showIncoming;
    if (!visible) return null;
    return <>{children}</>;
  }

  const opacity = role === "incoming" ? progress : 1 - progress;
  if (opacity <= 0.01) return null;

  return (
    <div
      className="now-playing-crossfade"
      style={{ opacity }}
      aria-hidden={opacity < 0.5}
    >
      {children}
    </div>
  );
}

function AlbumArtImage({
  src,
  objectFit,
}: {
  src: string;
  objectFit?: ArtworkNode["objectFit"];
}) {
  const style: CSSProperties | undefined = objectFit
    ? { objectFit }
    : undefined;
  return (
    <img src={src} alt="" className="now-playing-art__img" style={style} />
  );
}

/** Cover / placeholder / crossfade layers. Hosts own the outer chrome. */
export function NowPlayingArtVisual({
  display,
  objectFit,
}: {
  display: NowPlayingDisplay;
  objectFit?: ArtworkNode["objectFit"];
}) {
  const {
    artSrc,
    outgoingArtSrc,
    incomingArtSrc,
    showCrossfadeVisual,
    crossfadeProgress,
    reduceMotion,
  } = display;

  if (showCrossfadeVisual && (outgoingArtSrc || incomingArtSrc)) {
    return (
      <div className="now-playing-art__stack">
        {outgoingArtSrc ? (
          <CrossfadeOpacity
            progress={crossfadeProgress}
            role="outgoing"
            reduceMotion={reduceMotion}
          >
            <AlbumArtImage src={outgoingArtSrc} objectFit={objectFit} />
          </CrossfadeOpacity>
        ) : null}
        {incomingArtSrc ? (
          <CrossfadeOpacity
            progress={crossfadeProgress}
            role="incoming"
            reduceMotion={reduceMotion}
          >
            <AlbumArtImage src={incomingArtSrc} objectFit={objectFit} />
          </CrossfadeOpacity>
        ) : null}
      </div>
    );
  }

  if (artSrc) {
    return <AlbumArtImage src={artSrc} objectFit={objectFit} />;
  }

  return (
    <div className="now-playing-art__placeholder" aria-hidden>
      <IconAlbumPlaceholder />
    </div>
  );
}

interface NowPlayingArtProps {
  className?: string;
  nodeId?: string;
  interactionEnabled?: boolean;
  style?: NodeStyle;
  objectFit?: ArtworkNode["objectFit"];
}

/** Skin `artwork` node — current-track cover only, no lightbox. */
export function NowPlayingArt({
  className,
  nodeId,
  interactionEnabled = true,
  style,
  objectFit,
}: NowPlayingArtProps) {
  const display = useNowPlayingDisplay();
  const paint = styleFromSkinNode(style);
  const rootStyle: CSSProperties | undefined = interactionEnabled
    ? paint
    : { ...paint, pointerEvents: "none" };

  return (
    <div
      className={[
        "now-playing-art",
        !display.currentTrack && "now-playing-art--inactive",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      data-node-id={nodeId}
      aria-disabled={interactionEnabled ? undefined : true}
      style={rootStyle}
    >
      <NowPlayingArtVisual display={display} objectFit={objectFit} />
    </div>
  );
}
