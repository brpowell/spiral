import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Core colors of each built-in theme, read straight from its theme.json. */
export function builtinThemeColors(): {
  id: string;
  bg: string;
  ink: string;
  accent: string;
}[] {
  const dir = join(process.cwd(), "src-tauri/packs/builtin/themes");
  return readdirSync(dir)
    .filter((name) => name.startsWith("spiral."))
    .map((id) => {
      const { tokens } = JSON.parse(
        readFileSync(join(dir, id, "theme.json"), "utf8"),
      ) as { tokens: Record<string, string> };
      return {
        id,
        bg: tokens["color-bg"]!,
        ink: tokens["color-text-primary"]!,
        accent: tokens["color-accent"]!,
      };
    });
}
