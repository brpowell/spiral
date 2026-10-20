import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { IconCheck, IconLink } from "../icons";
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
  /** Marks an item linked from a folder on disk (shown as a link badge on the preview). */
  linked?: boolean;
  /** Optional action floated over the preview's top-right corner (e.g. Update). */
  previewAction?: ReactNode;
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
  linked = false,
  previewAction,
  actions,
  onApply,
  onPointerEnter,
  onPointerLeave,
}: AppearancePackCardProps) {
  const { t } = useTranslation(["common", "studio"]);
  const linkedLabel = t("studio:items.zone.linked");
  const authorLabel = author.trim() || t("common:unknown");

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
      aria-label={linked ? `${ariaLabel}, ${linkedLabel}` : ariaLabel}
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
        <div className="appearance-pack-card__preview-wrap">
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
            {linked ? (
              <div className="appearance-pack-card__badge-slot">
                <span className="appearance-pack-card__badge appearance-pack-card__badge--muted">
                  <IconLink aria-hidden />
                  {linkedLabel}
                </span>
              </div>
            ) : null}
          </div>
          {previewAction ? (
            <div
              className="appearance-pack-card__preview-action"
              onClick={stopCardActivate}
              onKeyDown={stopCardActivate}
            >
              {previewAction}
            </div>
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

/** Shared browse card for Packs + Catalog (preview, optional status badge, meta). */
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
