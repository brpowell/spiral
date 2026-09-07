import { useCallback, useEffect, useState } from "react";
import {
  sharedArtPath,
  trackEditorFormsEqual,
  tracksToForm,
  type TrackEditorForm,
  type TrackEditorFormField,
} from "../lib/trackMetadataForm";
import type { Track } from "../types/track";
import type { CanonicalRating } from "../lib/trackRating";

/**
 * Details-form state for CdTrackEditor (and reusable if library TrackEditor
 * is later split the same way). Callers own save / art persistence.
 */
export function useTrackMetadataForm(tracks: Track[], resetKey: string) {
  const [form, setForm] = useState<TrackEditorForm | null>(null);
  const [originalForm, setOriginalForm] = useState<TrackEditorForm | null>(
    null,
  );
  const [pendingArtPath, setPendingArtPath] = useState<string | null>(null);
  const [originalArtPath, setOriginalArtPath] = useState<string | null>(null);
  const [artSourcePath, setArtSourcePath] = useState<string | null>(null);
  const [selectedCoverUrl, setSelectedCoverUrl] = useState<string | null>(null);

  useEffect(() => {
    if (tracks.length === 0) {
      setForm(null);
      setOriginalForm(null);
      return;
    }
    const initial = tracksToForm(tracks);
    const initialArt = sharedArtPath(tracks);
    setForm(initial);
    setOriginalForm(initial);
    setPendingArtPath(initialArt);
    setOriginalArtPath(initialArt);
    setArtSourcePath(null);
    setSelectedCoverUrl(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key-gated form reset
  }, [resetKey]);

  const artChanged =
    pendingArtPath !== originalArtPath ||
    selectedCoverUrl != null ||
    artSourcePath != null;

  const hasChanges =
    form != null &&
    originalForm != null &&
    (!trackEditorFormsEqual(form, originalForm) || artChanged);

  const setField = useCallback((field: TrackEditorFormField, value: string) => {
    setForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  }, []);

  const setRating = useCallback((rating: CanonicalRating) => {
    setForm((prev) => (prev ? { ...prev, rating } : prev));
  }, []);

  return {
    form,
    setForm,
    originalForm,
    setOriginalForm,
    pendingArtPath,
    setPendingArtPath,
    originalArtPath,
    setOriginalArtPath,
    artSourcePath,
    setArtSourcePath,
    selectedCoverUrl,
    setSelectedCoverUrl,
    artChanged,
    hasChanges,
    setField,
    setRating,
  };
}
