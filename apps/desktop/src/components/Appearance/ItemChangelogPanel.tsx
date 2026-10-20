import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { RELOAD_LINKED_PACKS_EVENT } from "../../lib/appearanceWindow";
import {
  invalidatePackChangelogCache,
  peekPackChangelog,
  prefetchPackChangelog,
  setPackChangelogCache,
} from "../../lib/packs/packChangelogCache";
import { WORKSHOP_CHANGED_EVENT } from "../../lib/themeBridge";
import { writeItemChangelog } from "../../lib/tauri";
import { isEditablePackZone } from "../../types/pack";
import type { ItemSummary } from "../../types/item";
import { Button } from "../common/Button/Button";
import { Textarea } from "../common/Textarea/Textarea";
import { MarkdownBody } from "../common/MarkdownBody/MarkdownBody";

type ChangelogLoadState = "loading" | "ready" | "error";

function changelogStateFromCache(packDir: string): {
  changelog: string | null;
  loadState: ChangelogLoadState;
} {
  const entry = peekPackChangelog(packDir);
  if (entry?.status === "ready") {
    return { changelog: entry.value, loadState: "ready" };
  }
  if (entry?.status === "error") {
    return { changelog: null, loadState: "error" };
  }
  return { changelog: null, loadState: "loading" };
}

export function ItemChangelogPanel({
  item,
  busy,
  onPresenceChange,
}: {
  item: Pick<ItemSummary, "dir" | "zone">;
  busy: boolean;
  onPresenceChange?: (present: boolean) => void;
}) {
  const { t } = useTranslation("studio");
  const canEdit = isEditablePackZone(item.zone);
  const initial = changelogStateFromCache(item.dir);
  const [changelog, setChangelog] = useState<string | null>(initial.changelog);
  const [loadState, setLoadState] = useState<ChangelogLoadState>(
    initial.loadState,
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const reportPresence = useCallback(
    (value: string | null) => {
      onPresenceChange?.(Boolean(value?.trim()));
    },
    [onPresenceChange],
  );

  const loadChangelog = useCallback(
    async (opts?: { silent?: boolean; force?: boolean }) => {
      if (opts?.force) {
        invalidatePackChangelogCache(item.dir);
      }
      const existing = peekPackChangelog(item.dir);
      if (!opts?.silent && existing?.status !== "ready") {
        setLoadState("loading");
      }
      try {
        const text = await prefetchPackChangelog(item.dir);
        const cached = peekPackChangelog(item.dir);
        const next = cached?.status === "ready" ? cached.value : text;
        setChangelog(next);
        setLoadState("ready");
        reportPresence(next);
      } catch (err) {
        console.error("Failed to load CHANGELOG:", err);
        setChangelog(null);
        setLoadState("error");
        reportPresence(null);
      }
    },
    [item.dir, reportPresence],
  );

  useEffect(() => {
    setEditing(false);
    setSaveError(null);
    const cached = changelogStateFromCache(item.dir);
    setChangelog(cached.changelog);
    setLoadState(cached.loadState);
    void loadChangelog({ silent: cached.loadState === "ready" });
  }, [loadChangelog, item.dir]);

  useEffect(() => {
    const event =
      item.zone === "workshop"
        ? WORKSHOP_CHANGED_EVENT
        : item.zone === "linked"
          ? RELOAD_LINKED_PACKS_EVENT
          : null;
    if (event == null) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen(event, () => {
      if (editing) return;
      void loadChangelog({ silent: true, force: true });
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [editing, loadChangelog, item.zone]);

  const startEditing = () => {
    setDraft(changelog ?? "");
    setSaveError(null);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setSaveError(null);
    setDraft("");
  };

  const saveChangelog = async () => {
    if (!canEdit || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await writeItemChangelog(item.dir, draft);
      const next = draft.trim().length > 0 ? draft : null;
      setPackChangelogCache(item.dir, next);
      setChangelog(next);
      reportPresence(next);
      setEditing(false);
      setDraft("");
    } catch (err) {
      console.error("Failed to save CHANGELOG:", err);
      setSaveError(
        err instanceof Error ? err.message : t("catalog.changelogSaveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  if (editing && canEdit) {
    return (
      <div className="installed-packs__about">
        <div className="installed-packs__about-toolbar">
          <span className="installed-packs__about-toolbar-label">
            {t("catalog.changelogEditing")}
          </span>
          <div className="installed-packs__about-toolbar-actions">
            <Button
              variant="ghost"
              disabled={saving || busy}
              onClick={cancelEditing}
            >
              {t("catalog.changelogCancel")}
            </Button>
            <Button
              variant="primary"
              disabled={saving || busy}
              onClick={() => void saveChangelog()}
            >
              {saving
                ? t("catalog.changelogSaving")
                : t("catalog.changelogSave")}
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
          placeholder={t("catalog.changelogPlaceholder")}
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
        <p className="appearance-section__status">
          {t("catalog.changelogLoading")}
        </p>
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className="installed-packs__about">
        <p className="appearance-section__status">
          {t("catalog.changelogLoadFailed")}
        </p>
        {canEdit ? (
          <Button variant="ghost" disabled={busy} onClick={startEditing}>
            {t("catalog.changelogEdit")}
          </Button>
        ) : null}
      </div>
    );
  }

  if (changelog == null || changelog.trim().length === 0) {
    return (
      <div className="installed-packs__about">
        <div className="installed-packs__about-empty">
          <p className="appearance-section__status">
            {t("catalog.changelogEmpty")}
          </p>
          {canEdit ? (
            <Button variant="secondary" disabled={busy} onClick={startEditing}>
              {t("catalog.changelogAdd")}
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
            {t("catalog.changelogLabel")}
          </span>
          <div className="installed-packs__about-toolbar-actions">
            <Button variant="ghost" disabled={busy} onClick={startEditing}>
              {t("catalog.changelogEditAction")}
            </Button>
          </div>
        </div>
      ) : null}
      <MarkdownBody source={changelog} />
    </div>
  );
}
