import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type ComponentPropsWithoutRef,
  type KeyboardEvent,
  type MutableRefObject,
  type Ref,
} from "react";
import {
  useInputEditHistory,
  type InputEditHistory,
} from "../../../hooks/useInputEditHistory";
import { applyMacEditingShortcuts } from "../../../lib/macEditingShortcuts";
import "./TextInput.css";

export type { InputEditHistory };

export type TextInputProps = Omit<
  ComponentPropsWithoutRef<"input">,
  "defaultValue" | "value"
> & {
  type?: "text" | "number";
  variant?: "default" | "ghost";
  value?: string | number;
  onEscape?: (e: KeyboardEvent<HTMLInputElement>) => void;
  editHistoryRef?: MutableRefObject<InputEditHistory | null>;
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
      editHistoryRef,
      ...props
    },
    ref,
  ) {
    const inputRef = useRef<HTMLInputElement>(null);
    const {
      reset: resetEditHistory,
      recordChange,
      undo,
      redo,
      setValueWithoutRecord,
      replaceWithUndo,
    } = useInputEditHistory();
    const historyInitialized = useRef(false);

    const setRefs = useCallback(
      (node: HTMLInputElement | null) => {
        inputRef.current = node;
        assignRef(ref, node);
      },
      [ref],
    );

    useLayoutEffect(() => {
      if (historyInitialized.current || value === undefined) return;
      historyInitialized.current = true;
      resetEditHistory(String(value));
    }, [resetEditHistory, value]);

    // Sync external value changes when the input isn't focused. While focused,
    // the DOM owns typing and undo/redo; syncing would fight per-input undo.
    useLayoutEffect(() => {
      const el = inputRef.current;
      if (!el || value === undefined) return;
      const next = String(value);
      if (document.activeElement === el) return;
      if (el.value === next) return;
      el.value = next;
      resetEditHistory(next);
    }, [value, resetEditHistory]);

    useEffect(() => {
      if (!editHistoryRef) return;
      editHistoryRef.current = {
        setValueWithoutRecord,
        replaceWithUndo,
      };
      return () => {
        editHistoryRef.current = null;
      };
    }, [editHistoryRef, setValueWithoutRecord, replaceWithUndo]);

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        recordChange(e.target.value);
        onChange?.(e);
      },
      [onChange, recordChange],
    );

    // After programmatic edits (undo/redo, cut/paste), sync React state and history.
    const syncChange = useCallback(
      (el: HTMLInputElement) => {
        recordChange(el.value);
        onChange?.({ target: el, currentTarget: el } as React.ChangeEvent<HTMLInputElement>);
      },
      [onChange, recordChange],
    );

    const handleKeyDown = useCallback(
      (e: KeyboardEvent<HTMLInputElement>) => {
        onKeyDown?.(e);
        if (e.defaultPrevented) return;
        if (
          applyMacEditingShortcuts(e, undo, redo, syncChange)
        ) {
          return;
        }
        if (e.key === "Escape" && onEscape) {
          e.preventDefault();
          onEscape(e);
        }
      },
      [onKeyDown, onEscape, syncChange, undo, redo],
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
        autoComplete="off"
        autoCorrect="off"
        spellCheck="false"
        {...props}
      />
    );
  },
);