import { useMemo } from "react";
import { ChipInput } from "../common/ChipInput/ChipInput";
import {
  normalizeArtistName,
  parseArtistField,
  serializeArtistField,
} from "../../lib/artistNames";
import "./ArtistChipField.css";

export type ArtistChipFieldProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  suggestions?: string[];
  disabled?: boolean;
  inputAriaLabel?: string;
};

function isArtistDuplicate(name: string, values: string[]): boolean {
  const key = normalizeArtistName(name);
  return values.some((v) => normalizeArtistName(v) === key);
}

export function ArtistChipField({
  value,
  onChange,
  placeholder,
  suggestions,
  disabled,
  inputAriaLabel = "Add artist",
}: ArtistChipFieldProps) {
  const names = useMemo(() => parseArtistField(value), [value]);

  const handleChange = (next: string[]) => {
    onChange(serializeArtistField(next) ?? "");
  };

  return (
    <div className="artist-chip-field">
      <ChipInput
        values={names}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        suggestions={suggestions}
        isDuplicate={isArtistDuplicate}
        parseDraft={parseArtistField}
        inputAriaLabel={inputAriaLabel}
      />
    </div>
  );
}
