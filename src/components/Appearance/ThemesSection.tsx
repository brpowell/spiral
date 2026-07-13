import { resolveThemeTokens } from "../../lib/theme";
import { useThemeStore } from "../../store/useThemeStore";
import type { Theme } from "../../types/theme";
import { Button } from "../common/Button/Button";
import { AppearancePackCard } from "./AppearancePackCard";
import { useOpenAppearancePackDetail } from "./AppearancePackDetailContext";
import "./ThemesSection.css";
import "./AppearanceSection.css";

function ThemeSwatchPreview({ theme }: { theme: Theme }) {
  const tokens = resolveThemeTokens(theme);

  return (
    <>
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
    </>
  );
}

function ThemeSwatch({
  theme,
  active,
  onSelect,
}: {
  theme: Theme;
  active: boolean;
  onSelect: () => void;
}) {
  const openDetail = useOpenAppearancePackDetail();
  const packRef = { kind: "theme" as const, id: theme.id };

  return (
    <AppearancePackCard
      active={active}
      name={theme.name}
      author={theme.author}
      description={theme.description}
      ariaLabel={`${theme.name} by ${theme.author}`}
      preview={<ThemeSwatchPreview theme={theme} />}
      previewClassName="theme-picker__preview"
      onApply={onSelect}
      onViewDetails={() => openDetail(packRef)}
    />
  );
}

export function ThemesSection() {
  const themes = useThemeStore((s) => s.themes);
  const activeThemeId = useThemeStore((s) => s.activeThemeId);
  const themesLoaded = useThemeStore((s) => s.themesLoaded);
  const setTheme = useThemeStore((s) => s.setTheme);
  const openThemesFolder = useThemeStore((s) => s.openThemesFolder);

  return (
    <div className="appearance-section">
      <div className="appearance-section__body">
        {!themesLoaded ? (
          <p className="appearance-section__status">Loading themes…</p>
        ) : themes.length === 0 ? (
          <p className="appearance-section__status">No themes found.</p>
        ) : (
          <div className="appearance-pack-grid" role="list">
            {themes.map((theme) => (
              <div key={theme.id} role="listitem">
                <ThemeSwatch
                  theme={theme}
                  active={theme.id === activeThemeId}
                  onSelect={() => void setTheme(theme.id)}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <footer className="appearance-section__footer">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void openThemesFolder()}
        >
          Open themes folder
        </Button>
      </footer>
    </div>
  );
}
