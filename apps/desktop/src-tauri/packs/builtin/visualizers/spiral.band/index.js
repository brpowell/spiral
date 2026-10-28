/**
 * Double Dutch VizRenderer — pack-shipped canvas module.
 * A plucked rubber band in album colors. The line is a few smooth string
 * modes; bass drives the wide bulges and treble the small ripples. Mode sizes
 * come from the same meter as Bars and ride a springy envelope, so beats
 * snap the band and it wobbles back instead of flickering sample to sample.
 * Contract: export create() → { render(ctx, frame) }
 */

const BAR_COUNT = 128;
const MIRROR = true;
const GLOW = 0.6;
const ORIENTATION = "horizontal";

const IDLE_SPEED = 0.00032;
const IDLE_WAVE_FREQ = 180;
const IDLE_WAVE_SPREAD = 0.22;
const IDLE_WAVE_AMP = 0.22;
const IDLE_WAVE_BASE = 0.1;

/** Host analyser bytes span this many dB (minDecibels −100 → maxDecibels −30). */
const ANALYSER_DB_RANGE = 70;
/** Bands stop around 14 kHz; above that most masters are empty air. */
const MUSICAL_BIN_RATIO = 0.62;
/** Classic analyzer treble lift so cymbals can stand next to the kick. */
const LIFT_DB_PER_OCTAVE = 1.75;
/** Visible range below the running ceiling, as a fraction of the analyser scale. */
const DYNAMIC_WINDOW = 0.36;
/** How fast the auto-gain ceiling relaxes after a loud passage, per second. */
const CEILING_RELEASE_PER_SEC = 0.08;
const LEVEL_WEIGHT = 0.65;
const ONSET_PUNCH = 0.65;
const LEVEL_KNEE = 0.8;
const LEVEL_KNEE_SLOPE = 0.55;
/** Per-band moving average the onset is measured against. */
const ONSET_AVERAGE_MS = 600;
/** Envelope drop speed, in full heights per second. */
const BAR_FALL_PER_SEC = 1.8;

/** String modes on the band: mode 1 is one wide bulge, higher modes ripple. */
const MODES = 6;
/** Mode 1 swing rate. Higher modes swing a little faster (√k), never flicker-fast. */
const MODE_HZ = 0.9;
/** How springy the band is: natural rate of the envelope and how much it overshoots. */
const SPRING_HZ = 2.6;
const SPRING_DAMPING = 0.38;
/** Overall band height at full level, as a fraction of the half-height. */
const BAND_GAIN = 1.25;
/** Playback takes over from the resting wave, then settles back on pause. */
const PRESENCE_IN_MS = 280;
const PRESENCE_OUT_MS = 640;

/** One stop per swatch, in palette order, so none of them get blended away. */
function addPaletteStops(gradient, colors) {
  const swatches = colors && colors.length > 0 ? colors : ["#888888"];
  if (swatches.length === 1) {
    gradient.addColorStop(0, swatches[0]);
    gradient.addColorStop(1, swatches[0]);
    return;
  }
  for (let i = 0; i < swatches.length; i++) {
    gradient.addColorStop(i / (swatches.length - 1), swatches[i]);
  }
}

/** Black stage with a faint album-palette tint (theme accent when there's no art), deepest at the bottom. */
function paintBackdrop(ctx, width, height, accent, colors) {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, width, height);
  const stops = colors && colors.length > 0 ? colors : accent ? [accent] : [];
  if (stops.length > 0) {
    // A faint wash of the album palette across the canvas, deepening toward
    // the bottom.
    const wash = ctx.createLinearGradient(0, 0, width, 0);
    stops.forEach((color, i) => {
      wash.addColorStop(stops.length === 1 ? 0 : i / (stops.length - 1), color);
    });
    ctx.globalAlpha = 0.26;
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, width, height);
    const fade = ctx.createLinearGradient(0, 0, 0, height);
    fade.addColorStop(0, "rgba(0, 0, 0, 0.6)");
    fade.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.globalAlpha = 1;
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.restore();
}

function applyGlow(ctx, glow, color) {
  if (glow <= 0) return;
  ctx.shadowBlur = glow * 24;
  ctx.shadowColor = color;
}

function clearGlow(ctx) {
  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";
}

function idleWaveValue(phase, index, count) {
  const spread = (index / Math.max(count - 1, 1)) * IDLE_WAVE_SPREAD * count;
  return (
    (Math.sin(phase * IDLE_WAVE_FREQ + spread) + 1) * 0.5 * IDLE_WAVE_AMP +
    IDLE_WAVE_BASE
  );
}

/**
 * Log-spaced band edges that always advance at least one bin, so the low
 * end doesn't duplicate the same coarse bass bin.
 */
