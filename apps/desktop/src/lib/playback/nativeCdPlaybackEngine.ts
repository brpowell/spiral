import { NativePlaybackEngine } from "./nativePlaybackEngine";
import { CD_NATIVE_TRANSPORT } from "./nativeTransport";

export type { NativePlaybackError as CdPlaybackStreamError } from "./nativePlaybackEngine";

/** CD tracks through the Rust audio output. */
export class NativeCdPlaybackEngine extends NativePlaybackEngine {
  constructor() {
    super(CD_NATIVE_TRANSPORT);
  }
}
