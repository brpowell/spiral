/** WMP-style MM:SS digit roles (see classic skin DrawTimeNormalView). */
export type DigitSlotRole =
  | "sign"
  | "minuteTens"
  | "minuteOnes"
  | "secondTens"
  | "secondOnes";

export type DigitSlotFrames = Record<
  Exclude<DigitSlotRole, "sign">,
  number
>;

/** Map elapsed seconds to digit indices 0–9 for each MM:SS window. */
export function mmssDigitFrames(seconds: number): DigitSlotFrames {
  let s = Math.floor(Math.max(0, seconds));

  const secondOnes = s % 10;
  s -= s % 10;
  const secondTens = Math.floor((s % 60) / 10);
  s -= s % 60;
  s = Math.floor(s / 60);
  const minuteOnes = s % 10;
  s -= s % 10;
  const minuteTens = Math.floor(s / 10);

  return { minuteTens, minuteOnes, secondTens, secondOnes };
}

export function digitTimeDisplaySeconds(
  showElapsed: boolean,
  positionSeconds: number,
  durationSeconds: number,
): number {
  if (!showElapsed && durationSeconds > 0) {
    return Math.max(0, durationSeconds - positionSeconds);
  }
  return positionSeconds;
}
