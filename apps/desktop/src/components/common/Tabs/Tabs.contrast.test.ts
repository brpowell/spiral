// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { builtinThemeColors } from "../../../lib/builtinThemeColors.testutil";
import {
  MIN_TEXT_CONTRAST,
  accessibleSelectedText,
  hexContrastRatio,
  selectedTextSurfacesHex,
} from "../../../lib/accessibleColor";
import { windowAppearanceForBackground } from "../../../lib/theme";

const TABS_CSS = readFileSync(join(__dirname, "Tabs.css"), "utf8");

/** Body of the first rule whose selector matches exactly. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(
    TABS_CSS,
  );
  if (!match) throw new Error(`Rule not found: ${selector}`);
  return match[1]!;
}

describe("tab selected-state colors", () => {
  it.each([
    ".tabs--underline .tabs__tab--selected",
    ".tabs__badge",
    ".tabs__indicator",
  ])("%s uses the selected-text token, not the raw accent", (selector) => {
    const body = ruleBody(selector);
    expect(body).toContain("var(--color-interactive-selected-text)");
    expect(body).not.toMatch(/var\(--color-accent\)/);
  });

  // Tab strips sit on the page (About, item detail), modal surfaces (editors),
  // and the raised surface inside the track editor.
  it.each(builtinThemeColors())(
    "selected label clears AA on every tab surface for $id",
    ({ bg, ink, accent }) => {
      const label = accessibleSelectedText(
        bg,
        ink,
        accent,
        windowAppearanceForBackground(bg),
      )!;
      for (const surface of selectedTextSurfacesHex(bg, ink, accent)!) {
        // Hex rounding can shave a hair off the exact ratio.
        expect(hexContrastRatio(label, surface)!).toBeGreaterThanOrEqual(
          MIN_TEXT_CONTRAST - 0.02,
        );
      }
    },
  );
});
