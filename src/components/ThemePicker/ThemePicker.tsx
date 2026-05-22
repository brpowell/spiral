import { useEffect, useId, useRef, useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { resolveThemeTokens } from "../../lib/theme";
import { useThemeStore } from "../../store/useThemeStore";
import { THEME_SCHEMA_EXAMPLE, type Theme } from "../../types/theme";
import { IconCheck, IconClose, IconHelp } from "../icons";
import { AnimatedModal } from "../AnimatedModal/AnimatedModal";
import { Button } from "../Button/Button";
import { ModalFooter } from "../ModalFooter/ModalFooter";
import "./ThemePicker.css";

function ThemeSwatch({
  theme,
  active,
  onSelect,
}: {
  theme: Theme;
  active: boolean;
  onSelect: () => void;
}) {
  const tokens = resolveThemeTokens(theme);

  return (
    <button
      type="button"
      className={
        active
          ? "theme-picker__card theme-picker__card--active"
          : "theme-picker__card"
      }
      aria-pressed={active}
      aria-label={`${theme.name} by ${theme.author}`}
      onClick={onSelect}
    >
      <div className="theme-picker__preview" aria-hidden>
        <span
          className="theme-picker__preview-bg"
          style={{ background: tokens["color-bg"] }}
        />
        <span
          className="theme-picker__preview-surface"
          style={{ background: tokens["color-surface"] }}
        />
        <span
          className="theme-picker__preview-accent"
          style={{ background: tokens["color-accent"] }}
        />
      </div>
      <div className="theme-picker__meta">
        <span className="theme-picker__name">{theme.name}</span>
        <span className="theme-picker__author">{theme.author}</span>
      </div>
      {active && (
        <span className="theme-picker__check" aria-hidden>
          <IconCheck />
        </span>
      )}
    </button>
  );
}

export function ThemePicker() {
  const open = useThemeStore((s) => s.themePickerOpen);
  const setOpen = useThemeStore((s) => s.setThemePickerOpen);
  const themes = useThemeStore((s) => s.themes);
  const activeThemeId = useThemeStore((s) => s.activeThemeId);
  const setTheme = useThemeStore((s) => s.setTheme);
  const importTheme = useThemeStore((s) => s.importTheme);
  const openThemesFolder = useThemeStore((s) => s.openThemesFolder);

  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [schemaOpen, setSchemaOpen] = useState(false);

  useFocusTrap(panelRef, open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  return (
    <AnimatedModal
      open={open}
      backdropClassName="theme-picker-backdrop"
      panelClassName="theme-picker"
      panelRef={panelRef}
      labelledBy={titleId}
      onBackdropClick={() => setOpen(false)}
    >
        <header className="theme-picker__header">
          <h2 id={titleId} className="theme-picker__title">
            Themes
          </h2>
          <div className="theme-picker__header-actions">
            <div className="theme-picker__schema-wrap">
              <Button
                variant="ghost"
                size="md"
                iconOnly
                className="theme-picker__help"
                aria-expanded={schemaOpen}
                aria-controls="theme-schema-panel"
                title="Theme file format"
                onClick={() => setSchemaOpen((v) => !v)}
              >
                <IconHelp />
              </Button>
              {schemaOpen && (
                <div
                  id="theme-schema-panel"
                  className="theme-picker__schema-popover"
                  role="region"
                  aria-label="Theme JSON schema"
                >
                  <p>
                    Save custom themes as <code>.theme.json</code> in the
                    themes folder. Token keys map to CSS variables (prefixed
                    with <code>--</code>).
                  </p>
                  <pre>{THEME_SCHEMA_EXAMPLE}</pre>
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              size="md"
              iconOnly
              className="theme-picker__close"
              aria-label="Close"
              onClick={() => setOpen(false)}
            >
              <IconClose />
            </Button>
          </div>
        </header>

        <p className="theme-picker__hint">
          Choose a theme for an instant preview. Missing tokens fall back to
          Obsidian defaults.
        </p>

        <div className="theme-picker__grid" role="list">
          {themes.map((theme) => (
            <div key={theme.name} role="listitem">
              <ThemeSwatch
                theme={theme}
                active={theme.name === activeThemeId}
                onSelect={() => void setTheme(theme.name)}
              />
            </div>
          ))}
        </div>

        <ModalFooter padded>
          <Button variant="secondary" onClick={() => void importTheme()}>
            Add theme…
          </Button>
          <Button variant="secondary" onClick={() => void openThemesFolder()}>
            Open themes folder
          </Button>
        </ModalFooter>
    </AnimatedModal>
  );
}
