import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
} from "react";
import type { Theme, ThemeTokens } from "../../types/theme";
import { t } from "../../lib/i18n";
import {
  effectiveContributionId,
  isContributionId,
  packIdPrefix,
} from "../../lib/packs/packManifest";
import { OBSIDIAN_DEFAULT_TOKENS, resolveThemeTokens } from "../../lib/theme";
import { emitThemePreview } from "../../lib/themeBridge";
import {
  formatThemeValidationError,
  isThemeApplicable,
  validateThemeForApply,
} from "../../lib/themeValidation";
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
import { Separator } from "../common/Separator/Separator";
import { Slider } from "../common/Slider/Slider";
import { SlugField } from "../common/SlugField/SlugField";
import { Switch } from "../common/Switch/Switch";
import { TextInput } from "../common/TextInput/TextInput";
import { TextLink } from "../common/TextLink/TextLink";
import { Textarea } from "../common/Textarea/Textarea";
import { EditorDiscardOverlay } from "../EditorDiscardOverlay/EditorDiscardOverlay";
import { BrowseGridBody } from "../BrowseView/BrowseGridBody";
import { BrowseView } from "../BrowseView/BrowseView";
import { BrowseViewHeader } from "../BrowseView/BrowseViewHeader";
import { SidebarItem } from "../layout/SidebarItem/SidebarItem";
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

const TOKEN_LABELS: Record<string, string> = {
  "color-bg": "Background",
  "color-surface": "Surface",
  "color-surface-raised": "Surface raised",
  "color-text-primary": "Primary",
  "color-text-secondary": "Secondary",
  "color-text-muted": "Muted",
  "color-accent": "Accent",
  "color-accent-muted": "Muted",
  "color-accent-text": "On accent",
  "color-border": "Border",
  "color-danger": "Foreground",
  "color-danger-bg": "Background",
  "color-interactive": "Interactive",
  "color-interactive-selected-text": "Selected text",
  "color-alert-info": "Foreground",
  "color-alert-info-bg": "Background",
  "color-alert-info-border": "Border",
  "color-alert-success": "Foreground",
  "color-alert-success-bg": "Background",
  "color-alert-success-border": "Border",
  "color-alert-warning": "Foreground",
  "color-alert-warning-bg": "Background",
  "color-alert-warning-border": "Border",
  "color-alert-error": "Foreground",
  "color-alert-error-bg": "Background",
  "color-alert-error-border": "Border",
  "radius-card": "Card",
  "radius-button": "Button",
  "radius-input": "Input & controls",
  "font-ui": "UI font",
};

type ColorTokenGroup = {
  title: string;
  keys: readonly string[];
};

const COLOR_TOKEN_GROUPS: ColorTokenGroup[] = [
  {
    title: "Surfaces",
    keys: ["color-bg", "color-surface", "color-surface-raised", "color-border"],
  },
  {
    title: "Text",
    keys: [
      "color-text-primary",
      "color-text-secondary",
      "color-text-muted",
    ],
  },
  {
    title: "Accent",
    keys: ["color-accent", "color-accent-muted", "color-accent-text"],
  },
  {
    title: "Interactive",
    keys: ["color-interactive", "color-interactive-selected-text"],
  },
  {
    title: "Danger",
    keys: ["color-danger", "color-danger-bg"],
  },
  {
    title: "Alert — Info",
    keys: [
      "color-alert-info",
      "color-alert-info-bg",
      "color-alert-info-border",
    ],
  },
  {
    title: "Alert — Success",
    keys: [
      "color-alert-success",
      "color-alert-success-bg",
      "color-alert-success-border",
    ],
  },
  {
    title: "Alert — Warning",
    keys: [
      "color-alert-warning",
      "color-alert-warning-bg",
      "color-alert-warning-border",
    ],
  },
  {
    title: "Alert — Error",
    keys: [
      "color-alert-error",
      "color-alert-error-bg",
      "color-alert-error-border",
    ],
  },
];

const RADIUS_TOKEN_KEYS = [
  "radius-card",
  "radius-button",
  "radius-input",
] as const;

function parsePx(value: string | undefined): number {
  if (!value) return 0;
  const match = /^(-?\d+(?:\.\d+)?)px$/i.exec(value.trim());
  if (match) return Number(match[1]);
  const asNumber = Number(value);
  return Number.isFinite(asNumber) ? asNumber : 0;
}

function formatPx(value: number): string {
  return `${Math.round(value)}px`;
}

