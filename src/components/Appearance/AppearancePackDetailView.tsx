import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AppearanceSection } from "../../lib/appearanceWindow";
import { skinPreviewUrl } from "../../lib/skinAssets";
import { resolveThemeTokens } from "../../lib/theme";
import { loadSkinPack, loadVisualizerPack } from "../../lib/tauri";
import { useSkinStore } from "../../store/useSkinStore";
import { useThemeStore } from "../../store/useThemeStore";
import { useVisualizerStore } from "../../store/useVisualizerStore";
import type { LoadedSkinPack } from "../../types/skin";
import type { Theme } from "../../types/theme";
import type { LoadedVisualizerPack, VizSummary } from "../../types/visualizer";
import type { SceneLayer } from "../visualizer/scene/types";
import { Button } from "../common/Button/Button";
import { IconBack, IconCheck } from "../icons";
import type { AppearancePackRef } from "../../hooks/useAppearancePackDetail";
import { getAppearanceSectionConfig } from "./appearanceSections";
import "./AppearancePackDetailView.css";

interface AppearancePackDetailViewProps {
  section: AppearanceSection;
  ref: AppearancePackRef;
  onBack: () => void;
}

function collectRenderers(layers: SceneLayer[]): string[] {
  const found = new Set<string>();
  const visit = (nodes: SceneLayer[]) => {
    for (const layer of nodes) {
      if (layer.renderer) found.add(layer.renderer);
      if (layer.children?.length) visit(layer.children);
    }
  };
  visit(layers);
  return [...found].sort();
}

function ThemeDetailPreview({ theme }: { theme: Theme }) {
  const tokens = resolveThemeTokens(theme);
  const swatches = [
    { label: "Background", color: tokens["color-bg"] },
    { label: "Surface", color: tokens["color-surface"] },
    { label: "Accent", color: tokens["color-accent"] },
    { label: "Text", color: tokens["color-text-primary"] },
    { label: "Border", color: tokens["color-border"] },
    { label: "Danger", color: tokens["color-danger"] },
  ];

  return (
    <div className="pack-detail__theme-preview" aria-hidden>
      {swatches.map((swatch) => (
        <div key={swatch.label} className="pack-detail__theme-swatch">
          <span
            className="pack-detail__theme-swatch-color"
            style={{ background: swatch.color }}
          />
          <span className="pack-detail__theme-swatch-label">{swatch.label}</span>
        </div>
      ))}
    </div>
  );
}

function VisualizerDetailPreview({ pack }: { pack: VizSummary }) {
  const preview = skinPreviewUrl(pack.previewPath);

  if (preview) {
    return (
      <img
        src={preview}
        alt=""
        className="pack-detail__preview-img pack-detail__preview-img--hero"
      />
    );
  }

  return (
    <div className="pack-detail__viz-fallback" aria-hidden>
      <span className="pack-detail__viz-bar" />
      <span className="pack-detail__viz-bar pack-detail__viz-bar--mid" />
      <span className="pack-detail__viz-bar pack-detail__viz-bar--tall" />
      <span className="pack-detail__viz-bar pack-detail__viz-bar--mid" />
      <span className="pack-detail__viz-bar" />
    </div>
  );
}

function SkinDetailPreview({ previewPath }: { previewPath: string | null }) {
  const preview = skinPreviewUrl(previewPath);

  if (preview) {
    return (
      <img
        src={preview}
        alt=""
        className="pack-detail__preview-img pack-detail__preview-img--hero"
      />
    );
  }

  return <span className="pack-detail__skin-fallback" aria-hidden />;
}

function DetailMetadataRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="pack-detail__meta-row">
      <dt className="pack-detail__meta-label">{label}</dt>
      <dd className="pack-detail__meta-value">{value}</dd>
    </div>
  );
}

function ThemeOverview({ theme }: { theme: Theme }) {
  const tokens = resolveThemeTokens(theme);

  return (
    <dl className="pack-detail__meta-list">
      <DetailMetadataRow label="Font" value={tokens["font-ui"]} />
    </dl>
  );
}

