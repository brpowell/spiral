import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  type ComponentPropsWithoutRef,
  type KeyboardEvent,
  type Ref,
} from "react";
import "./TextInput.css";

// Tauri's macOS WebView does not wire up Cmd+A (select-all) or Cmd+Z (undo/redo)
// by default the way a real browser does. These have to be handled explicitly.
function applyMacEditingShortcuts(
  e: KeyboardEvent<HTMLInputElement>,
  syncChange: (el: HTMLInputElement) => void,
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

export type TextInputProps = Omit<
  ComponentPropsWithoutRef<"input">,
  "defaultValue" | "value"
> & {
  type?: "text" | "number";
  variant?: "default" | "ghost";
  value?: string | number;
  onEscape?: (e: KeyboardEvent<HTMLInputElement>) => void;
};

function assignRef<T>(ref: Ref<T> | undefined, node: T | null) {
  if (typeof ref === "function") ref(node);
  else if (ref) (ref as React.MutableRefObject<T | null>).current = node;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  function TextInput(
    {
      variant = "default",
      className,
      onKeyDown,
      onEscape,
      onChange,
      type = "text",
      value,
      ...props
    },
    ref,
  ) {
    const inputRef = useRef<HTMLInputElement>(null);

    const setRefs = useCallback(
      (node: HTMLInputElement | null) => {
        inputRef.current = node;
        assignRef(ref, node);
      },
      [ref],
    );

    // Sync external value changes when they diverge from the DOM (e.g. form reset,
    // chip commit clearing the draft). Skip while focused only when already in sync
    // so typing still drives the native undo stack instead of a fully controlled input.
    useLayoutEffect(() => {
      const el = inputRef.current;
      if (!el || value === undefined) return;
      const next = String(value);
      if (el.value === next) return;
      el.value = next;
    }, [value]);

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        onChange?.(e);
      },
      [onChange],
    );

    // After execCommand mutates the input, fire onChange so consumers stay in sync.
    const syncChange = useCallback(
      (el: HTMLInputElement) => {
        onChange?.({ target: el, currentTarget: el } as React.ChangeEvent<HTMLInputElement>);
      },
      [onChange],
    );

    const handleKeyDown = useCallback(
      (e: KeyboardEvent<HTMLInputElement>) => {
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
      "text-input",
      variant === "ghost" && "text-input--ghost",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <input
        ref={setRefs}
        type={type}
        className={classes}
        defaultValue={value !== undefined ? String(value) : ""}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        {...props}
      />
    );
  },
);