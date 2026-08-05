import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../common/Button/Button";
import { Checkbox } from "../common/Checkbox/Checkbox";
import { ContextMenu, ContextMenuItem } from "../ContextMenu/ContextMenu";
import { IconChevronDown, IconChevronRight, IconCopy } from "../icons";
import { useContextMenu } from "../../hooks/useContextMenu";
import { copyTextToClipboard } from "../../lib/clipboard";
import {
  formatLogLinePretty,
  getEntryOperationId,
  serializeLogLines,
} from "../../lib/activityLogLine";
import { showActivityLogCopiedToast } from "../../lib/activityLogToast";
import {
  filterActivityLogEntries,
  useActivityLogStore,
} from "../../store/useActivityLogStore";
import {
  ACTIVITY_LOG_DOMAIN_OPTIONS,
  type ActivityLogEntry,
  type LogLevel,
} from "../../types/activityLog";
import { Select } from "../common/Select/Select";
import { ActivityLogDomainChipField } from "./ActivityLogDomainChipField";
import { ActivityLogsActionsMenu } from "./ActivityLogsActionsMenu";
import "./ActivityLogsPanel.css";

const LEVEL_OPTIONS: { value: LogLevel; label: string }[] = [
  { value: "debug", label: "Debug+" },
  { value: "info", label: "Info+" },
  { value: "warn", label: "Warn+" },
  { value: "error", label: "Error only" },
];

const DRAG_SELECT_THRESHOLD_PX = 4;

function hasActiveTextSelection(): boolean {
  const selection = window.getSelection();
  return (
    selection != null &&
    !selection.isCollapsed &&
    selection.toString().trim().length > 0
  );
}

interface PendingRowDrag {
  anchorIndex: number;
  additive: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  startedOnText: boolean;
  originX: number;
  originY: number;
}

function formatTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Override catalog labels when group headers need a different phrasing. */
const DOMAIN_GROUP_LABELS: Record<string, string> = {
  "metadata.musicbrainz": "Metadata fetch",
  "metadata.coverArt": "Cover art fetch",
  "library.convert": "Track convert",
  "library.import": "Library import",
  "library.refresh": "Library refresh",
  "lyrics.fetch": "Lyrics fetch",
};

function domainGroupLabel(domain: string): string {
  return (
    DOMAIN_GROUP_LABELS[domain] ??
    ACTIVITY_LOG_DOMAIN_OPTIONS.find((option) => option.value === domain)
      ?.label ??
    domain
  );
}

function formatGroupLabel(entry: ActivityLogEntry): string {
  const discId = entry.context?.discId;
  const driveId = entry.context?.driveId;
  const domainLabel = domainGroupLabel(entry.domain);

  if (discId) return `${domainLabel} · disc ${discId}`;
  if (driveId) return `${domainLabel} · drive ${driveId}`;
  return domainLabel;
}

function shouldShowGroupHeader(
  entry: ActivityLogEntry,
  previous: ActivityLogEntry | undefined,
): boolean {
  const operationId = getEntryOperationId(entry);
  if (operationId == null) return false;
  if (previous == null) return true;
  return operationId !== getEntryOperationId(previous);
}

interface LogEntryRowProps {
  entry: ActivityLogEntry;
  entryIndex: number;
  selected: boolean;
  expanded: boolean;
  dragSelecting: boolean;
  onRowMouseDown: (index: number, event: React.MouseEvent) => void;
  onRowMouseEnter: (index: number) => void;
  onToggleExpand: () => void;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("button, a, input, textarea, select, label") != null
  );
}

function isTextTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(".activity-logs-panel__body, .activity-logs-panel__json") !=
      null
  );
}

