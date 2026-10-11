import { describe, expect, it } from "vitest";
import { scopeSkinStylesheet, skinScopeSelector } from "./scopeSkinStylesheet";

describe("scopeSkinStylesheet", () => {
  it("prefixes simple selectors", () => {
    const scoped = scopeSkinStylesheet(
      ".skin-text { color: red; }",
      "t3",
    );
    expect(scoped).toContain(
      `${skinScopeSelector("t3")} .skin-text`,
    );
    expect(scoped).toContain("color: red");
  });

  it("prefixes selectors inside @media", () => {
    const scoped = scopeSkinStylesheet(
      "@media (min-width: 400px) { .foo { display: block; } }",
      "t3",
    );
    expect(scoped).toContain("@media (min-width: 400px)");
    expect(scoped).toContain(`${skinScopeSelector("t3")} .foo`);
  });

  it("leaves @keyframes untouched", () => {
    const css = `@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
.fade { animation: fade 1s; }`;
    const scoped = scopeSkinStylesheet(css, "t3");
    expect(scoped).toContain("@keyframes fade");
    expect(scoped).toContain(`${skinScopeSelector("t3")} .fade`);
  });

  it("supports :global() escape hatch", () => {
    const scoped = scopeSkinStylesheet(
      ":global(.host-only) { z-index: 1; }",
      "t3",
    );
    expect(scoped).toContain(".host-only");
    expect(scoped).not.toContain('[data-skin-id="t3"] .host-only');
  });

  it("does not double-prefix existing skin scope", () => {
    const css = `[data-skin-id="t3"] .skin-text { color: blue; }`;
    const scoped = scopeSkinStylesheet(css, "t3");
    expect(scoped).toBe(css);
  });

  it("scopes descendant selectors for bounded components", () => {
    const scoped = scopeSkinStylesheet(
      `.skin-bounds[data-bounds-for="pl-view"] .skin-playlist-view {
        background: #285f03;
        font: 11px/1.25 Tahoma, Arial, sans-serif;
      }`,
      "headspace",
    );
    expect(scoped).toContain(
      `${skinScopeSelector("headspace")} .skin-bounds[data-bounds-for="pl-view"] .skin-playlist-view`,
    );
  });
});
