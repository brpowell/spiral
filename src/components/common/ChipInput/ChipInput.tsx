import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useContextMenu } from "../../../hooks/useContextMenu";
import { ContextMenu } from "../../ContextMenu/ContextMenu";
import { Chip } from "../Chip/Chip";
import { TextInput } from "../TextInput/TextInput";
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
  const [draft, setDraft] = useState("");
  const { open, anchor, position, menuRef, openAt, closeMenu } = useContextMenu({
    dismissExcludeRefs: [containerRef],
    closeOnScroll: false,
  });

  const addValue = useCallback(
    (token: string) => {
      const trimmed = token.trim();
      if (!trimmed || isDuplicate(trimmed, values)) return;
      onChange([...values, trimmed]);
    },
    [isDuplicate, onChange, values],
  );

  const commitDraft = useCallback(() => {
    if (!draft.trim()) return;
    const tokens = parseDraft(draft);
    if (tokens.length === 0) {
      setDraft("");
      closeMenu();
      return;
    }
    let next = values;
    for (const token of tokens) {
      const trimmed = token.trim();
      if (!trimmed || isDuplicate(trimmed, next)) continue;
      next = [...next, trimmed];
    }
    if (next.length !== values.length) onChange(next);
    setDraft("");
    closeMenu();
  }, [draft, values, onChange, parseDraft, isDuplicate, closeMenu]);

  const removeAt = (index: number) => {
    onChange(values.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
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

  const filteredSuggestions = useMemo(() => {
    if (!suggestions || suggestions.length === 0) return [];
    const term = draft.trim().toLowerCase();
    if (term.length === 0) return [];
    return suggestions
      .filter((name) => !isDuplicate(name, values))
      .filter((name) => name.toLowerCase().includes(term))
      .slice(0, 50);
  }, [suggestions, draft, isDuplicate, values]);

  useEffect(() => {
    const input = inputRef.current;
    if (
      !input ||
      disabled ||
      document.activeElement !== input ||
      draft.trim().length === 0 ||
      filteredSuggestions.length === 0
    ) {
      closeMenu();
      return;
    }
    const rect = input.getBoundingClientRect();
    openAt(rect.left, rect.bottom + 4);
  }, [draft, filteredSuggestions.length, disabled, openAt, closeMenu]);

  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const input = inputRef.current;
      if (!input) return;
      const rect = input.getBoundingClientRect();
      openAt(rect.left, rect.bottom + 4);
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, openAt]);

  const selectSuggestion = (name: string) => {
    addValue(name);
    setDraft("");
    closeMenu();
    inputRef.current?.focus();
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
          className="chip-input__field"
          variant="ghost"
          value={draft}
          placeholder={values.length === 0 ? placeholder : undefined}
          disabled={disabled}
          aria-label={inputAriaLabel}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
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
      <ContextMenu open={open} anchor={anchor} position={position} menuRef={menuRef}>
        <div className="chip-input__menu" role="presentation">
          {filteredSuggestions.map((name) => (
            <button
              key={name}
              type="button"
              role="menuitem"
              className="chip-input__menu-item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => selectSuggestion(name)}
            >
              {name}
            </button>
          ))}
        </div>
      </ContextMenu>
    </div>
  );
}
