import { t } from "./i18n";

/** Middot joins parallel bulk-outcome status clauses (not sentence clauses). */
const PEER_OUTCOME_SEPARATOR = " · ";

/** Join nonzero peer outcome clauses; empty input yields "". */
export function joinPeerOutcomeClauses(parts: string[]): string {
  return parts.filter((part) => part.length > 0).join(PEER_OUTCOME_SEPARATOR);
}

/**
 * A peer-counter clause after zero-suppression.
 *
 * `anchored` marks an operation-specific verb (`imported`, `converted`, …).
 * If every surviving clause is generic (`failed`, `fetched`, …), the title
 * gets an `{Operation}:` prefix (see Toast Amendment: Operation Prefix Rule).
 */
export type PeerOutcomeClause = {
  text: string;
  anchored?: boolean;
};

/** Build a peer-outcome title, prefixing when no anchor verb remains. */
export function formatPeerOutcomeTitle(
  clauses: PeerOutcomeClause[],
  options: {
    /** Localized operation name (e.g. "Import", "Convert", "Lyrics"). */
    operation: string;
    fallback: string;
  },
): string {
  const present = clauses.filter((clause) => clause.text.length > 0);
  const joined = joinPeerOutcomeClauses(present.map((clause) => clause.text));
  if (!joined) return options.fallback;
  if (present.some((clause) => clause.anchored)) return joined;
  return t("toasts:peer.prefixed", {
    operation: options.operation,
    parts: joined,
  });
}