function bandEdges(binCount, columns) {
  const maxBin = Math.max(columns, Math.ceil((binCount - 1) * MUSICAL_BIN_RATIO));
  const edges = [0];
  for (let i = 1; i <= columns; i++) {
    const ideal = Math.round(Math.pow(maxBin, i / columns));
    const lo = edges[i - 1] + 1;
    const hi = maxBin - (columns - i);
    edges.push(Math.max(lo, Math.min(hi, ideal)));
  }
  return edges;
}

function shapeLevel(steady, onset) {
  const raised = Math.max(0, steady * LEVEL_WEIGHT + onset * ONSET_PUNCH);
  if (raised < LEVEL_KNEE) return raised;
  return Math.min(1, LEVEL_KNEE + (raised - LEVEL_KNEE) * LEVEL_KNEE_SLOPE);
}

function createMeter() {
  let binCount = 0;
  let columns = 0;
  let edges = [];
  let lift = [];
  let average = [];
  let level = [];
  let ceiling = 0;
  /** False until this band count has seen a frame, so the first one is not a hit. */
  let primed = false;

  function configure(nextBinCount, nextColumns) {
    if (nextBinCount === binCount && nextColumns === columns) return;
    binCount = nextBinCount;
    columns = nextColumns;
    edges = bandEdges(binCount, columns);
    lift = [];
    for (let i = 0; i < columns; i++) {
      const center = Math.max(1, (edges[i] + edges[i + 1]) / 2);
      lift.push((Math.log2(center) * LIFT_DB_PER_OCTAVE) / ANALYSER_DB_RANGE);
    }
    average = new Array(columns).fill(0);
    level = new Array(columns).fill(0);
    primed = false;
  }

  return function measure(data, nextColumns, dt) {
    configure(data.length, nextColumns);
    const bands = new Array(columns);
    let frameMax = 0;
    for (let i = 0; i < columns; i++) {
      const i0 = Math.min(binCount - 1, edges[i]);
      const i1 = Math.min(binCount - 1, Math.max(i0, edges[i + 1] - 1));
      let peak = 0;
      for (let b = i0; b <= i1; b++) {
        const value = data[b] ?? 0;
        if (value > peak) peak = value;
      }
      bands[i] = peak > 0 ? peak + lift[i] : 0;
      if (bands[i] > frameMax) frameMax = bands[i];
    }

    if (!primed) {
      // Wait for real signal: priming on a silent frame seeds the onset
      // average at zero, so the first audible frame reads as a huge hit.
      if (frameMax === 0) return level;
      ceiling = Math.max(frameMax, DYNAMIC_WINDOW);
      const floor = ceiling - DYNAMIC_WINDOW;
      for (let i = 0; i < columns; i++) {
        average[i] = bands[i];
        const steady = (bands[i] - floor) / DYNAMIC_WINDOW;
        level[i] = shapeLevel(steady, 0);
      }
      primed = true;
      return level;
    }

    const seconds = dt / 1000;
    ceiling =
      frameMax > ceiling
        ? frameMax
        : Math.max(frameMax, ceiling - CEILING_RELEASE_PER_SEC * seconds);
    const floor = ceiling - DYNAMIC_WINDOW;
    const blend = 1 - Math.exp(-dt / ONSET_AVERAGE_MS);

    for (let i = 0; i < columns; i++) {
      const value = bands[i];
      const steady = (value - floor) / DYNAMIC_WINDOW;
      const onset = Math.max(0, value - average[i]) / DYNAMIC_WINDOW;
      average[i] += (value - average[i]) * blend;
      const target = shapeLevel(steady, onset);
      level[i] =
        target >= level[i]
          ? target
          : Math.max(target, level[i] - BAR_FALL_PER_SEC * seconds);
    }
    return level;
  };
}

/** Damped springs that chase the meter, giving each mode a rubbery snap. */
function createSprings(count) {
  const value = new Array(count).fill(0);
  const velocity = new Array(count).fill(0);
  const omega = 2 * Math.PI * SPRING_HZ;
  const stiffness = omega * omega;
  const damping = 2 * SPRING_DAMPING * omega;

  return function step(targets, dt) {
    const seconds = dt / 1000;
    for (let i = 0; i < count; i++) {
      const pull = stiffness * ((targets[i] ?? 0) - value[i]);
      velocity[i] += (pull - damping * velocity[i]) * seconds;
      value[i] += velocity[i] * seconds;
    }
    return value;
  };
}

/** Sample the band: standing string modes pinned at both ends. */
function bandShape(amplitudes, phases, sampleCount) {
  const samples = new Array(sampleCount);
  const span = Math.max(sampleCount - 1, 1);
  for (let i = 0; i < sampleCount; i++) {
    const x = i / span;
    let y = 0;
    for (let k = 0; k < amplitudes.length; k++) {
      const mode = k + 1;
      const weight = 1 / (1 + 0.45 * k);
      y +=
        Math.max(0, amplitudes[k]) *
        weight *
        Math.sin(mode * Math.PI * x) *
        Math.cos(phases[k]);
    }
    samples[i] = Math.tanh(y * BAND_GAIN);
  }
  return samples;
}

