import type { RendererParams, VisualizerDrawArgs } from "../types";
import {
  IDLE_SPEED,
  applyGlow,
  clearGlow,
  idleWaveValue,
  paletteColorAt,
  sampleFrequencyData,
  shouldDrawIdle,
} from "../rendererUtils";

export function drawBarsFrame(
  { ctx, width, height, context, remoteBins, state }: VisualizerDrawArgs,
  params: RendererParams,
): void {
  const barCount = params.barCount ?? 64;
  const mirror = params.mirror ?? false;
  const glow = (params.glow ?? 0) * (0.35 + context.audio.bassEnergy * 0.65);
  const orientation = params.orientation ?? "horizontal";
  const colors = context.colors.palette;

  ctx.clearRect(0, 0, width, height);

  const drawBar = (index: number, magnitude: number, alpha = 1) => {
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

  if (context.audio.isPlaying) {
    const data = sampleFrequencyData(state.frequencyDataRef, remoteBins);

    if (data) {
      for (let i = 0; i < barCount; i++) {
        const dataIndex = Math.floor((i / barCount) * data.length);
        const value = data[dataIndex] ?? 0;
        drawBar(i, value / 255);
      }
      return;
    }
  }

  if (!shouldDrawIdle(context)) return;

  state.idlePhaseRef.current += IDLE_SPEED;
  const phase = state.idlePhaseRef.current;

  for (let i = 0; i < barCount; i++) {
    drawBar(i, idleWaveValue(phase, i, barCount), 0.45);
  }
}
