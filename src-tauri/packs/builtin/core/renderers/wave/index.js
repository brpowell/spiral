/**
 * Wave VizRenderer — pack-shipped canvas module.
 * Contract: export create() → { render(ctx, frame, params) }
 */

const IDLE_SPEED = 0.00032;
const IDLE_WAVE_FREQ = 180;
const IDLE_WAVE_SPREAD = 0.22;
const IDLE_WAVE_AMP = 0.22;
const IDLE_WAVE_BASE = 0.1;

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

function resampleWaveform(source, sampleCount) {
  const samples = new Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const dataIndex = Math.floor((i / sampleCount) * source.length);
    samples[i] = source[dataIndex] ?? 0;
  }
  return samples;
}

function drawWavePath(ctx, samples, width, height, mirror, orientation) {
  const mid = orientation === "horizontal" ? height / 2 : width / 2;
  const amplitude = (orientation === "horizontal" ? height : width) * 0.42;

  const pointFor = (index, direction) => {
    const t = index / Math.max(samples.length - 1, 1);
    const value = samples[index] ?? 0;
    const offset = value * amplitude * (direction === "up" ? -1 : 1);
    if (orientation === "horizontal") {
      return { x: t * width, y: mid + offset };
    }
    return { x: mid + offset, y: t * height };
  };

  const first = pointFor(0, "up");
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);

  for (let i = 1; i < samples.length; i++) {
    const p = pointFor(i, "up");
    ctx.lineTo(p.x, p.y);
  }

  if (mirror) {
    for (let i = samples.length - 1; i >= 0; i--) {
      const p = pointFor(i, "down");
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
  }

  ctx.stroke();
}

export function create() {
  let idlePhase = 0;

  return {
    render(ctx, frame, params) {
      const sampleCount = params.barCount ?? 128;
      const mirror = params.mirror ?? true;
      const glow = params.glow ?? 0.5;
      const orientation = params.orientation ?? "horizontal";
      const colors = frame.colors.palette;
      const accent = paletteColorAt(colors, 0, 2);
      const accentEnd = paletteColorAt(colors, 1, 2);
      const { width, height } = frame.size;

      ctx.clearRect(0, 0, width, height);

      let samples = null;

      if (frame.audio.isPlaying && frame.audio.waveform.length > 0) {
        samples = resampleWaveform(frame.audio.waveform, sampleCount);
      }

      if (!samples) {
        if (frame.audio.isPlaying) return;

        samples = new Array(sampleCount);
        idlePhase += IDLE_SPEED;
        for (let i = 0; i < sampleCount; i++) {
          samples[i] =
            (idleWaveValue(idlePhase, i, sampleCount) - IDLE_WAVE_BASE) * 2;
        }
      }

      const gradient =
        orientation === "vertical"
          ? ctx.createLinearGradient(0, 0, 0, height)
          : ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, accent);
      gradient.addColorStop(1, accentEnd);

      ctx.lineWidth = Math.max(
        1.5,
        (orientation === "horizontal" ? height : width) * 0.02,
      );
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.strokeStyle = gradient;
      applyGlow(ctx, glow, accent);
      drawWavePath(ctx, samples, width, height, mirror, orientation);
      clearGlow(ctx);

      if (mirror) {
        ctx.globalAlpha = 0.18 + frame.audio.overallEnergy * 0.35;
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    },
  };
}
