import postcss from "postcss";
import prefixSelector from "postcss-prefix-selector";

/** CSS Modules-style escape hatch for rare unscoped rules (e.g. @font-face companions). */
const GLOBAL_SELECTOR_RE = /^:global\(\s*([\s\S]+?)\s*\)$/;

export function skinScopeSelector(skinId: string): string {
  return `[data-skin-id=${JSON.stringify(skinId)}]`;
}

/**
 * Prefix every rule in a skin pack stylesheet with `[data-skin-id="…"]` so
 * authors write plain selectors without leaking into the host app.
 */
export function scopeSkinStylesheet(css: string, skinId: string): string {
  const prefix = skinScopeSelector(skinId);

  const result = postcss([
    prefixSelector({
      prefix,
      transform(_prefix, selector, prefixedSelector) {
        const globalMatch = GLOBAL_SELECTOR_RE.exec(selector.trim());
        if (globalMatch) {
          return globalMatch[1];
        }
        if (selector.includes("[data-skin-id=")) {
          return selector;
        }
        return prefixedSelector;
      },
    }),
  ]).process(css, { from: undefined });

  return result.css;
}
