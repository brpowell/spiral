import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  invalidatePackReadmeCache,
  peekPackReadme,
  prefetchPackReadme,
  setPackReadmeCache,
} from "../../lib/packs/packReadmeCache";
import { WORKSHOP_CHANGED_EVENT } from "../../lib/themeBridge";
import { writePackReadme } from "../../lib/tauri";
import {
  isAuthoringPackZone,
  type PackSummary,
} from "../../types/pack";
import { Button } from "../common/Button/Button";
import { Textarea } from "../common/Textarea/Textarea";
import { PackReadmeMarkdown } from "./PackReadmeMarkdown";

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

export function PackAboutPanel({
  pack,
  busy,
}: {
  pack: PackSummary;
  busy: boolean;
}) {
  const canEdit = isAuthoringPackZone(pack.zone);
  const initial = readmeStateFromCache(pack.packDir);
  const [readme, setReadme] = useState<string | null>(initial.readme);
  const [loadState, setLoadState] = useState<ReadmeLoadState>(initial.loadState);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadReadme = useCallback(
    async (opts?: { silent?: boolean; force?: boolean }) => {
      if (opts?.force) {
        invalidatePackReadmeCache(pack.packDir);
      }
      const existing = peekPackReadme(pack.packDir);
      if (!opts?.silent && existing?.status !== "ready") {
        setLoadState("loading");
      }
      try {
        const text = await prefetchPackReadme(pack.packDir);
        const cached = peekPackReadme(pack.packDir);
        setReadme(cached?.status === "ready" ? cached.value : text);
        setLoadState("ready");
      } catch (err) {
        console.error("Failed to load pack README:", err);
        setReadme(null);
        setLoadState("error");
      }
    },
    [pack.packDir],
  );

  useEffect(() => {
    setEditing(false);
    setSaveError(null);
    const cached = readmeStateFromCache(pack.packDir);
    setReadme(cached.readme);
    setLoadState(cached.loadState);
    void loadReadme({ silent: cached.loadState === "ready" });
  }, [loadReadme, pack.packDir]);

  useEffect(() => {
    // File-watch live reload is workshop-only; linked packs use Reload Linked Packs.
    if (pack.zone !== "workshop") return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen(WORKSHOP_CHANGED_EVENT, () => {
      if (editing) return;
      void loadReadme({ silent: true, force: true });
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
  }, [editing, loadReadme, pack.zone]);

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
      await writePackReadme(pack.packDir, draft);
      const next = draft.trim().length > 0 ? draft : null;
      setPackReadmeCache(pack.packDir, next);
      setReadme(next);
      setEditing(false);
      setDraft("");
    } catch (err) {
      console.error("Failed to save pack README:", err);
      setSaveError(
        err instanceof Error ? err.message : "Failed to save README.",
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
            Editing README.md
          </span>
          <div className="installed-packs__about-toolbar-actions">
            <Button
              variant="ghost"
              disabled={saving || busy}
              onClick={cancelEditing}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={saving || busy}
              onClick={() => void saveReadme()}
            >
              {saving ? "Saving…" : "Save"}
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
          placeholder="Write a README for this pack (Markdown supported)."
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
        <p className="appearance-section__status">Loading README…</p>
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className="installed-packs__about">
        <p className="appearance-section__status">Couldn’t load README.</p>
        {canEdit ? (
          <Button variant="ghost" disabled={busy} onClick={startEditing}>
            Edit README
          </Button>
        ) : null}
      </div>
    );
  }

  if (readme == null || readme.trim().length === 0) {
    return (
      <div className="installed-packs__about">
        <div className="installed-packs__about-empty">
          <p className="appearance-section__status">No README.</p>
          {canEdit ? (
            <Button variant="secondary" disabled={busy} onClick={startEditing}>
              Add README
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
          <span className="installed-packs__about-toolbar-label">README</span>
          <div className="installed-packs__about-toolbar-actions">
            <Button variant="ghost" disabled={busy} onClick={startEditing}>
              Edit
            </Button>
          </div>
        </div>
      ) : null}
      <PackReadmeMarkdown source={readme} />
    </div>
  );
}
