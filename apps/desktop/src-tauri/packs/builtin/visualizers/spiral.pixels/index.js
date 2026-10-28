/**
 * Pixels VizRenderer — stereo-style block meter.
 * Album palette runs bottom to top, stacked blocks over faint unlit cells,
 * and a peak block that holds, then drops under gravity.
 * Contract: export create() → { render(ctx, frame) }
 */

const BAR_COUNT = 32;
const MIRROR = false;
const GLOW = 0;
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
/**
 * Visible range below the running ceiling, as a fraction of the analyser
 * scale (~25 dB). Wider keeps loud passages from sitting on the top row.
 */
const DYNAMIC_WINDOW = 0.36;
/** How fast the auto-gain ceiling relaxes after a loud passage, per second. */
const CEILING_RELEASE_PER_SEC = 0.08;
/**
 * A band at the ceiling rests here (0–1). Headroom above it is reserved
 * for the beat, so a hit rises without every loud column pinning at full.
 */
const LEVEL_WEIGHT = 0.65;
const ONSET_PUNCH = 0.65;
/** Above this height, extra loudness is compressed so columns don't pin. */
const LEVEL_KNEE = 0.8;
const LEVEL_KNEE_SLOPE = 0.55;
/** Per-band moving average the onset is measured against. */
const ONSET_AVERAGE_MS = 600;
/** Lit stack drop speed, in full heights per second. */
const BAR_FALL_PER_SEC = 1.8;
/** Playback takes over from the resting wave, then settles back on pause. */
const PRESENCE_IN_MS = 280;
const PRESENCE_OUT_MS = 640;
const PEAK_HOLD_MS = 400;
/** Peak block acceleration once its hold ends, in full heights per second². */
const PEAK_GRAVITY = 3.2;
const UNLIT_ALPHA = 0.08;

