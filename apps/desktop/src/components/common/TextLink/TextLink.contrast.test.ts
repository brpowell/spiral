import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(__dirname, path), "utf8");

describe("link colors", () => {
  it.each([
    ["TextLink.css", ".text-link"],
    [
      "../../DetailArtistLink/DetailArtistLink.css",
      ".detail-artist-link:hover",
    ],
  ])("%s paints %s with the washed link token", (file, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\:]/g, "\\$&");
    const body = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(
      read(file),
    )![1]!;
    expect(body).toContain("var(--color-link)");
    expect(body).not.toMatch(/var\(--color-accent\)/);
  });

  it("aliases the link token to the tab selected-text wash", () => {
    const theme = read("../../../styles/theme.css");
    expect(theme).toContain(
      "--color-link: var(--color-interactive-selected-text);",
    );
  });
});
