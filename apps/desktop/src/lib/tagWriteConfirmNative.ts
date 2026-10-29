import { message } from "@tauri-apps/plugin-dialog";
import { useTagWriteConfirmStore } from "../store/useTagWriteConfirmStore";
import { t } from "./i18n";
import type { TagWriteContext } from "./tagWriteConfirmPreferences";

let inFlight = false;

/**
 * Native-dialog twin of `useTagWriteConfirmStore.confirmTagWrite`, for surfaces
 * (skins) where the in-app modal doesn't fit. Shares the same "don't ask again"
 * state, offered as a second confirm button since native dialogs have no
 * checkbox. Resolves false if cancelled or another prompt is already open.
 */
export async function confirmTagWriteNative(
  context: TagWriteContext,
  fileCount: number,
): Promise<boolean> {
  const store = useTagWriteConfirmStore.getState();
  if (store.dismissed[context]) return true;
  if (inFlight) return false;
  inFlight = true;
  try {
    const save = t("dialogs:tagWrite.native.save");
    const saveDontAsk = t("dialogs:tagWrite.native.saveDontAsk");
    const answer = await message(
      `${t(`dialogs:tagWrite.message.${context}`, { count: fileCount })}\n\n${t("dialogs:tagWrite.backup")}`,
      {
        title: t("dialogs:tagWrite.title", { count: fileCount }),
        kind: "warning",
        buttons: {
          yes: save,
          no: saveDontAsk,
          cancel: t("common:cancel"),
        },
      },
    );
    if (answer === saveDontAsk) {
      store.dismissContext(context);
      return true;
    }
    return answer === save;
  } finally {
    inFlight = false;
  }
}
