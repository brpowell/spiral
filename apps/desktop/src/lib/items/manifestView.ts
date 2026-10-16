import { SOUND_CUES } from "../../types/soundPack";

/** Loose view over a parsed manifest; the types below only read what they show. */
export type ManifestJson = Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Display form of a manifest value (settings defaults, tokens). */
export function formatManifestValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const COLOR_VALUE =
  /^(#[0-9a-f]{3,8}|(rgb|hsl|hwb|lab|lch|oklab|oklch|color)\()/i;

export function looksLikeColor(key: string, value: string): boolean {
  return key.startsWith("color-") || COLOR_VALUE.test(value.trim());
}

export interface ThemeTokenView {
  colors: Array<[string, string]>;
  other: Array<[string, string]>;
}

export function themeTokenView(manifest: ManifestJson): ThemeTokenView {
  const colors: Array<[string, string]> = [];
  const other: Array<[string, string]> = [];
  for (const [key, raw] of Object.entries(asRecord(manifest.tokens))) {
    const value = formatManifestValue(raw);
    (looksLikeColor(key, value) ? colors : other).push([key, value]);
  }
  return { colors, other };
}

export interface SoundEntryView {
  id: string;
  file: string;
  /** Cues assigned to this sound. */
  cues: string[];
}

export interface SoundCueView {
  cue: string;
  /** Sound the pack assigns, or null when it leaves the cue to the default pack. */
  soundId: string | null;
  /** Cue the app plays today (others are kept for newer apps and ignored). */
  known: boolean;
  /** Assigned sound exists in the pack's library. */
  valid: boolean;
}

export interface SoundPackView {
  sounds: SoundEntryView[];
  cues: SoundCueView[];
}

export function soundPackView(manifest: ManifestJson): SoundPackView {
  const soundMap = asRecord(manifest.sounds);
  const cueMap = asRecord(manifest.cues);
  const known = Object.values(SOUND_CUES) as string[];

  const sounds: SoundEntryView[] = Object.entries(soundMap).map(
    ([id, file]) => ({
      id,
      file: formatManifestValue(file),
      cues: Object.entries(cueMap)
        .filter(([, target]) => target === id)
        .map(([cue]) => cue),
    }),
  );

  const assigned: SoundCueView[] = Object.entries(cueMap).map(
    ([cue, target]) => {
      const soundId = asString(target);
      return {
        cue,
        soundId,
        known: known.includes(cue),
        valid: soundId != null && soundId in soundMap,
      };
    },
  );
  const unassigned: SoundCueView[] = known
    .filter((cue) => !(cue in cueMap))
    .map((cue) => ({ cue, soundId: null, known: true, valid: true }));

  return { sounds, cues: [...assigned, ...unassigned] };
}

export interface SkinViewSummary {
  id: string;
  presentation: string | null;
  defaultSize: string | null;
  resizable: boolean | null;
}

export interface SkinSettingView {
  id: string;
  name: string;
  type: string;
  defaultValue: string;
}

export interface SkinContentsView {
  views: SkinViewSummary[];
  settings: SkinSettingView[];
  soundEffects: Array<[string, string]>;
  visualizer: string | null;
  stylesheet: string | null;
}

export function skinContentsView(manifest: ManifestJson): SkinContentsView {
  const views = Object.entries(asRecord(manifest.views)).map(
    ([id, raw]): SkinViewSummary => {
      const view = asRecord(raw);
      const window = asRecord(view.window);
      const width = asNumber(window.defaultWidth);
      const height = asNumber(window.defaultHeight);
      return {
        id,
        presentation: asString(view.presentation),
        defaultSize:
          width != null && height != null ? `${width} × ${height}` : null,
        resizable:
          typeof window.resizable === "boolean" ? window.resizable : null,
      };
    },
  );

  const settings = asArray(manifest.settings).map((raw): SkinSettingView => {
    const setting = asRecord(raw);
    return {
      id: asString(setting.id) ?? "",
      name: asString(setting.name) ?? asString(setting.id) ?? "",
      type: asString(setting.type) ?? "",
      defaultValue: formatManifestValue(setting.default),
    };
  });

  const soundEffects = Object.entries(asRecord(manifest.soundEffects)).map(
    ([key, file]): [string, string] => [key, formatManifestValue(file)],
  );

  const pinned = asString(asRecord(manifest.visualizer).id);

  return {
    views,
    settings,
    soundEffects,
    visualizer: pinned != null && pinned !== "global" ? pinned : null,
    stylesheet: asString(manifest.stylesheet),
  };
}

export interface VizLayerView {
  id: string | null;
  kind: string;
  /** Script or media file the layer runs or shows. */
  source: string | null;
  layout: string | null;
}

export function visualizerLayers(manifest: ManifestJson): VizLayerView[] {
  return asArray(manifest.children).map((raw): VizLayerView => {
    const layer = asRecord(raw);
    const layout = layer.layout;
    return {
      id: asString(layer.id),
      kind: asString(layer.kind) ?? "?",
      source: asString(layer.entry) ?? asString(layer.asset),
      layout: typeof layout === "string" ? layout : layout ? "custom" : null,
    };
  });
}
