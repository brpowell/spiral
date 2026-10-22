/**
 * Bars VizRenderer — pack-shipped canvas module.
 * Solid album-colored columns. Levels come from the same meter as Pixels:
 * musical bands, a running loudness ceiling, and a beat onset.
 * Contract: export create() → { render(ctx, frame) }
 */

const BAR_COUNT = 32;
const MIRROR = false;
const GLOW = 0;
const ORIENTATION = "horizontal";

/** Seconds for one rise to travel across the bars. */
const IDLE_POP_PERIOD = 3.4;
/** How much of the row lifts together, as a fraction of the bar count. */
const IDLE_POP_WIDTH = 0.18;
/** Peak of a resting rise. Kept short of a real bar so it doesn't read as playback. */
const IDLE_POP_AMP = 0.28;
const IDLE_POP_BASE = 0.04;

/** Host analyser bytes span this many dB (minDecibels −100 → maxDecibels −30). */
const ANALYSER_DB_RANGE = 70;
/** Bands stop around 14 kHz; above that most masters are empty air. */
const MUSICAL_BIN_RATIO = 0.62;
/** Classic analyzer treble lift so cymbals can stand next to the kick. */
const LIFT_DB_PER_OCTAVE = 1.75;
/**
 * Visible range below the running ceiling, as a fraction of the analyser
 * scale (~25 dB). Wider keeps loud passages from sitting at full height.
 */
const DYNAMIC_WINDOW = 0.36;
/** How fast the auto-gain ceiling relaxes after a loud passage, per second. */
const CEILING_RELEASE_PER_SEC = 0.08;
/**
 * A band at the ceiling rests here (0–1). Headroom above it is reserved
 * for the beat, so a hit rises without every loud bar pinning at full.
 */
const LEVEL_WEIGHT = 0.65;
const ONSET_PUNCH = 0.65;
/** Above this height, extra loudness is compressed so bars don't pin. */
const LEVEL_KNEE = 0.8;
const LEVEL_KNEE_SLOPE = 0.55;
/** Per-band moving average the onset is measured against. */
const ONSET_AVERAGE_MS = 600;
/** Bar drop speed, in full heights per second. */
const BAR_FALL_PER_SEC = 1.8;
/** Playback takes over from the resting rises, then settles back on pause. */
const PRESENCE_IN_MS = 280;
const PRESENCE_OUT_MS = 640;

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

/**
 * Fixed dark stage so the visualizer reads the same on light and dark themes.
 * Olive-black with a faint lime lift from below.
 */
function paintBackdrop(ctx, width, height) {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  const base = ctx.createLinearGradient(0, 0, 0, height);
  base.addColorStop(0, "#191b11");
  base.addColorStop(1, "#0d0f08");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);
  const lift = ctx.createRadialGradient(
    width / 2,
    height,
    0,
    width / 2,
    height,
    Math.max(width, height) * 0.7,
  );
  lift.addColorStop(0, "rgba(150, 200, 54, 0.09)");
  lift.addColorStop(1, "rgba(150, 200, 54, 0)");
  ctx.fillStyle = lift;
  ctx.fillRect(0, 0, width, height);
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

/** A soft rise that travels across the row, with a quieter one opposite it. */
function idlePopValue(time, index, count) {
  const x = index / Math.max(count - 1, 1);
  const bump = (center) => {
    let distance = Math.abs(x - center);
    distance = Math.min(distance, 1 - distance);
    const t = distance / IDLE_POP_WIDTH;
    if (t >= 1) return 0;
    return 0.5 + 0.5 * Math.cos(Math.PI * t);
  };
  const travel = (time / IDLE_POP_PERIOD) % 1;
  const rise = bump(travel) + bump((travel + 0.5) % 1) * 0.42;
  return IDLE_POP_BASE + IDLE_POP_AMP * Math.min(1, rise);
}

/**
 * Log-spaced band edges that always advance at least one bin, so the low
 * bars don't duplicate the same coarse bass bin.
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
  /** False until this bar count has seen a frame, so the first one is not a hit. */
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

export function create() {
  let idlePhase = 0;
  /** -1 until the first frame, so a still snapshot starts in the right pose. */
  let presence = -1;
  /** Last live column heights, held while playback settles into the resting rises. */
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

  return {
    render(ctx, frame) {
      const barCount = BAR_COUNT;
      const mirror = MIRROR;
      const glow = GLOW * (0.35 + frame.audio.bassEnergy * 0.65);
      const orientation = ORIENTATION;
      const colors = frame.trackMetadata.artColors;
      const { width, height } = frame.size;
      const dt = Math.max(0, Math.min(64, frame.time.deltaMs || 0));

      paintBackdrop(ctx, width, height);

      const drawBar = (index, magnitude, alpha = 1) => {
        const color = paletteColorAt(colors, index, barCount);
        applyGlow(ctx, glow, color);

        if (orientation === "vertical") {
          const barWidth = magnitude * width * 0.92;
          const slotHeight = height / barCount;
          const gap = Math.max(1, slotHeight * 0.18);
          const drawHeight = slotHeight - gap;
          const y = index * slotHeight + gap / 2;
          const x = mirror ? (width - barWidth) / 2 : 0;
          ctx.globalAlpha = alpha;
          ctx.fillStyle = color;
          ctx.fillRect(x, y, barWidth, drawHeight);
        } else {
          const barHeight = magnitude * height * 0.92;
          const barWidth = width / barCount;
          const gap = Math.max(1, barWidth * 0.18);
          const drawWidth = barWidth - gap;
          const x = index * barWidth + gap / 2;
          const y = mirror ? (height - barHeight) / 2 : height - barHeight;
          ctx.globalAlpha = alpha;
          ctx.fillStyle = color;
          ctx.fillRect(x, y, drawWidth, barHeight);
        }

        ctx.globalAlpha = 1;
        clearGlow(ctx);
      };

      const playing =
        frame.audio.isPlaying && frame.audio.frequencies.length > 0;
      if (frame.audio.isPlaying && !playing) return;

      if (playing) {
        liveHold = measure(frame.audio.frequencies, barCount, dt).slice();
      } else if (liveHold.length !== barCount) {
        liveHold = new Array(barCount).fill(0);
      }

      const amount = stepPresence(
        playing,
        dt,
        frame.flags.reducedMotion === true,
      );
      idlePhase += dt / 1000;
      const alpha = 0.45 + 0.55 * amount;
      for (let i = 0; i < barCount; i++) {
        const idle = idlePopValue(idlePhase, i, barCount);
        const level = (liveHold[i] ?? 0) * amount + idle * (1 - amount);
        drawBar(i, level, alpha);
      }
    },
  };
}
