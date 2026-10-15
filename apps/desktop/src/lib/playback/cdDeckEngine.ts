import { CdPlaybackEngine } from "./cdPlaybackEngine";
import { DeckEngineProxy, type DeckBackend } from "./deckEngineProxy";
import { NativeCdPlaybackEngine } from "./nativeCdPlaybackEngine";

/** CD engine: webview PCM, or the native output when enabled. */
export class CdDeckEngine extends DeckEngineProxy {
  protected createWebviewBackend(): DeckBackend {
    return new CdPlaybackEngine() as unknown as DeckBackend;
  }

  protected createNativeBackend(): DeckBackend {
    return new NativeCdPlaybackEngine() as unknown as DeckBackend;
  }
}
