import {
  useCallback,
  useId,
  useRef,
  type ComponentPropsWithoutRef,
} from "react";
import { flushSync } from "react-dom";
import { useSuggestionAutocomplete } from "../../../hooks/useSuggestionAutocomplete";
import { SuggestionMenu } from "../SuggestionMenu/SuggestionMenu";
import { TextInput } from "../TextInput/TextInput";
import "./AutocompleteInput.css";

export type AutocompleteInputProps = Omit<
  ComponentPropsWithoutRef<typeof TextInput>,
  "role" | "aria-autocomplete" | "aria-expanded" | "aria-controls"
> & {
  suggestions?: string[];
};

function applyInputValue(
  input: HTMLInputElement,
  value: string,
  onChange: AutocompleteInputProps["onChange"],
) {
  input.value = value;
  flushSync(() => {
    onChange?.({
      target: input,
      currentTarget: input,
    } as React.ChangeEvent<HTMLInputElement>);
  });
}

export function AutocompleteInput({
  suggestions,
  disabled,
  value,
  onChange,
  onBlur,
  onFocus,
  onKeyDown,
  ...props
}: AutocompleteInputProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuId = useId();
  const optionIdPrefix = `${menuId}-option`;
  const term = value != null ? String(value) : "";

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
    term,
    inputRef,
    containerRef,
    disabled,
  });

  const selectSuggestion = useCallback(
    (suggestion: string) => {
      const input = inputRef.current;
      if (!input) return;
      applyInputValue(input, suggestion, onChange);
      closeMenu();
      input.focus();
    },
    [onChange, closeMenu],
  );

  return (
    <div ref={containerRef} className="autocomplete-input">
      <TextInput
        ref={inputRef}
        {...props}
        value={value}
        disabled={disabled}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-activedescendant={
          open && activeIndex >= 0 ? `${optionIdPrefix}-${activeIndex}` : undefined
        }
        onChange={onChange}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          closeMenu();
          onBlur?.(e);
        }}
        onKeyDown={(e) => {
          if (handleSuggestionKeyDown(e, selectSuggestion)) return;
          if (e.key === "Escape") closeMenu();
          onKeyDown?.(e);
        }}
      />
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
