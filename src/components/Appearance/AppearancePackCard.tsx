import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { IconCheck } from "../icons";
import "./AppearancePackCard.css";

export interface AppearancePackCardProps {
  active: boolean;
  name: string;
  author: string;
  description?: string;
  ariaLabel: string;
  preview: ReactNode;
  className?: string;
  previewClassName?: string;
  /** Optional overflow actions (e.g. edit / delete). Hidden when omitted. */
  actions?: ReactNode;
  onApply: () => void;
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
  description,
  ariaLabel,
  preview,
  className,
  previewClassName,
  actions,
  onApply,
  onPointerEnter,
  onPointerLeave,
}: AppearancePackCardProps) {
  const { t } = useTranslation("common");
  const authorLabel = author.trim() || t("unknown");

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
            <div
              className="appearance-pack-card__actions-slot"
              onClick={actions ? stopCardActivate : undefined}
              onKeyDown={actions ? stopCardActivate : undefined}
            >
              {actions}
            </div>
          </div>
          <p className="appearance-pack-card__author">{authorLabel}</p>
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

/** Shared browse card for Packs + Get more (preview, optional status badge, meta). */
export function PackListCard({
  name,
  author,
  description,
  ariaLabel,
  preview,
  badge,
  actions,
  onOpen,
}: {
  name: string;
  author: string;
  description?: string;
  ariaLabel: string;
  preview: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  onOpen: () => void;
}) {
  return (
    <AppearancePackCard
      active={false}
      name={name}
      author={author}
      description={description}
      ariaLabel={ariaLabel}
      preview={
        <>
          {preview}
          {badge ? (
            <div className="appearance-pack-card__badge-slot">{badge}</div>
          ) : null}
        </>
      }
      previewClassName="appearance-pack-card__preview--pack"
      actions={actions}
      onApply={onOpen}
    />
  );
}
