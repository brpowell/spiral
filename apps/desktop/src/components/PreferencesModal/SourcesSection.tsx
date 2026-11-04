import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShortenHomePath } from "../../lib/homePath";
import {
  countTracksBySource,
  describeSourceError,
} from "../../lib/sourceAccess";
import {
  addSource,
  pickMusicFolder,
  removeSource,
  rescanSource,
  setImportSource,
} from "../../lib/tauri";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useSourcesStore } from "../../store/useSourcesStore";
import type { ReconcileSummary, Source } from "../../types/source";
import { AlertConfirmation } from "../common/AlertConfirmation/AlertConfirmation";
import { Button } from "../common/Button/Button";
import { FormField } from "../common/Field/Field";
import { IconOpenFolder, IconPlus } from "../icons";
import { SourceCard } from "./SourceCard";
import { SourceEditFlow } from "./SourceEditFlow";
import "./SourcesSection.css";

/** How often the offline badges refresh while the section is open. */
export const SOURCE_STATUS_POLL_MS = 5000;

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

  const [busyId, setBusyId] = useState<number | "add" | "managed" | null>(null);
  const [rescanningId, setRescanningId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Source | null>(null);
  // The folder just added, whose dialog finishes adding it (Cancel undoes).
  const [addingId, setAddingId] = useState<number | null>(null);
  const [removing, setRemoving] = useState<Source | null>(null);

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
      const source = await addSource(folder);
      applySource(source);
      await loadSources();
      setAddingId(source.id);
      setEditing(source);
    });

  /** Cancelled the Add dialog: take the folder it just added back out. */
  const cancelAdd = (source: Source) =>
    run(source.id, async () => {
      await removeSource(source.id);
      await loadSources();
      await usePlayerStore.getState().loadLibrary({ preservePlayback: true });
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

  return (
    <FormField
      className="sources-section"
      label={t("preferences:sources.title")}
      labelId={headingId}
    >
      <div
        className="sources-section__content"
        role="group"
        aria-labelledby={headingId}
      >
        <ul className="sources-section__list">
          {folders.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              count={counts.get(source.id) ?? { total: 0, missing: 0 }}
              offline={isOffline(source)}
              rescanning={rescanningId === source.id}
              busy={busy}
              onEdit={() => {
                setError(null);
                setAddingId(null);
                setEditing(source);
              }}
              onMakeDefault={() => void makeDefault(source)}
              onRescan={() => void rescan(source)}
              onRemove={() => {
                setError(null);
                setRemoving(source);
              }}
              removeDisabledReason={
                folders.length === 1
                  ? t("preferences:sources.removeLast")
                  : undefined
              }
            />
          ))}
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

        <SourceEditFlow
          source={editing}
          onClose={() => setEditing(null)}
          onSaving={() => {
            setError(null);
            setNotice(null);
          }}
          onSaved={loadStatuses}
          onCancelAdd={
            addingId != null ? (source) => void cancelAdd(source) : undefined
          }
        />

        <AlertConfirmation
          open={removing != null}
          onClose={() => setRemoving(null)}
          title={t("preferences:sources.removeTitle")}
          confirmLabel={t("preferences:sources.removeConfirm")}
          onConfirm={confirmRemove}
        >
          {/* Which folder this is, shown like its card in the list. */}
          {removing?.rootPath ? (
            <div className="sources-section__remove-folder">
              <IconOpenFolder aria-hidden />
              <code title={removing.rootPath}>
                {displayPath(removing.rootPath)}
              </code>
            </div>
          ) : null}
          <p>
            {t("preferences:sources.removeBody", {
              count: removing ? trackCount(removing) : 0,
            })}
          </p>
          {removing?.importTarget ? (
            <p>{t("preferences:sources.removeDefault")}</p>
          ) : null}
        </AlertConfirmation>
      </div>
    </FormField>
  );
}
