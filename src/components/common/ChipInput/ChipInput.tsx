import { useCallback, useId, useMemo, useRef, useState } from "react";
import { useSuggestionAutocomplete } from "../../../hooks/useSuggestionAutocomplete";
import { Chip } from "../Chip/Chip";
import { SuggestionMenu } from "../SuggestionMenu/SuggestionMenu";
import { TextInput, type InputEditHistory } from "../TextInput/TextInput";
import "./ChipInput.css";

export type ChipInputProps = {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  suggestions?: string[];
  isDuplicate?: (name: string, values: string[]) => boolean;
  /** Turn a committed draft into one or more chip values. Defaults to a single trimmed token. */
  parseDraft?: (draft: string) => string[];
  inputAriaLabel?: string;
};

function defaultParseDraft(draft: string): string[] {
  const trimmed = draft.trim();
  return trimmed ? [trimmed] : [];
}

function defaultIsDuplicate(_name: string, _values: string[]): boolean {
  return false;
}

export function ChipInput({
  values,
  onChange,
  placeholder,
  disabled,
  suggestions,
  isDuplicate = defaultIsDuplicate,
  parseDraft = defaultParseDraft,
  inputAriaLabel = "Add value",
}: ChipInputProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editHistoryRef = useRef<InputEditHistory | null>(null);
  const menuId = useId();
  const optionIdPrefix = `${menuId}-option`;
  const [draft, setDraft] = useState("");
  const excludeSuggestion = useMemo(
    () => (name: string) => isDuplicate(name, values),
    [isDuplicate, values],
  );

  const {
    setFocused,
    filteredSuggestions,
    activeIndex,
    setActiveIndex,
    handleSuggestionKeyDown,
    open,
    anchor,
    position,
    menuRef,
    menuWidth,
    closeMenu,
  } = useSuggestionAutocomplete({
    suggestions,
    term: draft,
    exclude: excludeSuggestion,
    inputRef,
    containerRef,
    disabled,
  });

  const addValue = useCallback(
    (token: string) => {
      const trimmed = token.trim();
      if (!trimmed || isDuplicate(trimmed, values)) return;
      onChange([...values, trimmed]);
    },
    [isDuplicate, onChange, values],
  );

  const clearDraft = useCallback(() => {
    setDraft("");
    const input = inputRef.current;
    editHistoryRef.current?.setValueWithoutRecord("");
    if (input) input.value = "";
    closeMenu();
  }, [closeMenu]);

  const commitDraft = useCallback(() => {
    if (!draft.trim()) return;
    const tokens = parseDraft(draft);
    if (tokens.length === 0) {
      clearDraft();
      return;
    }
    let next = values;
    for (const token of tokens) {
      const trimmed = token.trim();
      if (!trimmed || isDuplicate(trimmed, next)) continue;
      next = [...next, trimmed];
    }
    if (next.length !== values.length) onChange(next);
    clearDraft();
  }, [draft, values, onChange, parseDraft, isDuplicate, clearDraft]);

  const removeAt = (index: number) => {
    onChange(values.filter((_, i) => i !== index));
  };

  const selectSuggestion = (name: string) => {
    addValue(name);
    clearDraft();
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (handleSuggestionKeyDown(e, selectSuggestion)) return;
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commitDraft();
      return;
    }
    if (e.key === "Backspace" && draft === "" && values.length > 0) {
      e.preventDefault();
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div
      ref={containerRef}
      className={`chip-input${disabled ? " chip-input--disabled" : ""}`}
      onClick={() => inputRef.current?.focus()}
    >
      <div className="chip-input__chips" role="list">
        <TextInput
          ref={inputRef}
          editHistoryRef={editHistoryRef}
          className="chip-input__field"
          variant="ghost"
          value={draft}
          placeholder={values.length === 0 ? placeholder : undefined}
          disabled={disabled}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          aria-activedescendant={
            open && activeIndex >= 0 ? `${optionIdPrefix}-${activeIndex}` : undefined
          }
          aria-label={inputAriaLabel}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            commitDraft();
            closeMenu();
          }}
        />
        {values.map((name, index) => (
          <Chip
            key={`${name}-${index}`}
            label={name}
            onRemove={() => removeAt(index)}
            disabled={disabled}
          />
        ))}
      </div>
      <SuggestionMenu
        id={menuId}
        open={open}
        anchor={anchor}
        position={position}
        menuRef={menuRef}
        menuWidth={menuWidth}
        suggestions={filteredSuggestions}
        onSelect={selectSuggestion}
        activeIndex={activeIndex}
        onActiveIndexChange={setActiveIndex}
        optionIdPrefix={optionIdPrefix}
      />
    </div>
  );
}