function LogEntryRow({
  entry,
  entryIndex,
  selected,
  expanded,
  dragSelecting,
  onRowMouseDown,
  onRowMouseEnter,
  onToggleExpand,
}: LogEntryRowProps) {
  return (
    <div
      className={`activity-logs-panel__entry${
        selected ? " activity-logs-panel__entry--selected" : ""
      }${expanded ? " activity-logs-panel__entry--expanded" : ""}${
        dragSelecting ? " activity-logs-panel__entry--drag-selecting" : ""
      }`}
      data-entry-id={entry.id}
      data-entry-index={entryIndex}
      data-selected={selected ? "true" : "false"}
      onMouseDown={(event) => {
        if (isInteractiveTarget(event.target)) return;
        onRowMouseDown(entryIndex, event);
      }}
      onMouseEnter={() => {
        onRowMouseEnter(entryIndex);
      }}
    >
      <span className="activity-logs-panel__time">
        {formatTimestamp(entry.timestampMs)}
      </span>
      <span
        className={`activity-logs-panel__level activity-logs-panel__level--${entry.level}`}
      >
        {entry.level}
      </span>
      <div className="activity-logs-panel__body">
        <span className="activity-logs-panel__message">{entry.message}</span>
      </div>
      <div className="activity-logs-panel__actions">
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          className="activity-logs-panel__action"
          aria-label={expanded ? "Collapse JSON" : "Expand JSON"}
          aria-expanded={expanded}
          onClick={(event) => {
            event.stopPropagation();
            onToggleExpand();
          }}
        >
          {expanded ? <IconChevronDown /> : <IconChevronRight />}
        </Button>
      </div>
      {expanded && (
        <pre className="activity-logs-panel__json">
          {formatLogLinePretty(entry)}
        </pre>
      )}
    </div>
  );
}

