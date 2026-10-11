/** Main-window playback publishes the playhead without writing the player store. */
type LivePositionPublisher = (positionSeconds: number) => void;

let publisher: LivePositionPublisher | null = null;

export function setLivePositionPublisher(
  next: LivePositionPublisher | null,
): void {
  publisher = next;
}

export function notifyLivePosition(positionSeconds: number): void {
  publisher?.(positionSeconds);
}
