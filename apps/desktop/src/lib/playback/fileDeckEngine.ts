import { DeckEngineProxy, type DeckBackend } from "./deckEngineProxy";
import { NativeFilePlaybackEngine } from "./nativeFilePlaybackEngine";
import { PcmFilePlaybackEngine } from "./pcmFilePlaybackEngine";

/** Library-file engine: webview PCM, or the native output when enabled. */
export class FilePlaybackEngine extends DeckEngineProxy {
  protected createWebviewBackend(): DeckBackend {
    return new PcmFilePlaybackEngine() as unknown as DeckBackend;
  }

  protected createNativeBackend(): DeckBackend {
    return new NativeFilePlaybackEngine() as unknown as DeckBackend;
  }
}
