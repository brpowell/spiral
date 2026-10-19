import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertVizRendererSourceAllowed,
  findVizSourceViolations,
} from "./vizSourceGuard";

const VALID_CANVAS2D = `
export function create() {
  return {
    render(ctx, frame) {
      ctx.fillRect(0, 0, 10, 10);
    },
  };
}
`;

describe("findVizSourceViolations", () => {
  it("allows a normal single-file canvas renderer", () => {
    expect(findVizSourceViolations(VALID_CANVAS2D)).toEqual([]);
  });

  it("ignores banned tokens inside comments", () => {
    expect(
      findVizSourceViolations(`
        // do not call eval(
        /* nor import("https://evil") */
        export function create() { return { render() {} }; }
      `),
    ).toEqual([]);
  });

  it.each([
    ["eval", "eval('x')"],
    ["function-constructor", "Function('return 1')"],
    ["dynamic-import", "import('https://evil.example/x.js')"],
    ["static-import", "import foo from './other.js'"],
    ["static-import", 'import "./other.js"'],
    ["static-import", "import { create } from './other.js'"],
    ["importScripts", "importScripts('https://evil.example/x.js')"],
    ["worker", "new Worker('https://evil.example/w.js')"],
    ["shared-worker", "new SharedWorker('https://evil.example/w.js')"],
    ["create-object-url", "URL.createObjectURL(new Blob(['']))"],
    ["webassembly", "WebAssembly.instantiate(buf)"],
  ])("rejects %s", (id, snippet) => {
    const source = `export function create() { ${snippet}; return { render() {} }; }`;
    const hits = findVizSourceViolations(source);
    expect(hits.map((h) => h.id)).toContain(id);
  });

  it("does not treat 'important' as an import statement", () => {
    expect(
      findVizSourceViolations(`
        export function create() {
          const important = true;
          return { render() {} };
        }
      `),
    ).toEqual([]);
  });

  it("allows stock builtin visualizer entry sources", () => {
    const root = join(process.cwd(), "src-tauri/packs/builtin/visualizers");
    const sources = readdirSync(root, { withFileTypes: true })
      .filter((dir) => dir.isDirectory())
      .map((dir) => join(root, dir.name, "index.js"))
      .filter((path) => {
        try {
          readFileSync(path, "utf8");
          return true;
        } catch {
          return false;
        }
      })
      .map((path) => readFileSync(path, "utf8"));
    expect(sources.length).toBeGreaterThanOrEqual(4);
    for (const source of sources) {
      expect(findVizSourceViolations(source)).toEqual([]);
    }
  });
});

describe("assertVizRendererSourceAllowed", () => {
  it("returns for valid source", () => {
    expect(() => assertVizRendererSourceAllowed(VALID_CANVAS2D)).not.toThrow();
  });

  it("throws with a sandbox-prefixed message", () => {
    expect(() =>
      assertVizRendererSourceAllowed("export function create() { eval('x'); }"),
    ).toThrow(/\[viz-sandbox\] rejected draw module source/);
  });
});
