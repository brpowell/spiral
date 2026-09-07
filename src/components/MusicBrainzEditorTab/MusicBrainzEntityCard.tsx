import type { ReactNode } from "react";
import type { MusicBrainzHitFact } from "../../lib/musicBrainzEntityDisplay";
import { Skeleton } from "../common/Skeleton/Skeleton";
import "../common/ChoiceOption/ChoiceOption.css";
import "./MusicBrainzEntityCard.css";

const SKELETON_FACT_COUNT = 4;

function MusicBrainzEntityFacts({ facts }: { facts?: MusicBrainzHitFact[] }) {
  const visibleFacts = facts?.filter((item) => item.value.trim() !== "") ?? [];
  if (visibleFacts.length === 0) return null;

  return (
    <span className="musicbrainz-entity-facts">
      <span className="musicbrainz-entity-facts__row">
        {visibleFacts.map((item) => (
          <span key={item.key} className="musicbrainz-entity-facts__fact">
            <span className="musicbrainz-entity-facts__label">
              {item.label}
            </span>
            <span className="musicbrainz-entity-facts__value">
              {item.value}
            </span>
          </span>
        ))}
      </span>
    </span>
  );
}

export type MusicBrainzEntityCardProps = {
  title: ReactNode;
  details?: ReactNode;
  facts?: MusicBrainzHitFact[];
  actions?: ReactNode;
  /** When set, the card is a selectable button (search results). */
  onClick?: () => void;
};

function entityCardClassName(selectable: boolean): string {
  return [
    "choice-option",
    "musicbrainz-entity-card",
    selectable ? "musicbrainz-entity-card--selectable" : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function EntityCardBody({
  title,
  details,
  facts,
  actions,
}: Pick<
  MusicBrainzEntityCardProps,
  "title" | "details" | "facts" | "actions"
>) {
  return (
    <>
      <div className="musicbrainz-entity-card__row">
        <span className="choice-option__main">
          <span className="choice-option__title">{title}</span>
          {details != null ? (
            <span className="choice-option__details">{details}</span>
          ) : null}
        </span>
      </div>
      <MusicBrainzEntityFacts facts={facts} />
      {actions != null ? (
        <div className="musicbrainz-entity-card__actions">{actions}</div>
      ) : null}
    </>
  );
}

/** Assigned-entity summary, or a selectable search hit when `onClick` is set. */
export function MusicBrainzEntityCard({
  title,
  details,
  facts,
  actions,
  onClick,
}: MusicBrainzEntityCardProps) {
  const selectable = onClick != null;
  const className = entityCardClassName(selectable);
  const body = (
    <EntityCardBody
      title={title}
      details={details}
      facts={facts}
      actions={actions}
    />
  );

  if (selectable) {
    return (
      <button type="button" className={className} onClick={onClick}>
        {body}
      </button>
    );
  }

  return <div className={className}>{body}</div>;
}

export type MusicBrainzEntityCardSkeletonProps = {
  /** Mirror the action row so height stays stable during Save & fetch. */
  withActions?: boolean;
  /** Match selectable search-hit chrome (transparent border). */
  selectable?: boolean;
  "aria-label"?: string;
};

/** Loading placeholder matching MusicBrainzEntityCard layout. */
export function MusicBrainzEntityCardSkeleton({
  withActions = false,
  selectable = false,
  "aria-label": ariaLabel,
}: MusicBrainzEntityCardSkeletonProps) {
  return (
    <div
      className={entityCardClassName(selectable)}
      role="status"
      aria-busy="true"
      aria-label={ariaLabel}
    >
      <div className="musicbrainz-entity-card__row">
        <span className="choice-option__main musicbrainz-entity-card__skeleton-main">
          <Skeleton width="55%" height="0.95rem" radius="sm" />
          <Skeleton width="38%" height="0.75rem" radius="sm" />
        </span>
      </div>
      <div className="musicbrainz-entity-facts" aria-hidden>
        <div className="musicbrainz-entity-facts__row">
          {Array.from({ length: SKELETON_FACT_COUNT }, (_, index) => (
            <div key={index} className="musicbrainz-entity-facts__fact">
              <Skeleton width="3.25rem" height="0.65rem" radius="sm" />
              <Skeleton width="4.5rem" height="0.82rem" radius="sm" />
            </div>
          ))}
        </div>
      </div>
      {withActions ? (
        <div className="musicbrainz-entity-card__actions">
          <Skeleton width="11rem" height="1.65rem" radius="sm" />
          <Skeleton width="9rem" height="1.65rem" radius="sm" />
        </div>
      ) : null}
    </div>
  );
}
