#!/usr/bin/env node
// Stage the running app into recorded states and capture marketing shots.
// Needs `npm run dev:agent`. See docs/contributing/marketing-stage.md.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { call, evalBody } from "./lib/agentClient.mjs";
import { expandShots, resolveScene } from "./lib/stageScenes.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCENES_DIR = path.join(ROOT, "marketing", "scenes");
const OUT_DIR = path.join(ROOT, "marketing", "out");

const HELP = `usage: node scripts/stage.mjs <command> [args]

  list                              scenes (and what each expands to)
  save <name> [options]             record the live app as marketing/scenes/<name>.json
      --notes "text"                what this shot is meant to show
      --slot <slot>                 slot label for downstream tools, e.g. hero.light or theme.{theme}
      --base                        inherit-only scene (skipped by shoot --all)
      --extends <scene>             store only what differs from another scene
      --window <label>              window to record (default: main)
      --with-position               also record x/y (machine specific, off by default)
  assign <name> <slot>              set a scene's slot label (e.g. hero.dark, theme.{theme});
                                    also updates an existing capture manifest
  snapshot <file.json>              record the app's current state + window size to a file
  restore <file.json>               put the app back as a snapshot recorded it
  apply <name>                      stage the app to a scene, no capture
  shoot <name | --all> [--only a,b] [--strict]
                                    stage + native-window capture into marketing/out/
                                    (--strict: a scene with warnings fails, uncaptured)
`;

const flag = (args, name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const has = (args, name) => args.includes(name);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sceneFile = (name) => path.join(SCENES_DIR, `${name}.json`);

function loadScenes() {
  const scenes = {};
  const files = {};
  if (!fs.existsSync(SCENES_DIR)) return scenes;
  for (const file of fs.readdirSync(SCENES_DIR)) {
    if (!file.endsWith(".json")) continue;
    const scene = JSON.parse(
      fs.readFileSync(path.join(SCENES_DIR, file), "utf8"),
    );
    scene.name ??= file.replace(/\.json$/, "");
    if (scenes[scene.name]) {
      throw new Error(
        `scene name "${scene.name}" is used by both ${files[scene.name]} and ${file}; give each file its own "name" (a copied scene keeps the old one)`,
      );
    }
    files[scene.name] = file;
    scenes[scene.name] = scene;
  }
  return scenes;
}

const stageCall = (window, method, arg) =>
  evalBody(
    window,
    `if (!window.__stage) throw new Error("window.__stage missing: run the app with npm run dev:agent (dev build) and wait for it to finish loading");
     return await window.__stage.${method}(${arg === undefined ? "" : JSON.stringify(arg)});`,
    60000,
  );

async function applyShot(shot, strict = false) {
  const window = shot.window?.label ?? "main";
  await call({ cmd: "show", window });
  const { width, height, x, y } = shot.window ?? {};
  if (width && height) {
    await call({ cmd: "set_geometry", window, width, height, x, y });
    await sleep(400);
  }
  const warnings = await stageCall(window, "apply", shot.app ?? {});
  for (const w of warnings) console.warn(`  warning: ${w}`);
  if (strict && warnings.length) {
    throw new Error(warnings.join("; "));
  }
  return window;
}

async function save(name, args) {
  if (!name) throw new Error("save needs a scene name");
  const window = flag(args, "--window") ?? "main";
  const geometry = await call({ cmd: "geometry", window });
  const { state, warnings } = await stageCall(window, "capture");
  for (const w of warnings) console.warn(`warning: ${w}`);

  let scene = {
    name,
    notes: flag(args, "--notes") ?? "",
    window: {
      ...(window === "main" ? {} : { label: window }),
      width: Math.round(geometry.inner[0]),
      height: Math.round(geometry.inner[1]),
      ...(has(args, "--with-position")
        ? {
            x: Math.round(geometry.position[0]),
            y: Math.round(geometry.position[1]),
          }
        : {}),
    },
    app: state,
  };
  if (has(args, "--base")) scene.base = true;
  const slot = flag(args, "--slot");
  if (slot) scene.publish = { slot };
  const parentName = flag(args, "--extends");
  if (parentName) {
    const parent = resolveScene(parentName, loadScenes());
    scene = { ...scene, extends: parentName, ...diff(parent, scene) };
  }
  fs.mkdirSync(SCENES_DIR, { recursive: true });
  fs.writeFileSync(sceneFile(name), JSON.stringify(scene, null, 2) + "\n");
  console.log(`saved ${path.relative(ROOT, sceneFile(name))}`);
}

/** Keys of `scene` whose values differ from `parent`, recursively. */
function diff(parent, scene) {
  const out = { name: scene.name };
  for (const key of ["notes", "window", "app"]) {
    const d = diffValue(parent[key], scene[key]);
    if (d !== undefined) out[key] = d;
  }
  return out;
}
function diffValue(a, b) {
  if (JSON.stringify(a) === JSON.stringify(b)) return undefined;
  if (
    a &&
    b &&
    typeof a === "object" &&
    typeof b === "object" &&
    !Array.isArray(b)
  ) {
    const out = {};
    for (const key of Object.keys(b)) {
      const d = diffValue(a[key], b[key]);
      if (d !== undefined) out[key] = d;
    }
    return out;
  }
  return b;
}

function shotsFor(names, scenes, only) {
  const shots = [];
  for (const name of names) {
    for (const shot of expandShots(resolveScene(name, scenes))) {
      if (only && !only.some((o) => shot.variant.includes(o))) continue;
      shots.push(shot);
    }
  }
  return shots;
}

async function shoot(args) {
  const scenes = loadScenes();
  const names = has(args, "--all")
    ? Object.values(scenes)
        .filter((s) => !s.base)
        .map((s) => s.name)
    : [args.find((a) => !a.startsWith("--"))].filter(Boolean);
  if (!names.length) throw new Error("shoot needs a scene name or --all");
  const only = flag(args, "--only")?.split(",");
  const shots = shotsFor(names, scenes, only);
  if (!shots.length) throw new Error("nothing to shoot (check --only)");

  const strict = has(args, "--strict");
  const manifest = [];
  const failures = [];
  for (const shot of shots) {
    console.log(`${shot.variant}`);
    try {
      const window = await applyShot(shot, strict);
      const out = path.join(OUT_DIR, `${shot.variant}.png`);
      await call({ cmd: "capture", window, out });
      console.log(`  -> ${path.relative(ROOT, out)}`);
      manifest.push({
        scene: shot.name,
        variant: shot.variant,
        slot: shot.publish?.slot ?? null,
        file: path.relative(ROOT, out),
        notes: shot.notes ?? "",
        publish: shot.publish ?? null,
      });
    } catch (err) {
      console.error(`  failed: ${err.message}`);
      failures.push(`${shot.variant}: ${err.message}`);
    }
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifestPath = path.join(OUT_DIR, "manifest.json");
  const previous = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    : [];
  const fresh = new Set(manifest.map((m) => m.variant));
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      [...previous.filter((m) => !fresh.has(m.variant)), ...manifest],
      null,
      2,
    ) + "\n",
  );
  if (failures.length) {
    throw new Error(
      `${failures.length} shot(s) failed:\n  ${failures.join("\n  ")}`,
    );
  }
}

