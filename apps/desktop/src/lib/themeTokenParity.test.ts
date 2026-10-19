import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REQUIRED_THEME_TOKEN_KEYS } from "../types/theme";

/** Keys listed in the Rust `REQUIRED_THEME_TOKEN_KEYS` constant. */
function rustRequiredKeys(): string[] {
  const source = readFileSync(
    join(process.cwd(), "../../libs/spk-format/src/theme.rs"),
    "utf8",
  );
  const block =
    /pub const REQUIRED_THEME_TOKEN_KEYS[^=]*=\s*&\[([^\]]*)\]/.exec(source);
  if (!block)
    throw new Error("REQUIRED_THEME_TOKEN_KEYS not found in theme.rs");
  return [...block[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

describe("required theme tokens", () => {
  it("match between the app and the spk-format validator", () => {
    // Two lists that drift apart make themes the editor produces fail install and
    // export (issue #36): keep them identical.
    expect([...rustRequiredKeys()].sort()).toEqual(
      [...REQUIRED_THEME_TOKEN_KEYS].sort(),
    );
  });
});
