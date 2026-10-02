import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { t } from "../../lib/i18n";
import {
  humanizeIconId,
  resolveIconId,
  sortLibraryIconsByTag,
  SpiralIcon,
  type SpiralIconDefinition,
} from "../../lib/iconLibrary";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  usePopover,
} from "../common/Popover/Popover";
import { SearchField } from "../SearchField/SearchField";
import "./PlaylistIconPicker.css";

const COVER_TAG = "cover";

function filterIcons(query: string): SpiralIconDefinition[] {
  const icons = sortLibraryIconsByTag(COVER_TAG);
  const q = query.trim().toLowerCase();
  if (!q) return icons;
  return icons.filter((icon) => {
    if (icon.id.toLowerCase().includes(q)) return true;
    if (humanizeIconId(icon.id).toLowerCase().includes(q)) return true;
    return icon.tags.some((tag) => tag.toLowerCase().includes(q));
  });
}

function columnCount(grid: HTMLElement | null): number {
  if (!grid) return 1;
  const columns = getComputedStyle(grid).gridTemplateColumns;
  const count = columns
    .split(" ")
    .filter((part) => part && part !== "none").length;
  return count > 0 ? count : 1;
}

type PlaylistIconPickerProps = {
  value: string;
  onChange: (iconId: string) => void;
};

export function PlaylistIconPicker({
  value,
  onChange,
}: PlaylistIconPickerProps) {
  const triggerId = useId();
  const currentLabel = humanizeIconId(resolveIconId(value));

  return (
    <div className="playlist-icon-picker">
      <label htmlFor={triggerId} className="playlist-icon-picker__label">
        {t("library:editor.playlist.icon")}
      </label>
      <Popover placement="above-start">
        <PopoverTrigger
          id={triggerId}
          variant="secondary"
          className="playlist-editor__swatch playlist-icon-picker__trigger"
          title={currentLabel}
          aria-label={t("library:editor.playlist.iconValue", {
            name: currentLabel,
          })}
        >
          <SpiralIcon id={value} />
        </PopoverTrigger>
        <PopoverContent
          className="playlist-icon-picker__panel"
          aria-label={t("library:editor.playlist.chooseIcon")}
        >
          <PlaylistIconPickerPanel value={value} onChange={onChange} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function PlaylistIconPickerPanel({ value, onChange }: PlaylistIconPickerProps) {
  const { close } = usePopover();
  const gridRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const icons = useMemo(() => filterIcons(query), [query]);
  const selectedId = resolveIconId(value);
  const [activeIndex, setActiveIndex] = useState(() => {
    const index = filterIcons("").findIndex((icon) => icon.id === selectedId);
    return index >= 0 ? index : 0;
  });

  const index =
    icons.length === 0 ? -1 : Math.min(activeIndex, icons.length - 1);
  const active = index >= 0 ? icons[index] : undefined;

  useEffect(() => {
    const selected = gridRef.current?.querySelector<HTMLElement>(
      '[aria-selected="true"]',
    );
    selected?.scrollIntoView?.({ block: "nearest" });
  }, []);

  const select = (id: string) => {
    if (id !== value) onChange(id);
    close({ restoreFocus: true });
  };

  const focusIndex = (nextIndex: number) => {
    if (icons.length === 0) return;
    const next = Math.max(0, Math.min(icons.length - 1, nextIndex));
    setActiveIndex(next);
    const button = gridRef.current?.querySelectorAll("button")[next];
    if (!(button instanceof HTMLButtonElement)) return;
    button.focus();
    button.scrollIntoView?.({ block: "nearest" });
  };

  const onSearchKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!(e.target instanceof HTMLInputElement)) return;
    if (icons.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      focusIndex(index >= 0 ? index : 0);
      return;
    }
    if (e.key === "Enter" && active) {
      e.preventDefault();
      select(active.id);
    }
  };

  const onGridKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (icons.length === 0 || index < 0) return;
    const columns = columnCount(gridRef.current);
    let next = index;
    if (e.key === "ArrowRight") next = index + 1;
    else if (e.key === "ArrowLeft") next = index - 1;
    else if (e.key === "ArrowDown") next = index + columns;
    else if (e.key === "ArrowUp") next = index - columns;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = icons.length - 1;
    else return;
    e.preventDefault();
    focusIndex(next);
  };

  return (
    <>
      <div onKeyDown={onSearchKeyDown}>
        <SearchField
          value={query}
          aria-label={t("library:editor.playlist.searchIcons")}
          placeholder={t("library:editor.playlist.searchIcons")}
          onChange={(nextQuery) => {
            setQuery(nextQuery);
            const nextIcons = filterIcons(nextQuery);
            const selected = nextIcons.findIndex(
              (icon) => icon.id === selectedId,
            );
            setActiveIndex(selected >= 0 ? selected : 0);
          }}
        />
      </div>
      <div className="playlist-icon-picker__results">
        {icons.length === 0 ? (
          <p className="playlist-icon-picker__status" role="status">
            {t("library:editor.playlist.noIcons")}
          </p>
        ) : (
          <div
            ref={gridRef}
            className="playlist-icon-picker__grid"
            role="listbox"
            aria-label={t("library:editor.playlist.icon")}
            onKeyDown={onGridKeyDown}
          >
            {icons.map((icon, iconIndex) => {
              const label = humanizeIconId(icon.id);
              const selected = icon.id === selectedId;
              return (
                <button
                  key={icon.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  aria-label={label}
                  tabIndex={iconIndex === index ? 0 : -1}
                  className="playlist-icon-picker__option"
                  onFocus={() => setActiveIndex(iconIndex)}
                  onClick={() => select(icon.id)}
                >
                  <SpiralIcon id={icon.id} />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
