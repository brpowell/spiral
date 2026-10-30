import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useEditorDiscardPrompt } from "../../hooks/useEditorDiscardPrompt";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useResetOnOpen } from "../../hooks/useResetOnOpen";
import { t } from "../../lib/i18n";
import { cropsEqual, type ImageCrop } from "../../lib/imageCrop";
import { resolvePlaylistDesignFields } from "../../lib/playlistArt";
import {
  DEFAULT_PLAYLIST_COVER_GRADIENT_END,
  defaultPlaylistDesignCover,
  randomPlaylistCoverColors,
} from "../../lib/playlistCoverPresets";
import { getPlaylistById, resolvePlaylistTracks } from "../../lib/playlists";
import { pickImageFile, storeCroppedPlaylistArt } from "../../lib/tauri";
import { useNavigationStore } from "../../store/useNavigationStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { usePlaylistStore } from "../../store/usePlaylistStore";
import type { Playlist, PlaylistImageMode } from "../../types/playlist";
import { EditorDiscardOverlay } from "../EditorDiscardOverlay/EditorDiscardOverlay";
import { EditorSaveButton } from "../EditorSaveButton/EditorSaveButton";
import { PlaylistArt } from "../PlaylistArt/PlaylistArt";
import { PlaylistDesignedArt } from "../PlaylistArt/PlaylistDesignedArt";
import { PlaylistGeneratedArt } from "../PlaylistArt/PlaylistGeneratedArt";
import { Alert } from "../common/Alert/Alert";
import { Button } from "../common/Button/Button";
import { cssColorToHex } from "../common/ColorField/ColorField";
import { FormField } from "../common/Field/Field";
import { ImageCropModal } from "../common/ImageCropModal/ImageCropModal";
import { RadioGroup, RadioGroupItem } from "../common/RadioGroup/RadioGroup";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalHeaderMain,
  ModalTitle,
} from "../common/Modal/Modal";
import { Tab, TabList, TabPanel, Tabs } from "../common/Tabs/Tabs";
import { TextInput } from "../common/TextInput/TextInput";
import { Textarea } from "../common/Textarea/Textarea";
import { IconClose, IconShuffle } from "../icons";
import { PlaylistIconPicker } from "./PlaylistIconPicker";
import "../PlaylistArt/PlaylistArt.css";
import "../TrackEditor/TrackEditor.css";
import "./PlaylistEditorModal.css";

type PlaylistEditorTab = "details" | "art";

