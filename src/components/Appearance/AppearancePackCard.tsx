import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { IconCheck } from "../icons";
import "./AppearancePackCard.css";

export interface AppearancePackCardProps {
  active: boolean;
  name: string;
  author: string;
  /** Pack display name shown before the author as `[Pack] ∙ [Author]`. */
  packName?: string;
  packId?: string;
  description?: string;
  ariaLabel: string;
  preview: ReactNode;
  className?: string;
  previewClassName?: string;
  /** Optional overflow actions (e.g. edit / delete). Hidden when omitted. */
  actions?: ReactNode;
  onApply: () => void;
  /** Opens Packs focused on this pack when the pack name is clicked. */
  onOpenPack?: (packId: string) => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}

function stopCardActivate(event: MouseEvent | KeyboardEvent): void {
  event.stopPropagation();
}

export function AppearancePackCard({
  active,
  name,
  author,
  packName,
  packId,
  description,
  ariaLabel,
  preview,
  className,
  previewClassName,
  actions,
  onApply,
  onOpenPack,
  onPointerEnter,
  onPointerLeave,
}: AppearancePackCardProps) {
  const packLabel = packName?.trim() || packId?.trim() || "";
  const authorLabel = author.trim() || "Unknown";

  return (
    <div
      className={[
        "appearance-pack-card",
        active ? "appearance-pack-card--active" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      role="button"
      tabIndex={0}
      aria-pressed={active}
      aria-label={ariaLabel}
      onClick={onApply}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onApply();
        }
      }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <div className="appearance-pack-card__surface">
        <div
          className={[
            "appearance-pack-card__preview",
            "appearance-pack-card__preview--media",
            previewClassName,
          ]
            .filter(Boolean)
            .join(" ")}
          aria-hidden
        >
          {preview}
          {active ? (
            <span className="appearance-pack-card__check" aria-hidden>
              <IconCheck />
            </span>
          ) : null}
        </div>
        <div className="appearance-pack-card__meta">
          <div className="appearance-pack-card__meta-header">
            <span className="appearance-pack-card__name">{name}</span>
            {actions ? (
              <div
                className="appearance-pack-card__actions-slot"
                onClick={stopCardActivate}
                onKeyDown={stopCardActivate}
              >
                {actions}
              </div>
            ) : null}
          </div>
          <p className="appearance-pack-card__author">
            {packLabel ? (
              <>
                {packId && onOpenPack ? (
                  <button
                    type="button"
                    className="appearance-pack-card__pack"
                    onClick={(event) => {
                      stopCardActivate(event);
                      onOpenPack(packId);
                    }}
                  >
                    {packLabel}
                  </button>
                ) : (
                  <span className="appearance-pack-card__pack">
                    {packLabel}
                  </span>
                )}
                <span className="appearance-pack-card__sep" aria-hidden>
                  ∙
                </span>
              </>
            ) : null}
            <span className="appearance-pack-card__author-name">
              {authorLabel}
            </span>
          </p>
          <div className="appearance-pack-card__description">
            <span className="appearance-pack-card__description-text">
              {description ?? ""}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
