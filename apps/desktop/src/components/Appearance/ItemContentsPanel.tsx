import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  skinContentsView,
  soundPackView,
  themeTokenView,
  visualizerLayers,
  type ManifestJson,
} from "../../lib/items/manifestView";
import { resolveSoundPackAssetUrl } from "../../lib/packSounds";
import { playOneShot } from "../../lib/sfxPlayer";
import { readItemManifestJson } from "../../lib/tauri";
import type { ItemSummary } from "../../types/item";
import { Button } from "../common/Button/Button";
import { IconPlay } from "../icons";
import "./ItemContentsPanel.css";

type LoadState = "loading" | "ready" | "error";

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="item-contents__section">
      <h4 className="item-contents__heading">
        {title}
        {count != null ? (
          <span className="item-contents__count">{count}</span>
        ) : null}
      </h4>
      {children}
    </section>
  );
}

function Rows({ children }: { children: ReactNode }) {
  return <ul className="item-contents__rows">{children}</ul>;
}

function Row({ children }: { children: ReactNode }) {
  return <li className="item-contents__row">{children}</li>;
}

function Code({ children }: { children: ReactNode }) {
  return <code className="item-contents__code">{children}</code>;
}

function ThemeContents({ manifest }: { manifest: ManifestJson }) {
  const { t } = useTranslation("studio");
  const { colors, other } = themeTokenView(manifest);
  return (
    <>
      <Section title={t("items.contents.colors")} count={colors.length}>
        {colors.length === 0 ? (
          <p className="item-contents__empty">{t("items.contents.none")}</p>
        ) : (
          <Rows>
            {colors.map(([key, value]) => (
              <Row key={key}>
                <span
                  className="item-contents__swatch"
                  style={{ background: value }}
                  aria-hidden
                />
                <Code>{key}</Code>
                <span className="item-contents__value">{value}</span>
              </Row>
            ))}
          </Rows>
        )}
      </Section>
      {other.length > 0 ? (
        <Section title={t("items.contents.otherTokens")} count={other.length}>
          <Rows>
            {other.map(([key, value]) => (
              <Row key={key}>
                <Code>{key}</Code>
                <span className="item-contents__value">{value}</span>
              </Row>
            ))}
          </Rows>
        </Section>
      ) : null}
    </>
  );
}

function PlayButton({
  packId,
  soundId,
  label,
}: {
  packId: string;
  soundId: string;
  label: string;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={label}
      title={label}
      onClick={() => {
        void resolveSoundPackAssetUrl(packId, soundId).then((url) => {
          if (url) playOneShot(url);
        });
      }}
    >
      <IconPlay />
    </Button>
  );
}

function SoundContents({
  item,
  manifest,
}: {
  item: ItemSummary;
  manifest: ManifestJson;
}) {
  const { t } = useTranslation("studio");
  const { sounds, cues } = soundPackView(manifest);
  return (
    <>
      <Section title={t("items.contents.cues")} count={cues.length}>
        <Rows>
          {cues.map((cue) => (
            <Row key={cue.cue}>
              <Code>{cue.cue}</Code>
              <span className="item-contents__arrow" aria-hidden>
                →
              </span>
              {cue.soundId == null ? (
                <span className="item-contents__muted">
                  {t("items.contents.usesDefault")}
                </span>
              ) : (
                <>
                  <Code>{cue.soundId}</Code>
                  {!cue.valid ? (
                    <span className="item-contents__warn">
                      {t("items.contents.missingSound")}
                    </span>
                  ) : null}
                </>
              )}
              {!cue.known ? (
                <span className="item-contents__tag">
                  {t("items.contents.unusedCue")}
                </span>
              ) : null}
              {cue.soundId != null && cue.valid ? (
                <span className="item-contents__row-end">
                  <PlayButton
                    packId={item.effectiveId}
                    soundId={cue.soundId}
                    label={t("items.contents.play", { name: cue.soundId })}
                  />
                </span>
              ) : null}
            </Row>
          ))}
        </Rows>
      </Section>
      <Section title={t("items.contents.sounds")} count={sounds.length}>
        <Rows>
          {sounds.map((sound) => (
            <Row key={sound.id}>
              <Code>{sound.id}</Code>
              <span className="item-contents__value">{sound.file}</span>
              {sound.cues.length > 0 ? (
                <span className="item-contents__muted">
                  {t("items.contents.usedBy", { cues: sound.cues.join(", ") })}
                </span>
              ) : null}
              <span className="item-contents__row-end">
                <PlayButton
                  packId={item.effectiveId}
                  soundId={sound.id}
                  label={t("items.contents.play", { name: sound.id })}
                />
              </span>
            </Row>
          ))}
        </Rows>
      </Section>
    </>
  );
}

