import {
  useEffect,
  useId,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { IconChevronDown, IconChevronRight } from "@/components/icons";
import "./Disclosure.css";

/** How long the panel takes to open or close; the CSS transition uses it too. */
export const DISCLOSURE_TRANSITION_MS = 280;

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

  // The content stays mounted while it opens and until it has finished
  // closing, so it can animate; a closed disclosure holds none of it.
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  useEffect(() => {
    if (open || !mounted) return;
    const timer = window.setTimeout(
      () => setMounted(false),
      DISCLOSURE_TRANSITION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [open, mounted]);

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
      {/* Always in the page, so the trigger's aria-controls is valid and the
          height can transition: a grid row from 0fr to 1fr, the content's own
          height without measuring it. Inert while closed, or closing. */}
      <div
        id={panelId}
        className="disclosure__region"
        data-open={open || undefined}
        inert={!open || undefined}
        style={
          {
            "--disclosure-duration": `${DISCLOSURE_TRANSITION_MS}ms`,
          } as CSSProperties
        }
      >
        <div className="disclosure__clip">
          {mounted ? (
            <div
              className={["disclosure__panel", panelClassName]
                .filter(Boolean)
                .join(" ")}
            >
              {children}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
