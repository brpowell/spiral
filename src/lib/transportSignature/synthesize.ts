import {
  frequencyForAction,
  MUSICAL_INTERVALS,
  parseRecipe,
  type TransportAction,
  type TransportSoundRecipe,
} from "./recipe";

const NOISE_SEED = 0xa11ce;

let uiContext: AudioContext | null = null;

function uiAudioContext(): AudioContext {
  if (!uiContext || uiContext.state === "closed") {
    uiContext = new AudioContext();
  }
  if (uiContext.state === "suspended") {
    void uiContext.resume();
  }
  return uiContext;
}

function positiveHz(hz: number): number {
  if (!Number.isFinite(hz)) return 440;
  return Math.min(18000, Math.max(1, hz));
}

/** Deterministic burst so the signature is the same every press. */
function noiseBurst(length: number): Float32Array {
  let state = NOISE_SEED >>> 0;
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const unit = state / 4294967296;
    const env = 1 - i / Math.max(1, length);
    data[i] = (unit * 2 - 1) * env;
  }
  return data;
}

function scheduleTone(
  ctx: BaseAudioContext,
  destination: AudioNode,
  recipe: TransportSoundRecipe,
  action: TransportAction,
  when: number,
): void {
  if (!recipe.body.enabled && !recipe.overtone.enabled) return;

  const semitones = recipe.actionSemitones[action];
  const duration = Math.max(0.03, recipe.durationMs / 1000);
  const attack = Math.min(
    duration * 0.45,
    Math.max(0, recipe.body.attackMs / 1000),
  );
  const end = when + duration;
  const startHz = positiveHz(
    frequencyForAction(recipe.body.startHz, semitones),
  );
  const endHz = positiveHz(frequencyForAction(recipe.body.endHz, semitones));

  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.setValueAtTime(positiveHz(recipe.body.toneHz), when);
  tone.Q.setValueAtTime(0.7, when);
  tone.connect(destination);

  const connectVoice = (
    wave: OscillatorType,
    fromHz: number,
    toHz: number,
    gainAmount: number,
    detuneCents: number,
  ) => {
    if (gainAmount <= 0.0001) return;
    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(fromHz, when);
    if (Math.abs(toHz - fromHz) > 0.5) {
      osc.frequency.exponentialRampToValueAtTime(toHz, end);
    }
    osc.detune.setValueAtTime(detuneCents, when);

    const gain = ctx.createGain();
    const peak = Math.max(0.0001, recipe.masterGain * gainAmount);
    gain.gain.setValueAtTime(0.0001, when);
    if (attack > 0.0005) {
      gain.gain.exponentialRampToValueAtTime(peak, when + attack);
    } else {
      gain.gain.setValueAtTime(peak, when);
    }
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(gain);
    gain.connect(tone);
    osc.start(when);
    osc.stop(end + 0.03);
  };

  if (recipe.body.enabled) {
    connectVoice(recipe.body.wave, startHz, endHz, recipe.body.gain, 0);
  }
  if (recipe.overtone.enabled) {
    const ratio = MUSICAL_INTERVALS[recipe.overtone.interval];
    connectVoice(
      recipe.body.wave,
      positiveHz(startHz * ratio),
      positiveHz(endHz * ratio),
      recipe.overtone.gain,
      recipe.overtone.detuneCents,
    );
  }
}

function scheduleClick(
  ctx: BaseAudioContext,
  destination: AudioNode,
  recipe: TransportSoundRecipe,
  when: number,
): void {
  if (!recipe.click.enabled || recipe.click.gain <= 0.0001) return;

  const seconds = Math.max(0.001, recipe.click.durationMs / 1000);
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  buffer.copyToChannel(noiseBurst(length), 0);

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const highpass = ctx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.setValueAtTime(positiveHz(recipe.click.highpassHz), when);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(
    Math.max(0.0001, recipe.masterGain * recipe.click.gain),
    when,
  );

  source.connect(highpass);
  highpass.connect(gain);
  gain.connect(destination);
  source.start(when);
}

export function scheduleTransportSound(
  ctx: BaseAudioContext,
  destination: AudioNode,
  recipe: TransportSoundRecipe,
  action: TransportAction,
  when: number,
): void {
  scheduleTone(ctx, destination, recipe, action, when);
  scheduleClick(ctx, destination, recipe, when);
}

export function playTransportSound(
  recipe: TransportSoundRecipe,
  action: TransportAction,
): void {
  const safe = parseRecipe(recipe);
  if (!safe) return;
  try {
    const ctx = uiAudioContext();
    scheduleTransportSound(
      ctx,
      ctx.destination,
      safe,
      action,
      ctx.currentTime + 0.008,
    );
  } catch (err) {
    console.warn("Transport signature failed:", err);
  }
}

export async function renderTransportSound(
  recipe: TransportSoundRecipe,
  action: TransportAction,
): Promise<AudioBuffer> {
  const safe = parseRecipe(recipe);
  if (!safe) {
    throw new Error("Transport signature recipe is empty");
  }
  const sampleRate = 44100;
  const seconds = safe.durationMs / 1000 + 0.05;
  const offline = new OfflineAudioContext(
    1,
    Math.ceil(sampleRate * seconds),
    sampleRate,
  );
  scheduleTransportSound(offline, offline.destination, safe, action, 0);
  return offline.startRendering();
}