function SkinContents({ manifest }: { manifest: ManifestJson }) {
  const { t } = useTranslation("studio");
  const skin = skinContentsView(manifest);
  return (
    <>
      <Section title={t("items.contents.views")} count={skin.views.length}>
        <Rows>
          {skin.views.map((view) => (
            <Row key={view.id}>
              <Code>{view.id}</Code>
              {view.presentation ? (
                <span className="item-contents__tag">{view.presentation}</span>
              ) : null}
              {view.defaultSize ? (
                <span className="item-contents__value">{view.defaultSize}</span>
              ) : null}
              {view.resizable != null ? (
                <span className="item-contents__muted">
                  {view.resizable
                    ? t("items.contents.resizable")
                    : t("items.contents.fixedSize")}
                </span>
              ) : null}
            </Row>
          ))}
        </Rows>
      </Section>
      {skin.settings.length > 0 ? (
        <Section
          title={t("items.contents.settings")}
          count={skin.settings.length}
        >
          <Rows>
            {skin.settings.map((setting) => (
              <Row key={setting.id}>
                <span>{setting.name}</span>
                <Code>{setting.id}</Code>
                <span className="item-contents__tag">{setting.type}</span>
                <span className="item-contents__muted">
                  {t("items.contents.defaultValue", {
                    value: setting.defaultValue,
                  })}
                </span>
              </Row>
            ))}
          </Rows>
        </Section>
      ) : null}
      {skin.soundEffects.length > 0 ? (
        <Section
          title={t("items.contents.skinSounds")}
          count={skin.soundEffects.length}
        >
          <Rows>
            {skin.soundEffects.map(([key, file]) => (
              <Row key={key}>
                <Code>{key}</Code>
                <span className="item-contents__value">{file}</span>
              </Row>
            ))}
          </Rows>
        </Section>
      ) : null}
      {skin.visualizer || skin.stylesheet ? (
        <Section title={t("items.contents.more")}>
          <Rows>
            {skin.visualizer ? (
              <Row>
                <span>{t("items.contents.pinnedVisualizer")}</span>
                <Code>{skin.visualizer}</Code>
              </Row>
            ) : null}
            {skin.stylesheet ? (
              <Row>
                <span>{t("items.contents.stylesheet")}</span>
                <Code>{skin.stylesheet}</Code>
              </Row>
            ) : null}
          </Rows>
        </Section>
      ) : null}
    </>
  );
}

function VisualizerContents({ manifest }: { manifest: ManifestJson }) {
  const { t } = useTranslation("studio");
  const layers = visualizerLayers(manifest);
  return (
    <Section title={t("items.contents.layers")} count={layers.length}>
      <Rows>
        {layers.map((layer, index) => (
          <Row key={layer.id ?? index}>
            <span className="item-contents__tag">{layer.kind}</span>
            {layer.id ? <Code>{layer.id}</Code> : null}
            {layer.source ? (
              <span className="item-contents__value">{layer.source}</span>
            ) : null}
            {layer.layout ? (
              <span className="item-contents__muted">
                {t("items.contents.layout", { layout: layer.layout })}
              </span>
            ) : null}
          </Row>
        ))}
      </Rows>
    </Section>
  );
}

/** The manifest, rendered for its type. Sits behind the Contents tab. */
export function ItemContentsPanel({
  item,
  reloadKey,
}: {
  item: ItemSummary;
  /** Change to re-read the manifest (a watched edit or a reload). */
  reloadKey?: unknown;
}) {
  const { t } = useTranslation("studio");
  const [manifest, setManifest] = useState<ManifestJson | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    let cancelled = false;
    void readItemManifestJson(item.dir)
      .then((value) => {
        if (cancelled) return;
        setManifest(value);
        setState("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error("Failed to read item manifest:", err);
        setManifest(null);
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [item.dir, reloadKey]);

  if (state === "loading" && manifest == null) {
    return (
      <p className="appearance-section__status">
        {t("items.contents.loading")}
      </p>
    );
  }
  if (state === "error" || manifest == null) {
    return (
      <p className="appearance-section__status">{t("items.contents.failed")}</p>
    );
  }

  return (
    <div className="item-contents">
      {item.type === "theme" ? <ThemeContents manifest={manifest} /> : null}
      {item.type === "sound" ? (
        <SoundContents item={item} manifest={manifest} />
      ) : null}
      {item.type === "skin" ? <SkinContents manifest={manifest} /> : null}
      {item.type === "visualizer" ? (
        <VisualizerContents manifest={manifest} />
      ) : null}
      <details className="item-contents__raw">
        <summary>{t("items.contents.rawJson")}</summary>
        <pre>{JSON.stringify(manifest, null, 2)}</pre>
      </details>
    </div>
  );
}
