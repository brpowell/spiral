export type SuggestionFilterOptions = {
  limit?: number;
  exclude?: (suggestion: string) => boolean;
};

export function filterSubstringSuggestions(
  suggestions: string[],
  term: string,
  options: SuggestionFilterOptions = {},
): string[] {
  const { limit = 50, exclude } = options;
  const normalized = term.trim().toLowerCase();

  return suggestions
    .filter((suggestion) => (exclude ? !exclude(suggestion) : true))
    .filter(
      (suggestion) =>
        normalized.length === 0 ||
        suggestion.trim().toLowerCase() !== normalized,
    )
    .filter(
      (suggestion) =>
        normalized.length === 0 ||
        suggestion.toLowerCase().includes(normalized),
    )
    .slice(0, limit);
}
