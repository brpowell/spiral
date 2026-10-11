import type { ReactNode } from "react";
import { Button } from "../../common/Button/Button";
import { skinAssetFileUrl } from "../../../lib/skinAssets";
import {
  isSkinAssetIconPath,
  resolveSkinLibraryIcon,
} from "../../../lib/skinLibraryIcons";
import { useSkinModeAlwaysOnTop } from "../../../lib/skinModeAlwaysOnTop";
import { skinDragRegionNoneProps } from "../../../lib/skinDragRegion";
import {
  evaluateSkinBind,
  evaluateSkinCondition,
  type SkinBindState,
  useSkinBindState,
  useSkinControlEnabled,
} from "../../../lib/skinBinds";
import {
  playSkinSound,
  resolveSkinClickSound,
} from "../../../lib/skinSoundEffects";
import { useSkinTooltip } from "../../../lib/skinTooltips";
import {
  styleFromSkinNode,
  useResolvedNodeStyle,
} from "../../../lib/skinNodeStyle";
import {
  primaryClickAction,
  primaryClickViewId,
  scheduleSkinEffects,
} from "../../../lib/skinEffects";
import type { ButtonNode, LoadedSkinPack } from "../../../types/skin";
import "./SkinPrimitiveButton.css";

function PrimitiveIcon({
  icon,
  packDir,
}: {
  icon: string;
  packDir: string;
}): ReactNode {
  if (isSkinAssetIconPath(icon)) {
    return (
      <img
        className="skin-primitive-btn__asset-icon"
        src={skinAssetFileUrl(packDir, icon)}
        alt=""
        draggable={false}
      />
    );
  }
  const Icon = resolveSkinLibraryIcon(icon);
  return Icon ? <Icon /> : null;
}

function hasResolvableIcon(icon: string | undefined): boolean {
  if (!icon) return false;
  if (isSkinAssetIconPath(icon)) return true;
  return resolveSkinLibraryIcon(icon) != null;
}

function resolvePrimitiveIcon(
  icon: string | undefined,
  iconWhen: Record<string, string> | undefined,
  state: SkinBindState,
): string | undefined {
  let resolved = icon;
  if (!iconWhen) return resolved;
  for (const [condition, next] of Object.entries(iconWhen)) {
    if (evaluateSkinBind(condition, state)) {
      resolved = next;
    }
  }
  return resolved;
}

export function SkinPrimitiveButton({
  node,
  pack,
}: {
  node: ButtonNode;
  pack: LoadedSkinPack;
}) {
  const bindState = useSkinBindState();
  const alwaysOnTop = useSkinModeAlwaysOnTop();
  const interactionEnabled = useSkinControlEnabled(node.enabledWhen);
  const resolvedStyle = useResolvedNodeStyle(node.style, node.styleWhen);
  const presentation = node.presentation;
  const clickAction = primaryClickAction(node.onClick);

  if (presentation.kind !== "primitive") return null;

  const label = useSkinTooltip({
    action: clickAction,
    viewId: primaryClickViewId(node.onClick),
    id: node.id,
    tooltip: node.tooltip,
    tooltipWhen: node.tooltipWhen,
  });
  const isSticky =
    node.activeWhen && evaluateSkinCondition(node.activeWhen, bindState);
  const active =
    (clickAction === "skin.toggleAlwaysOnTop" && alwaysOnTop) ||
    Boolean(isSticky);

  const icon = resolvePrimitiveIcon(
    presentation.icon,
    presentation.iconWhen,
    bindState,
  );
  const text = presentation.text;
  const hasIcon = hasResolvableIcon(icon);
  const hasText = Boolean(text);
  const showTooltipAsLabel = !hasIcon && !hasText;
  const iconOnly = hasIcon && !hasText;
  const chrome = presentation.variant ?? "ghost";
  const className = [
    "skin-primitive-btn",
    chrome === "plain" && "skin-primitive-btn--plain",
    node.className,
    active && "skin-primitive-btn--active",
    clickAction === "skin.exit" || clickAction === "app.quit"
      ? "skin-primitive-btn--close"
      : null,
    (hasText || showTooltipAsLabel) &&
      chrome !== "plain" &&
      "skin-primitive-btn--text",
  ]
    .filter(Boolean)
    .join(" ");

  const body = (
    <>
      {hasIcon && icon ? (
        <PrimitiveIcon icon={icon} packDir={pack.packDir} />
      ) : null}
      {hasText ? text : null}
      {showTooltipAsLabel ? label : null}
    </>
  );

  const buttonProps = {
    className,
    "data-node-id": node.id,
    style: styleFromSkinNode(resolvedStyle, {
      omitOpacity: node.bounds !== undefined,
    }),
    ...skinDragRegionNoneProps(),
    disabled: !interactionEnabled,
    onClick: () => {
      if (!interactionEnabled) return;
      playSkinSound(
        pack,
        resolveSkinClickSound(node.sound, node.soundWhen, bindState),
      );
      scheduleSkinEffects(node.onClick, () => bindState);
    },
    "aria-label": label,
    "aria-pressed":
      clickAction === "skin.toggleAlwaysOnTop" || node.activeWhen
        ? active
        : undefined,
    title: label,
  };

  if (chrome === "plain") {
    return (
      <button type="button" {...buttonProps}>
        {body}
      </button>
    );
  }

  return (
    <Button variant={chrome} size="sm" iconOnly={iconOnly} {...buttonProps}>
      {body}
    </Button>
  );
}