function VisualizerOverview({ pack }: { pack: LoadedVisualizerPack }) {
  const surfacesRecord = pack.manifest.surfaces as Record<
    string,
    { scene?: SceneLayer[] }
  >;
  const defaultScene = surfacesRecord.default?.scene ?? [];
  const renderers = collectRenderers(defaultScene);
  const surfaces = Object.keys(surfacesRecord).sort();

  return (
    <dl className="pack-detail__meta-list">
      <DetailMetadataRow label="Pack ID" value={pack.summary.id} />
      <DetailMetadataRow
        label="Source"
        value={pack.summary.isBuiltin ? "Built-in" : "Custom"}
      />
      <DetailMetadataRow
        label="Version"
        value={String(pack.manifest.version)}
      />
      <DetailMetadataRow
        label="Renderers"
        value={renderers.length > 0 ? renderers.join(", ") : "—"}
      />
      <DetailMetadataRow
        label="Surfaces"
        value={surfaces.length > 0 ? surfaces.join(", ") : "—"}
      />
    </dl>
  );
}

function SkinOverview({ pack }: { pack: LoadedSkinPack }) {
  const viewNames = Object.keys(pack.manifest.views).sort();
  const visualizerPack = pack.manifest.visualizer?.pack ?? "global";

  return (
    <dl className="pack-detail__meta-list">
      <DetailMetadataRow label="Pack ID" value={pack.summary.id} />
      <DetailMetadataRow
        label="Source"
        value={pack.summary.isBuiltin ? "Built-in" : "Custom"}
      />
      <DetailMetadataRow
        label="Version"
        value={String(pack.manifest.version)}
      />
      <DetailMetadataRow
        label="Views"
        value={String(viewNames.length)}
      />
      <DetailMetadataRow
        label="Default view"
        value={pack.manifest.defaultView}
      />
      <DetailMetadataRow label="Visualizer" value={visualizerPack} />
    </dl>
  );
}

