import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
} from "react";
import { Trans, useTranslation } from "react-i18next";
import type { Theme, ThemeTokens } from "../../types/theme";
import { t as translate } from "../../lib/i18n";
import {
  effectiveContributionId,
  isContributionId,
  packIdPrefix,
} from "../../lib/packs/packManifest";
import {
  FIXED_RADIUS_TOKEN_KEYS,
  OBSIDIAN_DEFAULT_TOKENS,
  resolveThemeTokens,
  stripDerivedThemeTokens,
} from "../../lib/theme";
import { emitThemePreview } from "../../lib/themeBridge";
import {
  formatThemeValidationError,
  isThemeApplicable,
  validateThemeForApply,
} from "../../lib/themeValidation";
import {
  themeActivatedPayload,
  themeActivateFailedPayload,
  themeSavedPayload,
  themeSaveFailedPayload,
} from "../../lib/toastPayloads";
import { useEditorDiscardPrompt } from "../../hooks/useEditorDiscardPrompt";
import { useThemeStore } from "../../store/useThemeStore";
import { useBackgroundTasksStore } from "../../store/useBackgroundTasksStore";
import { Alert } from "../common/Alert/Alert";
import { Badge } from "../common/Badge/Badge";
import { Button } from "../common/Button/Button";
import { Checkbox } from "../common/Checkbox/Checkbox";
import { Chip } from "../common/Chip/Chip";
import { ColorField } from "../common/ColorField/ColorField";
import { FormField } from "../common/Field/Field";
import { SlugField } from "../common/SlugField/SlugField";
import { Switch } from "../common/Switch/Switch";
import { TextInput } from "../common/TextInput/TextInput";
import { TextLink } from "../common/TextLink/TextLink";
import { Textarea } from "../common/Textarea/Textarea";
import { EditorDiscardOverlay } from "../EditorDiscardOverlay/EditorDiscardOverlay";
import { BrowseGridBody } from "../BrowseView/BrowseGridBody";
import { BrowseView } from "../BrowseView/BrowseView";
import { BrowseViewHeader } from "../BrowseView/BrowseViewHeader";
import "./ThemeEditor.css";

/** Contribution id segment from an effective `authorId.packId.theme.contributionId`. */
function contributionIdFromTheme(theme: Theme): string {
  const prefix = `${packIdPrefix(theme.authorId, theme.packId)}theme.`;
  if (theme.authorId && theme.packId && theme.id.startsWith(prefix)) {
    return theme.id.slice(prefix.length);
  }
  const parts = theme.id.split(".");
  return parts[parts.length - 1] ?? "";
}

const COLOR_TOKEN_KEYS = [
  "color-bg",
  "color-text-primary",
  "color-accent",
  "color-danger",
  "color-alert-info",
  "color-alert-success",
  "color-alert-warning",
] as const;

function cloneTheme(theme: Theme): Theme {
  return {
    ...theme,
    tokens: stripDerivedThemeTokens({ ...theme.tokens }),
  };
}

function themeSnapshot(theme: Theme): string {
  return JSON.stringify({
    id: theme.id,
    name: theme.name,
    author: theme.author,
    description: theme.description,
    tokens: theme.tokens,
  });
}

function themesEqual(a: Theme, b: Theme): boolean {
  return themeSnapshot(a) === themeSnapshot(b);
}

function PreviewSecondaryText() {
  const { t } = useTranslation("studio");
  return (
    <p className="theme-editor__preview-body">
      <Trans
        t={t}
        i18nKey="themeEditor.previewSecondary"
        components={{
          link: <TextLink href="#theme-preview" tabIndex={-1} />,
        }}
      />
    </p>
  );
}

function ThemePreviewSamples() {
  const { t } = useTranslation("studio");
  return (
    <div className="theme-editor__preview-samples">
      <div className="theme-editor__preview-actions">
        <Button variant="primary" tabIndex={-1}>
          {t("themeEditor.primary")}
        </Button>
        <Button variant="secondary" tabIndex={-1}>
          {t("themeEditor.secondary")}
        </Button>
        <Button variant="ghost" tabIndex={-1}>
          {t("themeEditor.ghost")}
        </Button>
        <Button variant="danger" tabIndex={-1}>
          {t("themeEditor.danger")}
        </Button>
      </div>
      <TextInput
        value={t("themeEditor.previewInput")}
        readOnly
        tabIndex={-1}
        aria-label={t("themeEditor.previewInput")}
      />
      <div className="theme-editor__preview-row">
        <Chip label={t("themeEditor.chip")} onRemove={() => {}} />
        <Switch defaultChecked tabIndex={-1}>
          {t("themeEditor.switch")}
        </Switch>
        <Checkbox defaultChecked tabIndex={-1}>
          {t("themeEditor.check")}
        </Checkbox>
      </div>
    </div>
  );
}

