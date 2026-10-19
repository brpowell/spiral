import { useTranslation } from "react-i18next";
import { themeApplyFailedPayload } from "../../lib/toastPayloads";
import { useBackgroundTasksStore } from "../../store/useBackgroundTasksStore";
import { useThemeStore } from "../../store/useThemeStore";
import type { Theme } from "../../types/theme";
import { BrowseGridBody } from "../BrowseView/BrowseGridBody";
import { BrowseView } from "../BrowseView/BrowseView";
import { BrowseViewHeader } from "../BrowseView/BrowseViewHeader";
import { HiddenItems } from "./HiddenItems";
import { ItemActionsMenu } from "./ItemActionsMenu";
import { AppearancePackCard } from "./AppearancePackCard";
import { ThemeSwatchPreview } from "./ThemeSwatchPreview";
import "./ThemesSection.css";
import "./AppearanceSection.css";

function ThemeSwatch({
  theme,
  active,
  onSelect,
  onOpenItem,
}: {
  theme: Theme;
  active: boolean;
  onSelect: () => void;
  onOpenItem: (effectiveId: string) => void;
}) {
  const { t } = useTranslation(["studio", "common"]);
  const unknown = t("common:unknown");
  return (
    <AppearancePackCard
      active={active}
      name={theme.name}
      author={theme.author || unknown}
      description={theme.description}
      ariaLabel={t("items.cardAria", {
        name: theme.name,
        author: theme.author || unknown,
      })}
      preview={<ThemeSwatchPreview theme={theme} />}
      previewClassName="theme-picker__preview"
      actions={
        <ItemActionsMenu
          item={{
            effectiveId: theme.id,
            type: "theme",
            name: theme.name,
            zone: theme.zone,
          }}
          onOpenItem={onOpenItem}
        />
      }
      onApply={onSelect}
    />
  );
}

export function ThemesSection({
  onOpenItem,
}: {
  onOpenItem: (effectiveId: string) => void;
}) {
  const { t } = useTranslation(["studio", "library"]);
  const themes = useThemeStore((s) => s.themes);
  const activeThemeId = useThemeStore((s) => s.activeThemeId);
  const themesLoaded = useThemeStore((s) => s.themesLoaded);
  const setTheme = useThemeStore((s) => s.setTheme);
  const showErrorToast = useBackgroundTasksStore((s) => s.showErrorToast);

  const handleSelect = async (theme: Theme) => {
    try {
      await setTheme(theme.id);
    } catch (err) {
      showErrorToast(themeApplyFailedPayload(err));
    }
  };

  return (
    <BrowseView>
      <BrowseViewHeader
        className="browse-view__header--single-row"
        title={t("themes.title")}
        count={
          themesLoaded
            ? t("library:views.headerCount", { count: themes.length })
            : undefined
        }
      />

      <BrowseGridBody>
        {!themesLoaded ? (
          <p className="browse-view__empty">{t("themes.loading")}</p>
        ) : themes.length === 0 ? (
          <p className="browse-view__empty">{t("themes.empty")}</p>
        ) : (
          <div className="appearance-pack-grid" role="list">
            {themes.map((theme) => (
              <div key={theme.id} role="listitem">
                <ThemeSwatch
                  theme={theme}
                  active={theme.id === activeThemeId}
                  onSelect={() => void handleSelect(theme)}
                  onOpenItem={onOpenItem}
                />
              </div>
            ))}
          </div>
        )}
        <HiddenItems type="theme" />
      </BrowseGridBody>
    </BrowseView>
  );
}
