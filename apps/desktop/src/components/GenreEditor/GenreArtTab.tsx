import { useTranslation } from "react-i18next";
import { CoverArtLayout } from "@/components/CoverDesign/CoverArtLayout";
import { CoverDesignFields } from "@/components/CoverDesign/CoverDesignFields";
import { GenreCover } from "@/components/GenreArt/GenreCover";
import { PlaylistDesignedArt } from "@/components/PlaylistArt/PlaylistDesignedArt";
import { Alert } from "@/components/common/Alert/Alert";
import { Button } from "@/components/common/Button/Button";
import { Checkbox } from "@/components/common/Checkbox/Checkbox";
import { useGenreLook } from "@/hooks/useGenreLook";
import {
  defaultDesignForGenre,
  genreDesignsEqual,
  type GenreArtMode,
  type GenreDesign,
} from "@/lib/genres/genreDesign";
import type { Genre } from "@/lib/genres/genres";

interface GenreArtTabProps {
  genre: Genre;
  design: GenreDesign;
  onChange: (design: GenreDesign) => void;
  applyToAll: boolean;
  onApplyToAllChange: (value: boolean) => void;
}

/** The Art tab of Edit Genre: pick an art mode and tweak its controls. */
export function GenreArtTab({
  genre,
  design,
  onChange,
  applyToAll,
  onApplyToAllChange,
}: GenreArtTabProps) {
  const { t } = useTranslation("library");
  const look = useGenreLook(genre, design);
  const albumLook = useGenreLook(genre, { ...design, mode: "album" });
  const top = albumLook.top;
  const isDefault = genreDesignsEqual(design, defaultDesignForGenre(genre.key));

  const applyHint =
    design.mode === "album"
      ? "editor.genre.applyAllAlbum"
      : isDefault
        ? "editor.genre.applyAllReset"
        : "editor.genre.applyAllDesign";

  return (
    <>
      <CoverArtLayout<GenreArtMode>
        name="genre-art-mode"
        ariaLabel={t("editor.genre.modeAria")}
        value={design.mode}
        onChange={(mode) => onChange({ ...design, mode })}
        preview={<GenreCover look={look} alt={genre.name} label={genre.name} />}
        previewFooter={
          <Button
            variant="secondary"
            size="sm"
            className="genre-editor__reset"
            disabled={isDefault}
            onClick={() => onChange(defaultDesignForGenre(genre.key))}
          >
            {t("editor.genre.resetLook")}
          </Button>
        }
        options={[
          {
            value: "design",
            label: t("editor.genre.modeDesign"),
            thumb: (
              <PlaylistDesignedArt
                coverBackground={design.background}
                coverBackgroundEnd={design.backgroundEnd}
                coverIcon={design.icon}
                className="playlist-art--style-card"
              />
            ),
          },
          {
            value: "album",
            label: t("editor.genre.modeAlbum"),
            thumb: (
              <GenreCover
                look={albumLook}
                className="playlist-art--style-card"
              />
            ),
          },
        ]}
      >
        <CoverDesignFields
          inert={design.mode !== "design"}
          background={design.background}
          backgroundEnd={design.backgroundEnd}
          icon={design.icon}
          onChange={(fields) => onChange({ ...design, ...fields })}
        />

        <Alert
          variant="info"
          className="genre-editor__album-note"
          inert={design.mode !== "album"}
        >
          <p>{t("editor.genre.albumHint")}</p>
          <p>
            {top
              ? t(
                  top.basis === "listening"
                    ? "editor.genre.albumCurrent"
                    : "editor.genre.albumCurrentBySize",
                  { title: top.album.title, artist: top.album.artist },
                )
              : t("editor.genre.albumNone")}
          </p>
        </Alert>
      </CoverArtLayout>

      <div className="genre-editor__apply-all">
        <Checkbox
          checked={applyToAll}
          onChange={(e) => onApplyToAllChange(e.target.checked)}
        >
          {t("editor.genre.applyAll")}
        </Checkbox>
        <p className="genre-editor__hint">{t(applyHint)}</p>
      </div>
    </>
  );
}
