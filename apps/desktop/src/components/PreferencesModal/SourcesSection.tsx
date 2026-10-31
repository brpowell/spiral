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
} from "../../lib/tauri";
import { useLibrarySettingsStore } from "../../store/useLibrarySettingsStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useSourcesStore } from "../../store/useSourcesStore";
import type { ReconcileSummary, Source } from "../../types/source";
import { AlertConfirmation } from "../common/AlertConfirmation/AlertConfirmation";
import { Badge } from "../common/Badge/Badge";
import { Button } from "../common/Button/Button";
import {
  IconDelete,
  IconDisconnected,
  IconFolderLink,
  IconHardDrive,
  IconOpenFolder,
  IconPlus,
  IconRefresh,
} from "../icons";
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

/** Preferences → Sources: where the library's tracks come from. */
export function SourcesSection() {
  const { t } = useTranslation(["preferences", "common"]);
  const sources = useSourcesStore((s) => s.sources);
  const statuses = useSourcesStore((s) => s.statuses);
  const loadSources = useSourcesStore((s) => s.loadSources);
  const loadStatuses = useSourcesStore((s) => s.loadStatuses);
  const applySource = useSourcesStore((s) => s.applySource);
  const library = usePlayerStore((s) => s.library);
  const mediaFolder = useLibrarySettingsStore((s) => s.settings?.mediaFolder);

  const [busyId, setBusyId] = useState<number | "add" | null>(null);
  const [rescanningId, setRescanningId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
  const ordered = useMemo(
    () =>
      [...sources].sort(
        (a, b) =>
          ROLE_ORDER[sourceRole(a)] - ROLE_ORDER[sourceRole(b)] || a.id - b.id,
      ),
    [sources],
  );

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
          const path =
            role === "default"
              ? (mediaFolder ?? source.rootPath)
              : source.rootPath;
          const offline =
            role === "user" && statuses[source.id] === "unreachable";
          const busy = busyId != null;
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
                {path ? (
                  <code className="sources-section__path" title={path}>
                    {/* Ellipsize the start, so the folder name stays visible. */}
                    <bdo dir="ltr">{path}</bdo>
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
                    ? t("preferences:sources.managedDescription")
                    : role === "other"
                      ? t("preferences:sources.externalDescription")
                      : offline
                        ? t("preferences:sources.offlineHint")
                        : t("preferences:sources.watchedDescription")}
                </p>

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

      <AlertConfirmation
        open={removing != null}
        onClose={() => setRemoving(null)}
        title={t("preferences:sources.removeTitle", {
          name: removing?.name ?? "",
        })}
        confirmLabel={t("preferences:sources.removeConfirm")}
        onConfirm={confirmRemove}
      >
        <p>
          {t("preferences:sources.removeBody", {
            count: removing ? (counts.get(removing.id)?.total ?? 0) : 0,
          })}
        </p>
      </AlertConfirmation>
    </div>
  );
}
