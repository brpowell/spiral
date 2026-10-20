import type { ReactNode } from "react";
import { t } from "../../lib/i18n";
import { Button } from "../common/Button/Button";
import { IconBack } from "../icons";
import "./BrowseView.css";

interface BrowseViewHeaderProps {
  /** Omit for a header with only the back control (and actions). */
  title?: string;
  count?: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** When set, shows an icon-only back control before the title. */
  onBack?: () => void;
  /** Accessible name for the back control (default: "Back"). */
  backAriaLabel?: string;
}

export function BrowseViewHeader({
  title,
  count,
  actions,
  className = "",
  onBack,
  backAriaLabel = t("common:back"),
}: BrowseViewHeaderProps) {
  return (
    <header
      className={[
        "browse-view__header",
        onBack != null ? "browse-view__header--with-back" : null,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {onBack != null ? (
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          className="browse-view__back"
          aria-label={backAriaLabel}
          onClick={onBack}
        >
          <IconBack />
        </Button>
      ) : null}
      {title != null ? (
        <div className="browse-view__heading">
          <h1 className="browse-view__title">{title}</h1>
          {count != null ? (
            <span className="browse-view__count">{count}</span>
          ) : null}
        </div>
      ) : null}
      {actions}
    </header>
  );
}