/** Browse header title while editing a theme. */
export function formatThemeEditorTitle(name: string): string {
  return translate("studio:themes.editorTitle", {
    name: name.trim() || translate("common:untitledTheme"),
  });
}

export type ThemeEditorProps = {
  theme: Theme;
  onClose: () => void;
  /** Accessible name for the browse-header back control. */
  backAriaLabel?: string;
  /** Discard-aware close for the shell back button / section nav. */
  requestCloseRef?: MutableRefObject<(() => void) | null>;
  /** Fired when the user dismisses the unsaved-changes prompt. */
  onCloseRequestCancelled?: () => void;
};

export function ThemeEditor({
  theme,
  onClose,
  backAriaLabel = translate("common:back"),
  requestCloseRef,
  onCloseRequestCancelled,
}: ThemeEditorProps) {
  const { t } = useTranslation(["studio", "common"]);
  const saveTheme = useThemeStore((s) => s.saveTheme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const activeThemeId = useThemeStore((s) => s.activeThemeId);
  const themes = useThemeStore((s) => s.themes);
  const showErrorToast = useBackgroundTasksStore((s) => s.showErrorToast);
  const showToast = useBackgroundTasksStore((s) => s.showToast);

  const [draft, setDraft] = useState<Theme>(() => cloneTheme(theme));
  const [baseline, setBaseline] = useState<Theme>(() => cloneTheme(theme));
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const sessionThemeIdRef = useRef(theme.id);

  // Re-seed when navigating to a different theme id.
  useEffect(() => {
    if (sessionThemeIdRef.current === theme.id) return;
    sessionThemeIdRef.current = theme.id;
    setDraft(cloneTheme(theme));
    setBaseline(cloneTheme(theme));
  }, [theme]);

  const hasChanges = !themesEqual(draft, baseline);
  const editorTitle = formatThemeEditorTitle(draft.name);

  const { discardPrompt, requestClose, dismissDiscardPrompt } =
    useEditorDiscardPrompt(hasChanges, onClose);

  const handleKeepEditing = useCallback(() => {
    onCloseRequestCancelled?.();
    dismissDiscardPrompt();
  }, [dismissDiscardPrompt, onCloseRequestCancelled]);

  useEffect(() => {
    if (!requestCloseRef) return;
    requestCloseRef.current = requestClose;
    return () => {
      requestCloseRef.current = null;
    };
  }, [requestClose, requestCloseRef]);

  const isEditingActiveTheme = activeThemeId === draft.id;
  const busy = saving || applying;

  // Live-apply draft tokens across all windows when editing the active theme.
  useEffect(() => {
    if (!isEditingActiveTheme) return;
    emitThemePreview(draft);
  }, [draft, isEditingActiveTheme]);

  // If the view is torn down without an explicit discard/save (section change),
  // restore the last persisted tokens for the active theme.
  useEffect(() => {
    const themeId = theme.id;
    return () => {
      const state = useThemeStore.getState();
      if (state.activeThemeId !== themeId) return;
      const saved = state.themes.find((item) => item.id === themeId);
      if (saved) emitThemePreview(saved);
    };
  }, [theme.id]);

  useEffect(() => {
    if (busy || discardPrompt) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, discardPrompt, requestClose]);

  const persistDraft = useCallback(
    async (next: Theme): Promise<Theme> => {
      const saved = await saveTheme(next);
      sessionThemeIdRef.current = saved.id;
      setDraft(cloneTheme(saved));
      setBaseline(cloneTheme(saved));
      return saved;
    },
    [saveTheme],
  );

  const handleDiscard = useCallback(() => {
    if (activeThemeId === baseline.id) {
      emitThemePreview(baseline);
    }
    dismissDiscardPrompt();
    onClose();
  }, [activeThemeId, baseline, dismissDiscardPrompt, onClose]);

  const handleSaveAndClose = useCallback(async () => {
    setSaving(true);
    try {
      await persistDraft(draft);
      showToast(themeSavedPayload());
      dismissDiscardPrompt();
      onClose();
    } catch (err) {
      showErrorToast(themeSaveFailedPayload(err));
    } finally {
      setSaving(false);
    }
  }, [
    dismissDiscardPrompt,
    draft,
    onClose,
    persistDraft,
    showErrorToast,
    showToast,
  ]);

  const handleActivate = useCallback(async () => {
    setApplying(true);
    try {
      await setTheme(draft.id);
      // Keep unsaved draft tokens visible now that this theme is active.
      emitThemePreview(draft);
      showToast(themeActivatedPayload());
    } catch (err) {
      showErrorToast(themeActivateFailedPayload(err));
    } finally {
      setApplying(false);
    }
  }, [draft, setTheme, showErrorToast, showToast]);

  const previewTokens = resolveThemeTokens(draft);
  const storedTheme = themes.find((item) => item.id === draft.id);
  const canActivate = storedTheme ? isThemeApplicable(storedTheme) : false;
  const contributionId = contributionIdFromTheme(draft);
  const contributionIdValid = isContributionId(contributionId);

  const updateMeta = <K extends "name" | "author" | "description">(
    key: K,
    value: string,
  ) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const updateContributionId = (nextLocalId: string) => {
    setDraft((prev) => ({
      ...prev,
      id: effectiveContributionId(
        prev.authorId,
        prev.packId,
        "theme",
        nextLocalId,
      ),
    }));
  };

  const updateToken = (key: keyof ThemeTokens | string, value: string) => {
    setDraft((prev) => ({
      ...prev,
      tokens: {
        ...prev.tokens,
        [key]: value,
      },
    }));
  };

  const previewStyle = Object.fromEntries(
    Object.entries(previewTokens)
      .filter(
        ([key]) =>
          !(FIXED_RADIUS_TOKEN_KEYS as readonly string[]).includes(key),
      )
      .map(([key, value]) => [`--${key}`, value ?? ""]),
  ) as CSSProperties;

  return (
    <div className="theme-editor" role="region" aria-label={editorTitle}>
      <BrowseView className="theme-editor__browse">
        <BrowseViewHeader
          className="browse-view__header--single-row"
          title={editorTitle}
          backAriaLabel={backAriaLabel}
          onBack={requestClose}
        />
        <BrowseGridBody>
          <div className="theme-editor__layout">
            <div className="theme-editor__form">
              <section className="theme-editor__section">
                <h3 className="theme-editor__section-title">
                  {t("themeEditor.details")}
                </h3>
                <FormField
                  label={t("common:name")}
                  className="theme-editor__field--block"
                >
                  <TextInput
                    value={draft.name}
                    onChange={(e) => updateMeta("name", e.target.value)}
                  />
                </FormField>
                <FormField
                  label={t("themeEditor.contributionId")}
                  className="theme-editor__field--block"
                  description={
                    contributionId.length > 0 && !contributionIdValid
                      ? t("themeEditor.contributionIdInvalid")
                      : t("themeEditor.contributionIdHint")
                  }
                >
                  <SlugField
                    value={contributionId}
                    onChange={updateContributionId}
                    suggestedFrom={draft.name}
                    autoSyncKey={theme.id}
                    placeholder={t("themeEditor.contributionIdPlaceholder")}
                    disabled={busy}
                  />
                </FormField>
                <FormField
                  label={t("themeEditor.author")}
                  className="theme-editor__field--block"
                >
                  <TextInput
                    value={draft.author}
                    onChange={(e) => updateMeta("author", e.target.value)}
                  />
                </FormField>
                <FormField
                  label={t("common:description")}
                  className="theme-editor__field--block"
                >
                  <Textarea
                    value={draft.description}
                    onChange={(e) => updateMeta("description", e.target.value)}
                    rows={3}
                    autoSize
                  />
                </FormField>
              </section>

              <section className="theme-editor__section">
                <h3 className="theme-editor__section-title">
                  {t("themeEditor.colors")}
                </h3>
                {COLOR_TOKEN_KEYS.map((key) => {
                  const label = t(`themeEditor.tokens.${key}`);
                  const value =
                    draft.tokens[key] ?? OBSIDIAN_DEFAULT_TOKENS[key] ?? "";
                  const baselineValue =
                    baseline.tokens[key] ?? OBSIDIAN_DEFAULT_TOKENS[key] ?? "";
                  const isDirty = value !== baselineValue;
                  return (
                    <FormField key={key} label={label}>
                      <ColorField
                        value={value}
                        onChange={(next) => updateToken(key, next)}
                        onReset={
                          isDirty
                            ? () => updateToken(key, baselineValue)
                            : undefined
                        }
                        resetLabel={t("themeEditor.resetToken", { label })}
                        swatchLabel={t("themeEditor.pickToken", { label })}
                      />
                    </FormField>
                  );
                })}
              </section>

              <section className="theme-editor__section">
                <h3 className="theme-editor__section-title">
                  {t("themeEditor.typography")}
                </h3>
                <FormField
                  label={t("themeEditor.tokens.font-ui")}
                  className="theme-editor__field--block"
                >
                  <Textarea
                    value={
                      draft.tokens["font-ui"] ??
                      OBSIDIAN_DEFAULT_TOKENS["font-ui"] ??
                      ""
                    }
                    onChange={(e) => updateToken("font-ui", e.target.value)}
                    rows={3}
                    autoSize
                  />
                </FormField>
              </section>
            </div>

            <aside
              className="theme-editor__preview"
              aria-label={t("themeEditor.livePreview")}
            >
              <div
                className="theme-editor__preview-frame theme-derived"
                style={previewStyle}
                aria-hidden
              >
                <div className="theme-editor__preview-main">
                  <div className="theme-editor__preview-header">
                    <p className="theme-editor__preview-title">
                      {draft.name.trim() || t("common:untitledTheme")}
                    </p>
                    <div className="theme-editor__preview-badges">
                      <Badge>{t("themeEditor.neutral")}</Badge>
                      <Badge variant="accent">{t("themeEditor.accent")}</Badge>
                    </div>
                  </div>

                  <ThemePreviewSamples />

                  <div className="theme-editor__preview-surfaces">
                    <div className="theme-editor__preview-panel">
                      <p className="theme-editor__preview-panel-label">
                        {t("themeEditor.onSurface")}
                      </p>
                      <PreviewSecondaryText />
                    </div>
                    <div className="theme-editor__preview-card">
                      <p className="theme-editor__preview-panel-label">
                        {t("themeEditor.onRaised")}
                      </p>
                      <PreviewSecondaryText />
                    </div>
                  </div>

                  <div className="theme-editor__preview-alerts">
                    <Alert variant="info">{t("themeEditor.alertInfo")}</Alert>
                    <Alert variant="success">
                      {t("themeEditor.alertSuccess")}
                    </Alert>
                    <Alert variant="warning">
                      {t("themeEditor.alertWarning")}
                    </Alert>
                    <Alert variant="error">{t("themeEditor.alertError")}</Alert>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </BrowseGridBody>
      </BrowseView>

      <footer className="theme-editor__footer">
        {!isEditingActiveTheme ? (
          <Button
            variant="secondary"
            disabled={busy || !canActivate}
            title={
              canActivate || !storedTheme
                ? undefined
                : formatThemeValidationError(validateThemeForApply(storedTheme))
            }
            onClick={() => void handleActivate()}
          >
            {applying ? t("themeEditor.activating") : t("themeEditor.activate")}
          </Button>
        ) : null}
        <Button
          variant="primary"
          disabled={busy || !hasChanges || !contributionIdValid}
          onClick={() => void handleSaveAndClose()}
        >
          {saving ? t("common:saving") : t("common:save")}
        </Button>
      </footer>

      <EditorDiscardOverlay
        open={discardPrompt}
        description={t("themeEditor.discardDescription")}
        onKeepEditing={handleKeepEditing}
        onDiscard={handleDiscard}
        onSave={() => void handleSaveAndClose()}
        saveLabel={saving ? t("common:saving") : t("common:save")}
        saveDisabled={busy || !contributionIdValid}
      />
    </div>
  );
}
