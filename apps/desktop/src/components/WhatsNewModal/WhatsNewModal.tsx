import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import {
  canShowUpdateAction,
  fetchReleaseHistory,
  formatReleaseDate,
  normalizeReleaseVersion,
  pickSelectedVersion,
  resolveWhatsNewRows,
  type ReleaseNotesItem,
} from "../../lib/releases/history";
import { getAppVersion } from "../../lib/tauri";
import { useUpdaterStore } from "../../store/useUpdaterStore";
import { useWhatsNewStore } from "../../store/useWhatsNewStore";
import { Alert } from "../common/Alert/Alert";
import { Badge } from "../common/Badge/Badge";
import { Button } from "../common/Button/Button";
import { EmptyState } from "../common/EmptyState/EmptyState";
import { MarkdownBody } from "../common/MarkdownBody/MarkdownBody";
import {
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalHeader,
  ModalTitle,
} from "../common/Modal/Modal";
import { Skeleton } from "../common/Skeleton/Skeleton";
import { SidebarFrame, SidebarList } from "../layout/SidebarChrome";
import { SidebarItem } from "../layout/SidebarItem/SidebarItem";
import { IconCheck, IconErrorAlert } from "../icons";
import "./WhatsNewModal.css";

type LoadState = "loading" | "ready" | "error";

