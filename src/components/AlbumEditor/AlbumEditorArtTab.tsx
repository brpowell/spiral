import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useContextMenu } from "../../hooks/useContextMenu";
import { ContextMenu, ContextMenuItem } from "../ContextMenu/ContextMenu";
import { EntityArt } from "../EntityArt/EntityArt";
import { IconDownload, IconOpenFolder } from "../icons";
import "./AlbumEditor.css";

export type AlbumEditorArtTabProps = {
  previewSrc: string | null;
  artDragOver: boolean;
  fetchingArt: boolean;
  onArtDragOver: (active: boolean) => void;
  onArtDrop: (e: React.DragEvent) => void;
  onChangeArt: () => void;
  onFetchArt: () => void;
};

export function AlbumEditorArtTab({
  previewSrc,
  artDragOver,
  fetchingArt,
  onArtDragOver,
  onArtDrop,
  onChangeArt,
  onFetchArt,
}: AlbumEditorArtTabProps) {
  const { t } = useTranslation("library");
  const slotRef = useRef<HTMLButtonElement>(null);
  const frontLabel = t("editor.artTypes.front");
  const {
    open,
    anchor,
    position,
    menuRef,
    openedWithKeyboard,
    toggleFromTrigger,
    openAt,
    closeMenu,
    onContextMenu,
  } = useContextMenu({
    dismissExcludeRefs: [slotRef],
    triggerPlacement: "below-start",
  });

  const slotClass = [
    "album-editor__art-slot",
    artDragOver && "album-editor__art-slot--drop-active",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="album-editor__art-slots">
      <button
        ref={slotRef}
        type="button"
        data-art-drop-zone
        className={slotClass}
        aria-label={t("editor.artSlotMenuAria", { type: frontLabel })}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          if (e.detail === 0) {
            toggleFromTrigger(slotRef.current, { keyboard: true });
            return;
          }
          openAt(e.clientX, e.clientY);
        }}
        onContextMenu={onContextMenu}
        onDragOver={(e) => {
          e.preventDefault();
          onArtDragOver(true);
        }}
        onDragLeave={() => onArtDragOver(false)}
        onDrop={onArtDrop}
      >
        <span className="album-editor__art-slot-frame">
          {previewSrc ? (
            <img
              src={previewSrc}
              alt=""
              className="album-editor__art-slot-img"
            />
          ) : (
            <EntityArt
              artPath={null}
              className="album-editor__art-slot-placeholder"
            />
          )}
        </span>
        <span className="album-editor__art-slot-label">{frontLabel}</span>
      </button>

      <ContextMenu
        open={open}
        anchor={anchor}
        position={position}
        menuRef={menuRef}
        focusFirstItem={openedWithKeyboard}
      >
        <ContextMenuItem
          icon={<IconOpenFolder />}
          label={t("editor.chooseFromFile")}
          onClick={() => {
            closeMenu();
            onChangeArt();
          }}
        />
        <ContextMenuItem
          icon={<IconDownload />}
          label={fetchingArt ? t("editor.fetchingArt") : t("editor.fetchArt")}
          disabled={fetchingArt}
          onClick={() => {
            closeMenu();
            onFetchArt();
          }}
        />
      </ContextMenu>
    </div>
  );
}
