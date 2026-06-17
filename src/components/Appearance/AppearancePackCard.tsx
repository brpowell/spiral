import type { ReactNode } from "react";
import { Button } from "../common/Button/Button";
import { IconCheck, IconMore } from "../icons";
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
  onApply: () => void;
  onViewDetails: () => void;
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
  onApply,
  onViewDetails,
}: AppearancePackCardProps) {
  return (
    <div
      className={[
        "appearance-pack-card",
        active ? "appearance-pack-card--active" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="appearance-pack-card__surface">
        <button
          type="button"
          className="appearance-pack-card__apply"
          aria-pressed={active}
          aria-label={ariaLabel}
          onClick={onApply}
        >
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
        </button>
        <div className="appearance-pack-card__meta">
          <div className="appearance-pack-card__meta-header">
            <button
              type="button"
              className="appearance-pack-card__meta-apply appearance-pack-card__name"
              onClick={onApply}
            >
              {name}
            </button>
            <Button
              variant="secondary"
              size="sm"
              iconOnly
              className="appearance-pack-card__details"
              aria-label={`View details for ${name}`}
              title="View details"
              onClick={onViewDetails}
            >
              <IconMore />
            </Button>
          </div>
          <button
            type="button"
            className="appearance-pack-card__meta-apply appearance-pack-card__author"
            onClick={onApply}
          >
            {author}
          </button>
          <button
            type="button"
            className="appearance-pack-card__meta-apply appearance-pack-card__description"
            onClick={onApply}
          >
            {description ?? ""}
          </button>
        </div>
      </div>
    </div>
  );
}
