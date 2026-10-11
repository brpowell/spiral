import { useRef } from "react";
import { scheduleSkinEffects } from "../../../lib/skinEffects";
import {
  useSkinBindState,
  useSkinControlEnabled,
} from "../../../lib/skinBinds";
import { skinDragRegionNoneProps } from "../../../lib/skinDragRegion";
import {
  styleFromSkinNode,
  useResolvedNodeStyle,
} from "../../../lib/skinNodeStyle";
import { useSkinStore } from "../../../store/useSkinStore";
import type { InputNode } from "../../../types/skin";
import "./SkinInput.css";

export function SkinInput({ node }: { node: InputNode }) {
  const bindState = useSkinBindState();
  const bindStateRef = useRef(bindState);
  bindStateRef.current = bindState;
  const enabled = useSkinControlEnabled(node.enabledWhen);
  const resolvedStyle = useResolvedNodeStyle(node.style, node.styleWhen);
  const nodeId = node.id ?? "";
  const value = useSkinStore((s) =>
    nodeId ? (s.inputValues[nodeId] ?? "") : "",
  );
  const setInputValue = useSkinStore((s) => s.setInputValue);
  const style = styleFromSkinNode(resolvedStyle, {
    omitOpacity: node.bounds !== undefined,
  });
  const inputStyle =
    resolvedStyle?.color != null
      ? { ...style, caretColor: resolvedStyle.color }
      : style;

  return (
    <input
      type="text"
      className={["skin-input", node.className].filter(Boolean).join(" ")}
      data-node-id={node.id}
      value={value}
      placeholder={node.placeholder}
      maxLength={node.maxLength}
      disabled={!enabled}
      spellCheck={false}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      aria-label={node.placeholder}
      style={inputStyle}
      {...skinDragRegionNoneProps()}
      onChange={(event) => {
        const next = event.target.value;
        if (nodeId) setInputValue(nodeId, next);
        const effects = node.onChange?.map((effect) => ({
          ...effect,
          payload: { ...effect.payload, query: next },
        }));
        scheduleSkinEffects(effects, () => bindStateRef.current);
      }}
    />
  );
}
