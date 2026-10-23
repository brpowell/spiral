/**
 * Pre-load checks for pack visualizer draw-module source.
 *
 * Pack draw modules are a single host-supplied JS module — no secondary imports,
 * workers, or eval-style code loading. The source is parsed as an ES module and
 * the syntax tree is checked, so comments and string literals cannot hide or
 * fake banned code. Computed access (`self["ev" + "al"]`) is out of reach of a
 * static check; the worker's CSP and global lockdown cover that at runtime.
 */

import { parse, type Node } from "acorn";

interface VizSourceViolation {
  id: string;
  message: string;
}

const MESSAGES = {
  parse: "draw module source must parse as an ES module",
  eval: "eval() is not allowed in pack draw modules",
  "function-constructor":
    "Function() constructor is not allowed in pack draw modules",
  "dynamic-import":
    "dynamic import() is not allowed — ship a single entry module",
  "static-import":
    "import statements and export-from are not allowed — ship a single entry module",
  "import-meta": "import.meta is not allowed in pack draw modules",
  importScripts: "importScripts() is not allowed in pack draw modules",
  worker: "nested Worker is not allowed in pack draw modules",
  "shared-worker": "SharedWorker is not allowed in pack draw modules",
  "create-object-url":
    "URL.createObjectURL is not allowed in pack draw modules",
  webassembly: "WebAssembly is not allowed in pack draw modules",
} as const;

type ViolationId = keyof typeof MESSAGES;

/** Any reference to these names, as a variable or a member (`self.eval`). */
const BANNED_NAMES: ReadonlyMap<string, ViolationId> = new Map([
  ["eval", "eval"],
  ["Function", "function-constructor"],
  ["importScripts", "importScripts"],
  ["Worker", "worker"],
  ["SharedWorker", "shared-worker"],
  ["createObjectURL", "create-object-url"],
  ["WebAssembly", "webassembly"],
]);

type AnyNode = Node & Record<string, unknown>;

function isNode(value: unknown): value is AnyNode {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

/** Name an identifier or string-literal key, or `null` for anything else. */
function staticName(node: unknown): string | null {
  if (!isNode(node)) return null;
  if (node.type === "Identifier") return node.name as string;
  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (
    node.type === "TemplateLiteral" &&
    (node.expressions as unknown[]).length === 0
  ) {
    const [quasi] = node.quasis as { value: { cooked: string | null } }[];
    return quasi?.value.cooked ?? null;
  }
  return null;
}

/**
 * Identifiers that are not variable references: non-computed member names,
 * object/class keys, and labels. Member names are checked separately so that
 * `URL.createObjectURL` and `self["eval"]` still count.
 */
function nonReferenceIdentifiers(node: AnyNode, skip: Set<unknown>): void {
  switch (node.type) {
    case "MemberExpression":
      if (!node.computed) skip.add(node.property);
      break;
    case "Property":
    case "MethodDefinition":
    case "PropertyDefinition":
      if (!node.computed) skip.add(node.key);
      break;
    case "LabeledStatement":
    case "BreakStatement":
    case "ContinueStatement":
      skip.add(node.label);
      break;
  }
}

function checkNode(
  node: AnyNode,
  skip: Set<unknown>,
  hit: (id: ViolationId) => void,
): void {
  switch (node.type) {
    case "ImportDeclaration":
    case "ExportAllDeclaration":
      hit("static-import");
      return;
    case "ExportNamedDeclaration":
      if (node.source) hit("static-import");
      return;
    case "ImportExpression":
      hit("dynamic-import");
      return;
    case "MetaProperty": {
      const meta = node.meta as { name?: string };
      if (meta.name === "import") hit("import-meta");
      return;
    }
    case "MemberExpression": {
      const id = BANNED_NAMES.get(staticName(node.property) ?? "");
      if (id) hit(id);
      return;
    }
    case "Identifier": {
      if (skip.has(node)) return;
      const id = BANNED_NAMES.get(node.name as string);
      if (id) hit(id);
      return;
    }
  }
}

/** Return all static violations, or an empty array if the source is allowed. */
export function findVizSourceViolations(source: string): VizSourceViolation[] {
  let program: Node;
  try {
    program = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  } catch {
    return [{ id: "parse", message: MESSAGES.parse }];
  }

  const found = new Set<ViolationId>();
  const hit = (id: ViolationId): void => {
    found.add(id);
  };
  const skip = new Set<unknown>();
  const stack: AnyNode[] = [program as AnyNode];
  while (stack.length > 0) {
    const node = stack.pop()!;
    nonReferenceIdentifiers(node, skip);
    checkNode(node, skip, hit);
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) if (isNode(item)) stack.push(item);
      } else if (isNode(child)) {
        stack.push(child);
      }
    }
  }

  return (Object.keys(MESSAGES) as ViolationId[])
    .filter((id) => found.has(id))
    .map((id) => ({ id, message: MESSAGES[id] }));
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
