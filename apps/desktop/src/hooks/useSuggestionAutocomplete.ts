import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { filterSubstringSuggestions } from "../lib/suggestionFilter";
import { useInputAnchoredMenu } from "./useInputAnchoredMenu";

export type UseSuggestionAutocompleteOptions = {
  suggestions?: string[];
  term: string;
  exclude?: (suggestion: string) => boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  containerRef: RefObject<HTMLElement | null>;
  disabled?: boolean;
};

export function useSuggestionAutocomplete({
  suggestions,
  term,
  exclude,
  inputRef,
  containerRef,
  disabled,
}: UseSuggestionAutocompleteOptions) {
  const [focused, setFocused] = useState(false);

  const filteredSuggestions = useMemo(() => {
    if (!suggestions?.length) return [];
    return filterSubstringSuggestions(suggestions, term, { exclude });
  }, [suggestions, term, exclude]);

  const menu = useInputAnchoredMenu({
    inputRef,
    containerRef,
    disabled,
    shouldOpen: focused && filteredSuggestions.length > 0,
    layoutDeps: [filteredSuggestions.length],
  });

  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    if (!menu.open || filteredSuggestions.length === 0) {
      setActiveIndex(-1);
      return;
    }
    setActiveIndex((prev) =>
      prev >= 0 && prev < filteredSuggestions.length ? prev : 0,
    );
  }, [menu.open, filteredSuggestions.length]);

  const handleSuggestionKeyDown = useCallback(
    (e: KeyboardEvent, onSelect: (suggestion: string) => void): boolean => {
      const count = filteredSuggestions.length;
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && count > 0) {
        e.preventDefault();
        setActiveIndex((prev) => {
          const max = count - 1;
          if (e.key === "ArrowDown") return prev >= max ? 0 : prev + 1;
          return prev <= 0 ? max : prev - 1;
        });
        return true;
      }
      if (e.key === "Enter" && menu.open && activeIndex >= 0) {
        e.preventDefault();
        const suggestion = filteredSuggestions[activeIndex];
        if (suggestion) onSelect(suggestion);
        return true;
      }
      if (menu.open && count > 0 && e.key === "Home") {
        e.preventDefault();
        setActiveIndex(0);
        return true;
      }
      if (menu.open && count > 0 && e.key === "End") {
        e.preventDefault();
        setActiveIndex(count - 1);
        return true;
      }
      return false;
    },
    [menu.open, activeIndex, filteredSuggestions],
  );

  return {
    focused,
    setFocused,
    filteredSuggestions,
    activeIndex,
    setActiveIndex,
    handleSuggestionKeyDown,
    ...menu,
  };
}
