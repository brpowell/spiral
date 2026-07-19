import { useRef, type KeyboardEvent } from "react";
import { IconClose, IconSearch } from "../icons";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "../common/InputGroup/InputGroup";
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

  return (
    <InputGroup className={["search-field", className].filter(Boolean).join(" ")}>
      <InputGroupInput
        ref={inputRef}
        role="searchbox"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onEscape={handleEscape}
        aria-label={ariaLabel}
      />
      <InputGroupAddon align="inline-start">
        <IconSearch aria-hidden />
      </InputGroupAddon>
      <InputGroupAddon
        align="inline-end"
        className={!value ? "search-field__clear--hidden" : undefined}
      >
        <InputGroupButton
          aria-label="Clear search"
          aria-hidden={!value}
          tabIndex={value ? 0 : -1}
          disabled={!value}
          onClick={() => clear(true)}
        >
          <IconClose />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
