import { useTranslation } from "react-i18next";
import { revealInFileManagerLabel } from "../../lib/fileManager";
import { Button } from "../common/Button/Button";
import { ButtonGroup } from "../common/ButtonGroup/ButtonGroup";
import { IconOpenFolder, IconReplace } from "../icons";

export interface SpiralCardActionsProps {
  revealing: boolean;
  replacing: boolean;
  disabled?: boolean;
  onReveal: () => void;
  onReplace: () => void;
}

export function SpiralCardActions({
  revealing,
  replacing,
  disabled = false,
  onReveal,
  onReplace,
}: SpiralCardActionsProps) {
  const { t } = useTranslation("common");
  const busy = revealing || replacing || disabled;

  return (
    <ButtonGroup className="spiral-card-modal__actions">
      <Button variant="secondary" size="sm" disabled={busy} onClick={onReveal}>
        <IconOpenFolder />
        {revealing ? t("spiralCard.revealing") : revealInFileManagerLabel()}
      </Button>
      <Button variant="secondary" size="sm" disabled={busy} onClick={onReplace}>
        <IconReplace />
        {replacing ? t("spiralCard.installing") : t("spiralCard.replace")}
      </Button>
    </ButtonGroup>
  );
}
