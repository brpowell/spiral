import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  type ComponentPropsWithoutRef,
  type KeyboardEvent,
  type Ref,
} from "react";
import "./Textarea.css";

// Tauri's macOS WebView does not wire up Cmd+A (select-all) or Cmd+Z (undo/redo)
// by default the way a real browser does. These have to be handled explicitly.
function applyMacEditingShortcuts(
  e: KeyboardEvent<HTMLTextAreaElement>,
  syncChange: (el: HTMLTextAreaElement) => void,
): boolean {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return false;

  if (e.key === "a") {
    e.currentTarget.select();
    return true;
  }

  if (e.key === "z") {
    e.preventDefault();
    const el = e.currentTarget;
    // execCommand is deprecated in browsers but remains the only reliable way
    // to trigger native undo/redo in a WebView without reimplementing the stack.
    document.execCommand(e.shiftKey ? "redo" : "undo");
    syncChange(el);
    return true;
  }

  return false;
}

export type TextareaProps = Omit<
  ComponentPropsWithoutRef<"textarea">,
  "defaultValue" | "value"
> & {
  variant?: "default" | "ghost";
  value?: string;
  onEscape?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
};

function assignRef<T>(ref: Ref<T> | undefined, node: T | null) {
  if (typeof ref === "function") ref(node);
  else if (ref) (ref as React.MutableRefObject<T | null>).current = node;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    {
      variant = "default",
      className,
      onKeyDown,
      onEscape,
      onChange,
      value,
      ...props
    },
    ref,
  ) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const setRefs = useCallback(
      (node: HTMLTextAreaElement | null) => {
        textareaRef.current = node;
        assignRef(ref, node);
      },
      [ref],
    );

    // Sync external value changes to the uncontrolled textarea when it isn't focused.
    // This preserves the native undo stack (which breaks with a controlled input)
    // while still supporting programmatic updates and form resets.
    useLayoutEffect(() => {
      const el = textareaRef.current;
      if (!el || document.activeElement === el) return;
      if (value === undefined) return;
      const next = String(value);
      if (el.value !== next) el.value = next;
    }, [value]);

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        onChange?.(e);
      },
      [onChange],
    );

    // After execCommand mutates the textarea, fire onChange so consumers stay in sync.
    const syncChange = useCallback(
      (el: HTMLTextAreaElement) => {
        onChange?.({
          target: el,
          currentTarget: el,
        } as React.ChangeEvent<HTMLTextAreaElement>);
      },
      [onChange],
    );

    const handleKeyDown = useCallback(
      (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (applyMacEditingShortcuts(e, syncChange)) return;
        if (e.key === "Escape" && onEscape) {
          e.preventDefault();
          onEscape(e);
        }
        onKeyDown?.(e);
      },
      [onKeyDown, onEscape, syncChange],
    );

    const classes = [
      "textarea",
      variant === "ghost" && "textarea--ghost",
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
        {...props}
      />
    );
  },
);
