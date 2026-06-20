import { useEffect } from "react";
import { ContextMenu } from "../../ContextMenu/ContextMenu";
import "./SuggestionMenu.css";

export type SuggestionMenuProps = {
  id?: string;
  open: boolean;
  anchor: { x: number; y: number } | null;
  position: { left: number; top: number } | null;
  menuRef: React.RefObject<HTMLDivElement | null>;
  menuWidth?: number | null;
  suggestions: string[];
  onSelect: (suggestion: string) => void;
  activeIndex?: number;
  onActiveIndexChange?: (index: number) => void;
  optionIdPrefix?: string;
};

export function SuggestionMenu({
  id,
  open,
  anchor,
  position,
  menuRef,
  menuWidth,
  suggestions,
  onSelect,
  activeIndex = -1,
  onActiveIndexChange,
  optionIdPrefix,
}: SuggestionMenuProps) {
  useEffect(() => {
    if (!open || activeIndex < 0 || !optionIdPrefix) return;
    const option = document.getElementById(`${optionIdPrefix}-${activeIndex}`);
    option?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, optionIdPrefix]);

  return (
    <ContextMenu
      open={open}
      anchor={anchor}
      position={position}
      menuRef={menuRef}
      className="context-menu--suggestions"
      style={
        menuWidth != null
          ? { width: menuWidth, minWidth: menuWidth, maxWidth: menuWidth }
          : undefined
      }
    >
      <div id={id} className="suggestion-menu" role="listbox">
        {suggestions.map((suggestion, index) => (
          <button
            key={suggestion}
            type="button"
            id={optionIdPrefix ? `${optionIdPrefix}-${index}` : undefined}
            role="option"
            aria-selected={activeIndex === index}
            className={`suggestion-menu__item${
              activeIndex === index ? " suggestion-menu__item--active" : ""
            }`}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => onActiveIndexChange?.(index)}
            onClick={() => onSelect(suggestion)}
          >
            {suggestion}
          </button>
        ))}
      </div>
    </ContextMenu>
  );
}
