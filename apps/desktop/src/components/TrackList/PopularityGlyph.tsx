import { memo } from "react";
import {
  GLYPH_VIEWBOX,
  RING_LABEL_RADIUS,
  ringsGlyph,
  windUpGlyph,
} from "@/lib/popularity/popularityGlyph";
import "./PopularityGlyph.css";

export type PopularityGlyphVariant = "windUp" | "rings";

interface PopularityGlyphProps {
  /** 0..1, see `popularityFraction`. */
  fraction: number;
  variant: PopularityGlyphVariant;
}

/** A track's popularity drawn as a small spiral or set of grooves. Decorative; label the parent. */
export const PopularityGlyph = memo(function PopularityGlyph({
  fraction,
  variant,
}: PopularityGlyphProps) {
  return (
    <svg
      className={`popularity-glyph popularity-glyph--${variant === "windUp" ? "wind-up" : "rings"}`}
      viewBox={`0 0 ${GLYPH_VIEWBOX} ${GLYPH_VIEWBOX}`}
      aria-hidden
    >
      {variant === "windUp" ? (
        <WindUp fraction={fraction} />
      ) : (
        <Rings fraction={fraction} />
      )}
    </svg>
  );
});

function Rings({ fraction }: { fraction: number }) {
  const center = GLYPH_VIEWBOX / 2;
  const { rings, labelLit } = ringsGlyph(fraction);
  return (
    <>
      {rings.map((ring) => (
        <circle
          key={ring.radius}
          className={
            ring.lit
              ? "popularity-glyph__lit popularity-glyph__ring"
              : "popularity-glyph__track popularity-glyph__ring"
          }
          cx={center}
          cy={center}
          r={ring.radius}
        />
      ))}
      <circle
        className="popularity-glyph__label"
        data-lit={labelLit ? "" : undefined}
        cx={center}
        cy={center}
        r={RING_LABEL_RADIUS}
      />
    </>
  );
}

function WindUp({ fraction }: { fraction: number }) {
  const { track, lit } = windUpGlyph(fraction);
  return (
    <>
      <polyline className="popularity-glyph__track" points={track} />
      {lit && <polyline className="popularity-glyph__lit" points={lit} />}
    </>
  );
}
