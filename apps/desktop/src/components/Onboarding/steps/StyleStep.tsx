import { useTranslation } from "react-i18next";
import { useThemeStore } from "../../../store/useThemeStore";
import { useVisualizerStore } from "../../../store/useVisualizerStore";
import { ThemeSwatchPreview } from "../../Appearance/ThemeSwatchPreview";
import { useVizCardHover } from "../../Appearance/useVizCardHover";
import { VizCardPreview } from "../../Appearance/VisualizersSection";
import { usePrefersReducedMotion } from "../../visualizer/context";
import "../../Appearance/ThemesSection.css";
import "../../Appearance/VisualizersSection.css";

/** Pick a theme and a visualizer from the built-ins; both apply immediately. */
export function StyleStep() {
  const { t } = useTranslation("common");
  const themes = useThemeStore((s) => s.themes);
  const activeThemeId = useThemeStore((s) => s.activeThemeId);
  const setTheme = useThemeStore((s) => s.setTheme);
  const visualizers = useVisualizerStore((s) => s.visualizers);
  const activeVisualizerId = useVisualizerStore((s) => s.activeVisualizerId);
  const setActiveVisualizer = useVisualizerStore((s) => s.setActiveVisualizer);

  const themeChoices = themes.filter((th) => th.zone === "builtin");
  const reducedMotion = usePrefersReducedMotion();
  const { hoveredId, onEnter, onLeave } = useVizCardHover(reducedMotion);
  // Like the Studio: the hovered card plays live, otherwise the selected one.
  const liveId = reducedMotion ? null : (hoveredId ?? activeVisualizerId);

  const vizChoices = visualizers.filter((v) => v.isBuiltin);

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
              className="onboarding-choice visualizer-picker__preview"
              onClick={() => void setActiveVisualizer(viz.id)}
              onPointerEnter={() => onEnter(viz.id)}
              onPointerLeave={() => onLeave(viz.id)}
              onFocus={() => onEnter(viz.id)}
              onBlur={() => onLeave(viz.id)}
            >
              <VizCardPreview pack={viz} live={liveId === viz.id} />
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
