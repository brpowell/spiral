/**
 * Recipe edited in Sound Lab (DEV only). The app does not play these;
 * transport cues are the public sound contributions
 * `spiral.sound.play` and `spiral.sound.control`.
 */

export const TRANSPORT_ACTIONS = [
  "play",
  "pause",
  "previous",
  "next",
  "shuffle",
  "repeat",
] as const;

export type TransportAction = (typeof TRANSPORT_ACTIONS)[number];

export type OscillatorWave = "sine" | "triangle";

export const MUSICAL_INTERVALS = {
  unison: 1,
  majorThird: 2 ** (4 / 12),
  fourth: 2 ** (5 / 12),
  fifth: 2 ** (7 / 12),
  octave: 2,
} as const;

export type MusicalInterval = keyof typeof MUSICAL_INTERVALS;

export type TransportSoundRecipe = {
  version: 1;
  name: string;
  /** Linear amplitude. Kept under 1 so layered partials have headroom. */
  masterGain: number;
  durationMs: number;
  body: {
    enabled: boolean;
    wave: OscillatorWave;
    startHz: number;
    endHz: number;
    gain: number;
    attackMs: number;
    /** Lowpass cutoff in Hz. Higher is brighter. */
    toneHz: number;
  };
  overtone: {
    enabled: boolean;
    interval: MusicalInterval;
    gain: number;
    detuneCents: number;
  };
  click: {
    enabled: boolean;
    gain: number;
    durationMs: number;
    highpassHz: number;
  };
  /** Semitone offset per control. Zero keeps one identical signature. */
  actionSemitones: Record<TransportAction, number>;
};

export type SoundPreset = {
  id: string;
  name: string;
  description: string;
  recipe: TransportSoundRecipe;
};

const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

function midiHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function zeroActions(): Record<TransportAction, number> {
  return {
    play: 0,
    pause: 0,
    previous: 0,
    next: 0,
    shuffle: 0,
    repeat: 0,
  };
}

function baseRecipe(name: string): TransportSoundRecipe {
  return {
    version: 1,
    name,
    masterGain: 0.28,
    durationMs: 120,
    body: {
      enabled: true,
      wave: "sine",
      startHz: midiHz(72),
      endHz: midiHz(79),
      gain: 0.65,
      attackMs: 8,
      toneHz: 2200,
    },
    overtone: {
      enabled: true,
      interval: "fifth",
      gain: 0.18,
      detuneCents: 7,
    },
    click: {
      enabled: true,
      gain: 0.15,
      durationMs: 2.5,
      highpassHz: 4500,
    },
    actionSemitones: zeroActions(),
  };
}

function withRecipe(
  name: string,
  patch: {
    masterGain?: number;
    durationMs?: number;
    body?: Partial<TransportSoundRecipe["body"]>;
    overtone?: Partial<TransportSoundRecipe["overtone"]>;
    click?: Partial<TransportSoundRecipe["click"]>;
    actionSemitones?: Partial<Record<TransportAction, number>>;
  },
): TransportSoundRecipe {
  const recipe = baseRecipe(name);
  return {
    ...recipe,
    masterGain: patch.masterGain ?? recipe.masterGain,
    durationMs: patch.durationMs ?? recipe.durationMs,
    body: { ...recipe.body, ...patch.body },
    overtone: { ...recipe.overtone, ...patch.overtone },
    click: { ...recipe.click, ...patch.click },
    actionSemitones: {
      ...recipe.actionSemitones,
      ...patch.actionSemitones,
    },
  };
}

export const SOUND_PRESETS: SoundPreset[] = [
  {
    id: "spiral",
    name: "Spiral",
    description: "Quiet fifth, opening upward",
    recipe: withRecipe("Spiral", {}),
  },
  {
    id: "dew",
    name: "Dew",
    description: "Slow major third, no click",
    recipe: withRecipe("Dew", {
      masterGain: 0.24,
      durationMs: 180,
      body: {
        startHz: midiHz(67),
        endHz: midiHz(71),
        gain: 0.7,
        attackMs: 18,
        toneHz: 1600,
      },
      overtone: { interval: "octave", gain: 0.12, detuneCents: 4 },
      click: { enabled: false },
    }),
  },
  {
    id: "spark",
    name: "Spark",
    description: "Short octave glint",
    recipe: withRecipe("Spark", {
      masterGain: 0.26,
      durationMs: 70,
      body: {
        wave: "triangle",
        startHz: midiHz(76),
        endHz: midiHz(88),
        gain: 0.55,
        attackMs: 2,
        toneHz: 6400,
      },
      overtone: { interval: "fifth", gain: 0.2, detuneCents: 12 },
      click: { gain: 0.22, durationMs: 2, highpassHz: 6000 },
    }),
  },
  {
    id: "tick",
    name: "Tick",
    description: "Mostly the transient",
    recipe: withRecipe("Tick", {
      masterGain: 0.3,
      durationMs: 42,
      body: {
        startHz: midiHz(84),
        endHz: midiHz(91),
        gain: 0.35,
        attackMs: 1,
        toneHz: 5000,
      },
      overtone: { enabled: false },
      click: { gain: 0.55, durationMs: 4, highpassHz: 2500 },
    }),
  },
];

