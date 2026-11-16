import { useTranslation } from "react-i18next";
import { CoverArtLayout } from "@/components/CoverDesign/CoverArtLayout";
import { CoverColorFields } from "@/components/CoverDesign/CoverDesignFields";
import { GenreCover } from "@/components/GenreArt/GenreCover";
import { useGenreLook, type GenreLook } from "@/hooks/useGenreLook";
import { useThemeGradient } from "@/hooks/useThemeGradient";
import { Checkbox } from "@/components/common/Checkbox/Checkbox";
import { Switch } from "@/components/common/Switch/Switch";
import {
  type BackgroundDraft,
  type ColorBackground,
} from "@/lib/genres/genreBackground";
import type { Genre } from "@/lib/genres/genres";

type BackgroundChoice = "color" | "theme";

interface GenreArtTabProps {
  genre: Genre;
  draft: BackgroundDraft;
  onDraftChange: (draft: BackgroundDraft) => void;
  /** Also give every other genre this background when saving. */
  applyToAll: boolean;
  onApplyToAllChange: (applyToAll: boolean) => void;
}

/**
 * The Art tab of Edit Genre: a live preview beside the background choice, laid
 * out like the playlist editor's. The preview follows the unsaved choice, and
 * each mode keeps its own settings while the other is shown.
 */
export function GenreArtTab({
  genre,
  draft,
  onDraftChange,
  applyToAll,
  onApplyToAllChange,
}: GenreArtTabProps) {
  const { t } = useTranslation("library");
  const saved = useGenreLook(genre);
  const theme = useThemeGradient();

  // The icon and corner cover are the genre's own; only the background varies.
  const lookWith = (start: string, end: string | null): GenreLook => ({
    ...saved,
    start,
    end,
  });
  const themeLook = lookWith(theme.start, draft.gradient ? theme.end : null);
  // What "Choose color" shows: the colors picked so far, else a start from the
  // theme palette.
  const colorLook = draft.color
    ? lookWith(draft.color.start, draft.color.end)
    : lookWith(theme.start, theme.end);
  const previewLook = draft.mode === "color" ? colorLook : themeLook;

  const choose = (mode: BackgroundChoice) =>
    onDraftChange({
      ...draft,
      mode,
      color:
        mode === "color" && !draft.color
          ? { start: theme.start, end: theme.end }
          : draft.color,
    });
  const setColor = (color: ColorBackground) =>
    onDraftChange({ ...draft, color });

  return (
    <CoverArtLayout<BackgroundChoice>
      name="genre-background"
      ariaLabel={t("editor.fields.background")}
      value={draft.mode}
      onChange={choose}
      preview={
        <GenreCover look={previewLook} alt={genre.name} label={genre.name} />
      }
      options={[
        {
          value: "color",
          label: t("editor.background.color"),
          thumb: (
            <GenreCover look={colorLook} className="playlist-art--style-card" />
          ),
        },
        {
          value: "theme",
          label: t("editor.background.theme"),
          thumb: (
            <GenreCover look={themeLook} className="playlist-art--style-card" />
          ),
        },
      ]}
    >
      <div className="track-editor__fields">
        {draft.mode === "theme" ? (
          <Switch
            checked={draft.gradient}
            onChange={(e) =>
              onDraftChange({ ...draft, gradient: e.target.checked })
            }
          >
            {t("editor.background.gradient")}
          </Switch>
        ) : draft.color ? (
          <CoverColorFields
            background={draft.color.start}
            backgroundEnd={draft.color.end}
            onChange={(colors) =>
              setColor({ start: colors.background, end: colors.backgroundEnd })
            }
          />
        ) : null}
        <Checkbox
          checked={applyToAll}
          onChange={(e) => onApplyToAllChange(e.target.checked)}
        >
          {t("editor.background.applyToAll")}
        </Checkbox>
      </div>
    </CoverArtLayout>
  );
}
