import { useEffect, useRef, useState } from "react";
import { slugifyId } from "../../../lib/items/itemIds";
import { TextInput, type TextInputProps } from "../TextInput/TextInput";

export type SlugFieldProps = Omit<
  TextInputProps,
  "value" | "onChange" | "defaultValue" | "type"
> & {
  value: string;
  onChange: (value: string) => void;
  /**
   * When set and the user has not manually overridden the slug, keep `value`
   * synced to `slugifyId(suggestedFrom)` as the suggestion changes.
   */
  suggestedFrom?: string;
  /**
   * Change this (e.g. modal open / theme id) to reset manual override so
   * auto-sync from `suggestedFrom` resumes.
   */
  autoSyncKey?: string | number;
};

/**
 * Kebab-slug text field that can auto-follow a display-name source until the
 * user types in the slug field themselves.
 */
export function SlugField({
  value,
  onChange,
  suggestedFrom,
  autoSyncKey,
  onKeyDown,
  ...props
}: SlugFieldProps) {
  const [manualOverride, setManualOverride] = useState(false);
  const prevAutoSyncKeyRef = useRef(autoSyncKey);
  const prevValueRef = useRef(value);
  const prevSuggestedRef = useRef<string | undefined>(undefined);
  const primedRef = useRef(false);

  useEffect(() => {
    if (prevAutoSyncKeyRef.current === autoSyncKey) return;
    prevAutoSyncKeyRef.current = autoSyncKey;
    setManualOverride(false);
    prevSuggestedRef.current = undefined;
    primedRef.current = false;
  }, [autoSyncKey]);

  useEffect(() => {
    if (value === "" && prevValueRef.current !== "") {
      setManualOverride(false);
      prevSuggestedRef.current = undefined;
      primedRef.current = false;
    }
    prevValueRef.current = value;
  }, [value]);

  useEffect(() => {
    if (manualOverride || suggestedFrom === undefined) return;

    // First observation after mount/reset: seed without overwriting an
    // existing slug (e.g. editing a theme whose id already differs from name).
    if (!primedRef.current) {
      primedRef.current = true;
      prevSuggestedRef.current = suggestedFrom;
      if (!value.trim()) {
        onChange(slugifyId(suggestedFrom));
      }
      return;
    }

    if (prevSuggestedRef.current === suggestedFrom) return;
    prevSuggestedRef.current = suggestedFrom;
    const next = slugifyId(suggestedFrom);
    if (next !== value) onChange(next);
  }, [suggestedFrom, manualOverride, onChange, value]);

  return (
    <TextInput
      {...props}
      value={value}
      spellCheck={false}
      autoComplete="off"
      onChange={(e) => {
        setManualOverride(true);
        onChange(e.target.value);
      }}
      onKeyDown={onKeyDown}
    />
  );
}
