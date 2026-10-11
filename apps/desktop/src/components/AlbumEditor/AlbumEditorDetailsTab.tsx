import { useTranslation } from "react-i18next";
import {
  albumMixedFieldPlaceholder,
  type AlbumEditorForm,
} from "../../lib/albumMetadata";
import type { Track } from "../../types/track";
import { AutocompleteInput } from "../common/AutocompleteInput/AutocompleteInput";
import { FormField } from "../common/Field/Field";
import { TextInput } from "../common/TextInput/TextInput";

export type AlbumEditorDetailsTabProps = {
  form: AlbumEditorForm;
  tracks: Track[];
  genreSuggestions: string[];
  onFieldChange: (field: keyof AlbumEditorForm, value: string) => void;
};

export function AlbumEditorDetailsTab({
  form,
  tracks,
  genreSuggestions,
  onFieldChange,
}: AlbumEditorDetailsTabProps) {
  const { t } = useTranslation("library");

  return (
    <div className="track-editor__fields">
      <FormField label={t("editor.fields.album")}>
        <TextInput
          value={form.title}
          onChange={(e) => onFieldChange("title", e.target.value)}
        />
      </FormField>
      <FormField label={t("editor.fields.albumArtist")}>
        <TextInput
          value={form.artist}
          onChange={(e) => onFieldChange("artist", e.target.value)}
        />
      </FormField>
      <FormField label={t("editor.fields.year")}>
        <TextInput
          type="number"
          value={form.year}
          onChange={(e) => onFieldChange("year", e.target.value)}
        />
      </FormField>
      <FormField label={t("editor.fields.genre")}>
        <AutocompleteInput
          value={form.genre}
          placeholder={albumMixedFieldPlaceholder(tracks, "genre", form)}
          suggestions={genreSuggestions}
          onChange={(e) => onFieldChange("genre", e.target.value)}
        />
      </FormField>
    </div>
  );
}
