import { useState, type KeyboardEvent } from "react";
import { normalizeIconTag } from "../../lib/iconLibrary/iconTagTable";

const SUGGESTION_LIST_ID = "icon-lab-tag-suggestions";
const MAX_QUICK_ADD = 8;

type IconTagEditorProps = {
  tags: readonly string[];
  /** Every tag in use, most-used first; feeds suggestions. */
  knownTags: readonly string[];
  onChange: (tags: string[]) => void;
};

/** Chip editor: Enter or comma adds, × removes, Backspace on empty pops. */
export function IconTagEditor({
  tags,
  knownTags,
  onChange,
}: IconTagEditorProps) {
  const [draft, setDraft] = useState("");

  const add = (raw: string) => {
    const tag = normalizeIconTag(raw);
    setDraft("");
    if (!tag || tags.includes(tag)) return;
    onChange([...tags, tag]);
  };

  const remove = (tag: string) => onChange(tags.filter((t) => t !== tag));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && draft === "" && tags.length > 0) {
      remove(tags[tags.length - 1]!);
    }
  };

  const quickAdd = knownTags
    .filter((tag) => !tags.includes(tag))
    .slice(0, MAX_QUICK_ADD);

  return (
    <div className="icon-lab__tag-editor">
      <ul className="icon-lab__chips" aria-label="Tags">
        {tags.length === 0 ? (
          <li className="icon-lab__chips-empty">No tags</li>
        ) : null}
        {tags.map((tag) => (
          <li key={tag} className="icon-lab__chip">
            <span>{tag}</span>
            <button
              type="button"
              className="icon-lab__chip-remove"
              aria-label={`Remove tag ${tag}`}
              onClick={() => remove(tag)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <input
        type="text"
        className="icon-lab__tag-input"
        value={draft}
        list={SUGGESTION_LIST_ID}
        placeholder="Add a tag, then Enter"
        aria-label="Add tag"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => add(draft)}
      />
      <datalist id={SUGGESTION_LIST_ID}>
        {knownTags
          .filter((tag) => !tags.includes(tag))
          .map((tag) => (
            <option key={tag} value={tag} />
          ))}
      </datalist>
      {quickAdd.length > 0 ? (
        <div className="icon-lab__quick-add" aria-label="Common tags">
          {quickAdd.map((tag) => (
            <button
              key={tag}
              type="button"
              className="icon-lab__quick-tag"
              onClick={() => add(tag)}
            >
              + {tag}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
