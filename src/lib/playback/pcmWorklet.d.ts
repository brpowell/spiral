/** Web Audio worklet globals (not provided by TypeScript's default libs). */
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  abstract process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor,
): void;

/**
 * Frame index of the first sample of the block being rendered. Shared by every
 * node on the same AudioContext, so two decks can agree on a splice point.
 */
declare const currentFrame: number;
