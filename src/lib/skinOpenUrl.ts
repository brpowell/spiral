import { ask, message } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { t } from "./i18n";

let inFlight = false;

function parseHttpUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

async function showBlockedLink(): Promise<void> {
  await message(t("dialogs:skinOpenUrl.blockedBody"), {
    title: t("dialogs:skinOpenUrl.blockedTitle"),
    kind: "error",
  });
}

/** Confirm then open a skin-provided URL in the OS browser. */
export async function confirmAndOpenSkinUrl(url: string): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const href = parseHttpUrl(url);
    if (!href) {
      await showBlockedLink();
      return;
    }

    const confirmed = await ask(t("dialogs:skinOpenUrl.body", { url: href }), {
      title: t("dialogs:skinOpenUrl.title"),
      kind: "warning",
      okLabel: t("dialogs:skinOpenUrl.open"),
      cancelLabel: t("common:cancel"),
    });
    if (!confirmed) return;

    await openUrl(href);
  } finally {
    inFlight = false;
  }
}
