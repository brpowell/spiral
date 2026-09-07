import { useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useContextMenu } from "../../hooks/useContextMenu";
import { ContextMenu, ContextMenuItem } from "../ContextMenu/ContextMenu";
import { EntityArt } from "../EntityArt/EntityArt";
import { IconDownload, IconOpenFolder } from "../icons";
import { ART_TYPE_LABEL_KEY, type AlbumArtType } from "./AlbumArtPicker";
import "./AlbumEditor.css";

export type AlbumEditorArtTabProps = {
  previewSrc: string | null;
  artType?: AlbumArtType;
  placeholder?: ReactNode;
  artDragOver: boolean;
  fetchingArt: boolean;
  onArtDragOver: (active: boolean) => void;
  onArtDrop: (e: React.DragEvent) => void;
  onChangeArt: () => void;
  onFetchArt: () => void;
};

export function AlbumEditorArtTab({
  previewSrc,
  artType = "front",
  placeholder,
  artDragOver,
  fetchingArt,
  onArtDragOver,
  onArtDrop,
  onChangeArt,
  onFetchArt,
}: AlbumEditorArtTabProps) {
  const { t } = useTranslation("library");
  const slotRef = useRef<HTMLButtonElement>(null);
  const typeLabel = t(ART_TYPE_LABEL_KEY[artType]);
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

  const round = artType === "portrait";
  const slotClass = [
    "album-editor__art-slot",
    round && "album-editor__art-slot--round",
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
        aria-label={t("editor.artSlotMenuAria", { type: typeLabel })}
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
              placeholder={placeholder}
            />
          )}
        </span>
        <span className="album-editor__art-slot-label">{typeLabel}</span>
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
