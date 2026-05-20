import { useRef, type KeyboardEvent } from "react";
import { IconClose, IconSearch } from "../icons";
import { TextInput } from "../TextInput/TextInput";
import "./SearchField.css";

export interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  "aria-label": string;
  className?: string;
}

export function SearchField({
  value,
  onChange,
  placeholder,
  "aria-label": ariaLabel,
  className,
}: SearchFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const clear = (refocus = false) => {
    onChange("");
    const input = inputRef.current;
    if (input) input.value = "";
    if (refocus) input?.focus();
  };

  const handleEscape = (e: KeyboardEvent<HTMLInputElement>) => {
    if (value) clear();
    e.currentTarget.blur();
  };

  const rootClass = ["search-field", className].filter(Boolean).join(" ");

  return (
    <div className={rootClass}>
      <IconSearch />
      <TextInput
        ref={inputRef}
        variant="ghost"
        role="searchbox"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onEscape={handleEscape}
        aria-label={ariaLabel}
      />
      <button
        type="button"
        className="search-field__clear"
        onClick={() => clear(true)}
        disabled={!value}
        tabIndex={value ? 0 : -1}
        aria-label="Clear search"
        aria-hidden={!value}
      >
        <IconClose />
      </button>
    </div>
  );
}