function assign(name, slot) {
  if (!name || !slot) throw new Error("assign needs a scene name and a slot");
  const file = sceneFile(name);
  if (!fs.existsSync(file)) throw new Error(`no scene "${name}" (${file})`);
  const scene = JSON.parse(fs.readFileSync(file, "utf8"));
  scene.publish = { ...scene.publish, slot };
  fs.writeFileSync(file, JSON.stringify(scene, null, 2) + "\n");
  console.log(`${name} -> ${slot}`);

  // Keep an existing capture manifest in step so no re-shoot is needed. A
  // matrix scene expands slot tokens per variant, so those need a re-shoot.
  const manifestPath = path.join(OUT_DIR, "manifest.json");
  if (!fs.existsSync(manifestPath)) return;
  const resolved = resolveScene(name, loadScenes());
  if (resolved.matrix) {
    return console.log("matrix scene: re-run `shoot` to refresh the manifest");
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  let touched = 0;
  for (const entry of manifest) {
    if (entry.scene !== name) continue;
    entry.slot = slot;
    entry.publish = { ...entry.publish, slot };
    touched++;
  }
  if (touched) {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    console.log(
      `updated ${touched} manifest entr${touched === 1 ? "y" : "ies"}`,
    );
  }
}

async function snapshotState(file) {
  if (!file) throw new Error("snapshot needs an output file");
  const geometry = await call({ cmd: "geometry", window: "main" });
  const { state } = await stageCall("main", "capture");
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        window: {
          width: Math.round(geometry.inner[0]),
          height: Math.round(geometry.inner[1]),
          x: Math.round(geometry.position[0]),
          y: Math.round(geometry.position[1]),
        },
        app: state,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`snapshot written to ${file}`);
}

async function restoreState(file) {
  if (!file) throw new Error("restore needs a snapshot file");
  const snap = JSON.parse(fs.readFileSync(file, "utf8"));
  await applyShot({ variant: "restore", ...snap });
  console.log(`restored from ${file}`);
}

function list() {
  const scenes = loadScenes();
  for (const scene of Object.values(scenes)) {
    const tag = scene.base ? " (base)" : "";
    console.log(`${scene.name}${tag}${scene.notes ? ` - ${scene.notes}` : ""}`);
    if (!scene.base) {
      for (const shot of expandShots(resolveScene(scene.name, scenes))) {
        console.log(
          `    ${shot.variant}${shot.publish?.slot ? `  => ${shot.publish.slot}` : ""}`,
        );
      }
    }
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "list":
      return list();
    case "save":
      return save(rest[0], rest.slice(1));
    case "snapshot":
      return snapshotState(rest[0]);
    case "restore":
      return restoreState(rest[0]);
    case "assign":
      return assign(rest[0], rest[1]);
    case "apply": {
      const scenes = loadScenes();
      const [shot] = shotsFor([rest[0]], scenes);
      await applyShot(shot);
      return console.log(`applied ${shot.variant}`);
    }
    case "shoot":
      return shoot(rest);
    default:
      console.log(HELP);
      if (cmd && cmd !== "help") process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
});
