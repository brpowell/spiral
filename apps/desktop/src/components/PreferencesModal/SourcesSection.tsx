import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  countTracksBySource,
  describeSourceError,
  sourceDisplayName,
  sourceRole,
  type SourceRole,
} from "../../lib/sourceAccess";
import {
  addSource,
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
import { Badge } from "../common/Badge/Badge";
import { Button } from "../common/Button/Button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "../common/Field/Field";
import { Switch } from "../common/Switch/Switch";
import { TextInput } from "../common/TextInput/TextInput";
import {
  IconDelete,
  IconDisconnected,
  IconFolderLink,
  IconHardDrive,
  IconImport,
  IconOpenFolder,
  IconPlus,
  IconRefresh,
} from "../icons";
import {
  OrganizePreviewDialog,
  type OrganizeRequest,
} from "./OrganizePreviewDialog";
import "./SourcesSection.css";

/** How often the offline badges refresh while the section is open. */
export const SOURCE_STATUS_POLL_MS = 5000;

const ROLE_ORDER: Record<SourceRole, number> = {
  default: 0,
  user: 1,
  other: 2,
};

function sourceIcon(role: SourceRole) {
  if (role === "default") return <IconHardDrive aria-hidden />;
  if (role === "user") return <IconOpenFolder aria-hidden />;
  return <IconFolderLink aria-hidden />;
}

/** A path format field's value as stored: blank means the default format. */
function normalizeFormat(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

interface PendingOrganize extends OrganizeRequest {
  /** Clear the source's own format once applied (it goes back to the default). */
  clearFormat?: boolean;
}

/** Preferences → Sources: the folders Spiral plays music from. */
export function SourcesSection() {
  const { t } = useTranslation(["preferences", "common"]);
  const sources = useSourcesStore((s) => s.sources);
  const statuses = useSourcesStore((s) => s.statuses);
  const loadSources = useSourcesStore((s) => s.loadSources);
  const loadStatuses = useSourcesStore((s) => s.loadStatuses);
  const applySource = useSourcesStore((s) => s.applySource);
  const library = usePlayerStore((s) => s.library);
  const defaultFormat = useLibrarySettingsStore(
    (s) => s.settings?.organizePathFormat ?? "",
  );

  const [busyId, setBusyId] = useState<number | "add" | null>(null);
  const [rescanningId, setRescanningId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Source | null>(null);
  const [organizing, setOrganizing] = useState<PendingOrganize | null>(null);
  /** Path format edits not yet saved, by source id. */
  const [formatDrafts, setFormatDrafts] = useState<Record<number, string>>({});

  useEffect(() => {
    void loadSources();
    const timer = window.setInterval(
      () => void loadStatuses(),
      SOURCE_STATUS_POLL_MS,
    );
    return () => window.clearInterval(timer);
  }, [loadSources, loadStatuses]);

  const counts = useMemo(() => countTracksBySource(library), [library]);
  const ordered = useMemo(
    () =>
      [...sources].sort(
        (a, b) =>
          ROLE_ORDER[sourceRole(a)] - ROLE_ORDER[sourceRole(b)] || a.id - b.id,
      ),
    [sources],
  );

  const trackCount = (source: Source) => counts.get(source.id)?.total ?? 0;

  const clearDraft = (sourceId: number) =>
    setFormatDrafts((prev) => {
      const next = { ...prev };
      delete next[sourceId];
      return next;
    });

  const run = async (id: number | "add", action: () => Promise<void>) => {
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

  const relocate = (source: Source) =>
    run(source.id, async () => {
      const folder = await pickMusicFolder();
      if (!folder) return;
      applySource(await relocateSource(source.id, folder));
      await loadStatuses();
    });

  const makeImportTarget = (source: Source) =>
    run(source.id, async () => {
      await setImportSource(source.id);
      await loadSources();
    });

  /** Turning organize on moves existing files, so it goes through a preview. */
  const toggleOrganize = (source: Source, on: boolean) => {
    if (on && trackCount(source) > 0) {
      setError(null);
      setOrganizing({ source });
      return;
    }
    void run(source.id, async () => {
      applySource(await setSourceOrganize(source.id, on));
    });
  };

  /** A new format for an organized source moves its files, so it is previewed too. */
  const commitFormat = (source: Source) => {
    const draft = formatDrafts[source.id];
    if (draft === undefined) return;
    const next = normalizeFormat(draft);
    if (next === source.pathFormat) {
      clearDraft(source.id);
      return;
    }
    if (source.autoOrganize && trackCount(source) > 0) {
      setError(null);
      setOrganizing({
        source,
        pathFormat: next ?? defaultFormat,
        clearFormat: next == null,
      });
      return;
    }
    void run(source.id, async () => {
      applySource(await setSourcePathFormat(source.id, next));
      clearDraft(source.id);
    });
  };

  const organizeApplied = async () => {
    if (!organizing) return;
    if (organizing.clearFormat) {
      await setSourcePathFormat(organizing.source.id, null);
    }
    clearDraft(organizing.source.id);
    await loadSources();
  };

  const closeOrganize = () => {
    // Cancelling leaves the setting as it was, so drop the unsaved format.
    if (organizing) clearDraft(organizing.source.id);
    setOrganizing(null);
  };

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

  return (
    <div className="preferences__panel sources-section">
      <p className="preferences__hint">
        {t("preferences:sources.description")}
      </p>

      <ul className="sources-section__list">
        {ordered.map((source) => {
          const count = counts.get(source.id) ?? { total: 0, missing: 0 };
          const name = sourceDisplayName(source);
          const role = sourceRole(source);
          const offline =
            role !== "other" && statuses[source.id] === "unreachable";
          const busy = busyId != null;
          const organizeId = `source-organize-${source.id}`;
          const formatId = `source-format-${source.id}`;
          return (
            <li
              key={source.id}
              className="sources-section__item"
              data-source-kind={role}
            >
              <span className="sources-section__icon">{sourceIcon(role)}</span>
              <div className="sources-section__body">
                <div className="sources-section__heading">
                  <span className="sources-section__name">{name}</span>
                  {source.importTarget ? (
                    <Badge
                      variant="accent"
                      title={t("preferences:sources.importTargetHint")}
                    >
                      {t("preferences:sources.importTarget")}
                    </Badge>
                  ) : null}
                  {offline ? (
                    <Badge
                      className="sources-section__offline"
                      title={t("preferences:sources.offlineHint")}
                    >
                      <IconDisconnected aria-hidden />
                      {t("preferences:sources.offline")}
                    </Badge>
                  ) : null}
                </div>
                {source.rootPath ? (
                  <code
                    className="sources-section__path"
                    title={source.rootPath}
                  >
                    {/* Ellipsize the start, so the folder name stays visible. */}
                    <bdo dir="ltr">{source.rootPath}</bdo>
                  </code>
                ) : null}
                <p className="sources-section__meta">
                  {t("preferences:sources.trackCount", { count: count.total })}
                  {count.missing > 0 ? (
                    <>
                      {" · "}
                      <span className="sources-section__missing">
                        {t("preferences:sources.missingCount", {
                          count: count.missing,
                        })}
                      </span>
                    </>
                  ) : null}
                </p>
                <p className="sources-section__description">
                  {role === "default"
                    ? t("preferences:sources.defaultDescription")
                    : role === "other"
                      ? t("preferences:sources.otherDescription")
                      : offline
                        ? t("preferences:sources.offlineHint")
                        : t("preferences:sources.userDescription")}
                </p>

                {role !== "other" ? (
                  <div className="sources-section__settings">
                    <Field
                      orientation="horizontal"
                      className="sources-section__organize"
                    >
                      <Switch
                        id={organizeId}
                        checked={source.autoOrganize}
                        disabled={busy}
                        onChange={(e) =>
                          toggleOrganize(source, e.target.checked)
                        }
                      />
                      <FieldContent>
                        <FieldLabel htmlFor={organizeId}>
                          {t("preferences:sources.organize")}
                        </FieldLabel>
                        <FieldDescription>
                          {source.autoOrganize
                            ? t("preferences:sources.organizeOnDescription")
                            : t("preferences:sources.organizeOffDescription")}
                        </FieldDescription>
                      </FieldContent>
                    </Field>

                    <div className="sources-section__format">
                      <label
                        className="sources-section__format-label"
                        htmlFor={formatId}
                      >
                        {t("preferences:sources.pathFormat")}
                      </label>
                      <TextInput
                        id={formatId}
                        value={
                          formatDrafts[source.id] ?? source.pathFormat ?? ""
                        }
                        placeholder={t("preferences:sources.useDefaultFormat")}
                        spellCheck={false}
                        disabled={busy}
                        onChange={(e) =>
                          setFormatDrafts((prev) => ({
                            ...prev,
                            [source.id]: e.target.value,
                          }))
                        }
                        onBlur={() => commitFormat(source)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                      />
                      <p className="sources-section__description">
                        {t("preferences:sources.defaultFormat")}{" "}
                        <code>{defaultFormat}</code>
                      </p>
                    </div>
                  </div>
                ) : null}

                <div
                  className="sources-section__actions"
                  role="group"
                  aria-label={t("preferences:sources.actionsAria", { name })}
                >
                  <Button
                    size="sm"
                    disabled={busy}
                    isLoading={rescanningId === source.id}
                    onClick={() => void rescan(source)}
                  >
                    <IconRefresh aria-hidden />
                    {rescanningId === source.id
                      ? t("preferences:sources.rescanning")
                      : t("preferences:sources.rescan")}
                  </Button>
                  {role !== "other" && !source.importTarget ? (
                    <Button
                      size="sm"
                      disabled={busy || offline}
                      onClick={() => void makeImportTarget(source)}
                    >
                      <IconImport aria-hidden />
                      {t("preferences:sources.importHere")}
                    </Button>
                  ) : null}
                  {role === "user" ? (
                    <>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => void relocate(source)}
                      >
                        <IconOpenFolder aria-hidden />
                        {t("preferences:sources.changeLocation")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          setError(null);
                          setRemoving(source);
                        }}
                      >
                        <IconDelete aria-hidden />
                        {t("preferences:sources.remove")}
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
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

      <OrganizePreviewDialog
        request={organizing}
        onClose={closeOrganize}
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
      </AlertConfirmation>
    </div>
  );
}
