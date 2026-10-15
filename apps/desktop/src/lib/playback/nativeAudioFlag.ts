/**
 * Whether library files play through the native (Rust) output. A standalone
 * module so the playback engines can read it without importing the settings
 * store (which would close an import cycle through the player store).
 */
let enabled = false;

export function setNativeAudioEnabled(value: boolean): void {
  enabled = value;
}

export function isNativeAudioEnabled(): boolean {
  return enabled;
}
