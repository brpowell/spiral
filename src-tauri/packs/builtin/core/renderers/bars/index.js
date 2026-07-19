/**
 * Bars VizRenderer — pack-shipped canvas module.
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

export function create() {
  let idlePhase = 0;

  return {
    render(ctx, frame, params) {
      const barCount = params.barCount ?? 64;
      const mirror = params.mirror ?? false;
      const glow =
        (params.glow ?? 0) * (0.35 + frame.audio.bassEnergy * 0.65);
      const orientation = params.orientation ?? "horizontal";
      const colors = frame.colors.palette;
      const { width, height } = frame.size;

      ctx.clearRect(0, 0, width, height);

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

      if (frame.audio.isPlaying && frame.audio.frequencies.length > 0) {
        const data = frame.audio.frequencies;
        for (let i = 0; i < barCount; i++) {
          const dataIndex = Math.floor((i / barCount) * data.length);
          drawBar(i, data[dataIndex] ?? 0);
        }
        return;
      }

      if (frame.audio.isPlaying) return;

      idlePhase += IDLE_SPEED;
      for (let i = 0; i < barCount; i++) {
        drawBar(i, idleWaveValue(idlePhase, i, barCount), 0.45);
      }
    },
  };
}
