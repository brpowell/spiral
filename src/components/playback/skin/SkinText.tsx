import { ScrollingText } from "../../ScrollingText/ScrollingText";
import { useSkinBindValue } from "../../../lib/skinBinds";
import { styleFromSkinNode } from "../../../lib/skinNodeStyle";
import type { TextNode } from "../../../types/skin";
import "./SkinText.css";

export function SkinText({ node }: { node: TextNode }) {
  const bound = useSkinBindValue(node.bind);
  const text =
    node.value ?? (bound === null || bound === undefined ? "" : String(bound));
  const overflow = node.overflow ?? "visible";

  if (!text) return null;

  const className = [
    "skin-text",
    node.className,
    (overflow === "scroll" || overflow === "scroll-bounce") &&
      "skin-text--overflow-scroll",
    overflow === "clip" && "skin-text--overflow-clip",
  ]
    .filter(Boolean)
    .join(" ");

  const nodeIdProps = node.id ? { "data-node-id": node.id } : undefined;
  const style = styleFromSkinNode(node.style);

  if (overflow === "scroll" || overflow === "scroll-bounce") {
    return (
      <span className={className} style={style} {...nodeIdProps}>
        <ScrollingText
          text={text}
          mode={overflow === "scroll" ? "marquee" : "bounce"}
        />
      </span>
    );
  }

  return (
    <span className={className} style={style} {...nodeIdProps}>
      {text}
    </span>
  );
}