function cloneTheme(theme: Theme): Theme {
  return {
    ...theme,
    tokens: { ...theme.tokens },
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

function ThemePreviewSamples({ inputId }: { inputId: string }) {
  return (
    <>
      <div className="theme-editor__preview-actions">
        <Button variant="primary" size="sm" tabIndex={-1}>
          Primary
        </Button>
        <Button variant="secondary" size="sm" tabIndex={-1}>
          Secondary
        </Button>
        <Button variant="ghost" size="sm" tabIndex={-1}>
          Ghost
        </Button>
        <Button variant="danger" size="sm" tabIndex={-1}>
          Danger
        </Button>
      </div>
      <TextInput
        value="Input sample"
        readOnly
        tabIndex={-1}
        aria-label={`Preview input (${inputId})`}
      />
      <div className="theme-editor__preview-row">
        <Chip label="Chip" onRemove={() => { }} />
        <Switch defaultChecked tabIndex={-1}>
          Switch
        </Switch>
        <Checkbox defaultChecked tabIndex={-1}>
          Check
        </Checkbox>
      </div>
    </>
  );
}

/** Browse header title while editing a theme. */
export function formatThemeEditorTitle(name: string): string {
  return `Edit theme (${name.trim() || t("common:untitledTheme")})`;
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
  backAriaLabel = "Back",
  requestCloseRef,
  onCloseRequestCancelled,
}: ThemeEditorProps) {
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

  const {
    discardPrompt,
    requestClose,
    dismissDiscardPrompt,
  } = useEditorDiscardPrompt(hasChanges, onClose);

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

  const persistDraft = useCallback(async (next: Theme): Promise<Theme> => {
    const saved = await saveTheme(next);
    sessionThemeIdRef.current = saved.id;
    setDraft(cloneTheme(saved));
    setBaseline(cloneTheme(saved));
    return saved;
  }, [saveTheme]);

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
      showToast({
        label: "Theme saved",
        status: "success",
        key: "theme-editor-save",
      });
      dismissDiscardPrompt();
      onClose();
    } catch (err) {
      showErrorToast({
        label: err instanceof Error ? err.message : "Failed to save theme",
        key: "theme-editor-save",
      });
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
      showToast({
        label: "Theme activated",
        status: "success",
        key: "theme-editor-activate",
      });
    } catch (err) {
      showErrorToast({
        label: err instanceof Error ? err.message : "Failed to activate theme",
        key: "theme-editor-activate",
      });
    } finally {
      setApplying(false);
    }
  }, [draft, setTheme, showErrorToast, showToast]);

  const previewTokens = resolveThemeTokens(draft);
  const storedTheme = themes.find((t) => t.id === draft.id);
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
      id: effectiveContributionId(prev.authorId, prev.packId, "theme", nextLocalId),
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
    Object.entries(previewTokens).map(([key, value]) => [
      `--${key}`,
      value ?? "",
    ]),
  ) as CSSProperties;

  return (
    <div
      className="theme-editor"
      role="region"
      aria-label={editorTitle}
    >
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
                <h3 className="theme-editor__section-title">Details</h3>
                <FormField label="Name" className="theme-editor__field--block">
                  <TextInput
                    value={draft.name}
                    onChange={(e) => updateMeta("name", e.target.value)}
                  />
                </FormField>
                <FormField
                  label="Contribution ID"
                  className="theme-editor__field--block"
                  description={
                    contributionId.length > 0 && !contributionIdValid
                      ? "Use lowercase letters, numbers, and hyphens (e.g. my-theme)."
                      : "Kebab slug used in the theme’s effective id."
                  }
                >
                  <SlugField
                    value={contributionId}
                    onChange={updateContributionId}
                    suggestedFrom={draft.name}
                    autoSyncKey={theme.id}
                    placeholder="my-theme"
                    disabled={busy}
                  />
                </FormField>
                <FormField label="Author" className="theme-editor__field--block">
                  <TextInput
                    value={draft.author}
                    onChange={(e) => updateMeta("author", e.target.value)}
                  />
                </FormField>
              <FormField
                label="Description"
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

            {COLOR_TOKEN_GROUPS.map((group) => (
              <section key={group.title} className="theme-editor__section">
                <h3 className="theme-editor__section-title">{group.title}</h3>
                {group.keys.map((key) => {
                  const value =
                    draft.tokens[key] ??
                    OBSIDIAN_DEFAULT_TOKENS[key] ??
                    "";
                  const baselineValue =
                    baseline.tokens[key] ??
                    OBSIDIAN_DEFAULT_TOKENS[key] ??
                    "";
                  const isDirty = value !== baselineValue;
                  return (
                    <FormField key={key} label={TOKEN_LABELS[key] ?? key}>
                      <ColorField
                        value={value}
                        onChange={(next) => updateToken(key, next)}
                        onReset={
                          isDirty
                            ? () => updateToken(key, baselineValue)
                            : undefined
                        }
                        resetLabel={`Reset ${TOKEN_LABELS[key] ?? key}`}
                        swatchLabel={`Pick ${group.title} ${TOKEN_LABELS[key] ?? key}`}
                      />
                    </FormField>
                  );
                })}
              </section>
            ))}

            <section className="theme-editor__section">
              <h3 className="theme-editor__section-title">Radius</h3>
              {RADIUS_TOKEN_KEYS.map((key) => {
                const label = TOKEN_LABELS[key] ?? key;
                return (
                  <FormField key={key} label={label}>
                    <Slider
                      value={parsePx(
                        draft.tokens[key] ?? OBSIDIAN_DEFAULT_TOKENS[key],
                      )}
                      onChange={(e) =>
                        updateToken(key, formatPx(Number(e.target.value)))
                      }
                      min={0}
                      max={32}
                      step={1}
                      aria-label={label}
                      showValueTooltip
                      formatValueTooltip={(value) => `${Math.round(value)} px`}
                    />
                  </FormField>
                );
              })}
            </section>

            <section className="theme-editor__section">
              <h3 className="theme-editor__section-title">Typography</h3>
              <FormField
                label={TOKEN_LABELS["font-ui"]}
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

          <aside className="theme-editor__preview" aria-label="Live preview">
            <div
              className="theme-editor__preview-frame"
              style={previewStyle}
              aria-hidden
            >
              <div className="theme-editor__preview-chrome">
                <span className="theme-editor__preview-dot" />
                <span className="theme-editor__preview-dot" />
                <span className="theme-editor__preview-dot" />
              </div>

              <div className="theme-editor__preview-shell">
                <nav className="theme-editor__preview-rail">
                  <p className="theme-editor__preview-rail-label">Library</p>
                  <SidebarItem active tabIndex={-1}>
                    Albums
                  </SidebarItem>
                  <SidebarItem tabIndex={-1}>Artists</SidebarItem>
                  <SidebarItem tabIndex={-1}>Playlists</SidebarItem>
                </nav>

                <div className="theme-editor__preview-main">
                  <div className="theme-editor__preview-header">
                    <p className="theme-editor__preview-title">
                      {draft.name.trim() || t("common:untitledTheme")}
                    </p>
                    <div className="theme-editor__preview-badges">
                      <Badge>Neutral</Badge>
                      <Badge variant="accent">Accent</Badge>
                    </div>
                  </div>

                  <p className="theme-editor__preview-body">
                    Secondary text with a{" "}
                    <TextLink href="#theme-preview" tabIndex={-1}>
                      link
                    </TextLink>
                    .
                  </p>

                  <div className="theme-editor__preview-panel">
                    <p className="theme-editor__preview-panel-label">
                      On surface
                    </p>
                    <ThemePreviewSamples inputId="surface" />
                  </div>

                  <div className="theme-editor__preview-card">
                    <p className="theme-editor__preview-panel-label">
                      On raised
                    </p>
                    <ThemePreviewSamples inputId="raised" />
                  </div>

                  <Separator />

                  <div className="theme-editor__preview-alerts">
                    <Alert variant="info">Info alert</Alert>
                    <Alert variant="success">Success alert</Alert>
                    <Alert variant="warning">Warning alert</Alert>
                    <Alert variant="error">Error alert</Alert>
                  </div>
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
                : formatThemeValidationError(
                    validateThemeForApply(storedTheme),
                  )
            }
            onClick={() => void handleActivate()}
          >
            {applying ? "Activating…" : "Activate theme"}
          </Button>
        ) : null}
        <Button
          variant="primary"
          disabled={busy || !hasChanges || !contributionIdValid}
          onClick={() => void handleSaveAndClose()}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </footer>

      <EditorDiscardOverlay
        open={discardPrompt}
        description="Save your theme edits, or discard them and revert."
        onKeepEditing={handleKeepEditing}
        onDiscard={handleDiscard}
        onSave={() => void handleSaveAndClose()}
        saveLabel={saving ? "Saving…" : "Save"}
        saveDisabled={busy || !contributionIdValid}
      />
    </div>
  );
}
