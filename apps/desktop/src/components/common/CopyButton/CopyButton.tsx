import { useEffect, useRef, useState } from "react";
import { Button, type ButtonProps } from "../Button/Button";
import { IconCheck, IconCopy } from "../../icons";
import { copyTextToClipboard } from "../../../lib/clipboard";

const COPY_FEEDBACK_MS = 2000;

type CopyButtonProps = Omit<ButtonProps, "onClick" | "children" | "aria-label"> & {
  text: string;
  "aria-label"?: string;
  copiedAriaLabel?: string;
  title?: string;
  copiedTitle?: string;
};

export function CopyButton({
  text,
  "aria-label": ariaLabel = "Copy",
  copiedAriaLabel = "Copied",
  title,
  copiedTitle,
  variant = "ghost",
  size = "sm",
  iconOnly = true,
  ...buttonProps
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setCopied(false);
    if (resetTimeoutRef.current) {
      clearTimeout(resetTimeoutRef.current);
      resetTimeoutRef.current = null;
    }
  }, [text]);

  useEffect(() => {
    return () => {
      if (resetTimeoutRef.current) {
        clearTimeout(resetTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    const didCopy = await copyTextToClipboard(text);
    if (!didCopy) return;

    setCopied(true);
    if (resetTimeoutRef.current) {
      clearTimeout(resetTimeoutRef.current);
    }
    resetTimeoutRef.current = setTimeout(() => {
      setCopied(false);
      resetTimeoutRef.current = null;
    }, COPY_FEEDBACK_MS);
  };

  const label = copied ? copiedAriaLabel : ariaLabel;
  const tooltip = copied ? (copiedTitle ?? copiedAriaLabel) : title;

  return (
    <Button
      variant={variant}
      size={size}
      iconOnly={iconOnly}
      onClick={() => void handleCopy()}
      aria-label={label}
      title={tooltip}
      {...buttonProps}
    >
      {copied ? <IconCheck /> : <IconCopy />}
    </Button>
  );
}
