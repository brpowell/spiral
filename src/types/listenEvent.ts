/** How a library listen closed. */
export type ListenCompletion = "natural_end" | "skipped" | "interrupted";

/** Where the user was listening from (playback still runs on main). */
export type ListenUiMode = "library" | "skin";

/** Payload written via `record_listen_event`. */
export interface ListenEventPayload {
  trackId: number;
  startedAt: string;
  endedAt: string;
  listenedSeconds: number;
  libraryListenedSeconds: number;
  skinListenedSeconds: number;
  trackDurationSeconds: number | null;
  completion: ListenCompletion;
  source: "library";
  /** Majority mode by listened seconds (tie → library). */
  uiMode: ListenUiMode;
  themeId: string | null;
  themeName: string | null;
  skinId: string | null;
  skinName: string | null;
  visualizerId: string | null;
  visualizerName: string | null;
}
