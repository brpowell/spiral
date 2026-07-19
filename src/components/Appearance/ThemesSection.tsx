import { useState } from "react";
import { resolveThemeTokens } from "../../lib/theme";
import { useBackgroundTasksStore } from "../../store/useBackgroundTasksStore";
import { useThemeStore } from "../../store/useThemeStore";
import type { Theme } from "../../types/theme";
import { BrowseGridBody } from "../BrowseView/BrowseGridBody";
import { BrowseView } from "../BrowseView/BrowseView";
import { BrowseViewHeader } from "../BrowseView/BrowseViewHeader";
import { Button } from "../common/Button/Button";
import { WorkshopThemeActions } from "../ThemeEditor/WorkshopThemeActions";
import { AppearancePackActions } from "./AppearancePackActions";
import { AppearancePackCard } from "./AppearancePackCard";
import { useOpenAppearanceThemeEditor } from "./AppearanceThemeEditorContext";
import {
  NewThemeModal,
  type NewThemeModalResult,
} from "./NewThemeModal";
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
  onOpenPack,
}: {
  theme: Theme;
  active: boolean;
  onSelect: () => void;
  onOpenPack: (packId: string) => void;
}) {
  return (
    <AppearancePackCard
      active={active}
      name={theme.name}
      author={theme.author || "Unknown"}
      packName={theme.packName || theme.packId}
      packId={theme.packId}
      description={theme.description}
      ariaLabel={`${theme.name} by ${theme.author || "Unknown"}`}
      preview={<ThemeSwatchPreview theme={theme} />}
      previewClassName="theme-picker__preview"
      actions={
        theme.packId ? (
          theme.mutable ? (
            <WorkshopThemeActions theme={theme} onOpenPack={onOpenPack} />
          ) : (
            <AppearancePackActions
              name={theme.name}
              packId={theme.packId}
              onOpenPack={onOpenPack}
            />
          )
        ) : undefined
      }
      onApply={onSelect}
      onOpenPack={onOpenPack}
    />
  );
}

export function ThemesSection({
  onOpenPack,
}: {
  onOpenPack: (packId: string) => void;
}) {
  const themes = useThemeStore((s) => s.themes);
  const activeThemeId = useThemeStore((s) => s.activeThemeId);
  const themesLoaded = useThemeStore((s) => s.themesLoaded);
  const setTheme = useThemeStore((s) => s.setTheme);
  const createTheme = useThemeStore((s) => s.createTheme);
  const showErrorToast = useBackgroundTasksStore((s) => s.showErrorToast);
  const openThemeEditor = useOpenAppearanceThemeEditor();

  const [modalOpen, setModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const handleCreate = async (result: NewThemeModalResult) => {
    setCreating(true);
    try {
      const theme = await createTheme(
        result.packMode === "existing"
          ? { name: result.name, packId: result.packId }
          : { name: result.name, packName: result.packName },
      );
      setModalOpen(false);
      openThemeEditor(theme.id);
    } catch (err) {
      showErrorToast({
        label: err instanceof Error ? err.message : "Failed to create theme",
        key: "theme-create",
      });
    } finally {
      setCreating(false);
    }
  };

  const handleSelect = async (theme: Theme) => {
    try {
      await setTheme(theme.id);
    } catch (err) {
      showErrorToast({
        label: err instanceof Error ? err.message : "Cannot apply theme",
        key: "theme-apply",
      });
    }
  };

  return (
    <BrowseView>
      <BrowseViewHeader
        className="browse-view__header--single-row"
        title="Themes"
        count={themesLoaded ? `(${themes.length})` : undefined}
        actions={
          <Button
            variant="primary"
            size="sm"
            disabled={creating}
            onClick={() => setModalOpen(true)}
          >
            New Theme
          </Button>
        }
      />

      <BrowseGridBody>
        {!themesLoaded ? (
          <p className="browse-view__empty">Loading themes…</p>
        ) : themes.length === 0 ? (
          <p className="browse-view__empty">No themes found.</p>
        ) : (
          <div className="appearance-pack-grid" role="list">
            {themes.map((theme) => (
              <div key={theme.id} role="listitem">
                <ThemeSwatch
                  theme={theme}
                  active={theme.id === activeThemeId}
                  onSelect={() => void handleSelect(theme)}
                  onOpenPack={onOpenPack}
                />
              </div>
            ))}
          </div>
        )}
      </BrowseGridBody>

      <NewThemeModal
        open={modalOpen}
        creating={creating}
        onClose={() => setModalOpen(false)}
        onCreate={(result) => void handleCreate(result)}
      />
    </BrowseView>
  );
}
