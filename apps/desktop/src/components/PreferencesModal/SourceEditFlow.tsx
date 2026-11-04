import { useMemo, useState } from "react";
import {
  GENERIC_ORGANIZE_PATH_SAMPLE,
  trackToOrganizePathSample,
} from "../../lib/organizePathFormat";
import { organizeInBackground } from "../../lib/organizeSource";
import {
  relocateSource,
  setSourceOrganize,
  setSourcePathFormat,
} from "../../lib/tauri";
import { useLibrarySettingsStore } from "../../store/useLibrarySettingsStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useSourcesStore } from "../../store/useSourcesStore";
import type { Source } from "../../types/source";
import { SourceEditDialog, type SourceEdits } from "./SourceEditDialog";

interface SourceEditFlowProps {
  /** The source being edited; null keeps the dialog closed. */
  source: Source | null;
  onClose: () => void;
  /** Before the edits apply, e.g. to clear an earlier error. */
  onSaving?: () => void;
  /** After the edits applied and sources reloaded. */
  onSaved?: () => Promise<void> | void;
  /**
   * Only record organize and format changes, never move files now (the
   * caller organizes later, as onboarding does once it finishes).
   */
  deferOrganize?: boolean;
  /**
   * Set when the source was just added: the dialog becomes "Add music
   * source", and cancelling closes it and calls this to take the source back
   * out. Keep it set until the next source opens, so the dialog keeps its
   * add wording while it animates closed.
   */
  onCancelAdd?: (source: Source) => void;
}

/**
 * The Edit music source dialog and what Save does with it, shared by
 * Preferences and onboarding. Changes apply at once; turning organize on, or
 * a new format for an organized source, then moves the files in the
 * background, with a toast only when something actually moves.
 */
export function SourceEditFlow({
  source,
  onClose,
  onSaving,
  onSaved,
  deferOrganize = false,
  onCancelAdd,
}: SourceEditFlowProps) {
  // The last source shown, which a cancelled add removes after it closed.
  const [shown, setShown] = useState<Source | null>(source);
  if (source && source !== shown) setShown(source);
  const loadSources = useSourcesStore((s) => s.loadSources);
  const applySource = useSourcesStore((s) => s.applySource);
  const library = usePlayerStore((s) => s.library);
  const defaultFormat = useLibrarySettingsStore(
    (s) => s.settings?.defaultOrganizePathFormat ?? "",
  );
  const adding = onCancelAdd != null;

  const saveEdits = async (editing: Source, edits: SourceEdits) => {
    onSaving?.();
    let current = editing;
    if (edits.rootPath) {
      current = await relocateSource(editing.id, edits.rootPath);
    }
    if (edits.autoOrganize !== undefined) {
      current = await setSourceOrganize(editing.id, edits.autoOrganize);
    }
    const formatChanged = edits.pathFormat !== undefined;
    if (formatChanged) {
      current = await setSourcePathFormat(editing.id, edits.pathFormat ?? null);
    }
    applySource(current);
    await loadSources();
    await onSaved?.();

    const organize =
      current.autoOrganize && (edits.autoOrganize === true || formatChanged);
    if (organize && !deferOrganize) {
      // A folder just added is still being scanned: finish that first, so
      // every file it holds gets organized.
      void organizeInBackground([{ source: current }], { scanFirst: adding });
    }
  };

  /** One of the source's own tracks, so the format preview looks familiar. */
  const previewSample = useMemo(() => {
    const track = source
      ? library.find((t) => t.sourceId === source.id)
      : undefined;
    return track
      ? trackToOrganizePathSample(track)
      : GENERIC_ORGANIZE_PATH_SAMPLE;
  }, [source, library]);

  return (
    <SourceEditDialog
      source={source}
      defaultFormat={defaultFormat}
      previewSample={previewSample}
      onClose={onClose}
      onSave={saveEdits}
      onCancelAdd={
        onCancelAdd && shown
          ? () => {
              onClose();
              onCancelAdd(shown);
            }
          : undefined
      }
    />
  );
}
