import { PhysicalPosition } from "@tauri-apps/api/dpi";
import {
  availableMonitors,
  currentMonitor,
  getCurrentWindow,
} from "@tauri-apps/api/window";
import type { Monitor } from "@tauri-apps/api/window";
import {
  isSkinModeSnapEnabled,
  isSkinModeSnapSuppressed,
} from "./skinModeWindowChrome";
import type { SnapEdge } from "./skinModeWindowState";

const SKIN_MODE_LABEL = "skin-mode";
const SNAP_THRESHOLD_PX = 18;

function findMonitorByName(
  monitors: Monitor[],
  name: string | null,
): Monitor | null {
  if (!name) return null;
  return monitors.find((monitor) => monitor.name === name) ?? null;
}

async function resolveMonitor(name: string | null): Promise<Monitor | null> {
  const monitors = await availableMonitors();
  const match = findMonitorByName(monitors, name);
  if (match) return match;
  return currentMonitor();
}

function clampToWorkArea(
  x: number,
  y: number,
  width: number,
  height: number,
  monitor: Monitor,
): { x: number; y: number } {
  const work = monitor.workArea;
  const maxX = work.position.x + Math.max(0, work.size.width - width);
  const maxY = work.position.y + Math.max(0, work.size.height - height);
  return {
    x: Math.min(Math.max(x, work.position.x), maxX),
    y: Math.min(Math.max(y, work.position.y), maxY),
  };
}

export interface SnapResult {
  x: number;
  y: number;
  monitorName: string | null;
  scaleFactor: number;
  snapEdge: SnapEdge | null;
}

export async function snapSkinModeWindow(): Promise<SnapResult | null> {
  if (isSkinModeSnapSuppressed() || !isSkinModeSnapEnabled()) {
    return null;
  }

  const window = getCurrentWindow();
  if (window.label !== SKIN_MODE_LABEL) return null;

  const [position, size, monitor] = await Promise.all([
    window.outerPosition(),
    window.outerSize(),
    currentMonitor(),
  ]);
  if (!monitor) return null;

  const work = monitor.workArea;
  let x = position.x;
  let y = position.y;
  const { width, height } = size;

  const distLeft = x - work.position.x;
  const distRight = work.position.x + work.size.width - (x + width);
  const distTop = y - work.position.y;
  const distBottom = work.position.y + work.size.height - (y + height);

  let snapEdge: SnapEdge | null = null;
  const distances: { edge: SnapEdge; value: number }[] = [
    { edge: "left", value: distLeft },
    { edge: "right", value: distRight },
    { edge: "top", value: distTop },
    { edge: "bottom", value: distBottom },
  ];
  const nearest = distances.reduce((best, entry) =>
    entry.value < best.value ? entry : best,
  );

  if (nearest.value <= SNAP_THRESHOLD_PX) {
    snapEdge = nearest.edge;
    switch (nearest.edge) {
      case "left":
        x = work.position.x;
        break;
      case "right":
        x = work.position.x + work.size.width - width;
        break;
      case "top":
        y = work.position.y;
        break;
      case "bottom":
        y = work.position.y + work.size.height - height;
        break;
    }
  }

  const clamped = clampToWorkArea(x, y, width, height, monitor);
  if (clamped.x !== x || clamped.y !== y) {
    await window.setPosition(new PhysicalPosition(clamped.x, clamped.y));
  } else if (snapEdge) {
    await window.setPosition(new PhysicalPosition(x, y));
  }

  return {
    x: clamped.x,
    y: clamped.y,
    monitorName: monitor.name,
    scaleFactor: monitor.scaleFactor,
    snapEdge,
  };
}

/**
 * @param width Height in logical pixels; converted to physical for work-area math.
 */
export async function restoreSkinModeGeometry(
  persistedMonitorName: string | null,
  x: number,
  y: number,
  width: number,
  height: number,
  snapEdge: SnapEdge | null,
): Promise<{ x: number; y: number }> {
  const monitor = await resolveMonitor(persistedMonitorName);
  if (!monitor) {
    return { x, y };
  }

  const scale = monitor.scaleFactor;
  const physicalWidth = width * scale;
  const physicalHeight = height * scale;

  const work = monitor.workArea;
  let nextX = x;
  let nextY = y;

  if (snapEdge === "left") {
    nextX = work.position.x;
  } else if (snapEdge === "right") {
    nextX = work.position.x + work.size.width - physicalWidth;
  } else if (snapEdge === "top") {
    nextY = work.position.y;
  } else if (snapEdge === "bottom") {
    nextY = work.position.y + work.size.height - physicalHeight;
  }

  return clampToWorkArea(
    nextX,
    nextY,
    physicalWidth,
    physicalHeight,
    monitor,
  );
}
