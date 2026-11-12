import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(process.cwd(), "src-tauri/packs/builtin/visualizers");

function builtinSources(): { id: string; source: string }[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((dir) => dir.isDirectory())
    .map((dir) => ({
      id: dir.name,
      source: readFileSync(join(root, dir.name, "index.js"), "utf8"),
    }));
}

describe("builtin visualizers", () => {
  // Frame rate follows render cost (viewport size) on WebKitGTK, so a fixed
  // per-frame step made idle animations fast when small and slow when large.
  it("advance idle animation by elapsed time, not per frame", () => {
    const sources = builtinSources();
    expect(sources.length).toBeGreaterThanOrEqual(4);
    for (const { id, source } of sources) {
      const steps = source.match(/idlePhase\s*\+=[^;]*;/g) ?? [];
      for (const step of steps) {
        expect(step, `${id}: ${step}`).toMatch(/\bdt\b/);
      }
    }
  });
});
