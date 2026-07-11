import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  type ComponentPropsWithoutRef,
  type KeyboardEvent,
  type Ref,
} from "react";
import { useInputEditHistory } from "../../../hooks/useInputEditHistory";
import { applyMacEditingShortcuts } from "../../../lib/macEditingShortcuts";
import "./Textarea.css";

export type TextareaProps = Omit<
  ComponentPropsWithoutRef<"textarea">,
  "defaultValue" | "value"
> & {
  variant?: "default" | "ghost";
  autoSize?: boolean;
  value?: string;
  onEscape?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
};

function assignRef<T>(ref: Ref<T> | undefined, node: T | null) {
  if (typeof ref === "function") ref(node);
  else if (ref) (ref as React.MutableRefObject<T | null>).current = node;
}

function minHeightForRows(el: HTMLTextAreaElement, rows: number): number {
  const style = getComputedStyle(el);
  const lineHeight = parseFloat(style.lineHeight);
  if (!Number.isFinite(lineHeight) || rows <= 0) return 0;
  const paddingY =
    parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const borderY =
    parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
  return rows * lineHeight + paddingY + borderY;
}

export function syncTextareaAutoSize(
  el: HTMLTextAreaElement,
  rows?: number,
): void {
  el.style.height = "0px";
  let nextHeight = el.scrollHeight;
  if (rows != null) {
    nextHeight = Math.max(nextHeight, minHeightForRows(el, rows));
  }
  el.style.height = `${nextHeight}px`;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    {
      variant = "default",
      autoSize = false,
      className,
      onKeyDown,
      onEscape,
      onChange,
      value,
      rows,
      ...props
    },
    ref,
  ) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const {
      reset: resetEditHistory,
      recordChange,
      undo,
      redo,
    } = useInputEditHistory();
    const historyInitialized = useRef(false);

    const setRefs = useCallback(
      (node: HTMLTextAreaElement | null) => {
        textareaRef.current = node;
        assignRef(ref, node);
      },
      [ref],
    );

    useLayoutEffect(() => {
      if (historyInitialized.current || value === undefined) return;
      historyInitialized.current = true;
      resetEditHistory(String(value));
    }, [resetEditHistory, value]);

    const syncAutoSize = useCallback(() => {
      const el = textareaRef.current;
      if (!el || !autoSize) return;
      syncTextareaAutoSize(el, rows);
    }, [autoSize, rows]);

    // Sync external value changes when the input isn't focused.
    useLayoutEffect(() => {
      const el = textareaRef.current;
      if (!el || document.activeElement === el) return;
      if (value === undefined) return;
      const next = String(value);
      if (el.value === next) return;
      el.value = next;
      resetEditHistory(next);
      syncAutoSize();
    }, [value, resetEditHistory, syncAutoSize]);

    useLayoutEffect(() => {
      syncAutoSize();
    }, [syncAutoSize, value]);

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        recordChange(e.target.value);
        onChange?.(e);
        syncAutoSize();
      },
      [onChange, recordChange, syncAutoSize],
    );

    const syncChange = useCallback(
      (el: HTMLTextAreaElement) => {
        recordChange(el.value);
        onChange?.({
          target: el,
          currentTarget: el,
        } as React.ChangeEvent<HTMLTextAreaElement>);
        syncAutoSize();
      },
      [onChange, recordChange, syncAutoSize],
    );

    const handleKeyDown = useCallback(
      (e: KeyboardEvent<HTMLTextAreaElement>) => {
        onKeyDown?.(e);
        if (e.defaultPrevented) return;
        if (applyMacEditingShortcuts(e, undo, redo, syncChange)) return;
        if (e.key === "Escape" && onEscape) {
          e.preventDefault();
          onEscape(e);
        }
      },
      [onKeyDown, onEscape, syncChange, undo, redo],
    );

    const classes = [
      "textarea",
      variant === "ghost" && "textarea--ghost",
      autoSize && "textarea--autosize",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <textarea
        ref={setRefs}
        className={classes}
        defaultValue={value !== undefined ? String(value) : ""}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        rows={rows}
        {...props}
      />
    );
  },
);
