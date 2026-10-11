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

    // Sync external value changes when the input isn't focused. While focused,
    // the DOM owns typing; syncing would fight native undo.
    useLayoutEffect(() => {
      const el = inputRef.current;
      if (!el || value === undefined) return;
      const next = String(value);
      if (document.activeElement === el) return;
      if (el.value === next) return;
      el.value = next;
    }, [value]);

    const handleKeyDown = useCallback(
      (e: KeyboardEvent<HTMLInputElement>) => {
        onKeyDown?.(e);
        if (e.defaultPrevented) return;
        if (e.key === "Escape" && onEscape) {
          e.preventDefault();
          onEscape(e);
        }
      },
      [onKeyDown, onEscape],
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
        onKeyDown={handleKeyDown}
        autoComplete="off"
        autoCorrect="off"
        spellCheck="false"
        {...props}
      />
    );
  },
);
