/**
 * Pre-load checks for pack visualizer draw-module source.
 *
 * Pack draw modules are a single host-supplied JS module — no secondary imports,
 * workers, or eval-style code loading. This is best-effort static analysis;
 * the worker also stubs the corresponding runtime APIs.
 */

interface VizSourceViolation {
  id: string;
  message: string;
}

const FORBIDDEN: ReadonlyArray<{
  id: string;
  pattern: RegExp;
  message: string;
}> = [
  {
    id: "eval",
    pattern: /\beval\s*\(/,
    message: "eval() is not allowed in pack draw modules",
  },
  {
    id: "function-constructor",
    pattern: /\bFunction\s*\(/,
    message: "Function() constructor is not allowed in pack draw modules",
  },
  {
    id: "dynamic-import",
    pattern: /\bimport\s*\(/,
    message: "dynamic import() is not allowed — ship a single entry module",
  },
  {
    id: "static-import",
    pattern: /\bimport\b\s*(?:['"{*]|[\w$])/,
    message: "import statements are not allowed — ship a single entry module",
  },
  {
    id: "importScripts",
    pattern: /\bimportScripts\s*\(/,
    message: "importScripts() is not allowed in pack draw modules",
  },
  {
    id: "worker",
    pattern: /\bnew\s+Worker\s*\(/,
    message: "nested Worker is not allowed in pack draw modules",
  },
  {
    id: "shared-worker",
    pattern: /\bnew\s+SharedWorker\s*\(/,
    message: "SharedWorker is not allowed in pack draw modules",
  },
  {
    id: "create-object-url",
    pattern: /\bcreateObjectURL\s*\(/,
    message: "URL.createObjectURL is not allowed in pack draw modules",
  },
  {
    id: "webassembly",
    pattern: /\bWebAssembly\b/,
    message: "WebAssembly is not allowed in pack draw modules",
  },
];

/** Strip // and block comments so ban checks ignore documentation. */
function stripJsComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

/** Return all static violations, or an empty array if the source is allowed. */
export function findVizSourceViolations(source: string): VizSourceViolation[] {
  const text = stripJsComments(source);
  const hits: VizSourceViolation[] = [];
  for (const rule of FORBIDDEN) {
    if (rule.pattern.test(text)) {
      hits.push({ id: rule.id, message: rule.message });
    }
  }
  return hits;
}

/**
 * Throw if pack source uses banned code-loading patterns.
 * Safe to call from the host and again inside the worker.
 */
export function assertVizRendererSourceAllowed(source: string): void {
  const violations = findVizSourceViolations(source);
  if (violations.length === 0) return;
  const detail = violations.map((v) => v.message).join("; ");
  throw new Error(`[viz-sandbox] rejected draw module source: ${detail}`);
}
