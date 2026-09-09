import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { MusicBrainzHitFact } from "../../lib/musicBrainzEntityDisplay";
import { Skeleton } from "../common/Skeleton/Skeleton";
import "../common/ChoiceOption/ChoiceOption.css";
import "./MusicBrainzEntityCard.css";

const SKELETON_FACT_COUNT = 4;
const OVERFLOW_EPSILON_PX = 1;

function overflowClassName(start: boolean, end: boolean): string {
  return [
    "musicbrainz-entity-facts",
    start ? "musicbrainz-entity-facts--overflow-start" : null,
    end ? "musicbrainz-entity-facts--overflow-end" : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function MusicBrainzEntityFacts({ facts }: { facts?: MusicBrainzHitFact[] }) {
  const visibleFacts = facts?.filter((item) => item.value.trim() !== "") ?? [];
  const scrollerRef = useRef<HTMLSpanElement>(null);
  const [overflowStart, setOverflowStart] = useState(false);
  const [overflowEnd, setOverflowEnd] = useState(false);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (el == null || visibleFacts.length === 0) {
      setOverflowStart(false);
      setOverflowEnd(false);
      return;
    }

    const update = () => {
      const maxScroll = el.scrollWidth - el.clientWidth;
      setOverflowStart(el.scrollLeft > OVERFLOW_EPSILON_PX);
      setOverflowEnd(maxScroll - el.scrollLeft > OVERFLOW_EPSILON_PX);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    const row = el.firstElementChild;
    if (row != null) observer.observe(row);
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, [visibleFacts.length]);

  if (visibleFacts.length === 0) return null;

  return (
    <span
      ref={scrollerRef}
      className={overflowClassName(overflowStart, overflowEnd)}
    >
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
  /** Compact secondary line under the title (e.g. artist). Ellipsizes. */
  subtitle?: ReactNode;
  /** Wrapping helper copy for empty/fetch cards. Ignored when `subtitle` is set. */
  details?: ReactNode;
  facts?: MusicBrainzHitFact[];
  actions?: ReactNode;
  /** Trailing title-row content (e.g. a “Current” badge). */
  meta?: ReactNode;
  /** Marks a selectable card as the currently chosen option. */
  selected?: boolean;
  /** When set, the card is a selectable button (search results). */
  onClick?: () => void;
};

function entityCardClassName(selectable: boolean, selected = false): string {
  return [
    "choice-option",
    "musicbrainz-entity-card",
    selectable ? "musicbrainz-entity-card--selectable" : null,
    selected ? "choice-option--selected" : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function EntityCardBody({
  title,
  subtitle,
  details,
  facts,
  actions,
  meta,
}: Pick<
  MusicBrainzEntityCardProps,
  "title" | "subtitle" | "details" | "facts" | "actions" | "meta"
>) {
  return (
    <>
      <div className="musicbrainz-entity-card__row">
        <span className="choice-option__main">
          <span className="choice-option__title">{title}</span>
          {subtitle != null ? (
            <span className="musicbrainz-entity-card__subtitle">
              {subtitle}
            </span>
          ) : details != null ? (
            <span className="choice-option__details">{details}</span>
          ) : null}
        </span>
        {meta != null ? (
          <span className="musicbrainz-entity-card__meta">{meta}</span>
        ) : null}
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
  subtitle,
  details,
  facts,
  actions,
  meta,
  selected = false,
  onClick,
}: MusicBrainzEntityCardProps) {
  const selectable = onClick != null;
  const className = entityCardClassName(selectable, selected);
  const body = (
    <EntityCardBody
      title={title}
      subtitle={subtitle}
      details={details}
      facts={facts}
      actions={actions}
      meta={meta}
    />
  );

  if (selectable) {
    return (
      <button
        type="button"
        className={className}
        onClick={onClick}
        aria-pressed={selected ? true : undefined}
      >
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
          <Skeleton width="55%" height="0.875rem" radius="sm" />
          <Skeleton width="38%" height="0.8rem" radius="sm" />
        </span>
      </div>
      <div className="musicbrainz-entity-facts" aria-hidden>
        <div className="musicbrainz-entity-facts__row">
          {Array.from({ length: SKELETON_FACT_COUNT }, (_, index) => (
            <div key={index} className="musicbrainz-entity-facts__fact">
              <Skeleton width="3.25rem" height="0.75rem" radius="sm" />
              <Skeleton width="4.5rem" height="0.75rem" radius="sm" />
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
