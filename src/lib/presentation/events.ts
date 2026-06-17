import type { PresentationEventName } from "./types";

type Listener = () => void;

/** Lightweight pub/sub for presentation triggers (viz scenes, future skin timelines). */
export class PresentationEventBus {
  private listeners = new Map<string, Set<Listener>>();

  on(event: PresentationEventName | string, listener: Listener): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
    };
  }

  emit(event: PresentationEventName | string): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      listener();
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

export const presentationEvents = new PresentationEventBus();
