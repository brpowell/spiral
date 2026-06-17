import * as THREE from "three";
import { paletteColorAt } from "../rendererUtils";

function hexToThreeColor(hex: string): THREE.Color {
  return new THREE.Color(hex);
}

export function paletteToThreeColors(
  palette: readonly string[],
  count: number,
): THREE.Color[] {
  if (palette.length === 0) {
    return Array.from({ length: count }, () => new THREE.Color("#888888"));
  }
  return Array.from({ length: count }, (_, i) =>
    hexToThreeColor(paletteColorAt([...palette], i, count)),
  );
}