export const SPIRAL_PRESET = SOUND_PRESETS[0];

function clamp(
  value: unknown,
  lo: number,
  hi: number,
  fallback: number,
): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

function parseWave(value: unknown, fallback: OscillatorWave): OscillatorWave {
  return value === "sine" || value === "triangle" ? value : fallback;
}

function parseInterval(
  value: unknown,
  fallback: MusicalInterval,
): MusicalInterval {
  if (typeof value === "string" && value in MUSICAL_INTERVALS) {
    return value as MusicalInterval;
  }
  return fallback;
}

/** Accept a lab export or a stored draft. `{ enabled: false }` stays silent. */
export function parseRecipe(value: unknown): TransportSoundRecipe | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.enabled === false) return null;
  if (raw.version !== 1) return null;

  const fallback = baseRecipe("Untitled");
  const body = asRecord(raw.body);
  const overtone = asRecord(raw.overtone);
  const click = asRecord(raw.click);
  const semitones = asRecord(raw.actionSemitones);
  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 60) : "";

  return {
    version: 1,
    name: name || fallback.name,
    masterGain: clamp(raw.masterGain, 0, 0.8, fallback.masterGain),
    durationMs: clamp(raw.durationMs, 24, 320, fallback.durationMs),
    body: {
      enabled:
        typeof body.enabled === "boolean"
          ? body.enabled
          : fallback.body.enabled,
      wave: parseWave(body.wave, fallback.body.wave),
      startHz: clamp(body.startHz, 80, 4000, fallback.body.startHz),
      endHz: clamp(body.endHz, 80, 8000, fallback.body.endHz),
      gain: clamp(body.gain, 0, 1, fallback.body.gain),
      attackMs: clamp(body.attackMs, 0, 80, fallback.body.attackMs),
      toneHz: clamp(body.toneHz, 400, 14000, fallback.body.toneHz),
    },
    overtone: {
      enabled:
        typeof overtone.enabled === "boolean"
          ? overtone.enabled
          : fallback.overtone.enabled,
      interval: parseInterval(overtone.interval, fallback.overtone.interval),
      gain: clamp(overtone.gain, 0, 1, fallback.overtone.gain),
      detuneCents: clamp(
        overtone.detuneCents,
        -40,
        40,
        fallback.overtone.detuneCents,
      ),
    },
    click: {
      enabled:
        typeof click.enabled === "boolean"
          ? click.enabled
          : fallback.click.enabled,
      gain: clamp(click.gain, 0, 1, fallback.click.gain),
      durationMs: clamp(click.durationMs, 1, 28, fallback.click.durationMs),
      highpassHz: clamp(
        click.highpassHz,
        400,
        12000,
        fallback.click.highpassHz,
      ),
    },
    actionSemitones: {
      play: clamp(semitones.play, -12, 12, 0),
      pause: clamp(semitones.pause, -12, 12, 0),
      previous: clamp(semitones.previous, -12, 12, 0),
      next: clamp(semitones.next, -12, 12, 0),
      shuffle: clamp(semitones.shuffle, -12, 12, 0),
      repeat: clamp(semitones.repeat, -12, 12, 0),
    },
  };
}

export function recipeExport(
  recipe: TransportSoundRecipe,
): TransportSoundRecipe & {
  enabled: true;
} {
  return { enabled: true, ...recipe };
}

export function frequencyForAction(hz: number, semitones: number): number {
  const shifted = hz * 2 ** (semitones / 12);
  if (!Number.isFinite(shifted)) return hz;
  return Math.min(18000, Math.max(1, shifted));
}

export function formatPitch(hz: number): string {
  if (!Number.isFinite(hz) || hz <= 0) return "—";
  const midi = Math.round(12 * Math.log2(hz / 440) + 69);
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${Math.round(hz)} Hz · ${name}${octave}`;
}

export function formatSemitones(semitones: number): string {
  if (semitones === 0) return "0";
  const rounded = Math.round(semitones);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}
