import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { RELOAD_LINKED_PACKS_EVENT } from "../../lib/appearanceWindow";
import {
  invalidatePackReadmeCache,
  peekPackReadme,
  prefetchPackReadme,
  setPackReadmeCache,
} from "../../lib/packs/packReadmeCache";
import { LIBRARY_PACKS_CHANGED_EVENT } from "../../lib/themeBridge";
import { writeItemReadme } from "../../lib/tauri";
import { isEditablePackZone } from "../../types/pack";
import type { ItemSummary } from "../../types/item";
import { Button } from "../common/Button/Button";
import { Textarea } from "../common/Textarea/Textarea";
import { MarkdownBody } from "../common/MarkdownBody/MarkdownBody";

type ReadmeLoadState = "loading" | "ready" | "error";

function readmeStateFromCache(packDir: string): {
  readme: string | null;
  loadState: ReadmeLoadState;
} {
  const entry = peekPackReadme(packDir);
  if (entry?.status === "ready") {
    return { readme: entry.value, loadState: "ready" };
  }
  if (entry?.status === "error") {
    return { readme: null, loadState: "error" };
  }
  return { readme: null, loadState: "loading" };
}

export function ItemAboutPanel({
  item,
  busy,
}: {
  item: Pick<ItemSummary, "dir" | "zone">;
  busy: boolean;
}) {
  const { t } = useTranslation(["studio", "common"]);
  const canEdit = isEditablePackZone(item.zone);
  const initial = readmeStateFromCache(item.dir);
  const [readme, setReadme] = useState<string | null>(initial.readme);
  const [loadState, setLoadState] = useState<ReadmeLoadState>(
    initial.loadState,
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadReadme = useCallback(
    async (opts?: { silent?: boolean; force?: boolean }) => {
      if (opts?.force) {
        invalidatePackReadmeCache(item.dir);
      }
      const existing = peekPackReadme(item.dir);
      if (!opts?.silent && existing?.status !== "ready") {
        setLoadState("loading");
      }
      try {
        const text = await prefetchPackReadme(item.dir);
        const cached = peekPackReadme(item.dir);
        setReadme(cached?.status === "ready" ? cached.value : text);
        setLoadState("ready");
      } catch (err) {
        console.error("Failed to load README:", err);
        setReadme(null);
        setLoadState("error");
      }
    },
    [item.dir],
  );

  useEffect(() => {
    setEditing(false);
    setSaveError(null);
    const cached = readmeStateFromCache(item.dir);
    setReadme(cached.readme);
    setLoadState(cached.loadState);
    void loadReadme({ silent: cached.loadState === "ready" });
  }, [loadReadme, item.dir]);

  useEffect(() => {
    // Items under the Library's Packs folder are file-watched; other linked folders reload on
    // "Reload Linked Packs". Either may apply to any linked item.
    if (item.zone !== "linked") return;
    let disposed = false;
    const unlisteners: (() => void)[] = [];
    for (const event of [
      LIBRARY_PACKS_CHANGED_EVENT,
      RELOAD_LINKED_PACKS_EVENT,
    ]) {
      void listen(event, () => {
        if (editing) return;
        void loadReadme({ silent: true, force: true });
      }).then((fn) => {
        if (disposed) {
          fn();
          return;
        }
        unlisteners.push(fn);
      });
    }
    return () => {
      disposed = true;
      for (const unlisten of unlisteners) unlisten();
    };
  }, [editing, loadReadme, item.zone]);

  const startEditing = () => {
    setDraft(readme ?? "");
    setSaveError(null);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setSaveError(null);
    setDraft("");
  };

  const saveReadme = async () => {
    if (!canEdit || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await writeItemReadme(item.dir, draft);
      const next = draft.trim().length > 0 ? draft : null;
      setPackReadmeCache(item.dir, next);
      setReadme(next);
      setEditing(false);
      setDraft("");
    } catch (err) {
      console.error("Failed to save README:", err);
      setSaveError(err instanceof Error ? err.message : t("about.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (editing && canEdit) {
    return (
      <div className="installed-packs__about">
        <div className="installed-packs__about-toolbar">
          <span className="installed-packs__about-toolbar-label">
            {t("about.editing")}
          </span>
          <div className="installed-packs__about-toolbar-actions">
            <Button
              variant="ghost"
              disabled={saving || busy}
              onClick={cancelEditing}
            >
              {t("common:cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={saving || busy}
              onClick={() => void saveReadme()}
            >
              {saving ? t("common:saving") : t("common:save")}
            </Button>
          </div>
        </div>
        <Textarea
          className="installed-packs__about-editor"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={14}
          disabled={saving || busy}
          spellCheck
          placeholder={t("about.placeholder")}
          autoFocus
          autoSize
        />
        {saveError ? (
          <p className="installed-packs__about-error" role="alert">
            {saveError}
          </p>
        ) : null}
      </div>
    );
  }

  if (loadState === "loading") {
    return (
      <div className="installed-packs__about">
        <p className="appearance-section__status">{t("about.loading")}</p>
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className="installed-packs__about">
        <p className="appearance-section__status">{t("about.loadFailed")}</p>
        {canEdit ? (
          <Button variant="ghost" disabled={busy} onClick={startEditing}>
            {t("about.edit")}
          </Button>
        ) : null}
      </div>
    );
  }

  if (readme == null || readme.trim().length === 0) {
    return (
      <div className="installed-packs__about">
        <div className="installed-packs__about-empty">
          <p className="appearance-section__status">{t("about.empty")}</p>
          {canEdit ? (
            <Button variant="secondary" disabled={busy} onClick={startEditing}>
              {t("about.add")}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="installed-packs__about">
      {canEdit ? (
        <div className="installed-packs__about-toolbar">
          <span className="installed-packs__about-toolbar-label">
            {t("about.label")}
          </span>
          <div className="installed-packs__about-toolbar-actions">
            <Button variant="ghost" disabled={busy} onClick={startEditing}>
              {t("common:edit")}
            </Button>
          </div>
        </div>
      ) : null}
      <MarkdownBody source={readme} />
    </div>
  );
}
