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
import { SidebarList, SidebarSection } from "../layout/SidebarChrome";
import { SidebarMenuItem } from "../layout/SidebarItem/SidebarMenuItem";
import { NewThemeModal, type NewThemeModalResult } from "./NewThemeModal";

type NewKind = "theme";

interface NewEntry {
  kind: NewKind;
  labelKey: string;
}

/** Item types that can be created from the "Create" menu. Add entries to extend. */
const NEW_ENTRIES: NewEntry[] = [{ kind: "theme", labelKey: "create.theme" }];

interface StudioSidebarActionsProps {
  /** Runs `go`, first leaving the Theme Editor if it is open. */
  runAfterLeavingEditor: (go: () => void) => void;
  openThemeEditor: (themeId: string) => void;
  /** Extra sidebar entries rendered directly under the Manage menu. */
  children?: ReactNode;
}

/** "New" and "Manage" menus pinned above the Studio sidebar's section list. */
export function StudioSidebarActions({
  runAfterLeavingEditor,
  openThemeEditor,
  children,
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
    <SidebarSection
      aria-label={t("actions.aria")}
      className="appearance-shell__sidebar-section--first"
    >
      <SidebarList>
        <li>
          <SidebarMenuItem
            icon={<IconPlus />}
            ariaLabel={t("actions.createAria")}
            menu={(close) =>
              NEW_ENTRIES.map((entry) => (
                <ContextMenuItem
                  key={entry.kind}
                  label={t(entry.labelKey)}
                  onClick={() => {
                    close();
                    startNew(entry.kind);
                  }}
                />
              ))
            }
          >
            {t("actions.create")}
          </SidebarMenuItem>
        </li>
        <li>
          <SidebarMenuItem
            icon={<IconSettings />}
            ariaLabel={t("actions.manageAria")}
            disabled={busy}
            layoutDeps={[busy]}
            menu={(close) => (
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
          >
            {t("actions.manage")}
          </SidebarMenuItem>
        </li>
        {children}
      </SidebarList>

      <NewThemeModal
        open={themeModalOpen}
        creating={creating}
        onClose={() => setThemeModalOpen(false)}
        onCreate={(result) => void handleCreate(result)}
      />
    </SidebarSection>
  );
}
