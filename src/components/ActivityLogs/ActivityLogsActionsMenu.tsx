import { useCallback, useState } from "react";
import { clearActivityLogsRemote } from "../../lib/activityLogBridge";
import {
  copyDiagnosticsToClipboard,
  saveDiagnosticsToFile,
} from "../../lib/diagnosticsExport";
import {
  ContextMenuItem,
  ContextMenuSeparator,
} from "../ContextMenu/ContextMenu";
import { IconCopy, IconOpenFolder, IconReset } from "../icons";
import { MenuButton } from "../MenuButton/MenuButton";

interface ActivityLogsActionsMenuProps {
  includeClear?: boolean;
  ariaLabel?: string;
}

export function ActivityLogsActionsMenu({
  includeClear = false,
  ariaLabel = "Activity log actions",
}: ActivityLogsActionsMenuProps) {
  const [copying, setCopying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [clearing, setClearing] = useState(false);

  const handleCopy = useCallback((close: () => void) => {
    setCopying(true);
    void copyDiagnosticsToClipboard()
      .then((copied) => {
        if (copied) close();
      })
      .finally(() => {
        setCopying(false);
      });
  }, []);

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
    <MenuButton ariaLabel={ariaLabel} layoutDeps={[copying, exporting, clearing]}>
      {(close) => (
        <>
          <ContextMenuItem
            icon={<IconCopy />}
            label={copying ? "Copying…" : "Copy logs"}
            disabled={copying || exporting || clearing}
            onClick={() => handleCopy(close)}
          />
          <ContextMenuItem
            icon={<IconOpenFolder />}
            label={exporting ? "Exporting…" : "Export logs…"}
            disabled={copying || exporting || clearing}
            onClick={() => handleExport(close)}
          />
          {includeClear ? (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                icon={<IconReset />}
                label={clearing ? "Clearing logs…" : "Clear logs"}
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
