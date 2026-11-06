// Scene resolution for scripts/stage.mjs: `extends` inheritance and `matrix`
// expansion. Pure functions so they can be unit tested without the app.

const isObject = (v) => v && typeof v === "object" && !Array.isArray(v);

export function deepMerge(base, over) {
  if (!isObject(base) || !isObject(over))
    return over === undefined ? base : over;
  const out = { ...base };
  for (const [key, value] of Object.entries(over)) {
    out[key] = key in base ? deepMerge(base[key], value) : value;
  }
  return out;
}

/** Resolve `extends` chains. `scenes` maps scene name to its raw JSON. */
export function resolveScene(name, scenes, seen = []) {
  const raw = scenes[name];
  if (!raw) throw new Error(`unknown scene "${name}"`);
  if (seen.includes(name)) {
    throw new Error(`scene inheritance cycle: ${[...seen, name].join(" -> ")}`);
  }
  if (!raw.extends) return { ...raw };
  const parent = resolveScene(raw.extends, scenes, [...seen, name]);
  const rest = { ...raw };
  delete rest.extends;
  const merged = deepMerge(parent, rest);
  delete merged.extends;
  // `base` marks a scene as inherit-only; it is not inherited itself.
  if (raw.base === undefined) delete merged.base;
  // A child's matrix replaces, not merges with, its parent's.
  if (raw.matrix) merged.matrix = raw.matrix;
  return merged;
}

function setPath(obj, dotted, value) {
  const keys = dotted.split(".");
  let cursor = obj;
  for (const key of keys.slice(0, -1)) {
    cursor[key] = isObject(cursor[key]) ? { ...cursor[key] } : {};
    cursor = cursor[key];
  }
  cursor[keys.at(-1)] = value;
}

const slug = (v) =>
  String(v)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * Expand a resolved scene into one concrete shot per matrix combination.
 * A scene without a matrix yields a single shot. `{name}` in `publish.slot`
 * is replaced by the matrix value whose key ends in `.name`.
 */
export function expandShots(scene) {
  const { matrix, ...rest } = scene;
  if (!matrix || !Object.keys(matrix).length) {
    return [{ ...rest, variant: scene.name }];
  }
  let combos = [{}];
  for (const [path, values] of Object.entries(matrix)) {
    combos = combos.flatMap((combo) =>
      values.map((value) => ({ ...combo, [path]: value })),
    );
  }
  return combos.map((combo) => {
    const shot = structuredClone(rest);
    const tokens = {};
    for (const [path, value] of Object.entries(combo)) {
      setPath(shot, path, value);
      // Namespaced ids (spiral.theme.noir) slot as their last segment (noir).
      tokens[path.split(".").at(-1)] = String(value).split(".").at(-1);
    }
    if (shot.publish?.slot) {
      shot.publish = {
        ...shot.publish,
        slot: shot.publish.slot.replace(/\{(\w+)\}/g, (m, key) =>
          key in tokens ? String(tokens[key]) : m,
        ),
      };
    }
    return {
      ...shot,
      variant: `${scene.name}--${Object.values(tokens).map(slug).join("-")}`,
    };
  });
}
