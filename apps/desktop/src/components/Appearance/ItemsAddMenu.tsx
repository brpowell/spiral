import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  importItemWithRefresh,
  linkItemFolderWithRefresh,
  reloadLinkedItemsWithRefresh,
} from "../../lib/items/itemActions";
import { ContextMenuItem } from "../ContextMenu/ContextMenu";
import { IconFolderLink, IconImport, IconRefresh } from "../icons";
import { MenuButton } from "../MenuButton/MenuButton";

/** Section-header menu for bringing items in from outside: import, link, reload. */
export function ItemsAddMenu() {
  const { t } = useTranslation("studio");
  const [busy, setBusy] = useState(false);

  const run = (action: () => Promise<unknown>) => {
    setBusy(true);
    void action().finally(() => setBusy(false));
  };

  return (
    <MenuButton
      ariaLabel={t("items.addAria")}
      label={t("items.add")}
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
            label={t("items.import")}
            disabled={busy}
            onClick={() => {
              close();
              run(importItemWithRefresh);
            }}
          />
          <ContextMenuItem
            icon={<IconFolderLink />}
            label={t("items.linkFolder")}
            disabled={busy}
            onClick={() => {
              close();
              run(linkItemFolderWithRefresh);
            }}
          />
          <ContextMenuItem
            icon={<IconRefresh />}
            label={t("items.reloadLinked")}
            disabled={busy}
            onClick={() => {
              close();
              run(reloadLinkedItemsWithRefresh);
            }}
          />
        </>
      )}
    </MenuButton>
  );
}
