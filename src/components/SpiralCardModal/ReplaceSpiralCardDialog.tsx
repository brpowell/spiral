import {
  cancelPendingSpcardReplace,
  confirmPendingSpcardReplace,
} from "../../lib/spcardInstall";
import { useLicenseStore } from "../../store/useLicenseStore";
import { AlertConfirmation } from "../common/AlertConfirmation/AlertConfirmation";

export function ReplaceSpiralCardDialog() {
  const pendingReplacePath = useLicenseStore((s) => s.pendingReplacePath);
  const open = pendingReplacePath != null;

  return (
    <AlertConfirmation
      open={open}
      onClose={cancelPendingSpcardReplace}
      title="Replace Spiral Card?"
      titleId="replace-spiral-card-title"
      confirmLabel="Replace Card"
      onConfirm={confirmPendingSpcardReplace}
    >
      <p>
        The current license and design will be replaced by the new one.
      </p>
    </AlertConfirmation>
  );
}
