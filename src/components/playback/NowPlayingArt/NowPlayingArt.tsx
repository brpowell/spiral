import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  useNowPlayingDisplay,
  type NowPlayingDisplay,
} from "../../../hooks/useNowPlayingDisplay";
import { subscribeCrossfadeVisual } from "../../../lib/crossfadeVisualClock";
import type { CrossfadeVisualState } from "../../../lib/playback";
import { styleFromSkinNode } from "../../../lib/skinNodeStyle";
import type { ArtworkNode, NodeStyle } from "../../../types/skin";
import { IconDisc2 } from "../../icons";
import "./NowPlayingArt.css";

function applyCrossfadeOpacity(
  el: HTMLDivElement,
  role: "outgoing" | "incoming",
  reduceMotion: boolean,
  state: CrossfadeVisualState | null,
): void {
  const progress = state?.progress ?? (role === "incoming" ? 0 : 1);
  if (reduceMotion) {
    const showIncoming = progress >= 0.5;
    const visible = role === "incoming" ? showIncoming : !showIncoming;
    el.style.opacity = visible ? "1" : "0";
    el.style.visibility = visible ? "visible" : "hidden";
    el.ariaHidden = visible ? "false" : "true";
    return;
  }
  const opacity = role === "incoming" ? progress : 1 - progress;
  el.style.opacity = String(opacity);
  el.style.visibility = opacity <= 0.01 ? "hidden" : "visible";
  el.ariaHidden = opacity < 0.5 ? "true" : "false";
}

export function CrossfadeOpacity({
  role,
  reduceMotion,
  children,
}: {
  role: "outgoing" | "incoming";
  reduceMotion: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    return subscribeCrossfadeVisual((state) => {
      applyCrossfadeOpacity(el, role, reduceMotion, state);
    });
  }, [role, reduceMotion]);

  return (
    <div
      ref={ref}
      className="now-playing-crossfade"
      style={{ opacity: role === "incoming" ? 0 : 1 }}
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
    reduceMotion,
  } = display;

  if (showCrossfadeVisual && (outgoingArtSrc || incomingArtSrc)) {
    return (
      <div className="now-playing-art__stack">
        {outgoingArtSrc ? (
          <CrossfadeOpacity role="outgoing" reduceMotion={reduceMotion}>
            <AlbumArtImage src={outgoingArtSrc} objectFit={objectFit} />
          </CrossfadeOpacity>
        ) : null}
        {incomingArtSrc ? (
          <CrossfadeOpacity role="incoming" reduceMotion={reduceMotion}>
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
      <IconDisc2 />
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
  const paint = styleFromSkinNode(style, { omitOpacity: true });
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
