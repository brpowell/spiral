import { Button } from "../../common/Button/Button";
import {
  IconAlwaysOnTop,
  IconClose,
  IconPalette,
  IconRestoreWindow,
} from "../../icons";
import { useSkinAction } from "../../../lib/skinActions";
import { useSkinModeAlwaysOnTop } from "../../../lib/skinModeAlwaysOnTop";
import { skinDragRegionNoneProps } from "../../../lib/skinDragRegion";
import type { ButtonNode } from "../../../types/skin";
import "./SkinPrimitiveButton.css";

const ACTION_LABELS: Record<string, string> = {
  "skin.openPicker": "Choose skin",
  "skin.toggleAlwaysOnTop": "Toggle always on top",
  "skin.restoreMainWindow": "Restore main window",
  "skin.exit": "Exit skin mode",
  "skin.minimize": "Minimize window",
  "app.quit": "Quit Spiral",
};

function ActionIcon({
  action,
  width = 14,
  height = 14,
}: {
  action: string | undefined;
  width?: number;
  height?: number;
}) {
  switch (action) {
    case "skin.openPicker":
      return <IconPalette width={width} height={height} />;
    case "skin.toggleAlwaysOnTop":
      return <IconAlwaysOnTop width={width} height={height} />;
    case "skin.restoreMainWindow":
      return <IconRestoreWindow width={width} height={height} />;
    case "skin.exit":
    case "app.quit":
      return <IconClose width={width} height={height} />;
    case "skin.minimize":
      return (
        <svg viewBox="0 0 24 24" width={width} height={height} aria-hidden>
          <path fill="currentColor" d="M5 19h14v-2H5v2z" />
        </svg>
      );
    default:
      return null;
  }
}

export function SkinPrimitiveButton({ node }: { node: ButtonNode }) {
  const invoke = useSkinAction(node.action);
  const alwaysOnTop = useSkinModeAlwaysOnTop();
  const presentation = node.presentation;

  if (presentation.kind !== "primitive") return null;

  const label = ACTION_LABELS[node.action ?? ""] ?? node.id ?? node.action ?? "Action";
  const active = node.action === "skin.toggleAlwaysOnTop" && alwaysOnTop;

  const className = [
    "skin-primitive-btn",
    presentation.classPrefix,
    active && "skin-primitive-btn--active",
    node.action === "skin.exit" || node.action === "app.quit"
      ? "skin-primitive-btn--close"
      : null,
    presentation.variant ? `skin-primitive-btn--${presentation.variant}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Button
      variant="ghost"
      size="sm"
      iconOnly
      className={className}
      data-node-id={node.id}
      {...skinDragRegionNoneProps()}
      onClick={() => invoke()}
      aria-label={label}
      aria-pressed={node.action === "skin.toggleAlwaysOnTop" ? active : undefined}
      title={label}
    >
      <ActionIcon action={node.action} />
    </Button>
  );
}
