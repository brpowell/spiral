import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  soundPackView,
  themeTokenView,
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

/** Theme tokens and sound pack assignments. Other types have no contents view. */
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
    </div>
  );
}
