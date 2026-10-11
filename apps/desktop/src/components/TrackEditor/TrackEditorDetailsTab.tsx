import { useTranslation } from "react-i18next";
import {
  mixedFieldPlaceholder,
  type TrackEditorForm,
  type TrackEditorFormField,
} from "../../lib/trackMetadataForm";
import type { Track } from "../../types/track";
import { ArtistChipField } from "../ArtistChipField/ArtistChipField";
import { TrackRating } from "../TrackRating/TrackRating";
import { FormField } from "../common/Field/Field";
import { AutocompleteInput } from "../common/AutocompleteInput/AutocompleteInput";
import { TextInput } from "../common/TextInput/TextInput";

function TrackEditorField({
  label,
  field,
  type = "text",
  min,
  form,
  tracks,
  onChange,
  suggestions,
}: {
  label: string;
  field: TrackEditorFormField;
  type?: "text" | "number";
  min?: number;
  form: TrackEditorForm;
  tracks: Track[];
  onChange: (field: TrackEditorFormField, value: string) => void;
  suggestions?: string[];
}) {
  const common = {
    type,
    min,
    value: form[field],
    placeholder: mixedFieldPlaceholder(tracks, field, form),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      onChange(field, e.target.value),
  };

  return (
    <FormField label={label}>
      {suggestions && type === "text" ? (
        <AutocompleteInput {...common} suggestions={suggestions} />
      ) : (
        <TextInput {...common} />
      )}
    </FormField>
  );
}

function TrackEditorNumberPairField({
  label,
  numberField,
  totalField,
  form,
  tracks,
  isBulk,
  onChange,
}: {
  label: string;
  numberField: "trackNumber" | "discNumber";
  totalField: "totalTracks" | "totalDiscs";
  form: TrackEditorForm;
  tracks: Track[];
  isBulk: boolean;
  onChange: (field: TrackEditorFormField, value: string) => void;
}) {
  const { t } = useTranslation("library");
  return (
    <FormField label={label}>
      <div className="track-editor__number-pair">
        <TextInput
          type="number"
          min={1}
          value={form[numberField]}
          placeholder={
            isBulk
              ? mixedFieldPlaceholder(tracks, numberField, form)
              : undefined
          }
          onChange={(e) => onChange(numberField, e.target.value)}
          aria-label={label}
        />
        <span className="track-editor__number-pair-of" aria-hidden>
          {t("editor.of")}
        </span>
        <TextInput
          type="number"
          min={1}
          value={form[totalField]}
          placeholder={
            isBulk ? mixedFieldPlaceholder(tracks, totalField, form) : undefined
          }
          onChange={(e) => onChange(totalField, e.target.value)}
          aria-label={t("editor.numberTotalAria", { label })}
        />
      </div>
    </FormField>
  );
}

export type TrackEditorDetailsTabProps = {
  form: TrackEditorForm;
  tracks: Track[];
  isBulk: boolean;
  onFieldChange: (field: TrackEditorFormField, value: string) => void;
  onRatingChange: (rating: number) => void;
  artistSuggestions: string[];
  genreSuggestions: string[];
  albumSuggestions: string[];
};

export function TrackEditorDetailsTab({
  form,
  tracks,
  isBulk,
  onFieldChange,
  onRatingChange,
  artistSuggestions,
  genreSuggestions,
  albumSuggestions,
}: TrackEditorDetailsTabProps) {
  const { t } = useTranslation("library");
  return (
    <div className="track-editor__fields">
      <TrackEditorField
        label={t("editor.fields.title")}
        field="title"
        form={form}
        tracks={tracks}
        onChange={onFieldChange}
      />
      <FormField label={t("editor.fields.artist")}>
        <ArtistChipField
          value={form.artist}
          onChange={(value) => onFieldChange("artist", value)}
          placeholder={
            isBulk ? mixedFieldPlaceholder(tracks, "artist", form) : undefined
          }
          suggestions={artistSuggestions}
          inputAriaLabel={t("editor.artistAria")}
        />
      </FormField>
      <TrackEditorField
        label={t("editor.fields.album")}
        field="album"
        form={form}
        tracks={tracks}
        onChange={onFieldChange}
        suggestions={albumSuggestions}
      />
      <TrackEditorField
        label={t("editor.fields.albumArtist")}
        field="albumArtist"
        form={form}
        tracks={tracks}
        onChange={onFieldChange}
        suggestions={artistSuggestions}
      />
      <TrackEditorField
        label={t("editor.fields.year")}
        field="year"
        type="number"
        min={1}
        form={form}
        tracks={tracks}
        onChange={onFieldChange}
      />
      <TrackEditorNumberPairField
        label={t("editor.fields.trackNumber")}
        numberField="trackNumber"
        totalField="totalTracks"
        form={form}
        tracks={tracks}
        isBulk={isBulk}
        onChange={onFieldChange}
      />
      <TrackEditorNumberPairField
        label={t("editor.fields.discNumber")}
        numberField="discNumber"
        totalField="totalDiscs"
        form={form}
        tracks={tracks}
        isBulk={isBulk}
        onChange={onFieldChange}
      />
      <TrackEditorField
        label={t("editor.fields.genre")}
        field="genre"
        form={form}
        tracks={tracks}
        onChange={onFieldChange}
        suggestions={genreSuggestions}
      />
      {!isBulk ? (
        <FormField label={t("editor.fields.rating")}>
          <TrackRating
            value={form.rating}
            size="comfortable"
            onChange={onRatingChange}
          />
        </FormField>
      ) : null}
    </div>
  );
}