function lerpColor(a, b, t) {
  const parse = (hex) => {
    const h = hex.replace("#", "");
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  };
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const bl = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

function paletteColorAt(colors, index, count) {
  if (!colors || colors.length === 0) return "#888888";
  if (count <= 1) return colors[0];
  const t = index / (count - 1);
  const colorIndex = t * (colors.length - 1);
  const idx = Math.floor(colorIndex);
  const frac = colorIndex - idx;
  const c1 = colors[idx] ?? colors[0];
  const c2 = colors[Math.min(idx + 1, colors.length - 1)] ?? c1;
  return lerpColor(c1, c2, frac);
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
 * columns don't duplicate the same coarse bass bin.
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
  /** False until this grid has seen a frame, so the first one is not a hit. */
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
    // A new column count has no per-band history. Priming skips the onset
    // kick, which otherwise reads the whole frame as one enormous beat.
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

function litRows(level, rows) {
  if (level <= 0.04 || rows <= 0) return 0;
  return Math.max(1, Math.min(rows, Math.round(level * rows)));
}

/**
 * Short surfaces (mini slot, picker card, and the card's still snapshot)
 * share one row count, so the same shape gets the same grid even when the
 * pixel size differs. Taller surfaces step up so an expanded view stays fine.
 */
const GRID_ROWS_SHORT = 8;
const GRID_FINE_AFTER = 360;

function blockGrid(width, height, orientation, requestedColumns) {
  const vertical = orientation === "vertical";
  const along = vertical ? height : width;
  const across = vertical ? width : height;
  const aspect = along / Math.max(across, 1);
  const rows =
    across < GRID_FINE_AFTER
      ? GRID_ROWS_SHORT
      : Math.min(28, Math.round(across / 18));
  const columns = Math.max(
    8,
    Math.min(requestedColumns, Math.round(rows * aspect)),
  );
  return { columns, rows };
}

function fillBlock(ctx, x, y, w, h) {
  if (w <= 0 || h <= 0) return;
  const radius = Math.min(1.5, w * 0.22, h * 0.22);
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fill();
}

function stackPainter(ctx, { column, columns, rows, width, height, orientation, mirror }) {
  const vertical = orientation === "vertical";
  const cellAlong = (vertical ? height : width) / columns;
  const cellAcross = (vertical ? width : height) / rows;
  const gapAlong = Math.max(1, cellAlong * 0.2);
  const gapAcross = Math.max(1, cellAcross * 0.2);
  const blockAlong = cellAlong - gapAlong;
  const blockAcross = cellAcross - gapAcross;
  const origin = column * cellAlong + gapAlong / 2;

  return (step) => {
    if (vertical) {
      const y = origin;
      if (mirror) {
        const mid = width / 2;
        const reach = (step + 1) * cellAcross - gapAcross / 2;
        fillBlock(ctx, mid - reach, y, blockAcross, blockAlong);
        fillBlock(ctx, mid + step * cellAcross + gapAcross / 2, y, blockAcross, blockAlong);
        return;
      }
      fillBlock(ctx, step * cellAcross + gapAcross / 2, y, blockAcross, blockAlong);
      return;
    }

    const x = origin;
    if (mirror) {
      const mid = height / 2;
      const reach = (step + 1) * cellAcross - gapAcross / 2;
      fillBlock(ctx, x, mid - reach, blockAlong, blockAcross);
      fillBlock(ctx, x, mid + step * cellAcross + gapAcross / 2, blockAlong, blockAcross);
      return;
    }
    const y = height - (step + 1) * cellAcross + gapAcross / 2;
    fillBlock(ctx, x, y, blockAlong, blockAcross);
  };
}

export function create() {
  let idlePhase = 0;
  /** -1 until the first frame, so a still snapshot starts in the right pose. */
  let presence = -1;
  /** Last live column heights, held while playback settles into the resting wave. */
  let liveHold = [];
  const measure = createMeter();

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
  /** @type {number[]} */
  let peaks = [];
  /** @type {number[]} */
  let holdMs = [];
  /** @type {number[]} */
  let peakVelocity = [];

  function syncPeaks(count) {
    if (peaks.length === count) return;
    peaks = new Array(count).fill(0);
    holdMs = new Array(count).fill(0);
    peakVelocity = new Array(count).fill(0);
  }

  function stepPeaks(levels, dt, reducedMotion) {
    const seconds = dt / 1000;
    for (let i = 0; i < levels.length; i++) {
      const level = levels[i] ?? 0;
      if (reducedMotion || level >= peaks[i]) {
        peaks[i] = level;
        holdMs[i] = reducedMotion ? 0 : PEAK_HOLD_MS;
        peakVelocity[i] = 0;
      } else if (holdMs[i] > 0) {
        holdMs[i] = Math.max(0, holdMs[i] - dt);
      } else {
        peakVelocity[i] += PEAK_GRAVITY * seconds;
        peaks[i] = Math.max(level, peaks[i] - peakVelocity[i] * seconds);
      }
    }
  }

  return {
    render(ctx, frame) {
      const requested = BAR_COUNT;
      const mirror = MIRROR;
      const glow = GLOW * (0.35 + frame.audio.bassEnergy * 0.65);
      const orientation = ORIENTATION;
      const colors = frame.trackMetadata.artColors;
      const { width, height } = frame.size;
      const dt = Math.max(0, Math.min(64, frame.time.deltaMs || 0));
      const { columns, rows } = blockGrid(width, height, orientation, requested);

      paintBackdrop(
        ctx,
        width,
        height,
        frame.theme?.tokens?.["color-accent"],
        frame.trackMetadata.artColors,
      );
      syncPeaks(columns);

      const playing =
        frame.audio.isPlaying && frame.audio.frequencies.length > 0;
      if (frame.audio.isPlaying && !playing) return;

      if (playing) {
        liveHold = measure(frame.audio.frequencies, columns, dt).slice();
      } else if (liveHold.length !== columns) {
        liveHold = new Array(columns).fill(0);
      }

      const reducedMotion = frame.flags.reducedMotion === true;
      const amount = stepPresence(playing, dt, reducedMotion);
      idlePhase += IDLE_SPEED;
      const levels = new Array(columns);
      for (let i = 0; i < columns; i++) {
        const idle = idleWaveValue(idlePhase, i, columns);
        levels[i] = (liveHold[i] ?? 0) * amount + idle * (1 - amount);
      }

      stepPeaks(levels, dt, reducedMotion);

      const alpha = 0.45 + 0.55 * amount;
      const steps = mirror ? Math.max(1, Math.floor(rows / 2)) : rows;
      for (let i = 0; i < columns; i++) {
        const paint = stackPainter(ctx, {
          column: i,
          columns,
          rows,
          width,
          height,
          orientation,
          mirror,
        });
        const lit = litRows(levels[i] ?? 0, steps);
        const peakStep = litRows(peaks[i] ?? 0, steps) - 1;

        const paintStep = (step, stepAlpha) => {
          const color = paletteColorAt(colors, step, steps);
          ctx.fillStyle = color;
          ctx.globalAlpha = stepAlpha;
          applyGlow(ctx, stepAlpha > UNLIT_ALPHA ? glow : 0, color);
          paint(step);
          clearGlow(ctx);
        };

        for (let step = lit; step < steps; step++) {
          if (step !== peakStep) paintStep(step, UNLIT_ALPHA);
        }
        for (let step = 0; step < lit; step++) paintStep(step, alpha);
        if (peakStep >= lit) paintStep(peakStep, alpha);
      }
      ctx.globalAlpha = 1;
    },
  };
}
