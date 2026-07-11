import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { LyricsFormat, LyricsLine } from "../../types/lyrics";
import type { LyricsFetchFeedback } from "../../lib/lyricsFetch";
import { formatLyricsFormatLabel, parseEditorLyricsChange } from "../../lib/lyrics";
import { serializeLrc } from "../../lib/lyricsLrc";
import { hasSyncedTimestamps } from "../../lib/lyricsScroll";
import { Button } from "../common/Button/Button";
import { Alert } from "../common/Alert/Alert";
import { Badge } from "../common/Badge/Badge";
import { EmptyState } from "../common/EmptyState/EmptyState";
import { syncTextareaAutoSize, Textarea } from "../common/Textarea/Textarea";
import { IconMicrophone } from "../icons";
import "./TrackEditorLyricsTab.css";

export type TrackEditorLyricsTabProps = {
  value: string;
  syncedLines: LyricsLine[] | null;
  instrumental: boolean;
  fetchingLyrics: boolean;
  fetchFeedback: LyricsFetchFeedback | null;
  onFetchLyrics: () => void;
  onMarkInstrumental: () => void;
  onClearInstrumental: () => void;
  onChange: (update: {
    text: string;
    syncedLines: LyricsLine[] | null;
    format: LyricsFormat;
  }) => void;
};

const LYRICS_TEXTAREA_ROWS = 6;

export function TrackEditorLyricsTab({
  value,
  syncedLines,
  instrumental,
  fetchingLyrics,
  fetchFeedback,
  onFetchLyrics,
  onMarkInstrumental,
  onClearInstrumental,
  onChange,
}: TrackEditorLyricsTabProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);
  const isSynced = syncedLines != null && hasSyncedTimestamps(syncedLines);

  const handleChange = useCallback(
    (nextValue: string) => {
      onChange(parseEditorLyricsChange(nextValue, syncedLines));
    },
    [onChange, syncedLines],
  );

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const pasted = event.clipboardData.getData("text");
      if (!pasted.trim()) {
        return;
      }

      const parsed = parseEditorLyricsChange(pasted, syncedLines);
      if (parsed.format !== "line_synced") {
        return;
      }

      event.preventDefault();
      onChange(parsed);
    },
    [onChange, syncedLines],
  );

  const swapToRawIfSynced = useCallback(() => {
    if (!isSynced || !syncedLines) {
      return;
    }

    const el = textareaRef.current;
    if (!el) {
      return;
    }

    const raw = serializeLrc(syncedLines);
    if (el.value !== raw) {
      el.value = raw;
    }
  }, [isSynced, syncedLines]);

  const handlePointerDown = useCallback(() => {
    if (!focused) {
      swapToRawIfSynced();
    }
  }, [focused, swapToRawIfSynced]);

  const handleFocus = useCallback(() => {
    setFocused(true);
    swapToRawIfSynced();
  }, [swapToRawIfSynced]);

  const handleBlur = useCallback(() => {
    setFocused(false);
  }, []);

  // Textarea only syncs `value` when the prop changes; after editing synced
  // lyrics the DOM still holds LRC while state is already plain text.
  useLayoutEffect(() => {
    if (instrumental) {
      return;
    }

    const el = textareaRef.current;
    if (!el) {
      return;
    }

    if (!focused) {
      const next = String(value);
      if (el.value !== next) {
        el.value = next;
      }
    }

    syncTextareaAutoSize(el, LYRICS_TEXTAREA_ROWS);
  }, [focused, instrumental, value]);

  const formatLabel = instrumental
    ? formatLyricsFormatLabel("instrumental")
    : isSynced
      ? formatLyricsFormatLabel("line_synced")
      : null;

  return (
    <div className="track-editor-lyrics-tab">
      <div className="track-editor-lyrics-tab__toolbar">
        <Button
          size="sm"
          variant="secondary"
          className="track-editor-lyrics-tab__fetch-btn"
          onClick={onFetchLyrics}
          disabled={fetchingLyrics || instrumental}
          aria-busy={fetchingLyrics}
        >
          {fetchingLyrics ? (
            <>
              <span
                className="track-editor-lyrics-tab__spinner"
                aria-hidden
              />
              Fetching…
            </>
          ) : (
            "Fetch lyrics"
          )}
        </Button>
        {instrumental ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={onClearInstrumental}
            disabled={fetchingLyrics}
          >
            Clear instrumental
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={onMarkInstrumental}
            disabled={fetchingLyrics}
          >
            Mark as instrumental
          </Button>
        )}
        {formatLabel ? (
          <Badge
            variant="accent"
            className="track-editor-lyrics-tab__format-badge"
            aria-live="polite"
          >
            {formatLabel}
          </Badge>
        ) : null}
      </div>
      {fetchFeedback && !instrumental ? (
        <Alert variant={fetchFeedback.variant}>{fetchFeedback.text}</Alert>
      ) : null}
      {instrumental ? (
        <EmptyState
          className="track-editor-lyrics-tab__instrumental"
          icon={<IconMicrophone />}
          title="Instrumental"
          description="This track is marked as having no lyrics. Auto-fetch will skip it."
        />
      ) : (
        <Textarea
          ref={textareaRef}
          autoSize
          className={[
            "track-editor-lyrics-tab__textarea",
            focused
              ? "track-editor-lyrics-tab__textarea--editing"
              : "track-editor-lyrics-tab__textarea--resting",
          ].join(" ")}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onPointerDown={handlePointerDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onPaste={handlePaste}
          placeholder="Paste or type lyrics…"
          aria-label="Track lyrics"
          rows={LYRICS_TEXTAREA_ROWS}
        />
      )}
    </div>
  );
}