export function ActivityLogsPanel() {
  const entries = useActivityLogStore((s) => s.entries);
  const domainFilters = useActivityLogStore((s) => s.domainFilters);
  const minLevel = useActivityLogStore((s) => s.minLevel);
  const autoScroll = useActivityLogStore((s) => s.autoScroll);
  const setDomainFilters = useActivityLogStore((s) => s.setDomainFilters);
  const setMinLevel = useActivityLogStore((s) => s.setMinLevel);
  const setAutoScroll = useActivityLogStore((s) => s.setAutoScroll);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const anchorIndexRef = useRef<number | null>(null);
  const pendingRowDragRef = useRef<PendingRowDrag | null>(null);
  const dragSelectActiveRef = useRef(false);
  const autoScrollWasEnabledRef = useRef(autoScroll);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [contextEntryId, setContextEntryId] = useState<string | null>(null);
  const [dragSelecting, setDragSelecting] = useState(false);

  const filteredEntries = useMemo(
    () => filterActivityLogEntries(entries, domainFilters, minLevel),
    [entries, domainFilters, minLevel],
  );

  const entryIndexById = useMemo(() => {
    const map = new Map<string, number>();
    filteredEntries.forEach((entry, index) => {
      map.set(entry.id, index);
    });
    return map;
  }, [filteredEntries]);

  const selectedEntries = useMemo(
    () => filteredEntries.filter((entry) => selectedIds.has(entry.id)),
    [filteredEntries, selectedIds],
  );

  const contextMenuCopyCount = useMemo(() => {
    if (contextEntryId != null && !selectedIds.has(contextEntryId)) {
      return 1;
    }
    return selectedEntries.length;
  }, [contextEntryId, selectedEntries.length, selectedIds]);

  const copyEntries = useCallback(async (entriesToCopy: ActivityLogEntry[]) => {
    if (entriesToCopy.length === 0) return false;
    const text = serializeLogLines(entriesToCopy);
    const copied = await copyTextToClipboard(text);
    if (copied) {
      showActivityLogCopiedToast(entriesToCopy.length);
    }
    return copied;
  }, []);

  const handleContextMenuBeforeOpen = useCallback(
    (event: React.MouseEvent) => {
      const row = (event.target as Element).closest("[data-entry-id]");
      const entryId =
        row instanceof HTMLElement ? (row.dataset.entryId ?? null) : null;
      setContextEntryId(entryId);

      if (entryId != null && !selectedIds.has(entryId)) {
        const index = entryIndexById.get(entryId);
        if (index != null) {
          anchorIndexRef.current = index;
          setSelectedIds(new Set([entryId]));
        }
      }
    },
    [entryIndexById, selectedIds],
  );

  const {
    onContextMenu,
    closeMenu,
    open: contextMenuOpen,
    anchor: contextMenuAnchor,
    position: contextMenuPosition,
    menuRef: contextMenuRef,
  } = useContextMenu({
    layoutDeps: [contextMenuCopyCount],
    onBeforeOpen: handleContextMenuBeforeOpen,
  });

  const applyRangeSelection = useCallback(
    (anchorIndex: number, currentIndex: number, additive: boolean) => {
      const start = Math.min(anchorIndex, currentIndex);
      const end = Math.max(anchorIndex, currentIndex);
      const rangeIds = new Set<string>();
      for (let i = start; i <= end; i += 1) {
        rangeIds.add(filteredEntries[i].id);
      }

      setSelectedIds((previous) => {
        if (additive) {
          const next = new Set(previous);
          for (const id of rangeIds) next.add(id);
          return next;
        }
        return rangeIds;
      });
      anchorIndexRef.current = anchorIndex;
    },
    [filteredEntries],
  );

  const handleSelectEntry = useCallback(
    (
      entry: ActivityLogEntry,
      event: Pick<React.MouseEvent, "shiftKey" | "metaKey" | "ctrlKey">,
    ) => {
      const index = entryIndexById.get(entry.id);
      if (index == null) return;

      listRef.current?.focus({ preventScroll: true });

      setSelectedIds((previous) => {
        if (event.shiftKey) {
          const anchor = anchorIndexRef.current ?? index;
          const start = Math.min(anchor, index);
          const end = Math.max(anchor, index);
          const next = new Set<string>();
          for (let i = start; i <= end; i += 1) {
            next.add(filteredEntries[i].id);
          }
          return next;
        }

        if (event.metaKey || event.ctrlKey) {
          const next = new Set(previous);
          if (next.has(entry.id)) next.delete(entry.id);
          else next.add(entry.id);
          anchorIndexRef.current = index;
          return next;
        }

        anchorIndexRef.current = index;
        return new Set([entry.id]);
      });
    },
    [entryIndexById, filteredEntries],
  );

  const finishRowDrag = useCallback(() => {
    pendingRowDragRef.current = null;
    dragSelectActiveRef.current = false;
    setDragSelecting(false);
  }, []);

  const handleRowMouseDown = useCallback(
    (index: number, event: React.MouseEvent) => {
      if (event.button !== 0) return;

      listRef.current?.focus({ preventScroll: true });

      pendingRowDragRef.current = {
        anchorIndex: index,
        additive: event.metaKey || event.ctrlKey,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        startedOnText: isTextTarget(event.target),
        originX: event.clientX,
        originY: event.clientY,
      };
      dragSelectActiveRef.current = false;
      setDragSelecting(false);
    },
    [],
  );

  const handleRowMouseEnter = useCallback(
    (index: number) => {
      const pending = pendingRowDragRef.current;
      if (!pending || !dragSelectActiveRef.current) return;
      applyRangeSelection(pending.anchorIndex, index, pending.additive);
    },
    [applyRangeSelection],
  );

  useEffect(() => {
    const handleDocumentMouseMove = (event: MouseEvent) => {
      const pending = pendingRowDragRef.current;
      if (!pending || event.buttons !== 1) return;

      const moved =
        Math.hypot(
          event.clientX - pending.originX,
          event.clientY - pending.originY,
        ) > DRAG_SELECT_THRESHOLD_PX;

      if (!dragSelectActiveRef.current) {
        if (!moved) return;

        const deltaX = Math.abs(event.clientX - pending.originX);
        const deltaY = Math.abs(event.clientY - pending.originY);

        if (pending.startedOnText) {
          if (deltaY <= deltaX || hasActiveTextSelection()) {
            finishRowDrag();
            return;
          }
        }

        dragSelectActiveRef.current = true;
        setDragSelecting(true);
        window.getSelection()?.removeAllRanges();

        if (pending.shiftKey) {
          applyRangeSelection(
            anchorIndexRef.current ?? pending.anchorIndex,
            pending.anchorIndex,
            pending.additive,
          );
        } else if (!pending.additive) {
          applyRangeSelection(pending.anchorIndex, pending.anchorIndex, false);
        }
      }

      const target = document.elementFromPoint(event.clientX, event.clientY);
      const row = target?.closest("[data-entry-index]");
      if (!(row instanceof HTMLElement)) return;

      const index = Number(row.dataset.entryIndex);
      if (Number.isNaN(index)) return;

      applyRangeSelection(pending.anchorIndex, index, pending.additive);
    };

    const handleDocumentMouseUp = () => {
      const pending = pendingRowDragRef.current;
      if (!pending) return;

      if (dragSelectActiveRef.current) {
        finishRowDrag();
        return;
      }

      const entry = filteredEntries[pending.anchorIndex];
      if (entry != null && !hasActiveTextSelection()) {
        handleSelectEntry(entry, pending);
      }

      finishRowDrag();
    };

    document.addEventListener("mousemove", handleDocumentMouseMove);
    document.addEventListener("mouseup", handleDocumentMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleDocumentMouseMove);
      document.removeEventListener("mouseup", handleDocumentMouseUp);
    };
  }, [applyRangeSelection, filteredEntries, finishRowDrag, handleSelectEntry]);

  const copySelected = useCallback(() => {
    if (selectedEntries.length === 0) return;
    void copyEntries(selectedEntries);
  }, [copyEntries, selectedEntries]);

  const handleCopyContext = useCallback(() => {
    closeMenu();
    copySelected();
  }, [closeMenu, copySelected]);

  const handleToggleExpand = useCallback((entryId: string) => {
    setExpandedIds((previous) => {
      const next = new Set(previous);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!autoScroll) {
      autoScrollWasEnabledRef.current = false;
      return;
    }

    if (!autoScrollWasEnabledRef.current) {
      stickToBottomRef.current = true;
      autoScrollWasEnabledRef.current = true;
    }

    if (!stickToBottomRef.current) return;

    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
  }, [autoScroll, filteredEntries]);

  useEffect(() => {
    setSelectedIds((previous) => {
      const valid = new Set(filteredEntries.map((entry) => entry.id));
      const next = new Set([...previous].filter((id) => valid.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [filteredEntries]);

  const handleListScroll = () => {
    const list = listRef.current;
    if (!list) return;
    const distanceFromBottom =
      list.scrollHeight - list.scrollTop - list.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 48;
  };

  const handleListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const isMod = event.metaKey || event.ctrlKey;
    if (!isMod) return;

    if (event.key.toLowerCase() === "a") {
      event.preventDefault();
      setSelectedIds(new Set(filteredEntries.map((entry) => entry.id)));
      return;
    }

    if (event.key.toLowerCase() === "c") {
      const selection = window.getSelection()?.toString().trim();
      if (selection) return;
      if (selectedEntries.length === 0) return;
      event.preventDefault();
      copySelected();
    }
  };

  return (
    <div className="activity-logs-panel">
      <div className="activity-logs-panel__toolbar">
        <ActivityLogDomainChipField
          value={domainFilters}
          onChange={setDomainFilters}
        />

        <div className="activity-logs-panel__controls">
          <Select
            aria-label="Minimum log level"
            value={minLevel}
            options={LEVEL_OPTIONS}
            onChange={setMinLevel}
          />

          <label className="activity-logs-panel__toggle">
            <Checkbox
              checked={autoScroll}
              onChange={(event) => setAutoScroll(event.target.checked)}
              aria-label="Auto-scroll"
            />
            Auto-scroll
          </label>

          <ActivityLogsActionsMenu includeClear />
        </div>
      </div>

      <div
        ref={listRef}
        className={`activity-logs-panel__list${
          dragSelecting ? " activity-logs-panel__list--drag-selecting" : ""
        }`}
        tabIndex={0}
        aria-label="Activity logs"
        onScroll={handleListScroll}
        onKeyDown={handleListKeyDown}
        onContextMenu={onContextMenu}
        onMouseDown={(event) => {
          if (event.button !== 0) return;
          if (
            event.target instanceof Element &&
            event.target.closest(".activity-logs-panel__entry")
          ) {
            return;
          }
          setSelectedIds(new Set());
          anchorIndexRef.current = null;
        }}
      >
        {filteredEntries.length === 0 ? (
          <p className="activity-logs-panel__empty">No logs yet...</p>
        ) : (
          filteredEntries.map((entry, index) => {
            const previous = filteredEntries[index - 1];
            const showHeader = shouldShowGroupHeader(entry, previous);

            return (
              <div key={entry.id} className="activity-logs-panel__list-item">
                {showHeader && (
                  <div className="activity-logs-panel__group-header">
                    {formatGroupLabel(entry)}
                  </div>
                )}
                <LogEntryRow
                  entry={entry}
                  entryIndex={index}
                  selected={selectedIds.has(entry.id)}
                  expanded={expandedIds.has(entry.id)}
                  dragSelecting={dragSelecting}
                  onRowMouseDown={handleRowMouseDown}
                  onRowMouseEnter={handleRowMouseEnter}
                  onToggleExpand={() => handleToggleExpand(entry.id)}
                />
              </div>
            );
          })
        )}
      </div>

      {contextMenuOpen ? (
        <ContextMenu
          open={contextMenuOpen}
          anchor={contextMenuAnchor}
          position={contextMenuPosition}
          menuRef={contextMenuRef}
        >
          <ContextMenuItem
            icon={<IconCopy />}
            label={
              contextMenuCopyCount === 1
                ? "Copy 1 line"
                : `Copy ${contextMenuCopyCount} lines`
            }
            disabled={contextMenuCopyCount === 0}
            onClick={handleCopyContext}
          />
        </ContextMenu>
      ) : null}
    </div>
  );
}
