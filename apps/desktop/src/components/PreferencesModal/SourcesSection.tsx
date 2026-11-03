import {
  Fragment,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { useShortenHomePath } from "../../lib/homePath";
import {
  GENERIC_ORGANIZE_PATH_SAMPLE,
  trackToOrganizePathSample,
} from "../../lib/organizePathFormat";
import {
  countTracksBySource,
  describeSourceError,
  sourceDisplayName,
} from "../../lib/sourceAccess";
import {
  addSource,
  createManagedSource,
  pickMusicFolder,
  relocateSource,
  removeSource,
  rescanSource,
  setImportSource,
  setSourceOrganize,
  setSourcePathFormat,
} from "../../lib/tauri";
import { useLibrarySettingsStore } from "../../store/useLibrarySettingsStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useSourcesStore } from "../../store/useSourcesStore";
import type { ReconcileSummary, Source } from "../../types/source";
import { AlertConfirmation } from "../common/AlertConfirmation/AlertConfirmation";
import { Button } from "../common/Button/Button";
import { FormField } from "../common/Field/Field";
import {
  ContextMenuItem,
  ContextMenuSeparator,
} from "../ContextMenu/ContextMenu";
import {
  IconCheck,
  IconDelete,
  IconDisconnected,
  IconFolderCog,
  IconOpenFolder,
  IconPencil,
  IconPlus,
  IconRefresh,
} from "../icons";
import { MenuButton } from "../MenuButton/MenuButton";
import {
  OrganizePreviewDialog,
  type OrganizeRequest,
} from "./OrganizePreviewDialog";
import { SourceEditDialog, type SourceEdits } from "./SourceEditDialog";
import "./SourcesSection.css";

/** How often the offline badges refresh while the section is open. */
export const SOURCE_STATUS_POLL_MS = 5000;

interface PendingOrganize extends OrganizeRequest {
  /** Clear the source's own format once applied (it goes back to the default). */
  clearFormat?: boolean;
}

/**
 * Preferences → Library → Music folders: the folders Spiral plays music
 * from, which may be none. Each folder shows only its path and counts;
 * everything else is under its menu.
 */
export function SourcesSection() {
  const { t } = useTranslation(["preferences", "common"]);
  const headingId = useId();
  const sources = useSourcesStore((s) => s.sources);
  const statuses = useSourcesStore((s) => s.statuses);
  const loadSources = useSourcesStore((s) => s.loadSources);
  const loadStatuses = useSourcesStore((s) => s.loadStatuses);
  const applySource = useSourcesStore((s) => s.applySource);
  const library = usePlayerStore((s) => s.library);
  const displayPath = useShortenHomePath();
  const defaultFormat = useLibrarySettingsStore(
    (s) => s.settings?.defaultOrganizePathFormat ?? "",
  );

  const [busyId, setBusyId] = useState<number | "add" | "managed" | null>(null);
  const [rescanningId, setRescanningId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Source | null>(null);
  const [removing, setRemoving] = useState<Source | null>(null);
  const [organizing, setOrganizing] = useState<PendingOrganize | null>(null);

  useEffect(() => {
    void loadSources();
    const timer = window.setInterval(
      () => void loadStatuses(),
      SOURCE_STATUS_POLL_MS,
    );
    return () => window.clearInterval(timer);
  }, [loadSources, loadStatuses]);

  const counts = useMemo(() => countTracksBySource(library), [library]);
  const folders = useMemo(
    () => [...sources].sort((a, b) => a.id - b.id),
    [sources],
  );

  const trackCount = (source: Source) => counts.get(source.id)?.total ?? 0;
  const isOffline = (source: Source) => statuses[source.id] === "unreachable";

  const run = async (
    id: number | "add" | "managed",
    action: () => Promise<void>,
  ) => {
    if (busyId != null) return;
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      setError(describeSourceError(err));
    } finally {
      setBusyId(null);
    }
  };

  const addFolder = () =>
    run("add", async () => {
      const folder = await pickMusicFolder();
      if (!folder) return;
      applySource(await addSource(folder));
      await loadSources();
    });

  const addManagedFolder = () =>
    run("managed", async () => {
      applySource(await createManagedSource());
      await loadSources();
    });

  const rescan = (source: Source) =>
    run(source.id, async () => {
      setRescanningId(source.id);
      try {
        const summary: ReconcileSummary = await rescanSource(source.id);
        setNotice(
          t("preferences:sources.scanSummary", {
            added: summary.added,
            updated: summary.updated,
            missing: summary.missing,
            restored: summary.restored,
          }),
        );
        await loadStatuses();
      } finally {
        setRescanningId(null);
      }
    });

  const makeDefault = (source: Source) =>
    run(source.id, async () => {
      await setImportSource(source.id);
      await loadSources();
    });

  /**
   * Saves the edit dialog. A new location applies at once; turning
   * organize on, or a new format for an organized source, moves files, so it
   * goes through the preview (cancelling it leaves organizing as it was).
   */
  const saveEdits = async (source: Source, edits: SourceEdits) => {
    setError(null);
    setNotice(null);
    let current = source;
    if (edits.rootPath) {
      current = await relocateSource(source.id, edits.rootPath);
      applySource(current);
    }

    const formatChanged = edits.pathFormat !== undefined;
    const nextFormat = formatChanged
      ? (edits.pathFormat ?? null)
      : current.pathFormat;
    const organize = edits.autoOrganize ?? current.autoOrganize;
    const movesFiles =
      organize &&
      trackCount(current) > 0 &&
      (edits.autoOrganize === true || formatChanged);

    if (movesFiles) {
      setOrganizing(
        formatChanged
          ? {
              source: current,
              pathFormat: nextFormat ?? defaultFormat,
              clearFormat: nextFormat == null,
            }
          : { source: current },
      );
    } else {
      if (edits.autoOrganize !== undefined) {
        current = await setSourceOrganize(source.id, edits.autoOrganize);
      }
      if (formatChanged) {
        current = await setSourcePathFormat(source.id, nextFormat);
      }
      applySource(current);
    }
    await loadSources();
    await loadStatuses();
  };

  const organizeApplied = async () => {
    if (!organizing) return;
    if (organizing.clearFormat) {
      await setSourcePathFormat(organizing.source.id, null);
    }
    await loadSources();
  };

  /** One of the source's own tracks, so the format preview looks familiar. */
  const previewSample = useMemo(() => {
    const track = editing
      ? library.find((t) => t.sourceId === editing.id)
      : undefined;
    return track
      ? trackToOrganizePathSample(track)
      : GENERIC_ORGANIZE_PATH_SAMPLE;
  }, [editing, library]);

  const confirmRemove = async () => {
    if (!removing) return;
    const source = removing;
    setError(null);
    try {
      await removeSource(source.id);
      await loadSources();
      await usePlayerStore.getState().loadLibrary({ preservePlayback: true });
    } catch (err) {
      setError(describeSourceError(err));
      throw err;
    }
  };

  const busy = busyId != null;

  /** Counts, then the folder's status (default, offline) inline after them. */
  const renderMeta = (source: Source) => {
    if (rescanningId === source.id) {
      return (
        <p className="sources-section__meta" role="status">
          {t("preferences:sources.rescanning")}
        </p>
      );
    }
    const count = counts.get(source.id) ?? { total: 0, missing: 0 };
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
    if (isOffline(source)) {
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

  /**
   * Rescan for every row; Edit and Remove only for folders, and Make default
   * for folders that aren't it (it acts at once, so it isn't in Edit).
   */
  const renderMenu = (source: Source, name: string) => (
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
          <ContextMenuItem
            icon={<IconPencil />}
            label={t("preferences:sources.edit")}
            onClick={() => {
              close();
              setError(null);
              setEditing(source);
            }}
          />
          {!source.importTarget ? (
            <ContextMenuItem
              icon={<IconCheck />}
              label={t("preferences:sources.makeDefault")}
              disabled={isOffline(source)}
              onClick={() => {
                close();
                void makeDefault(source);
              }}
            />
          ) : null}
          <ContextMenuItem
            icon={<IconRefresh />}
            label={t("preferences:sources.rescan")}
            onClick={() => {
              close();
              void rescan(source);
            }}
          />
          <ContextMenuSeparator />
          <ContextMenuItem
            icon={<IconDelete />}
            label={t("preferences:sources.remove")}
            className="context-menu__danger"
            onClick={() => {
              close();
              setError(null);
              setRemoving(source);
            }}
          />
        </>
      )}
    </MenuButton>
  );

  /** A folder the user chose, `Tracks` included. */
  const renderFolder = (source: Source) => {
    // The path is what identifies a folder; the name only labels its menu.
    const name = sourceDisplayName(source);
    return (
      <li key={source.id} className="sources-section__item">
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
          {renderMeta(source)}
        </div>
        {renderMenu(source, name)}
      </li>
    );
  };

  return (
    <FormField
      className="sources-section"
      label={t("preferences:sources.title")}
      labelId={headingId}
      description={t("preferences:sources.description")}
      descriptionPosition="below-label"
    >
      <div
        className="sources-section__content"
        role="group"
        aria-labelledby={headingId}
      >
        {folders.length > 0 ? (
          <>
            <ul className="sources-section__list">
              {folders.map((source) => renderFolder(source))}
            </ul>
            <Button
              variant="secondary"
              className="preferences__action-btn"
              disabled={busyId != null}
              isLoading={busyId === "add"}
              onClick={() => void addFolder()}
            >
              <IconPlus aria-hidden />
              {t("preferences:sources.addFolder")}
            </Button>
          </>
        ) : (
          <div className="sources-section__empty">
            <p className="sources-section__empty-title">
              {t("preferences:sources.emptyTitle")}
            </p>
            <p className="sources-section__description">
              {t("preferences:sources.emptyBody")}
            </p>
            <div className="sources-section__actions">
              <Button
                variant="secondary"
                disabled={busyId != null}
                isLoading={busyId === "add"}
                onClick={() => void addFolder()}
              >
                <IconPlus aria-hidden />
                {t("preferences:sources.addFolder")}
              </Button>
              <Button
                variant="ghost"
                disabled={busyId != null}
                isLoading={busyId === "managed"}
                onClick={() => void addManagedFolder()}
              >
                <IconFolderCog aria-hidden />
                {t("preferences:sources.manageTracks")}
              </Button>
            </div>
          </div>
        )}

        {notice ? (
          <p className="preferences__hint" role="status">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="preferences__error" role="alert">
            {error}
          </p>
        ) : null}

        <SourceEditDialog
          source={editing}
          defaultFormat={defaultFormat}
          previewSample={previewSample}
          onClose={() => setEditing(null)}
          onSave={saveEdits}
        />

        <OrganizePreviewDialog
          request={organizing}
          onClose={() => setOrganizing(null)}
          onApplied={organizeApplied}
        />

        <AlertConfirmation
          open={removing != null}
          onClose={() => setRemoving(null)}
          title={t("preferences:sources.removeTitle", {
            name: removing ? sourceDisplayName(removing) : "",
          })}
          confirmLabel={t("preferences:sources.removeConfirm")}
          onConfirm={confirmRemove}
        >
          <p>
            {t("preferences:sources.removeBody", {
              count: removing ? trackCount(removing) : 0,
            })}
          </p>
          {removing?.rootPath ? (
            <p>
              {t("preferences:sources.removeKeepsFolder", {
                path: displayPath(removing.rootPath),
              })}
            </p>
          ) : null}
          {removing?.importTarget ? (
            <p>{t("preferences:sources.removeDefault")}</p>
          ) : null}
        </AlertConfirmation>
      </div>
    </FormField>
  );
}
