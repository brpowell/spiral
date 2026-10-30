import { useTranslation } from "react-i18next";
import { skinPreviewUrl } from "../../../lib/skinAssets";
import { useThemeStore } from "../../../store/useThemeStore";
import { useVisualizerStore } from "../../../store/useVisualizerStore";
import type { VizSummary } from "../../../types/visualizer";
import { ThemeSwatchPreview } from "../../Appearance/ThemeSwatchPreview";
import { useVizCardSnapshot } from "../../Appearance/vizCardSnapshot";
import "../../Appearance/ThemesSection.css";
import "../../Appearance/VisualizersSection.css";

/** How many built-in options to offer per category. */
const CHOICES = 3;

function VizThumb({ viz }: { viz: VizSummary }) {
  const authored = skinPreviewUrl(viz.previewPath);
  const snapshot = useVizCardSnapshot(authored ? "" : viz.id);
  const src = authored ?? snapshot;
  return src ? (
    <img src={src} alt="" className="visualizer-picker__preview-img" />
  ) : (
    <span className="visualizer-picker__preview-pending" />
  );
}

/** Pick a theme and a visualizer; both apply immediately. */
export function StyleStep() {
  const { t } = useTranslation("common");
  const themes = useThemeStore((s) => s.themes);
  const activeThemeId = useThemeStore((s) => s.activeThemeId);
  const setTheme = useThemeStore((s) => s.setTheme);
  const visualizers = useVisualizerStore((s) => s.visualizers);
  const activeVisualizerId = useVisualizerStore((s) => s.activeVisualizerId);
  const setActiveVisualizer = useVisualizerStore((s) => s.setActiveVisualizer);

  const themeChoices = themes
    .filter((th) => th.zone === "builtin")
    .slice(0, CHOICES);
  const vizChoices = visualizers.filter((v) => v.isBuiltin).slice(0, CHOICES);

  return (
    <>
      <section className="onboarding-choices">
        <h2 className="onboarding-choices__heading">
          {t("onboarding.style.themes")}
        </h2>
        <div className="onboarding-choices__row" role="radiogroup">
          {themeChoices.map((theme) => (
            <button
              key={theme.id}
              type="button"
              role="radio"
              aria-checked={theme.id === activeThemeId}
              aria-label={theme.name}
              title={theme.name}
              className="onboarding-choice"
              onClick={() => void setTheme(theme.id)}
            >
              <ThemeSwatchPreview theme={theme} />
            </button>
          ))}
        </div>
      </section>
      <section className="onboarding-choices">
        <h2 className="onboarding-choices__heading">
          {t("onboarding.style.visualizers")}
        </h2>
        <div className="onboarding-choices__row" role="radiogroup">
          {vizChoices.map((viz) => (
            <button
              key={viz.id}
              type="button"
              role="radio"
              aria-checked={viz.id === activeVisualizerId}
              aria-label={viz.name}
              title={viz.name}
              className="onboarding-choice"
              onClick={() => void setActiveVisualizer(viz.id)}
            >
              <VizThumb viz={viz} />
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