/** Round the corners of a polyline. */
function curveThrough(ctx, points) {
  const n = points.length;
  if (n === 0) return;
  ctx.lineTo(points[0].x, points[0].y);
  for (let i = 1; i < n - 1; i++) {
    const next = points[i + 1];
    const midX = (points[i].x + next.x) / 2;
    const midY = (points[i].y + next.y) / 2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
  }
  if (n > 1) ctx.lineTo(points[n - 1].x, points[n - 1].y);
}

function drawWavePath(ctx, samples, width, height, mirror, orientation) {
  const mid = orientation === "horizontal" ? height / 2 : width / 2;
  const amplitude = (orientation === "horizontal" ? height : width) * 0.42;
  const span = Math.max(samples.length - 1, 1);

  const pointFor = (index, direction) => {
    const t = index / span;
    const value = samples[index] ?? 0;
    const offset = value * amplitude * (direction === "up" ? -1 : 1);
    if (orientation === "horizontal") {
      return { x: t * width, y: mid + offset };
    }
    return { x: mid + offset, y: t * height };
  };

  const upper = [];
  for (let i = 0; i < samples.length; i++) upper.push(pointFor(i, "up"));

  const first = upper[0];
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  curveThrough(ctx, upper);

  if (mirror) {
    const lower = [];
    for (let i = samples.length - 1; i >= 0; i--) lower.push(pointFor(i, "down"));
    curveThrough(ctx, lower);
    ctx.closePath();
  }

  ctx.stroke();
}

export function create() {
  let idlePhase = 0;
  /** -1 until the first frame, so a still snapshot starts in the right pose. */
  let presence = -1;
  /** Last plucked shape, held while playback settles into the resting wave. */
  let liveHold = [];
  let liveEnergy = 0;
  const measure = createMeter();
  const springs = createSprings(MODES);
  const phases = Array.from({ length: MODES }, (_, k) => k * 1.7);

  function stepPresence(playing, dt, reducedMotion) {
    const target = playing ? 1 : 0;
    if (presence < 0 || reducedMotion) {
      presence = target;
      return presence;
    }
    const ms = playing ? PRESENCE_IN_MS : PRESENCE_OUT_MS;
    presence += (target - presence) * (1 - Math.exp(-dt / ms));
    return presence;
  }

  return {
    render(ctx, frame) {
      const sampleCount = BAR_COUNT;
      const mirror = MIRROR;
      const glow = GLOW;
      const orientation = ORIENTATION;
      const colors = frame.trackMetadata.artColors;
      const { width, height } = frame.size;
      const dt = Math.min(64, frame.time?.deltaMs ?? 16);

      paintBackdrop(
        ctx,
        width,
        height,
        frame.theme?.tokens?.["color-accent"],
        frame.trackMetadata.artColors,
      );

      const playing =
        frame.audio.isPlaying && frame.audio.frequencies.length > 0;
      if (frame.audio.isPlaying && !playing) return;

      if (playing) {
        const amplitudes = springs(
          measure(frame.audio.frequencies, MODES, dt),
          dt,
        );
        const seconds = dt / 1000;
        for (let k = 0; k < MODES; k++) {
          phases[k] += 2 * Math.PI * MODE_HZ * Math.sqrt(k + 1) * seconds;
        }
        liveHold = bandShape(amplitudes, phases, sampleCount);
        let sum = 0;
        for (const a of amplitudes) sum += Math.max(0, a);
        liveEnergy = sum / MODES;
      } else if (liveHold.length !== sampleCount) {
        liveHold = new Array(sampleCount).fill(0);
      }

      const amount = stepPresence(
        playing,
        dt,
        frame.flags.reducedMotion === true,
      );
      idlePhase += IDLE_SPEED;
      const samples = new Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) {
        const idle =
          (idleWaveValue(idlePhase, i, sampleCount) - IDLE_WAVE_BASE) * 2;
        samples[i] = (liveHold[i] ?? 0) * amount + idle * (1 - amount);
      }
      const energy = liveEnergy * amount;

      const gradient =
        orientation === "vertical"
          ? ctx.createLinearGradient(0, 0, 0, height)
          : ctx.createLinearGradient(0, 0, width, 0);
      addPaletteStops(gradient, colors);

      ctx.lineWidth = Math.max(
        1.5,
        (orientation === "horizontal" ? height : width) * 0.02,
      );
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.strokeStyle = gradient;
      applyGlow(ctx, glow, colors[0] ?? "#888888");
      drawWavePath(ctx, samples, width, height, mirror, orientation);
      clearGlow(ctx);

      if (mirror) {
        ctx.globalAlpha = 0.18 + energy * 0.35;
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    },
  };
}
