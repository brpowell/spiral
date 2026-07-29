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
  const busy = revealing || exporting || replacing || disabled;

  return (
    <MenuButton
      className={className}
      ariaLabel="Manage Card"
      label="Manage Card"
      layoutDeps={[revealing, exporting, replacing, disabled]}
    >
      {(close) => (
        <>
          <ContextMenuItem
            icon={<IconOpenFolder />}
            label={
              revealing ? "Revealing…" : revealInFileManagerLabel()
            }
            disabled={busy}
            onClick={() => {
              close();
              onReveal();
            }}
          />
          <ContextMenuItem
            icon={<IconSquareExport />}
            label={exporting ? "Exporting…" : "Export Card…"}
            disabled={busy}
            onClick={() => {
              close();
              onExport();
            }}
          />
          <ContextMenuItem
            icon={<IconReplace />}
            label={replacing ? "Installing…" : "Replace Card…"}
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
