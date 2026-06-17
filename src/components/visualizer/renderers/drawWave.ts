import type { RendererParams, VisualizerDrawArgs } from "../types";
import {
  IDLE_SPEED,
  IDLE_WAVE_BASE,
  applyGlow,
  binsToWaveSamples,
  clearGlow,
  idleWaveValue,
  paletteColorAt,
  resampleWaveform,
  sampleTimeDomainData,
  shouldDrawIdle,
} from "../rendererUtils";

function buildWaveSamples(
  sampleCount: number,
  timeDomainDataRef: { current: Uint8Array<ArrayBuffer> | null },
  remoteWaveform: number[] | null,
  remoteBins: number[] | null,
): number[] | null {
  if (remoteWaveform && remoteWaveform.length > 0) {
    return resampleWaveform(remoteWaveform, sampleCount);
  }

  if (remoteBins && remoteBins.length > 0) {
    return binsToWaveSamples(remoteBins, sampleCount);
  }

  const timeData = sampleTimeDomainData(timeDomainDataRef);
  if (!timeData) return null;

  const samples: number[] = new Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const dataIndex = Math.floor((i / sampleCount) * timeData.length);
    const value = timeData[dataIndex] ?? 128;
    samples[i] = (value - 128) / 128;
  }
  return samples;
}

function drawWavePath(
  ctx: CanvasRenderingContext2D,
  samples: number[],
  width: number,
  height: number,
  mirror: boolean,
  orientation: "horizontal" | "vertical",
): void {
  const mid = orientation === "horizontal" ? height / 2 : width / 2;
  const amplitude = (orientation === "horizontal" ? height : width) * 0.42;

  const pointFor = (index: number, direction: "up" | "down") => {
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

export function drawWaveFrame(
  { ctx, width, height, context, remoteBins, remoteWaveform, state }: VisualizerDrawArgs,
  params: RendererParams,
): void {
  const sampleCount = params.barCount ?? 128;
  const mirror = params.mirror ?? true;
  const glow = params.glow ?? 0.5;
  const orientation = params.orientation ?? "horizontal";
  const colors = context.colors.palette;
  const accent = paletteColorAt(colors, 0, 2);
  const accentEnd = paletteColorAt(colors, 1, 2);

  ctx.clearRect(0, 0, width, height);

  let samples: number[] | null = null;

  if (context.audio.isPlaying) {
    samples = buildWaveSamples(
      sampleCount,
      state.timeDomainDataRef,
      remoteWaveform,
      remoteBins,
    );
  }

  if (!samples) {
    if (!shouldDrawIdle(context)) return;

    samples = new Array(sampleCount);
    state.idlePhaseRef.current += IDLE_SPEED;
    const phase = state.idlePhaseRef.current;
    for (let i = 0; i < sampleCount; i++) {
      samples[i] = (idleWaveValue(phase, i, sampleCount) - IDLE_WAVE_BASE) * 2;
    }
  }

  const gradient =
    orientation === "vertical"
      ? ctx.createLinearGradient(0, 0, 0, height)
      : ctx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, accent);
  gradient.addColorStop(1, accentEnd);

  ctx.lineWidth = Math.max(1.5, (orientation === "horizontal" ? height : width) * 0.02);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = gradient;
  applyGlow(ctx, glow, accent);
  drawWavePath(ctx, samples, width, height, mirror, orientation);
  clearGlow(ctx);

  if (mirror) {
    ctx.globalAlpha = 0.18 + context.audio.overallEnergy * 0.35;
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}
