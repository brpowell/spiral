import { useCallback, useMemo, useState } from "react";
import {
  getLibraryIcon,
  humanizeIconId,
  searchLibraryIcons,
  SPIRAL_ICONS,
  SpiralIcon,
  useIconLibraryVersion,
} from "@/lib/iconLibrary";
import { countIconTags } from "@/lib/iconLibrary/iconTagTable";
import { PlaylistIconPicker } from "@/components/PlaylistEditorModal/PlaylistIconPicker";
import "@/components/PlaylistEditorModal/PlaylistEditorModal.css";
import { SearchField } from "@/components/SearchField/SearchField";
import { IconTagEditor } from "./IconTagEditor";
import { saveIconTags } from "./saveIconTags";
import "./IconLabShell.css";

/** Tag-filter value for icons that have no tags. */
const UNTAGGED = "\0untagged";
const PREVIEW_SIZES = [16, 20, 24, 32, 48, 64] as const;
const MIN_TILE_SIZE = 16;
const MAX_TILE_SIZE = 64;

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "error"; message: string };

/**
 * Developer → Icon Lab: preview the whole icon catalog, edit tags (written to
 * `iconTags.json`), and open the real playlist icon picker on any icon.
 */
export function IconLabShell() {
  // Re-render on tag changes; also keeps derived lists below fresh.
  const version = useIconLibraryVersion();
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [tileSize, setTileSize] = useState(24);
  const [selectedId, setSelectedId] = useState(() => SPIRAL_ICONS[0]?.id ?? "");
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });

  const tagCounts = useMemo(
    () => countIconTags(SPIRAL_ICONS),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` marks tag edits
    [version],
  );
  const untaggedCount = useMemo(
    () => SPIRAL_ICONS.filter((icon) => icon.tags.length === 0).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` marks tag edits
    [version],
  );

  const icons = useMemo(() => {
    const matches = searchLibraryIcons(query);
    if (tagFilter === null) return matches;
    if (tagFilter === UNTAGGED) {
      return matches.filter((icon) => icon.tags.length === 0);
    }
    return matches.filter((icon) => icon.tags.includes(tagFilter));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` marks tag edits
  }, [query, tagFilter, version]);

  const selected = getLibraryIcon(selectedId);

  const onTagsChange = useCallback(
    (tags: string[]) => {
      if (!selected) return;
      setSaveState({ status: "saving" });
      void saveIconTags(selected.id, tags).then((result) => {
        setSaveState(
          result.ok
            ? { status: "saved" }
            : { status: "error", message: result.error },
        );
      });
    },
    [selected],
  );

  const select = (id: string) => {
    setSelectedId(id);
    setSaveState({ status: "idle" });
  };

  return (
    <div className="icon-lab">
      <section className="icon-lab__browser" aria-label="Icons">
        <header className="icon-lab__toolbar">
          <SearchField
            value={query}
            aria-label="Search icons"
            placeholder="Search by id or tag"
            onChange={setQuery}
            className="icon-lab__search"
          />
          <label className="icon-lab__size">
            <span>Size</span>
            <input
              type="range"
              min={MIN_TILE_SIZE}
              max={MAX_TILE_SIZE}
              step={4}
              value={tileSize}
              aria-label="Preview size"
              onChange={(e) => setTileSize(Number(e.target.value))}
            />
            <output>{tileSize}px</output>
          </label>
        </header>

        <div
          className="icon-lab__filters"
          role="group"
          aria-label="Filter by tag"
        >
          <FilterChip
            label="All"
            count={SPIRAL_ICONS.length}
            active={tagFilter === null}
            onClick={() => setTagFilter(null)}
          />
          <FilterChip
            label="Untagged"
            count={untaggedCount}
            active={tagFilter === UNTAGGED}
            onClick={() =>
              setTagFilter(tagFilter === UNTAGGED ? null : UNTAGGED)
            }
          />
          {tagCounts.map(({ tag, count }) => (
            <FilterChip
              key={tag}
              label={tag}
              count={count}
              active={tagFilter === tag}
              onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
            />
          ))}
        </div>

        <p className="icon-lab__count" role="status">
          {icons.length} of {SPIRAL_ICONS.length} icons
        </p>

        {icons.length === 0 ? (
          <p className="icon-lab__empty">No icons match.</p>
        ) : (
          <div
            className="icon-lab__grid"
            role="listbox"
            aria-label="Icon catalog"
            style={
              { "--icon-lab-size": `${tileSize}px` } as React.CSSProperties
            }
          >
            {icons.map((icon) => (
              <button
                key={icon.id}
                type="button"
                role="option"
                aria-selected={icon.id === selectedId}
                className={[
                  "icon-lab__tile",
                  icon.tags.length === 0 ? "icon-lab__tile--untagged" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                title={icon.tags.length ? icon.tags.join(", ") : "No tags"}
                onClick={() => select(icon.id)}
              >
                <SpiralIcon id={icon.id} />
                <span className="icon-lab__tile-label">{icon.id}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <aside className="icon-lab__detail" aria-label="Selected icon">
        {selected ? (
          <>
            <header className="icon-lab__detail-header">
              <h2 className="icon-lab__detail-title">
                {humanizeIconId(selected.id)}
              </h2>
              <code className="icon-lab__detail-id">{selected.id}</code>
            </header>

            <div className="icon-lab__section">
              <h3 className="icon-lab__section-title">Sizes</h3>
              <div className="icon-lab__ladder">
                {PREVIEW_SIZES.map((px) => (
                  <figure key={px} className="icon-lab__ladder-step">
                    <SpiralIcon
                      id={selected.id}
                      style={{ width: px, height: px }}
                    />
                    <figcaption>{px}</figcaption>
                  </figure>
                ))}
              </div>
            </div>

            <div className="icon-lab__section">
              <h3 className="icon-lab__section-title">Tags</h3>
              <IconTagEditor
                key={selected.id}
                tags={selected.tags}
                knownTags={tagCounts.map((entry) => entry.tag)}
                onChange={onTagsChange}
              />
              <p
                className={[
                  "icon-lab__save",
                  saveState.status === "error" ? "icon-lab__save--error" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                role="status"
              >
                {saveState.status === "saving" ? "Saving…" : null}
                {saveState.status === "saved" ? "Saved to iconTags.json" : null}
                {saveState.status === "error"
                  ? `Not saved: ${saveState.message}`
                  : null}
              </p>
            </div>

            <div className="icon-lab__section">
              <h3 className="icon-lab__section-title">Icon picker</h3>
              <p className="icon-lab__hint">
                The real playlist icon picker, with the selected icon as its
                value. Icons tagged <code>cover</code> are listed first. Picking
                one selects it here.
              </p>
              <PlaylistIconPicker value={selected.id} onChange={select} />
            </div>
          </>
        ) : (
          <p className="icon-lab__empty">Select an icon.</p>
        )}
      </aside>
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={["icon-lab__filter", active ? "icon-lab__filter--active" : ""]
        .filter(Boolean)
        .join(" ")}
      onClick={onClick}
    >
      {label}
      <span className="icon-lab__filter-count">{count}</span>
    </button>
  );
}
