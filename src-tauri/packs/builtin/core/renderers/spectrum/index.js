/**
 * Spectrum VizRenderer — pack-shipped canvas module.
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

function logBinIndex(index, count, dataLength) {
  if (count <= 1) return 0;
  const t = index / (count - 1);
  const logT = Math.pow(t, 2.2);
  return Math.min(dataLength - 1, Math.floor(logT * (dataLength - 1)));
}

function spectrumBaseline(height, width, orientation, mirror) {
  if (orientation === "vertical") {
    return mirror ? width / 2 : 0;
  }
  return mirror ? height / 2 : height;
}

export function create() {
  let idlePhase = 0;

  return {
    render(ctx, frame, params) {
      const bucketCount = params.barCount ?? 96;
      const mirror = params.mirror ?? false;
      const glow = params.glow ?? 0.6;
      const orientation = params.orientation ?? "horizontal";
      const colors = frame.colors.palette;
      const { width, height } = frame.size;

      ctx.clearRect(0, 0, width, height);

      const magnitudes = new Array(bucketCount);
      let hasData = false;

      if (frame.audio.isPlaying && frame.audio.frequencies.length > 0) {
        const data = frame.audio.frequencies;
        hasData = true;
        for (let i = 0; i < bucketCount; i++) {
          const dataIndex = logBinIndex(i, bucketCount, data.length);
          magnitudes[i] = data[dataIndex] ?? 0;
        }
      }

      if (!hasData) {
        if (frame.audio.isPlaying) return;

        idlePhase += IDLE_SPEED;
        for (let i = 0; i < bucketCount; i++) {
          magnitudes[i] = idleWaveValue(idlePhase, i, bucketCount);
        }
      }

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

      if (orientation === "horizontal") {
        ctx.moveTo(0, baseline);
        for (let i = 0; i < bucketCount; i++) {
          const x = (i / Math.max(bucketCount - 1, 1)) * width;
          const magnitude = magnitudes[i] ?? 0;
          const y = mirror
            ? baseline - magnitude * cross * 0.45
            : baseline - magnitude * cross * 0.92;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(width, baseline);
        if (mirror) {
          for (let i = bucketCount - 1; i >= 0; i--) {
            const x = (i / Math.max(bucketCount - 1, 1)) * width;
            const magnitude = magnitudes[i] ?? 0;
            const y = baseline + magnitude * cross * 0.45;
            ctx.lineTo(x, y);
          }
        } else {
          ctx.lineTo(0, baseline);
        }
      } else {
        ctx.moveTo(baseline, 0);
        for (let i = 0; i < bucketCount; i++) {
          const y = (i / Math.max(bucketCount - 1, 1)) * height;
          const magnitude = magnitudes[i] ?? 0;
          const x = mirror
            ? baseline - magnitude * cross * 0.45
            : baseline + magnitude * cross * 0.92;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(baseline, height);
        if (mirror) {
          for (let i = bucketCount - 1; i >= 0; i--) {
            const y = (i / Math.max(bucketCount - 1, 1)) * height;
            const magnitude = magnitudes[i] ?? 0;
            const x = baseline + magnitude * cross * 0.45;
            ctx.lineTo(x, y);
          }
        } else {
          ctx.lineTo(baseline, 0);
        }
      }

      ctx.closePath();
      ctx.globalAlpha = 0.55 + frame.audio.overallEnergy * 0.35;
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