function CoverColorButton({
  value,
  label,
  onChange,
}: {
  value: string;
  label: string;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const openPicker = () => {
    const input = inputRef.current;
    if (!input) return;
    try {
      input.showPicker();
    } catch {
      input.click();
    }
  };

  return (
    <span className="playlist-editor__swatch-hit">
      <Button
        variant="secondary"
        className="playlist-editor__swatch"
        style={
          {
            "--btn-face": value,
            "--btn-face-hover": value,
          } as CSSProperties
        }
        aria-label={label}
        onClick={openPicker}
      />
      <input
        ref={inputRef}
        type="color"
        className="playlist-editor__swatch-input"
        value={value}
        tabIndex={-1}
        aria-hidden
        onChange={(e) => onChange(e.target.value)}
      />
    </span>
  );
}

type PlaylistEditorSnapshot = {
  title: string;
  description: string;
  imageMode: PlaylistImageMode;
  customImagePath: string | null;
  /** Pending pick awaiting bake on save (editor-only). */
  customImageSourcePath: string | null;
  customImageCrop: ImageCrop | null;
  coverBackground: string;
  coverBackgroundEnd: string | null;
  coverIcon: string;
};

function newPlaylistSnapshot(): PlaylistEditorSnapshot {
  const defaults = defaultPlaylistDesignCover();
  return {
    title: "",
    description: "",
    imageMode: "design",
    customImagePath: null,
    customImageSourcePath: null,
    customImageCrop: null,
    coverBackground: defaults.coverBackground,
    coverBackgroundEnd: null,
    coverIcon: defaults.coverIcon,
  };
}

function snapshotFromPlaylist(playlist: Playlist): PlaylistEditorSnapshot {
  const defaults = defaultPlaylistDesignCover();
  const design = resolvePlaylistDesignFields(
    "design",
    playlist.coverBackground,
    playlist.coverBackgroundEnd,
    playlist.coverIcon,
  );
  return {
    title: playlist.title,
    description: playlist.description ?? "",
    imageMode: playlist.imageMode,
    customImagePath: playlist.customImagePath,
    customImageSourcePath: null,
    customImageCrop: null,
    coverBackground: design.coverBackground ?? defaults.coverBackground,
    coverBackgroundEnd: design.coverBackgroundEnd,
    coverIcon: design.coverIcon ?? defaults.coverIcon,
  };
}

function playlistEditorSnapshotsEqual(
  a: PlaylistEditorSnapshot,
  b: PlaylistEditorSnapshot,
): boolean {
  return (
    a.title.trim() === b.title.trim() &&
    a.description.trim() === b.description.trim() &&
    a.imageMode === b.imageMode &&
    a.customImagePath === b.customImagePath &&
    a.customImageSourcePath === b.customImageSourcePath &&
    cropsEqual(a.customImageCrop, b.customImageCrop) &&
    a.coverBackground === b.coverBackground &&
    a.coverBackgroundEnd === b.coverBackgroundEnd &&
    a.coverIcon === b.coverIcon
  );
}

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

  const isOpen = editingPlaylistId != null && (isNew || existing != null);

  const [activeTab, setActiveTab] = useState<PlaylistEditorTab>("details");
  useResetOnOpen(isOpen, "details", activeTab, setActiveTab);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [imageMode, setImageMode] = useState<PlaylistImageMode>("design");
  const [customImagePath, setCustomImagePath] = useState<string | null>(null);
  const [customImageSourcePath, setCustomImageSourcePath] = useState<
    string | null
  >(null);
  const [customImageCrop, setCustomImageCrop] = useState<ImageCrop | null>(
    null,
  );
  const [cropInitial, setCropInitial] = useState<ImageCrop | null>(null);
  const [cropModalSourcePath, setCropModalSourcePath] = useState<string | null>(
    null,
  );
  const [coverBackground, setCoverBackground] = useState(
    () => defaultPlaylistDesignCover().coverBackground,
  );
  const [coverBackgroundEnd, setCoverBackgroundEnd] = useState<string | null>(
    null,
  );
  const [coverIcon, setCoverIcon] = useState<string>(
    () => defaultPlaylistDesignCover().coverIcon,
  );
  const [baseline, setBaseline] = useState<PlaylistEditorSnapshot | null>(null);
  const [saving, setSaving] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, isOpen);

  const tracks = useMemo(
    () => (existing ? resolvePlaylistTracks(existing, library) : []),
    [existing, library],
  );

  // Choosing Image only reveals the file button. Until a file is picked, art
  // stays on the last committed cover so Save does not rewrite it.
  const imageChoicePending =
    imageMode === "custom" && !customImagePath && !customImageSourcePath;
  const committedImageMode =
    imageChoicePending && baseline ? baseline.imageMode : imageMode;
  const committedCustomImagePath =
    imageChoicePending && baseline ? baseline.customImagePath : customImagePath;

  const hasChanges =
    baseline != null &&
    !playlistEditorSnapshotsEqual(baseline, {
      title,
      description,
      imageMode: committedImageMode,
      customImagePath: committedCustomImagePath,
      customImageSourcePath,
      customImageCrop,
      coverBackground,
      coverBackgroundEnd,
      coverIcon,
    });

  const {
    discardPrompt,
    setDiscardPrompt,
    requestClose,
    handleBackdropClick,
    dismissDiscardPrompt,
  } = useEditorDiscardPrompt(hasChanges, closePlaylistEditor, saving);

  const sessionKey =
    editingPlaylistId == null
      ? null
      : editingPlaylistId === "new"
        ? "new"
        : existing
          ? `edit:${existing.id}`
          : null;

  useEffect(() => {
    if (sessionKey == null) return;
    setDiscardPrompt(false);
    setActiveTab("details");
    const snapshot =
      existing == null ? newPlaylistSnapshot() : snapshotFromPlaylist(existing);
    setTitle(snapshot.title);
    setDescription(snapshot.description);
    setImageMode(snapshot.imageMode);
    setCustomImagePath(snapshot.customImagePath);
    setCustomImageSourcePath(snapshot.customImageSourcePath);
    setCustomImageCrop(snapshot.customImageCrop);
    setCropModalSourcePath(null);
    setCoverBackground(snapshot.coverBackground);
    setCoverBackgroundEnd(snapshot.coverBackgroundEnd);
    setCoverIcon(snapshot.coverIcon);
    setBaseline(snapshot);
    // Reset only when opening a playlist. `existing` changes identity whenever
    // the playlist list refreshes, which would wipe in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- session-keyed reset
  }, [sessionKey, setDiscardPrompt]);

  const pendingCustomPath = customImagePath ?? customImageSourcePath;
  const showLiveCrop =
    imageMode === "custom" &&
    customImageSourcePath != null &&
    customImageCrop != null;

  const previewPlaylist: Playlist = useMemo(() => {
    const design = resolvePlaylistDesignFields(
      imageMode,
      coverBackground,
      coverBackgroundEnd,
      coverIcon,
    );
    return {
      id: existing?.id ?? 0,
      title: title.trim() || t("common:untitledPlaylist"),
      description: description.trim() || null,
      dateCreated: existing?.dateCreated ?? "",
      lastUsedAt: existing?.lastUsedAt ?? "",
      trackIds: existing?.trackIds ?? [],
      imageMode,
      customImagePath: showLiveCrop ? customImageSourcePath : pendingCustomPath,
      coverBackground: design.coverBackground,
      coverBackgroundEnd: design.coverBackgroundEnd,
      coverIcon: design.coverIcon,
    };
  }, [
    existing,
    title,
    description,
    imageMode,
    pendingCustomPath,
    showLiveCrop,
    customImageSourcePath,
    coverBackground,
    coverBackgroundEnd,
    coverIcon,
  ]);

  const clearCustomImage = useCallback(() => {
    setCustomImagePath(null);
    setCustomImageSourcePath(null);
    setCustomImageCrop(null);
  }, []);

  const hasCustomImage =
    customImagePath != null || customImageSourcePath != null;

  // A picked image keeps its original and crop for the session, so re-editing
  // adjusts that crop. A saved one only has the stored, already cropped file.
  const handleEditImage = useCallback(() => {
    if (customImageSourcePath) {
      setCropInitial(customImageCrop);
      setCropModalSourcePath(customImageSourcePath);
    } else if (customImagePath) {
      setCropInitial(null);
      setCropModalSourcePath(customImagePath);
    }
  }, [customImageCrop, customImagePath, customImageSourcePath]);

  const handlePickImage = useCallback(async () => {
    const picked = await pickImageFile();
    if (!picked) return;
    setCropInitial(null);
    setCropModalSourcePath(picked);
  }, []);

  const handleCropModalClose = useCallback(() => {
    setCropModalSourcePath(null);
    setCropInitial(null);
  }, []);

  const handleCropApply = useCallback(
    (crop: ImageCrop) => {
      if (!cropModalSourcePath) return;
      setImageMode("custom");
      setCustomImageSourcePath(cropModalSourcePath);
      setCustomImageCrop(crop);
      setCustomImagePath(null);
      setCropModalSourcePath(null);
      setCropInitial(null);
    },
    [cropModalSourcePath],
  );

  const handleSelectMode = useCallback(
    (mode: PlaylistImageMode) => {
      if (mode === "design") {
        const design = resolvePlaylistDesignFields(
          "design",
          coverBackground,
          coverBackgroundEnd,
          coverIcon,
        );
        setCoverBackground(
          design.coverBackground ??
            defaultPlaylistDesignCover().coverBackground,
        );
        setCoverBackgroundEnd(design.coverBackgroundEnd);
        setCoverIcon(
          design.coverIcon ?? defaultPlaylistDesignCover().coverIcon,
        );
        setImageMode("design");
        clearCustomImage();
        return;
      }
      if (mode === "custom") {
        setImageMode("custom");
        return;
      }
      setImageMode("generated");
      clearCustomImage();
    },
    [coverBackground, coverBackgroundEnd, coverIcon, clearCustomImage],
  );

  const resolveImageForSave = useCallback(
    async (playlistId: number) => {
      const design = resolvePlaylistDesignFields(
        committedImageMode,
        coverBackground,
        coverBackgroundEnd,
        coverIcon,
      );

      const cover = {
        coverBackground: design.coverBackground,
        coverBackgroundEnd: design.coverBackgroundEnd,
        coverIcon: design.coverIcon,
      };

      if (committedImageMode !== "custom") {
        return {
          imageMode: committedImageMode,
          customImagePath: null,
          ...cover,
        };
      }

      if (customImageSourcePath && customImageCrop) {
        const cached = await storeCroppedPlaylistArt(
          playlistId,
          title.trim() || t("common:untitledPlaylist"),
          customImageSourcePath,
          customImageCrop,
        );
        return {
          imageMode: "custom" as const,
          customImagePath: cached,
          ...cover,
        };
      }

      if (committedCustomImagePath) {
        return {
          imageMode: "custom" as const,
          customImagePath: committedCustomImagePath,
          ...cover,
        };
      }

      return {
        imageMode: "generated" as const,
        customImagePath: null,
        ...cover,
      };
    },
    [
      committedImageMode,
      committedCustomImagePath,
      customImageSourcePath,
      customImageCrop,
      coverBackground,
      coverBackgroundEnd,
      coverIcon,
      title,
    ],
  );

  const handleSave = useCallback(async () => {
    const trimmedTitle = title.trim() || t("common:untitledPlaylist");

    setSaving(true);
    try {
      const desc = description.trim() || null;
      if (isNew) {
        const defaults = defaultPlaylistDesignCover();
        const id = await createPlaylist(trimmedTitle, desc, {
          imageMode: "design",
          customImagePath: null,
          coverBackground: defaults.coverBackground,
          coverBackgroundEnd: null,
          coverIcon: defaults.coverIcon,
        });
        // Custom images need the real id for the art cache key.
        const image = await resolveImageForSave(id);
        await updatePlaylist(id, trimmedTitle, desc, image);
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
  const pickerBackground =
    cssColorToHex(coverBackground) ??
    defaultPlaylistDesignCover().coverBackground;
  const pickerBackgroundEnd =
    cssColorToHex(coverBackgroundEnd ?? "") ??
    DEFAULT_PLAYLIST_COVER_GRADIENT_END;

  const identityTitle =
    title.trim() ||
    (isNew ? t("library:views.playlists.new") : t("common:untitledPlaylist"));
  const identitySubtitle = description.trim();

  return (
    <>
      <Modal
        open={isOpen}
        onClose={handleBackdropClick}
        dismissible={!saving}
        size="editor"
        fitContent
        panelClassName="track-editor-modal"
        panelRef={panelRef}
        labelledBy={titleId}
      >
        {isOpen ? (
          <>
            <div className="track-editor-modal__content track-editor-modal__content--tabbed">
              <div className="track-editor-modal__main">
                <ModalHeader className="track-editor__identity-header">
                  <div className="track-editor__identity">
                    <div className="track-editor__identity-art" aria-hidden>
                      <PlaylistArt
                        playlist={previewPlaylist}
                        tracks={tracks}
                        className="playlist-art--identity"
                        imageCrop={showLiveCrop ? customImageCrop : undefined}
                      />
                    </div>
                    <ModalHeaderMain className="track-editor__identity-meta">
                      <ModalTitle
                        id={titleId}
                        className="track-editor__identity-title"
                      >
                        {identityTitle}
                      </ModalTitle>
                      {identitySubtitle ? (
                        <p className="track-editor__identity-subtitle">
                          {identitySubtitle}
                        </p>
                      ) : null}
                    </ModalHeaderMain>
                  </div>
                </ModalHeader>

                <Tabs
                  value={activeTab}
                  onChange={(tab) => setActiveTab(tab as PlaylistEditorTab)}
                  className="track-editor__tabs"
                  variant="underline"
                >
                  <TabList
                    fade
                    aria-label={t("library:editor.playlistTabsAria")}
                    className="track-editor__tab-bar"
                  >
                    <Tab value="details">{t("library:editor.tabDetails")}</Tab>
                    <Tab value="art">{t("library:editor.tabArt")}</Tab>
                  </TabList>

                  <ModalBody className="track-editor__tab-body">
                    <div className="track-editor__tab-stage">
                      <TabPanel
                        value="details"
                        className="track-editor__tab-panel"
                      >
                        <div className="track-editor__fields">
                          <FormField label={t("library:editor.fields.title")}>
                            <TextInput
                              value={title}
                              onChange={(e) => setTitle(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void handleSave();
                              }}
                              placeholder={t("common:untitledPlaylist")}
                              autoFocus
                            />
                          </FormField>
                          <FormField
                            label={t("library:editor.fields.description")}
                          >
                            <Textarea
                              className="playlist-editor__description"
                              value={description}
                              rows={4}
                              onChange={(e) => setDescription(e.target.value)}
                              placeholder={t("common:optional")}
                            />
                          </FormField>
                        </div>
                      </TabPanel>

                      <TabPanel value="art" className="track-editor__tab-panel">
                        <div className="playlist-editor__art">
                          <div className="playlist-editor__art-preview">
                            <PlaylistArt
                              playlist={previewPlaylist}
                              tracks={tracks}
                              className="playlist-art--editor"
                              imageCrop={
                                showLiveCrop ? customImageCrop : undefined
                              }
                            />
                          </div>

                          <div className="playlist-editor__art-controls">
                            <RadioGroup
                              name="playlist-image-mode"
                              value={imageMode}
                              onChange={handleSelectMode}
                              variant="button"
                              orientation="horizontal"
                              aria-label={t(
                                "library:editor.playlist.coverSourceAria",
                              )}
                              className="playlist-editor__style-cards"
                            >
                              <RadioGroupItem
                                value="design"
                                className="playlist-editor__style-card"
                              >
                                <span
                                  className="playlist-editor__style-thumb"
                                  aria-hidden
                                >
                                  <PlaylistDesignedArt
                                    coverBackground={coverBackground}
                                    coverBackgroundEnd={coverBackgroundEnd}
                                    coverIcon={coverIcon}
                                    className="playlist-art--style-card"
                                  />
                                </span>
                                <span className="playlist-editor__style-label">
                                  {t("library:editor.playlist.design")}
                                </span>
                              </RadioGroupItem>
                              <RadioGroupItem
                                value="generated"
                                className="playlist-editor__style-card"
                              >
                                <span
                                  className="playlist-editor__style-thumb"
                                  aria-hidden
                                >
                                  <PlaylistGeneratedArt
                                    tracks={tracks}
                                    className="playlist-art--style-card"
                                  />
                                </span>
                                <span className="playlist-editor__style-label">
                                  {t("library:editor.playlist.fromTracks")}
                                </span>
                              </RadioGroupItem>
                              <RadioGroupItem
                                value="custom"
                                className="playlist-editor__style-card"
                              >
                                <span
                                  className="playlist-editor__style-thumb"
                                  aria-hidden
                                >
                                  <PlaylistArt
                                    playlist={{
                                      ...previewPlaylist,
                                      imageMode: "custom",
                                      customImagePath: showLiveCrop
                                        ? customImageSourcePath
                                        : pendingCustomPath,
                                    }}
                                    className="playlist-art--style-card"
                                    imageCrop={
                                      showLiveCrop ? customImageCrop : undefined
                                    }
                                  />
                                </span>
                                <span className="playlist-editor__style-label">
                                  {t("library:editor.playlist.image")}
                                </span>
                              </RadioGroupItem>
                            </RadioGroup>

                            <div className="playlist-editor__option-stage">
                              <Alert
                                variant="info"
                                inert={imageMode !== "generated"}
                              >
                                {t("library:editor.playlist.fromTracksHint")}
                              </Alert>

                              <div
                                className="playlist-editor__design"
                                inert={imageMode !== "design"}
                              >
                                <div className="playlist-editor__colors">
                                  <label className="playlist-editor__color-picker">
                                    <span className="playlist-editor__color-picker-label">
                                      {t("library:editor.playlist.colorStart")}
                                    </span>
                                    <CoverColorButton
                                      value={pickerBackground}
                                      label={t(
                                        "library:editor.playlist.colorStart",
                                      )}
                                      onChange={setCoverBackground}
                                    />
                                  </label>
                                  {coverBackgroundEnd ? (
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      iconOnly
                                      className="playlist-editor__color-action"
                                      aria-label={t(
                                        "library:editor.playlist.swapColors",
                                      )}
                                      onClick={() => {
                                        setCoverBackground(coverBackgroundEnd);
                                        setCoverBackgroundEnd(coverBackground);
                                      }}
                                    >
                                      <svg
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        aria-hidden
                                      >
                                        <path d="m16 3 4 4-4 4" />
                                        <path d="M20 7H4" />
                                        <path d="m8 21-4-4 4-4" />
                                        <path d="M4 17h16" />
                                      </svg>
                                    </Button>
                                  ) : null}
                                  <div className="playlist-editor__color-picker">
                                    <span className="playlist-editor__color-picker-label">
                                      {t("library:editor.playlist.colorEnd")}
                                    </span>
                                    {coverBackgroundEnd ? (
                                      <span className="playlist-editor__color-swatch">
                                        <CoverColorButton
                                          value={pickerBackgroundEnd}
                                          label={t(
                                            "library:editor.playlist.colorEnd",
                                          )}
                                          onChange={setCoverBackgroundEnd}
                                        />
                                        <button
                                          type="button"
                                          className="playlist-editor__color-clear"
                                          aria-label={t(
                                            "library:editor.playlist.clearSecondColor",
                                          )}
                                          onClick={() =>
                                            setCoverBackgroundEnd(null)
                                          }
                                        >
                                          <IconClose />
                                        </button>
                                      </span>
                                    ) : (
                                      <Button
                                        variant="secondary"
                                        className="playlist-editor__swatch playlist-editor__color-add"
                                        aria-label={t(
                                          "library:editor.playlist.addSecondColor",
                                        )}
                                        onClick={() =>
                                          setCoverBackgroundEnd(
                                            DEFAULT_PLAYLIST_COVER_GRADIENT_END,
                                          )
                                        }
                                      >
                                        +
                                      </Button>
                                    )}
                                  </div>
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    iconOnly
                                    className="playlist-editor__color-action"
                                    aria-label={t(
                                      "library:editor.playlist.randomizeColors",
                                    )}
                                    onClick={() => {
                                      const next = randomPlaylistCoverColors(
                                        coverBackgroundEnd != null,
                                        {
                                          background: coverBackground,
                                          backgroundEnd: coverBackgroundEnd,
                                        },
                                      );
                                      setCoverBackground(next.coverBackground);
                                      setCoverBackgroundEnd(
                                        next.coverBackgroundEnd,
                                      );
                                    }}
                                  >
                                    <IconShuffle aria-hidden />
                                  </Button>
                                </div>
                                <PlaylistIconPicker
                                  value={coverIcon}
                                  onChange={setCoverIcon}
                                />
                              </div>

                              <div
                                className="playlist-editor__image-actions"
                                inert={imageMode !== "custom"}
                              >
                                <div className="playlist-editor__image-buttons">
                                  <Button
                                    size="sm"
                                    onClick={() => void handlePickImage()}
                                  >
                                    {t("library:editor.playlist.chooseImage")}
                                  </Button>
                                  {hasCustomImage ? (
                                    <Button size="sm" onClick={handleEditImage}>
                                      {t("library:editor.editImage")}
                                    </Button>
                                  ) : null}
                                </div>
                                <p className="playlist-editor__hint">
                                  {t("library:editor.playlist.chooseImageHint")}
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </TabPanel>
                    </div>
                  </ModalBody>
                </Tabs>
              </div>

              <ModalFooter
                fade
                inert={discardPrompt || undefined}
                onCancel={requestClose}
                cancelDisabled={saving}
              >
                <EditorSaveButton
                  size="md"
                  saving={saving}
                  label={saving ? t("common:saving") : t("common:save")}
                  onClick={() => void handleSave()}
                  disabled={!hasChanges || saving || discardPrompt}
                />
              </ModalFooter>
            </div>

            <EditorDiscardOverlay
              open={discardPrompt}
              description={t("library:editor.discardPlaylist")}
              onKeepEditing={dismissDiscardPrompt}
              onDiscard={() => {
                setDiscardPrompt(false);
                closePlaylistEditor();
              }}
            />
          </>
        ) : null}
      </Modal>

      <ImageCropModal
        open={cropModalSourcePath != null}
        filePath={cropModalSourcePath}
        aspect={1}
        initialCrop={cropInitial}
        onApply={handleCropApply}
        onClose={handleCropModalClose}
      />
    </>
  );
}
