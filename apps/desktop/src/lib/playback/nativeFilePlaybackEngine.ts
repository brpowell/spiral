import { NativePlaybackEngine } from "./nativePlaybackEngine";
import { FILE_NATIVE_TRANSPORT } from "./nativeTransport";

/** Library files through the Rust audio output. */
export class NativeFilePlaybackEngine extends NativePlaybackEngine {
  constructor() {
    super(FILE_NATIVE_TRANSPORT);
  }
}
