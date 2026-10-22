/**
 * Wave VizRenderer — pack-shipped canvas module.
 * A mirrored waveform. Each column is the peak of its slice, so transients
 * stay spikes. The slopes between them are blurred, and only peaks that
 * stand clear of their neighbors keep their height, so the line stays
 * spiky without the jagged oscilloscope corners.
 * Contract: export create() → { render(ctx, frame) }
 */

const COLUMN_COUNT = 128;
const MIRROR = true;
const GLOW = 0.6;
const ORIENTATION = "horizontal";

const IDLE_SPEED = 0.00032;
const IDLE_WAVE_FREQ = 180;
const IDLE_WAVE_SPREAD = 0.22;
const IDLE_WAVE_AMP = 0.22;
const IDLE_WAVE_BASE = 0.1;

/** Neighbor span of the blur that rounds the slopes between spikes. */
const SMOOTH_RADIUS = 3;
/** How much of a distinct peak's height survives the blur. */
const PEAK_KEEP = 0.9;
/** A bump has to stand this far above its neighbors before it stays a spike. */
const PEAK_PROMINENCE = 0.05;
/** Cardinal-spline tension. Lower is rounder; higher stays closer to the samples. */
const CURVE_TENSION = 0.5;
/** Outer fraction of the wave that settles into the center line. */
const EDGE_TAPER = 0.05;
/** Spike rise and settle. Short on purpose: each frame is a new slice of audio. */
const ATTACK_MS = 22;
const RELEASE_MS = 68;

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

/**
 * Dark olive stage with a faint lime lift from below. Semi-transparent, so
 * the theme still tints it; light themes get a softened dark, not a black box.
 */
const BACKDROP_ALPHA = 0.6;

function paintBackdrop(ctx, width, height) {
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.globalAlpha = BACKDROP_ALPHA;
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

function idleWaveValue(phase, index, count) {
  const spread = (index / Math.max(count - 1, 1)) * IDLE_WAVE_SPREAD * count;
  return (
    (Math.sin(phase * IDLE_WAVE_FREQ + spread) + 1) * 0.5 * IDLE_WAVE_AMP +
    IDLE_WAVE_BASE
  );
}

/** Loudest sample in each column. Spikes survive; zero-crossing chatter does not. */
function peakEnvelope(source, sampleCount) {
  const peaks = new Array(sampleCount);
  const n = source.length;
  for (let i = 0; i < sampleCount; i++) {
    const start = Math.floor((i * n) / sampleCount);
    const end = Math.max(start + 1, Math.floor(((i + 1) * n) / sampleCount));
    let peak = 0;
    const last = Math.min(end, n);
    for (let j = start; j < last; j++) {
      const value = Math.abs(source[j] ?? 0);
      if (value > peak) peak = value;
    }
    peaks[i] = peak;
  }
  return peaks;
}

function blurEnvelope(values, radius) {
  const n = values.length;
  const out = new Array(n);
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

/**
 * Blur the body, then lift local peaks back up so the tips stay spiky
 * while the slopes between them stay smooth.
 */
function softenEnvelope(values) {
  const soft = blurEnvelope(values, SMOOTH_RADIUS);
  const out = new Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const peak = values[i] ?? 0;
    const prev = values[Math.max(0, i - 1)] ?? peak;
    const next = values[Math.min(values.length - 1, i + 1)] ?? peak;
    const prominence = peak - Math.max(prev, next);
    if (prominence >= PEAK_PROMINENCE) {
      const keep = Math.min(1, PEAK_KEEP + prominence);
      out[i] = peak * keep + soft[i] * (1 - keep);
    } else {
      out[i] = soft[i];
    }
  }
  return out;
}

function taperEdges(values) {
  const n = values.length;
  const edge = Math.max(1, Math.round((n - 1) * EDGE_TAPER));
  for (let i = 0; i < edge; i++) {
    const gain = i / edge;
    values[i] *= gain;
    values[n - 1 - i] *= gain;
  }
  return values;
}

function shapeWaveform(source, sampleCount) {
  return taperEdges(softenEnvelope(peakEnvelope(source, sampleCount)));
}

/** Smooth curve through every point, so peaks keep their height. */
function curveThrough(ctx, points) {
  const n = points.length;
  if (n === 0) return;
  ctx.lineTo(points[0].x, points[0].y);
  if (n === 1) return;
  const scale = (1 - CURVE_TENSION) / 2;
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(n - 1, i + 2)];
    ctx.bezierCurveTo(
      p1.x + (p2.x - p0.x) * scale,
      p1.y + (p2.y - p0.y) * scale,
      p2.x - (p3.x - p1.x) * scale,
      p2.y - (p3.y - p1.y) * scale,
      p2.x,
      p2.y,
    );
  }
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

  ctx.beginPath();
  ctx.moveTo(upper[0].x, upper[0].y);
  curveThrough(ctx, upper);

  if (mirror) {
    const lower = [];
    for (let i = samples.length - 1; i >= 0; i--) lower.push(pointFor(i, "down"));
    curveThrough(ctx, lower);
    ctx.closePath();
  }
}

function followTargets(display, targets, dt) {
  if (display.length !== targets.length) {
    return targets.slice();
  }
  const attack = 1 - Math.exp(-dt / ATTACK_MS);
  const release = 1 - Math.exp(-dt / RELEASE_MS);
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i] ?? 0;
    const blend = target >= display[i] ? attack : release;
    display[i] += (target - display[i]) * blend;
  }
  return display;
}

export function create() {
  let idlePhase = 0;
  let display = [];

  return {
    render(ctx, frame) {
      const sampleCount = COLUMN_COUNT;
      const mirror = MIRROR;
      const glow = GLOW;
      const orientation = ORIENTATION;
      const colors = frame.trackMetadata.artColors;
      const { width, height } = frame.size;
      const dt = Math.min(64, frame.time?.deltaMs ?? 16);

      paintBackdrop(ctx, width, height);

      let targets = null;

      if (frame.audio.isPlaying && frame.audio.waveform.length > 0) {
        targets = shapeWaveform(frame.audio.waveform, sampleCount);
      }

      if (!targets) {
        if (frame.audio.isPlaying) return;

        targets = new Array(sampleCount);
        idlePhase += IDLE_SPEED;
        for (let i = 0; i < sampleCount; i++) {
          targets[i] =
            (idleWaveValue(idlePhase, i, sampleCount) - IDLE_WAVE_BASE) * 2;
        }
        taperEdges(targets);
      }

      display = followTargets(display, targets, dt);

      const gradient =
        orientation === "vertical"
          ? ctx.createLinearGradient(0, 0, 0, height)
          : ctx.createLinearGradient(0, 0, width, 0);
      addPaletteStops(gradient, colors);

      ctx.lineWidth = Math.max(
        1.5,
        (orientation === "horizontal" ? height : width) * 0.018,
      );
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.strokeStyle = gradient;
      ctx.fillStyle = gradient;

      drawWavePath(ctx, display, width, height, mirror, orientation);
      if (mirror) {
        ctx.globalAlpha = 0.2 + frame.audio.overallEnergy * 0.34;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      applyGlow(ctx, glow, colors[0] ?? "#888888");
      ctx.stroke();
      clearGlow(ctx);
    },
  };
}
