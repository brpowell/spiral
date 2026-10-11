import { useId, useState, type ReactNode } from "react";
import { IconChevronDown, IconChevronRight } from "../../icons";
import "./Disclosure.css";

export type DisclosureProps = {
  label: ReactNode;
  children: ReactNode;
  /** Controlled open state. Omit to let the disclosure manage itself. */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  panelClassName?: string;
};

export function Disclosure({
  label,
  children,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  className,
  panelClassName,
}: DisclosureProps) {
  const panelId = useId();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = openProp ?? uncontrolledOpen;

  const toggle = () => {
    const next = !open;
    if (openProp === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  return (
    <div className={["disclosure", className].filter(Boolean).join(" ")}>
      <button
        type="button"
        className="disclosure__trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
      >
        {open ? <IconChevronDown /> : <IconChevronRight />}
        {label}
      </button>
      {open ? (
        <div
          id={panelId}
          className={["disclosure__panel", panelClassName]
            .filter(Boolean)
            .join(" ")}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