export function AppearancePackDetailView({
  section,
  ref: packRef,
  onBack,
}: AppearancePackDetailViewProps) {
  const themes = useThemeStore((s) => s.themes);
  const activeThemeId = useThemeStore((s) => s.activeThemeId);
  const setTheme = useThemeStore((s) => s.setTheme);
  const packs = useVisualizerStore((s) => s.packs);
  const activePackId = useVisualizerStore((s) => s.activePackId);
  const setActivePack = useVisualizerStore((s) => s.setActivePack);
  const skins = useSkinStore((s) => s.skins);
  const activeSkinId = useSkinStore((s) => s.activeSkinId);
  const setSkin = useSkinStore((s) => s.setSkin);

  const [loadedVisualizer, setLoadedVisualizer] =
    useState<LoadedVisualizerPack | null>(null);
  const [loadedSkin, setLoadedSkin] = useState<LoadedSkinPack | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const sectionConfig = getAppearanceSectionConfig(section);
  const theme = useMemo(
    () =>
      packRef.kind === "theme"
        ? themes.find((item) => item.name === packRef.id)
        : undefined,
    [packRef, themes],
  );
  const vizSummary = useMemo(
    () =>
      packRef.kind === "visualizer"
        ? packs.find((item) => item.id === packRef.id)
        : undefined,
    [packRef, packs],
  );
  const skinSummary = useMemo(
    () =>
      packRef.kind === "skin"
        ? skins.find((item) => item.id === packRef.id)
        : undefined,
    [packRef, skins],
  );

  useEffect(() => {
    if (packRef.kind !== "visualizer" && packRef.kind !== "skin") return;

    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setLoadedVisualizer(null);
    setLoadedSkin(null);

    const load = async () => {
      try {
        if (packRef.kind === "visualizer") {
          const loaded = await loadVisualizerPack(packRef.id);
          if (!cancelled) setLoadedVisualizer(loaded);
        } else {
          const loaded = await loadSkinPack(packRef.id);
          if (!cancelled) setLoadedSkin(loaded);
        }
      } catch {
        if (!cancelled) setLoadError("Failed to load pack details.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [packRef]);

  const summary = useMemo(() => {
    if (packRef.kind === "theme" && theme) {
      return {
        name: theme.name,
        author: theme.author,
        description: theme.description,
      };
    }
    if (packRef.kind === "visualizer" && vizSummary) {
      return {
        name: vizSummary.name,
        author: vizSummary.author,
        description: vizSummary.description,
      };
    }
    if (packRef.kind === "skin" && skinSummary) {
      return {
        name: skinSummary.name,
        author: skinSummary.author,
        description: skinSummary.description,
      };
    }
    return null;
  }, [packRef.kind, theme, vizSummary, skinSummary]);

  const isActive = useMemo(() => {
    if (packRef.kind === "theme") return activeThemeId === packRef.id;
    if (packRef.kind === "visualizer") return activePackId === packRef.id;
    return activeSkinId === packRef.id;
  }, [packRef, activeThemeId, activePackId, activeSkinId]);

  const handleApply = () => {
    if (packRef.kind === "theme") void setTheme(packRef.id);
    else if (packRef.kind === "visualizer") void setActivePack(packRef.id);
    else void setSkin(packRef.id);
  };

  if (!summary) {
    return (
      <div className="pack-detail pack-detail--missing">
        <Button
          variant="ghost"
          size="sm"
          className="pack-detail__back"
          onClick={onBack}
        >
          <IconBack />
          Back to {sectionConfig.label}
        </Button>
        <p className="pack-detail__status">Pack not found.</p>
      </div>
    );
  }

  return (
    <div className="pack-detail">
      <div className="pack-detail__toolbar">
        <Button
          variant="ghost"
          size="sm"
          className="pack-detail__back"
          onClick={onBack}
        >
          <IconBack />
          Back to {sectionConfig.label}
        </Button>
      </div>

      <div className="pack-detail__hero">
        {packRef.kind === "theme" && theme ? (
          <ThemeDetailPreview theme={theme} />
        ) : null}
        {packRef.kind === "visualizer" && vizSummary ? (
          <VisualizerDetailPreview pack={vizSummary} />
        ) : null}
        {packRef.kind === "skin" && skinSummary ? (
          <SkinDetailPreview previewPath={skinSummary.previewPath} />
        ) : null}
      </div>

      <div className="pack-detail__header">
        <div className="pack-detail__title-block">
          <h3 className="pack-detail__name">{summary.name}</h3>
          <p className="pack-detail__byline">
            by {summary.author}
            {packRef.kind === "visualizer" && vizSummary ? (
              <>
                {" "}
                · {vizSummary.isBuiltin ? "Built-in" : "Custom"}
              </>
            ) : null}
            {packRef.kind === "skin" && skinSummary ? (
              <>
                {" "}
                · {skinSummary.isBuiltin ? "Built-in" : "Custom"}
              </>
            ) : null}
          </p>
        </div>
        <Button
          variant={isActive ? "secondary" : "primary"}
          size="sm"
          className="pack-detail__apply"
          disabled={isActive}
          onClick={handleApply}
        >
          {isActive ? (
            <>
              <IconCheck />
              Applied
            </>
          ) : (
            "Apply"
          )}
        </Button>
      </div>

      {summary.description ? (
        <p className="pack-detail__description">{summary.description}</p>
      ) : null}

      <section className="pack-detail__section" aria-labelledby="pack-overview">
        <h4 id="pack-overview" className="pack-detail__section-title">
          Overview
        </h4>
        {loading ? (
          <p className="pack-detail__status">Loading details…</p>
        ) : loadError ? (
          <p className="pack-detail__status pack-detail__status--error">
            {loadError}
          </p>
        ) : packRef.kind === "theme" && theme ? (
          <ThemeOverview theme={theme} />
        ) : packRef.kind === "visualizer" && loadedVisualizer ? (
          <VisualizerOverview pack={loadedVisualizer} />
        ) : packRef.kind === "skin" && loadedSkin ? (
          <SkinOverview pack={loadedSkin} />
        ) : null}
      </section>
    </div>
  );
}
