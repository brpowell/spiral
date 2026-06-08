import { ScrollingText } from "../../ScrollingText/ScrollingText";
import { useSkinBindValue } from "../../../lib/skinBinds";
import type { TextNode, TextStyle } from "../../../types/skin";
import "./SkinText.css";

export function SkinText({
  node,
  textStyles,
}: {
  node: TextNode;
  textStyles: Record<string, TextStyle>;
}) {
  const value = useSkinBindValue(node.bind);
  const style = node.textStyle ? textStyles[node.textStyle] : undefined;
  const text = value === null || value === undefined ? "" : String(value);

  if (!text) return null;

  const className = [
    "skin-text",
    style?.size && `skin-text--${style.size}`,
    style?.weight && `skin-text--${style.weight}`,
    style?.truncate && "skin-text--truncate",
  ]
    .filter(Boolean)
    .join(" ");

  const colorVar = style?.role ? `var(--${style.role})` : undefined;

  if (style?.truncate) {
    return (
      <span
        className={className}
        style={colorVar ? { color: colorVar } : undefined}
      >
        <ScrollingText
          text={text}
          mode={style?.scroll === "marquee" ? "marquee" : "bounce"}
        />
      </span>
    );
  }

  return (
    <span className={className} style={colorVar ? { color: colorVar } : undefined}>
      {text}
    </span>
  );
}