export function WhatsNewModal() {
  const { t } = useTranslation("common");
  const open = useWhatsNewStore((s) => s.open);
  const focusVersion = useWhatsNewStore((s) => s.focusVersion);
  const closeWhatsNew = useWhatsNewStore((s) => s.closeWhatsNew);
  const availableUpdate = useUpdaterStore((s) => s.availableUpdate);
  const mockRelease = useUpdaterStore((s) => s.mockRelease);
  const installAvailableUpdate = useUpdaterStore(
    (s) => s.installAvailableUpdate,
  );
  const updaterStatus = useUpdaterStore((s) => s.status);

  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open);

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [history, setHistory] = useState<ReleaseNotesItem[]>([]);
  const [reloadToken, setReloadToken] = useState(0);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const [installedVersion, setInstalledVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setLoadState("loading");
      setHistory([]);
      setSelectedVersion(null);
      return;
    }

    let cancelled = false;
    void getAppVersion()
      .then((version) => {
        if (!cancelled) setInstalledVersion(version);
      })
      .catch(() => {
        if (!cancelled) {
          setInstalledVersion(availableUpdate?.currentVersion ?? null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, availableUpdate?.currentVersion]);

  useEffect(() => {
    if (!open) return;

    if (mockRelease) {
      setHistory([]);
      setLoadState("ready");
      return;
    }

    const abort = new AbortController();
    setLoadState("loading");
    void fetchReleaseHistory({ signal: abort.signal })
      .then((releases) => {
        if (abort.signal.aborted) return;
        setHistory(releases);
        setLoadState("ready");
      })
      .catch((err: unknown) => {
        if (abort.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("Failed to load release notes:", err);
        setHistory([]);
        setLoadState("error");
      });

    return () => abort.abort();
  }, [open, reloadToken, mockRelease]);

  const rows = useMemo(
    () =>
      resolveWhatsNewRows({
        history,
        availableUpdate,
        installedVersion: mockRelease ? installedVersion : null,
      }),
    [history, availableUpdate, mockRelease, installedVersion],
  );

  useEffect(() => {
    if (!open) return;
    setSelectedVersion((current) => {
      if (current && rows.some((row) => row.version === current)) {
        return current;
      }
      return pickSelectedVersion({ rows, focusVersion });
    });
  }, [open, rows, focusVersion]);

  const installedNorm = installedVersion
    ? normalizeReleaseVersion(installedVersion)
    : null;
  const selected = rows.find((row) => row.version === selectedVersion) ?? null;
  const showUpdate = canShowUpdateAction({
    selectedVersion,
    rows,
    availableUpdate,
  });
  const updateBusy =
    updaterStatus === "downloading" || updaterStatus === "checking";

  const handleRetry = () => {
    setReloadToken((token) => token + 1);
  };

  const handleUpdate = () => {
    void installAvailableUpdate();
  };

  const notesEmpty = selected != null && selected.notes.trim().length === 0;
  const selectedDate =
    selected != null ? formatReleaseDate(selected.pub_date) : "";
  const showHistoryError = loadState === "error";
  const showLoading = loadState === "loading" && rows.length === 0;
  const showEmpty = loadState === "ready" && rows.length === 0;

  return (
    <Modal
      open={open}
      onClose={closeWhatsNew}
      size="xl"
      panelClassName="whats-new-modal"
      panelRef={panelRef}
      labelledBy={titleId}
    >
      <ModalHeader>
        <ModalTitle id={titleId}>{t("updates.whatsNew.title")}</ModalTitle>
        <ModalCloseButton onClick={closeWhatsNew} />
      </ModalHeader>

      <ModalBody className="whats-new__body">
        <SidebarFrame
          as="aside"
          aria-label={t("updates.whatsNew.versionsAria")}
          className="whats-new__sidebar"
        >
          {showLoading ? (
            <div className="whats-new__sidebar-loading" aria-hidden>
              <Skeleton height="2.4rem" />
              <Skeleton height="2.4rem" />
              <Skeleton height="2.4rem" />
            </div>
          ) : (
            <SidebarList>
              {rows.map((row) => {
                const installed =
                  installedNorm != null && row.version === installedNorm;
                const dateLabel = formatReleaseDate(row.pub_date);
                return (
                  <li key={row.version}>
                    <SidebarItem
                      active={row.version === selectedVersion}
                      subtitle={dateLabel || undefined}
                      trailing={
                        installed ? (
                          <span
                            className="whats-new__installed-check"
                            title={t("updates.whatsNew.installed")}
                            aria-label={t("updates.whatsNew.installed")}
                          >
                            <IconCheck />
                          </span>
                        ) : undefined
                      }
                      onClick={() => setSelectedVersion(row.version)}
                    >
                      {row.version}
                    </SidebarItem>
                  </li>
                );
              })}
            </SidebarList>
          )}
        </SidebarFrame>

        <div className="whats-new__pane">
          {showLoading ? (
            <div className="whats-new__pane-loading" aria-busy="true">
              <Skeleton width="8rem" height="1.25rem" />
              <Skeleton height="4rem" />
              <Skeleton height="4rem" />
            </div>
          ) : showEmpty ? (
            <EmptyState title={t("updates.whatsNew.empty")} />
          ) : showHistoryError && rows.length === 0 ? (
            <EmptyState
              icon={<IconErrorAlert />}
              title={t("updates.whatsNew.loadError")}
              description={t("updates.whatsNew.loadErrorDetail")}
              action={
                <Button size="sm" onClick={handleRetry}>
                  {t("updates.whatsNew.retry")}
                </Button>
              }
            />
          ) : (
            <>
              {showHistoryError ? (
                <Alert variant="error" className="whats-new__error-banner">
                  <span>{t("updates.whatsNew.loadError")}</span>
                  <Button variant="ghost" size="xs" onClick={handleRetry}>
                    {t("updates.whatsNew.retry")}
                  </Button>
                </Alert>
              ) : null}

              {mockRelease ? (
                <Alert variant="info" className="whats-new__sim-banner">
                  This is a simulated release. Updating will not install a real
                  build.
                </Alert>
              ) : null}

              {selected ? (
                <>
                  <div className="whats-new__pane-header">
                    <div className="whats-new__pane-heading">
                      <div className="whats-new__pane-title">
                        <h3 className="whats-new__pane-version">
                          {selected.version}
                        </h3>
                        {installedNorm != null &&
                        selected.version === installedNorm ? (
                          <Badge className="whats-new__installed-badge">
                            <IconCheck />
                            {t("updates.whatsNew.installed")}
                          </Badge>
                        ) : null}
                      </div>
                      {selectedDate ? (
                        <p className="whats-new__pane-date">{selectedDate}</p>
                      ) : null}
                    </div>
                    {showUpdate ? (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={handleUpdate}
                        disabled={updateBusy}
                      >
                        {t("updates.available.update")}
                      </Button>
                    ) : null}
                  </div>
                  <div className="whats-new__notes">
                    {notesEmpty ? (
                      <p className="whats-new__notes-empty">
                        {t("updates.whatsNew.emptyNotes")}
                      </p>
                    ) : (
                      <MarkdownBody source={selected.notes} />
                    )}
                  </div>
                </>
              ) : null}
            </>
          )}
        </div>
      </ModalBody>
    </Modal>
  );
}
