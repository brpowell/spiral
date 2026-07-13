import { forwardRef, type ComponentPropsWithoutRef } from "react";
import "./TextLink.css";

export type TextLinkProps = ComponentPropsWithoutRef<"a">;

export const TextLink = forwardRef<HTMLAnchorElement, TextLinkProps>(
  function TextLink({ className, target, rel, ...props }, ref) {
    const classes = ["text-link", className].filter(Boolean).join(" ");
    const resolvedRel =
      target === "_blank" ? (rel ?? "noopener noreferrer") : rel;

    return (
      <a
        ref={ref}
        className={classes}
        target={target}
        rel={resolvedRel}
        {...props}
      />
    );
  },
);
