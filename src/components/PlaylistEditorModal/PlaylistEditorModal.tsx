import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import {
  playlistArtCacheKey,
  resolvePlaylistImageMode,
} from "../../lib/playlistArt";
import { getPlaylistById, resolvePlaylistTracks } from "../../lib/playlists";
import { cacheArtFromFile, pickImageFile } from "../../lib/tauri";
import { useNavigationStore } from "../../store/useNavigationStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { usePlaylistStore } from "../../store/usePlaylistStore";
import type { Playlist, PlaylistImageMode } from "../../types/playlist";
import { PlaylistArt } from "../PlaylistArt/PlaylistArt";
import { Button } from "../common/Button/Button";
import { FormField } from "../common/Field/Field";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from "../common/Modal/Modal";
import { TextInput } from "../common/TextInput/TextInput";
import { Textarea } from "../common/Textarea/Textarea";
import "../PlaylistArt/PlaylistArt.css";
import "./PlaylistEditorModal.css";

export function PlaylistEditorModal() {
  const editingPlaylistId = usePlaylistStore((s) => s.editingPlaylistId);
  const playlists = usePlaylistStore((s) => s.playlists);
  const closePlaylistEditor = usePlaylistStore((s) => s.closePlaylistEditor);
  const createPlaylist = usePlaylistStore((s) => s.createPlaylist);
  const updatePlaylist = usePlaylistStore((s) => s.updatePlaylist);
  const openPlaylist = useNavigationStore((s) => s.openPlaylist);
  const library = usePlayerStore((s) => s.library);

  const isNew = editingPlaylistId === "new";
  const existing = useMemo(
    () =>
      typeof editingPlaylistId === "number"
        ? getPlaylistById(playlists, editingPlaylistId)
        : undefined,
    [editingPlaylistId, playlists],
  );

  const isOpen =
    editingPlaylistId != null && (isNew || existing != null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [imageMode, setImageMode] = useState<PlaylistImageMode>("generated");
  const [customImagePath, setCustomImagePath] = useState<string | null>(null);
  const [customImageSourcePath, setCustomImageSourcePath] = useState<
    string | null
  >(null);
  const [saving, setSaving] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, isOpen);

  const tracks = useMemo(
    () => (existing ? resolvePlaylistTracks(existing, library) : []),
    [existing, library],
  );

  useEffect(() => {
    if (!isOpen) return;
    if (isNew) {
      setTitle("Untitled Playlist");
      setDescription("");
      setImageMode("generated");
      setCustomImagePath(null);
      setCustomImageSourcePath(null);
    } else if (existing) {
      setTitle(existing.title);
      setDescription(existing.description ?? "");
      setImageMode(existing.imageMode);
      setCustomImagePath(existing.customImagePath);
      setCustomImageSourcePath(null);
    }
  }, [isOpen, isNew, existing]);

  const previewPlaylist: Playlist = useMemo(() => {
    const pendingCustomPath =
      imageMode === "custom"
        ? customImagePath ?? customImageSourcePath
        : null;
    return {
      id: existing?.id ?? 0,
      title: title.trim() || "Untitled Playlist",
      description: description.trim() || null,
      dateCreated: existing?.dateCreated ?? "",
      lastUsedAt: existing?.lastUsedAt ?? "",
      trackIds: existing?.trackIds ?? [],
      imageMode: resolvePlaylistImageMode(imageMode, pendingCustomPath),
      customImagePath: pendingCustomPath,
    };
  }, [
    existing,
    title,
    description,
    imageMode,
    customImagePath,
    customImageSourcePath,
  ]);

  const handleClose = useCallback(() => {
    if (saving) return;
    closePlaylistEditor();
  }, [saving, closePlaylistEditor]);

  const handlePickImage = useCallback(async () => {
    const picked = await pickImageFile();
    if (!picked) return;

    setImageMode("custom");
    if (typeof editingPlaylistId === "number") {
      try {
        const cached = await cacheArtFromFile(
          picked,
          playlistArtCacheKey(editingPlaylistId),
        );
        setCustomImagePath(cached);
        setCustomImageSourcePath(null);
      } catch {
        setCustomImageSourcePath(picked);
        setCustomImagePath(null);
      }
    } else {
      setCustomImageSourcePath(picked);
      setCustomImagePath(null);
    }
  }, [editingPlaylistId]);

  const resolveImageForSave = useCallback(
    async (playlistId: number) => {
      const mode = resolvePlaylistImageMode(imageMode, customImagePath);
      if (mode !== "custom") {
        return { imageMode: "generated" as const, customImagePath: null };
      }

      if (customImagePath) {
        return { imageMode: "custom" as const, customImagePath };
      }

      if (customImageSourcePath) {
        const cached = await cacheArtFromFile(
          customImageSourcePath,
          playlistArtCacheKey(playlistId),
        );
        return { imageMode: "custom" as const, customImagePath: cached };
      }

      return { imageMode: "generated" as const, customImagePath: null };
    },
    [imageMode, customImagePath, customImageSourcePath],
  );

  const handleSave = useCallback(async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    setSaving(true);
    try {
      const desc = description.trim() || null;
      if (isNew) {
        const id = await createPlaylist(trimmedTitle, desc, {
          imageMode: "generated",
          customImagePath: null,
        });
        const image = await resolveImageForSave(id);
        if (
          image.imageMode !== "generated" ||
          image.customImagePath != null
        ) {
          await updatePlaylist(id, trimmedTitle, desc, image);
        }
        openPlaylist(id);
      } else if (typeof editingPlaylistId === "number") {
        const image = await resolveImageForSave(editingPlaylistId);
        await updatePlaylist(editingPlaylistId, trimmedTitle, desc, image);
      }
      closePlaylistEditor();
    } finally {
      setSaving(false);
    }
  }, [
    title,
    description,
    isNew,
    editingPlaylistId,
    createPlaylist,
    updatePlaylist,
    openPlaylist,
    closePlaylistEditor,
    resolveImageForSave,
  ]);

  const titleId = "playlist-editor-title";
  const showCustomActions = imageMode === "custom";

  return (
    <Modal
      open={isOpen}
      onClose={handleClose}
      size="sm"
      panelRef={panelRef}
      labelledBy={titleId}
    >
      <ModalHeader>
        <ModalTitle id={titleId}>
          {isNew ? "New Playlist" : "Edit Playlist"}
        </ModalTitle>
      </ModalHeader>

      <ModalBody>
        <FormField label="Cover">
          <div className="playlist-editor__image-section">
            <div className="playlist-editor__preview-row">
              <div className="playlist-editor__preview">
                <PlaylistArt
                  playlist={previewPlaylist}
                  tracks={tracks}
                  className="playlist-art--editor"
                />
              </div>
              <div className="playlist-editor__image-actions">
                <div
                  className="playlist-editor__segmented"
                  role="radiogroup"
                  aria-label="Cover image source"
                >
                  <label className="playlist-editor__segment">
                    <input
                      type="radio"
                      name="playlist-image-mode"
                      value="generated"
                      checked={imageMode === "generated"}
                      onChange={() => setImageMode("generated")}
                    />
                    From playlist
                  </label>
                  <label className="playlist-editor__segment">
                    <input
                      type="radio"
                      name="playlist-image-mode"
                      value="custom"
                      checked={imageMode === "custom"}
                      onChange={() => setImageMode("custom")}
                    />
                    Custom image
                  </label>
                </div>
                {showCustomActions ? (
                  <Button
                    size="sm"
                    onClick={() => void handlePickImage()}
                  >
                    Choose Image
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </FormField>

        <FormField label="Title">
          <TextInput
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSave();
            }}
            autoFocus
          />
        </FormField>
        <FormField label="Description">
          <Textarea
            value={description}
            rows={3}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional"
          />
        </FormField>
      </ModalBody>

      <ModalFooter onCancel={handleClose} cancelDisabled={saving}>
        <Button
          variant="primary"
          size="md"
          onClick={() => void handleSave()}
          disabled={saving || !title.trim()}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
