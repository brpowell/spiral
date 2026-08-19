import { useTranslation } from "react-i18next";
import { revealInFileManagerLabel } from "../../lib/fileManager";
import { ContextMenuItem } from "../ContextMenu/ContextMenu";
import { IconOpenFolder, IconReplace, IconSquareExport } from "../icons";
import { MenuButton } from "../MenuButton/MenuButton";

export interface SpiralCardActionsMenuProps {
  revealing: boolean;
  exporting: boolean;
  replacing: boolean;
  disabled?: boolean;
  className?: string;
  onReveal: () => void;
  onExport: () => void;
  onReplace: () => void;
}

export function SpiralCardActionsMenu({
  revealing,
  exporting,
  replacing,
  disabled = false,
  className,
  onReveal,
  onExport,
  onReplace,
}: SpiralCardActionsMenuProps) {
  const { t } = useTranslation("common");
  const busy = revealing || exporting || replacing || disabled;

  return (
    <MenuButton
      className={className}
      ariaLabel={t("spiralCard.manage")}
      label={t("spiralCard.manage")}
      layoutDeps={[revealing, exporting, replacing, disabled]}
    >
      {(close) => (
        <>
          <ContextMenuItem
            icon={<IconOpenFolder />}
            label={
              revealing ? t("spiralCard.revealing") : revealInFileManagerLabel()
            }
            disabled={busy}
            onClick={() => {
              close();
              onReveal();
            }}
          />
          <ContextMenuItem
            icon={<IconSquareExport />}
            label={
              exporting ? t("spiralCard.exporting") : t("spiralCard.export")
            }
            disabled={busy}
            onClick={() => {
              close();
              onExport();
            }}
          />
          <ContextMenuItem
            icon={<IconReplace />}
            label={
              replacing ? t("spiralCard.installing") : t("spiralCard.replace")
            }
            disabled={busy}
            onClick={() => {
              close();
              onReplace();
            }}
          />
        </>
      )}
    </MenuButton>
  );
}
