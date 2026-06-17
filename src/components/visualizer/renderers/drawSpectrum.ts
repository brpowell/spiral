import type { RendererParams, VisualizerDrawArgs } from "../types";
import {
  IDLE_SPEED,
  applyGlow,
  clearGlow,
  idleWaveValue,
  logBinIndex,
  paletteColorAt,
  sampleFrequencyData,
  shouldDrawIdle,
} from "../rendererUtils";

function spectrumBaseline(
  height: number,
  width: number,
  orientation: "horizontal" | "vertical",
  mirror: boolean,
): number {
  if (orientation === "vertical") {
    return mirror ? width / 2 : 0;
  }
  return mirror ? height / 2 : height;
}

export function drawSpectrumFrame(
  { ctx, width, height, context, remoteBins, state }: VisualizerDrawArgs,
  params: RendererParams,
): void {
  const bucketCount = params.barCount ?? 96;
  const mirror = params.mirror ?? false;
  const glow = params.glow ?? 0.6;
  const orientation = params.orientation ?? "horizontal";
  const colors = context.colors.palette;

  ctx.clearRect(0, 0, width, height);

  const magnitudes: number[] = new Array(bucketCount);
  let hasData = false;

  if (context.audio.isPlaying) {
    const data = sampleFrequencyData(state.frequencyDataRef, remoteBins);

    if (data) {
      hasData = true;
      for (let i = 0; i < bucketCount; i++) {
        const dataIndex = logBinIndex(i, bucketCount, data.length);
        magnitudes[i] = (data[dataIndex] ?? 0) / 255;
      }
    }
  }

  if (!hasData) {
    if (!shouldDrawIdle(context)) return;

    state.idlePhaseRef.current += IDLE_SPEED;
    const phase = state.idlePhaseRef.current;

    for (let i = 0; i < bucketCount; i++) {
      magnitudes[i] = idleWaveValue(phase, i, bucketCount);
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
  gradient.addColorStop(1, paletteColorAt(colors, bucketCount - 1, bucketCount));

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
  ctx.globalAlpha = 0.55 + context.audio.overallEnergy * 0.35;
  applyGlow(ctx, glow, paletteColorAt(colors, 0, bucketCount));
  ctx.fillStyle = gradient;
  ctx.fill();
  clearGlow(ctx);
  ctx.globalAlpha = 1;

  ctx.lineWidth = 1;
  ctx.strokeStyle = paletteColorAt(colors, Math.floor(bucketCount * 0.7), bucketCount);
  ctx.globalAlpha = 0.7;
  ctx.stroke();
  ctx.globalAlpha = 1;
}
