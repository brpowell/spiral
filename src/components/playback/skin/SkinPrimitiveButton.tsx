import { Button } from "../../common/Button/Button";
import {
  IconAlwaysOnTop,
  IconClose,
  IconPalette,
  IconMaximize,
} from "../../icons";
import { useSkinAction } from "../../../lib/skinActions";
import { useSkinModeAlwaysOnTop } from "../../../lib/skinModeAlwaysOnTop";
import { skinDragRegionNoneProps } from "../../../lib/skinDragRegion";
import {
  evaluateSkinCondition,
  useSkinBindState,
  useSkinControlEnabled,
} from "../../../lib/skinBinds";
import { useSkinTooltip } from "../../../lib/skinTooltips";
import type { ButtonNode } from "../../../types/skin";
import "./SkinPrimitiveButton.css";

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
      return <IconMaximize width={width} height={height} />;
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

function actionHasIcon(action: string | undefined): boolean {
  switch (action) {
    case "skin.openPicker":
    case "skin.toggleAlwaysOnTop":
    case "skin.restoreMainWindow":
    case "skin.exit":
    case "app.quit":
    case "skin.minimize":
      return true;
    default:
      return false;
  }
}

export function SkinPrimitiveButton({ node }: { node: ButtonNode }) {
  const invoke = useSkinAction(node.action);
  const bindState = useSkinBindState();
  const alwaysOnTop = useSkinModeAlwaysOnTop();
  const interactionEnabled = useSkinControlEnabled(node.enabledWhen);
  const presentation = node.presentation;

  if (presentation.kind !== "primitive") return null;

  const label = useSkinTooltip({
    action: node.action,
    panelId: node.panelId,
    viewId: node.viewId,
    id: node.id,
    tooltip: node.tooltip,
    tooltipWhen: node.tooltipWhen,
  });
  const isSticky =
    node.activeWhen &&
    evaluateSkinCondition(node.activeWhen, bindState);
  const active =
    (node.action === "skin.toggleAlwaysOnTop" && alwaysOnTop) || Boolean(isSticky);
  const hasIcon = actionHasIcon(node.action);

  const className = [
    "skin-primitive-btn",
    presentation.classPrefix,
    active && "skin-primitive-btn--active",
    node.action === "skin.exit" || node.action === "app.quit"
      ? "skin-primitive-btn--close"
      : null,
    !hasIcon && "skin-primitive-btn--text",
    presentation.variant ? `skin-primitive-btn--${presentation.variant}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Button
      variant="ghost"
      size="sm"
      iconOnly={hasIcon}
      className={className}
      data-node-id={node.id}
      {...skinDragRegionNoneProps()}
      disabled={!interactionEnabled}
      onClick={() => {
        if (!interactionEnabled) return;
        invoke();
      }}
      aria-label={label}
      aria-pressed={node.action === "skin.toggleAlwaysOnTop" ? active : undefined}
      title={label}
    >
      {hasIcon ? <ActionIcon action={node.action} /> : label}
    </Button>
  );
}
