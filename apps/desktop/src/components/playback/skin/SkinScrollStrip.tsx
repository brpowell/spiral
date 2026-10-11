import { useEffect, useRef, useState } from "react";
import { skinAssetFileUrl } from "../../../lib/skinAssets";
import {
  buildScrollStripInitialTops,
  resolveScrollStripItemTop,
  resolveScrollStripSlideLayout,
} from "../../../lib/skinScrollStrip";
import { useSkinScrollStripState } from "../../../lib/skinScrollStripContext";
import type { LoadedSkinPack, ScrollStripNode } from "../../../types/skin";
import { useSkinLayoutContext } from "./SkinLayoutContext";
import "./SkinScrollStrip.css";

export function SkinScrollStrip({
  node,
  pack,
}: {
  node: ScrollStripNode;
  pack: LoadedSkinPack;
}) {
  const { state } = useSkinScrollStripState();
  const layout = useSkinLayoutContext();
  // Layout context already includes this node's absolute origin when bounded.
  const stripOriginY = layout.origin.y;
  const runtime = node.id ? state[node.id] : undefined;
  const slide = runtime?.slide ?? 1;
  const slideLayout = resolveScrollStripSlideLayout(node, slide);
  const transitionMs = node.presentation.transitionMs ?? 500;
  const lastTopsRef = useRef<Record<string, number>>(
    buildScrollStripInitialTops(node, stripOriginY),
  );
  const [reduceMotion, setReduceMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduceMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const itemStates = node.presentation.items.map((item) => {
    const placement = slideLayout[item.id];
    const visible = placement !== undefined;
    const top = visible
      ? resolveScrollStripItemTop(placement.y, stripOriginY)
      : (lastTopsRef.current[item.id] ?? 0);
    if (visible) {
      lastTopsRef.current[item.id] = top;
    }
    return { item, visible, top };
  });

  return (
    <div
      className="skin-scroll-strip"
      data-node-id={node.id}
      style={{
        ["--skin-scroll-strip-transition-ms" as string]: reduceMotion
          ? "0ms"
          : `${transitionMs}ms`,
      }}
    >
      {itemStates.map(({ item, visible, top }) => {
        const src = skinAssetFileUrl(pack.packDir, item.asset);

        return (
          <div
            key={item.id}
            className={[
              "skin-scroll-strip__item",
              visible && "skin-scroll-strip__item--visible",
            ]
              .filter(Boolean)
              .join(" ")}
            style={{
              top: `${top}px`,
              width: `${item.w}px`,
              height: `${item.h}px`,
              backgroundImage: `url("${src}")`,
            }}
            aria-hidden
          />
        );
      })}
    </div>
  );
}
