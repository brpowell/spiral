/**
 * Spectrum VizRenderer — pack-shipped canvas module.
 * Filled album-palette spectrum. Levels come from the same meter as Bars:
 * musical bands, a running loudness ceiling, and a beat onset.
 * Contract: export create() → { render(ctx, frame) }
 */

const BAR_COUNT = 96;
const MIRROR = false;
const GLOW = 0.7;
const ORIENTATION = "horizontal";

const IDLE_WAVE_AMP = 0.34;
const IDLE_WAVE_BASE = 0.07;

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
 * for the beat, so a hit rises without the outline pinning at full.
 */
const LEVEL_WEIGHT = 0.65;
const ONSET_PUNCH = 0.65;
/** Above this height, extra loudness is compressed so the outline doesn't pin. */
const LEVEL_KNEE = 0.8;
const LEVEL_KNEE_SLOPE = 0.55;
/** Per-band moving average the onset is measured against. */
const ONSET_AVERAGE_MS = 600;
/** Outline drop speed, in full heights per second. */
const BAR_FALL_PER_SEC = 1.2;
/** Playback takes over from the resting wave, then settles back on pause. */
const PRESENCE_IN_MS = 280;
const PRESENCE_OUT_MS = 640;
/** How many neighboring bands blend into each point of the outline. */
const OUTLINE_RADIUS = 3;

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

/** Fixed black stage so the visualizer reads the same on every theme. */
function paintBackdrop(ctx, width, height) {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#000000";
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

/** A few swells drifting across the surface, so the resting juice keeps reshaping. */
function idleWaveValue(time, index, count) {
  const x = index / Math.max(count - 1, 1);
  const swell = Math.sin(x * Math.PI * 2 * 1.15 - time * 1.35);
  const chop = Math.sin(x * Math.PI * 2 * 2.65 + time * 2.05);
  const ripple = Math.sin(x * Math.PI * 2 * 4.6 - time * 2.7);
  const mixed = swell * 0.55 + chop * 0.3 + ripple * 0.15;
  const breath = 0.8 + 0.2 * Math.sin(time * 0.42);
  return IDLE_WAVE_BASE + ((mixed + 1) * 0.5) * IDLE_WAVE_AMP * breath;
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
  /** False until this point count has seen a frame, so the first one is not a hit. */
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

function smoothOutline(values) {
  const n = values.length;
  const out = new Array(n);
  const radius = OUTLINE_RADIUS;
  for (let i = 0; i < n; i++) {
    let acc = 0;
    let weight = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = Math.min(n - 1, Math.max(0, i + k));
      const w = radius + 1 - Math.abs(k);
      acc += (values[j] ?? 0) * w;
      weight += w;
    }
    out[i] = weight > 0 ? acc / weight : 0;
  }
  return out;
}

/** Round the corners of a polyline so the fill reads as a wave. */
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

function spectrumBaseline(height, width, orientation, mirror) {
  if (orientation === "vertical") {
    return mirror ? width / 2 : 0;
  }
  return mirror ? height / 2 : height;
}

export function create() {
  let idlePhase = 0;
  /** -1 until the first frame, so a still snapshot starts in the right pose. */
  let presence = -1;
  /** Last live outline, held while playback settles into the resting wave. */
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
      const bucketCount = BAR_COUNT;
      const mirror = MIRROR;
      const glow = GLOW;
      const orientation = ORIENTATION;
      const colors = frame.trackMetadata.artColors;
      const { width, height } = frame.size;
      const dt = Math.max(0, Math.min(64, frame.time.deltaMs || 0));

      paintBackdrop(ctx, width, height);

      const playing =
        frame.audio.isPlaying && frame.audio.frequencies.length > 0;
      if (frame.audio.isPlaying && !playing) return;

      if (playing) {
        liveHold = measure(frame.audio.frequencies, bucketCount, dt).slice();
      } else if (liveHold.length !== bucketCount) {
        liveHold = new Array(bucketCount).fill(0);
      }

      const amount = stepPresence(
        playing,
        dt,
        frame.flags.reducedMotion === true,
      );
      idlePhase += dt / 1000;
      const magnitudes = new Array(bucketCount);
      for (let i = 0; i < bucketCount; i++) {
        const idle = idleWaveValue(idlePhase, i, bucketCount);
        magnitudes[i] = (liveHold[i] ?? 0) * amount + idle * (1 - amount);
      }

      const outline = smoothOutline(magnitudes);
      const baseline = spectrumBaseline(height, width, orientation, mirror);
      const cross = orientation === "horizontal" ? height : width;

      const gradient =
        orientation === "horizontal"
          ? ctx.createLinearGradient(0, 0, width, 0)
          : ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, paletteColorAt(colors, 0, bucketCount));
      gradient.addColorStop(
        0.5,
        paletteColorAt(colors, Math.floor(bucketCount / 2), bucketCount),
      );
      gradient.addColorStop(
        1,
        paletteColorAt(colors, bucketCount - 1, bucketCount),
      );

      ctx.beginPath();

      const span = Math.max(bucketCount - 1, 1);
      if (orientation === "horizontal") {
        const top = [];
        const bottom = [];
        for (let i = 0; i < bucketCount; i++) {
          const x = (i / span) * width;
          const magnitude = outline[i] ?? 0;
          top.push({
            x,
            y: mirror
              ? baseline - magnitude * cross * 0.45
              : baseline - magnitude * cross * 0.92,
          });
          if (mirror) {
            bottom.push({ x, y: baseline + magnitude * cross * 0.45 });
          }
        }
        ctx.moveTo(0, baseline);
        curveThrough(ctx, top);
        ctx.lineTo(width, baseline);
        if (mirror) {
          bottom.reverse();
          curveThrough(ctx, bottom);
        } else {
          ctx.lineTo(0, baseline);
        }
      } else {
        const forward = [];
        const back = [];
        for (let i = 0; i < bucketCount; i++) {
          const y = (i / span) * height;
          const magnitude = outline[i] ?? 0;
          forward.push({
            x: mirror
              ? baseline - magnitude * cross * 0.45
              : baseline + magnitude * cross * 0.92,
            y,
          });
          if (mirror) {
            back.push({ x: baseline + magnitude * cross * 0.45, y });
          }
        }
        ctx.moveTo(baseline, 0);
        curveThrough(ctx, forward);
        ctx.lineTo(baseline, height);
        if (mirror) {
          back.reverse();
          curveThrough(ctx, back);
        } else {
          ctx.lineTo(baseline, 0);
        }
      }

      ctx.closePath();
      ctx.globalAlpha = 0.55 + frame.audio.overallEnergy * amount * 0.35;
      applyGlow(ctx, glow, paletteColorAt(colors, 0, bucketCount));
      ctx.fillStyle = gradient;
      ctx.fill();
      clearGlow(ctx);
      ctx.globalAlpha = 1;

      ctx.lineWidth = 1;
      ctx.strokeStyle = paletteColorAt(
        colors,
        Math.floor(bucketCount * 0.7),
        bucketCount,
      );
      ctx.globalAlpha = 0.7;
      ctx.stroke();
      ctx.globalAlpha = 1;
    },
  };
}
