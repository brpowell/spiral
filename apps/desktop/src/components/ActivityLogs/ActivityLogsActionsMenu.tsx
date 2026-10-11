import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { clearActivityLogsRemote } from "../../lib/activityLogBridge";
import { formatActivityLogDisplayList } from "../../lib/activityLogLine";
import { showActivityLogCopiedToast } from "../../lib/activityLogToast";
import { copyTextToClipboard } from "../../lib/clipboard";
import { saveDiagnosticsToFile } from "../../lib/diagnosticsExport";
import { useActivityLogStore } from "../../store/useActivityLogStore";
import type { ActivityLogEntry } from "../../types/activityLog";
import {
  ContextMenuCheckboxItem,
  ContextMenuItem,
  ContextMenuSeparator,
} from "../ContextMenu/ContextMenu";
import { IconCopy, IconOpenFolder, IconReset } from "../icons";
import { MenuButton } from "../MenuButton/MenuButton";

interface ActivityLogsActionsMenuProps {
  entries: ActivityLogEntry[];
  includeClear?: boolean;
  ariaLabel?: string;
}

export function ActivityLogsActionsMenu({
  entries,
  includeClear = false,
  ariaLabel,
}: ActivityLogsActionsMenuProps) {
  const { t } = useTranslation("common");
  const autoScroll = useActivityLogStore((s) => s.autoScroll);
  const setAutoScroll = useActivityLogStore((s) => s.setAutoScroll);
  const [copying, setCopying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const resolvedAriaLabel = ariaLabel ?? t("activityLogs.actionsAria");

  const handleToggleAutoScroll = useCallback(() => {
    setAutoScroll(!autoScroll);
  }, [autoScroll, setAutoScroll]);

  const handleCopy = useCallback(
    (close: () => void) => {
      if (entries.length === 0) return;
      setCopying(true);
      const text = formatActivityLogDisplayList(entries);
      void copyTextToClipboard(text)
        .then((copied) => {
          if (!copied) return;
          showActivityLogCopiedToast(entries.length);
          close();
        })
        .finally(() => {
          setCopying(false);
        });
    },
    [entries],
  );

  const handleExport = useCallback((close: () => void) => {
    setExporting(true);
    void saveDiagnosticsToFile()
      .then((path) => {
        if (path != null) close();
      })
      .finally(() => {
        setExporting(false);
      });
  }, []);

  const handleClear = useCallback((close: () => void) => {
    setClearing(true);
    void clearActivityLogsRemote()
      .then(() => {
        close();
      })
      .finally(() => {
        setClearing(false);
      });
  }, []);

  return (
    <MenuButton
      ariaLabel={resolvedAriaLabel}
      layoutDeps={[copying, exporting, clearing, autoScroll]}
    >
      {(close) => (
        <>
          <ContextMenuCheckboxItem
            checked={autoScroll}
            label={t("activityLogs.autoScroll")}
            onClick={handleToggleAutoScroll}
          />
          <ContextMenuSeparator />
          <ContextMenuItem
            icon={<IconCopy />}
            label={
              copying ? t("activityLogs.copying") : t("activityLogs.copyLogs")
            }
            disabled={copying || exporting || clearing || entries.length === 0}
            onClick={() => handleCopy(close)}
          />
          <ContextMenuItem
            icon={<IconOpenFolder />}
            label={
              exporting
                ? t("activityLogs.exporting")
                : t("activityLogs.exportLogs")
            }
            disabled={copying || exporting || clearing}
            onClick={() => handleExport(close)}
          />
          {includeClear ? (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                icon={<IconReset />}
                label={
                  clearing
                    ? t("activityLogs.clearing")
                    : t("activityLogs.clearLogs")
                }
                disabled={copying || exporting || clearing}
                onClick={() => handleClear(close)}
              />
            </>
          ) : null}
        </>
      )}
    </MenuButton>
  );
}
