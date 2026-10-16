import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  importItemWithRefresh,
  linkItemFolderWithRefresh,
  reloadLinkedItemsWithRefresh,
} from "../../lib/items/itemActions";
import { themeCreateFailedPayload } from "../../lib/toastPayloads";
import { useBackgroundTasksStore } from "../../store/useBackgroundTasksStore";
import { useThemeStore } from "../../store/useThemeStore";
import { ContextMenuItem } from "../ContextMenu/ContextMenu";
import {
  IconFolderLink,
  IconImport,
  IconPlus,
  IconRefresh,
  IconSettings,
} from "../icons";
import { MenuButton } from "../MenuButton/MenuButton";
import { NewThemeModal, type NewThemeModalResult } from "./NewThemeModal";
import "./StudioSidebarActions.css";

type NewKind = "theme";

interface NewEntry {
  kind: NewKind;
  icon: ReactNode;
  labelKey: string;
}

/** Item types that can be created from the "New" menu. Add entries to extend. */
const NEW_ENTRIES: NewEntry[] = [
  { kind: "theme", icon: <IconPlus />, labelKey: "new.theme" },
];

interface StudioSidebarActionsProps {
  /** Runs `go`, first leaving the Theme Editor if it is open. */
  runAfterLeavingEditor: (go: () => void) => void;
  openThemeEditor: (themeId: string) => void;
}

/** "New" and "Manage" menus pinned above the Studio sidebar's section list. */
export function StudioSidebarActions({
  runAfterLeavingEditor,
  openThemeEditor,
}: StudioSidebarActionsProps) {
  const { t } = useTranslation("studio");
  const createTheme = useThemeStore((s) => s.createTheme);
  const showErrorToast = useBackgroundTasksStore((s) => s.showErrorToast);
  const [themeModalOpen, setThemeModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const startNew = (kind: NewKind) => {
    runAfterLeavingEditor(() => {
      if (kind === "theme") setThemeModalOpen(true);
    });
  };

  const handleCreate = async (result: NewThemeModalResult) => {
    setCreating(true);
    try {
      const theme = await createTheme({ name: result.name });
      setThemeModalOpen(false);
      openThemeEditor(theme.id);
    } catch (err) {
      showErrorToast(themeCreateFailedPayload(err));
    } finally {
      setCreating(false);
    }
  };

  const runManage = (action: () => Promise<unknown>) => {
    setBusy(true);
    void action().finally(() => setBusy(false));
  };

  return (
    <div className="studio-sidebar-actions">
      <MenuButton
        ariaLabel={t("actions.newAria")}
        label={t("actions.new")}
        icon={<IconPlus />}
        className="studio-sidebar-actions__menu"
        triggerClassName="studio-sidebar-actions__trigger"
        variant="primary"
        size="sm"
        triggerPlacement="below-start"
      >
        {(close) =>
          NEW_ENTRIES.map((entry) => (
            <ContextMenuItem
              key={entry.kind}
              icon={entry.icon}
              label={t(entry.labelKey)}
              onClick={() => {
                close();
                startNew(entry.kind);
              }}
            />
          ))
        }
      </MenuButton>
      <MenuButton
        ariaLabel={t("actions.manageAria")}
        label={t("actions.manage")}
        icon={<IconSettings />}
        className="studio-sidebar-actions__menu"
        triggerClassName="studio-sidebar-actions__trigger"
        variant="secondary"
        size="sm"
        triggerPlacement="below-start"
        disabled={busy}
        layoutDeps={[busy]}
      >
        {(close) => (
          <>
            <ContextMenuItem
              icon={<IconImport />}
              label={t("actions.install")}
              onClick={() => {
                close();
                runManage(importItemWithRefresh);
              }}
            />
            <ContextMenuItem
              icon={<IconFolderLink />}
              label={t("actions.linkFolder")}
              onClick={() => {
                close();
                runManage(linkItemFolderWithRefresh);
              }}
            />
            <ContextMenuItem
              icon={<IconRefresh />}
              label={t("actions.reloadLinked")}
              onClick={() => {
                close();
                runManage(reloadLinkedItemsWithRefresh);
              }}
            />
          </>
        )}
      </MenuButton>

      <NewThemeModal
        open={themeModalOpen}
        creating={creating}
        onClose={() => setThemeModalOpen(false)}
        onCreate={(result) => void handleCreate(result)}
      />
    </div>
  );
}
