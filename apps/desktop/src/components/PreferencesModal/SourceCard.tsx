import { Fragment, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { revealInFileManagerLabel } from "../../lib/fileManager";
import { useShortenHomePath } from "../../lib/homePath";
import { sourceDisplayName } from "../../lib/sourceAccess";
import type { Source } from "../../types/source";
import {
  ContextMenuItem,
  ContextMenuSeparator,
} from "../ContextMenu/ContextMenu";
import {
  IconCheck,
  IconDelete,
  IconDisconnected,
  IconOpenFolder,
  IconPencil,
  IconRefresh,
} from "../icons";
import { MenuButton } from "../MenuButton/MenuButton";
import "./SourcesSection.css";

interface SourceCardProps {
  source: Source;
  /** Its tracks, and how many of those are missing. */
  count: { total: number; missing: number };
  offline?: boolean;
  /** Shows "Scanning…" in place of the counts. */
  rescanning?: boolean;
  /** Disables the menu while another action runs. */
  busy?: boolean;
  /** Each action shows in the menu only when it's given. */
  onEdit?: () => void;
  onMakeDefault?: () => void;
  onRescan?: () => void;
  /** Show the folder in Finder (or the platform's file manager). */
  onReveal?: () => void;
  onRemove?: () => void;
}

/**
 * A music folder as a card, in Preferences and onboarding: its path, then
 * its counts and status (default, offline), with its actions in a menu.
 */
export function SourceCard({
  source,
  count,
  offline = false,
  rescanning = false,
  busy = false,
  onEdit,
  onMakeDefault,
  onRescan,
  onReveal,
  onRemove,
}: SourceCardProps) {
  const { t } = useTranslation(["preferences", "common"]);
  const displayPath = useShortenHomePath();
  // The path is what identifies a folder; the name only labels its menu.
  const name = sourceDisplayName(source);

  /** Counts, then the folder's status (default, offline) inline after them. */
  const renderMeta = () => {
    if (rescanning) {
      return (
        <p className="sources-section__meta" role="status">
          {t("preferences:sources.rescanning")}
        </p>
      );
    }
    const parts: ReactNode[] = [
      t("preferences:sources.trackCount", { count: count.total }),
    ];
    if (count.missing > 0) {
      parts.push(
        <span className="sources-section__missing">
          {t("preferences:sources.missingCount", { count: count.missing })}
        </span>,
      );
    }
    if (source.importTarget) {
      parts.push(
        <span
          className="sources-section__status sources-section__default"
          title={t("preferences:sources.defaultHint")}
        >
          <IconCheck aria-hidden />
          {t("preferences:sources.defaultBadge")}
        </span>,
      );
    }
    if (offline) {
      parts.push(
        <span
          className="sources-section__status sources-section__offline"
          title={t("preferences:sources.offlineHint")}
        >
          <IconDisconnected aria-hidden />
          {t("preferences:sources.offline")}
        </span>,
      );
    }
    return (
      <p className="sources-section__meta">
        {parts.map((part, i) => (
          <Fragment key={i}>
            {i > 0 ? (
              <span className="sources-section__sep" aria-hidden>
                ·
              </span>
            ) : null}
            {part}
          </Fragment>
        ))}
      </p>
    );
  };

  // Make default only for folders that aren't it (it acts at once, so it
  // isn't in Edit).
  const canMakeDefault = onMakeDefault != null && !source.importTarget;

  return (
    <li className="sources-section__item">
      <span className="sources-section__icon">
        <IconOpenFolder aria-hidden />
      </span>
      <div className="sources-section__body">
        {source.rootPath ? (
          <code className="sources-section__path" title={source.rootPath}>
            {/* Ellipsize the start, so the folder name stays visible. */}
            <bdo dir="ltr">{displayPath(source.rootPath)}</bdo>
          </code>
        ) : null}
        {renderMeta()}
      </div>
      <MenuButton
        ariaLabel={t("preferences:sources.actionsAria", { name })}
        title={t("common:actions")}
        variant="ghost"
        className="sources-section__menu"
        disabled={busy}
        layoutDeps={[source.importTarget]}
      >
        {(close) => (
          <>
            {onEdit ? (
              <ContextMenuItem
                icon={<IconPencil />}
                label={t("preferences:sources.edit")}
                onClick={() => {
                  close();
                  onEdit();
                }}
              />
            ) : null}
            {canMakeDefault ? (
              <ContextMenuItem
                icon={<IconCheck />}
                label={t("preferences:sources.makeDefault")}
                disabled={offline}
                onClick={() => {
                  close();
                  onMakeDefault();
                }}
              />
            ) : null}
            {onRescan ? (
              <ContextMenuItem
                icon={<IconRefresh />}
                label={t("preferences:sources.rescan")}
                onClick={() => {
                  close();
                  onRescan();
                }}
              />
            ) : null}
            {onReveal ? (
              <ContextMenuItem
                icon={<IconOpenFolder />}
                label={revealInFileManagerLabel()}
                disabled={offline}
                onClick={() => {
                  close();
                  onReveal();
                }}
              />
            ) : null}
            {onRemove ? (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem
                  icon={<IconDelete />}
                  label={t("preferences:sources.remove")}
                  className="context-menu__danger"
                  onClick={() => {
                    close();
                    onRemove();
                  }}
                />
              </>
            ) : null}
          </>
        )}
      </MenuButton>
    </li>
  );
}
