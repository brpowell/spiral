import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { AppearanceSection } from "../../lib/appearanceWindow";
import { useAppearanceSection } from "../../hooks/useAppearanceSection";
import { useAppearanceThemeEditor } from "../../hooks/useAppearanceThemeEditor";
import { viewTransition } from "../../lib/motion";
import { useThemeStore } from "../../store/useThemeStore";
import {
  SidebarFrame,
  SidebarList,
  SidebarSection,
} from "../layout/SidebarChrome";
import { SidebarItem } from "../layout/SidebarItem/SidebarItem";
import { ThemeEditor } from "../ThemeEditor/ThemeEditor";
import {
  APPEARANCE_CONTENT_SECTIONS,
  APPEARANCE_MANAGE_SECTION,
  getAppearanceSectionConfig,
} from "./appearanceSections";
import { AppearanceThemeEditorProvider } from "./AppearanceThemeEditorContext";
import { InstalledPacksSection } from "./InstalledPacksSection";
import { SkinsSection } from "./SkinsSection";
import { ThemesSection } from "./ThemesSection";
import { VisualizersSection } from "./VisualizersSection";
import "./AppearanceShell.css";

function AppearanceSectionPanel({
  section,
  focusPackId,
  onFocusConsumed,
  onOpenPack,
  onLeavePackDetail,
  packDetailBackAriaLabel,
  packSelectedKey,
  onPackSelectedKeyChange,
}: {
  section: AppearanceSection;
  focusPackId: string | null;
  onFocusConsumed: () => void;
  onOpenPack: (packId: string) => void;
  onLeavePackDetail: () => void;
  packDetailBackAriaLabel: string;
  packSelectedKey: string | null;
  onPackSelectedKeyChange: (key: string | null) => void;
}) {
  switch (section) {
    case "themes":
      return <ThemesSection onOpenPack={onOpenPack} />;
    case "visualizers":
      return <VisualizersSection onOpenPack={onOpenPack} />;
    case "skins":
      return <SkinsSection onOpenPack={onOpenPack} />;
    case "packs":
      return (
        <InstalledPacksSection
          focusPackId={focusPackId}
          onFocusConsumed={onFocusConsumed}
          onLeaveDetail={onLeavePackDetail}
          detailBackAriaLabel={packDetailBackAriaLabel}
          selectedKey={packSelectedKey}
          onSelectedKeyChange={onPackSelectedKeyChange}
        />
      );
  }
}

export function AppearanceShell() {
  const [section, setSection, eventFocusPackId, clearEventFocusPackId] =
    useAppearanceSection();
  const { session: editorSession, openEditor, closeEditor } =
    useAppearanceThemeEditor();
  const themes = useThemeStore((s) => s.themes);

  const [localFocusPackId, setLocalFocusPackId] = useState<string | null>(null);
  const focusPackId = localFocusPackId ?? eventFocusPackId;
  /** Lifted so pack detail survives Theme Editor mount/unmount. */
  const [packSelectedKey, setPackSelectedKey] = useState<string | null>(null);
  /** Section to restore when leaving pack details (e.g. Themes → pack → back). */
  const [packReturnSection, setPackReturnSection] =
    useState<AppearanceSection | null>(null);

  const editorRequestCloseRef = useRef<(() => void) | null>(null);
  const afterEditorCloseRef = useRef<(() => void) | null>(null);

  const viewingPackDetail = packSelectedKey != null;

  const handleEditorClose = useCallback(() => {
    const afterClose = afterEditorCloseRef.current;
    afterEditorCloseRef.current = null;
    closeEditor();
    afterClose?.();
  }, [closeEditor]);

  const requestLeaveEditor = useCallback((afterClose?: () => void) => {
    afterEditorCloseRef.current = afterClose ?? null;
    editorRequestCloseRef.current?.();
  }, []);

  const handleEditorCloseCancelled = useCallback(() => {
    afterEditorCloseRef.current = null;
  }, []);

  const clearPackDetail = useCallback(() => {
    setPackSelectedKey(null);
    setPackReturnSection(null);
  }, []);

  const goBackFromPack = useCallback(() => {
    const returnTo = packReturnSection;
    clearPackDetail();
    if (returnTo != null && returnTo !== "packs") {
      setSection(returnTo);
    }
  }, [clearPackDetail, packReturnSection, setSection]);

  const handleSectionClick = useCallback(
    (next: AppearanceSection) => {
      if (editorSession != null) {
        requestLeaveEditor(() => {
          clearPackDetail();
          setSection(next);
        });
        return;
      }
      if (next === "packs" && section === "packs" && viewingPackDetail) {
        clearPackDetail();
        return;
      }
      if (next !== "packs") {
        clearPackDetail();
      }
      setSection(next);
    },
    [
      clearPackDetail,
      editorSession,
      requestLeaveEditor,
      section,
      setSection,
      viewingPackDetail,
    ],
  );

  const openPack = useCallback(
    (packId: string) => {
      const go = () => {
        setPackReturnSection(section);
        setLocalFocusPackId(packId);
        setSection("packs");
      };
      if (editorSession != null) {
        requestLeaveEditor(go);
        return;
      }
      go();
    },
    [editorSession, requestLeaveEditor, section, setSection],
  );

  const handleFocusConsumed = useCallback(() => {
    setLocalFocusPackId(null);
    clearEventFocusPackId();
  }, [clearEventFocusPackId]);

  useEffect(() => {
    if (eventFocusPackId) {
      // Deep-link / external navigate: back returns to Packs list.
      setPackReturnSection(null);
    }
  }, [eventFocusPackId]);

  const editorTheme =
    editorSession != null
      ? (themes.find((theme) => theme.id === editorSession.themeId) ?? null)
      : null;

  useEffect(() => {
    if (editorSession != null && editorTheme == null) {
      closeEditor();
    }
  }, [closeEditor, editorSession, editorTheme]);

  const editing = editorSession != null && editorTheme != null;
  const packBackLabel = getAppearanceSectionConfig(
    packReturnSection ?? "packs",
  ).label;
  const editorBackAriaLabel = viewingPackDetail
    ? "Back to Pack Details"
    : "Back to Themes";
  const packDetailBackAriaLabel = `Back to ${packBackLabel}`;
  const contentKey = editing
    ? `editor-${editorSession.themeId}`
    : `list-${section}`;

  return (
    <div className="appearance-shell">
      <aside className="appearance-shell__sidebar">
        <header className="appearance-shell__sidebar-header">
          <h1 className="appearance-shell__title">Studio</h1>
        </header>
        <SidebarFrame embedded aria-label="Studio sections">
          <SidebarList>
            {APPEARANCE_CONTENT_SECTIONS.map((item) => (
              <li key={item.id}>
                <SidebarItem
                  icon={item.icon}
                  active={section === item.id}
                  onClick={() => handleSectionClick(item.id)}
                >
                  {item.label}
                </SidebarItem>
              </li>
            ))}
          </SidebarList>
          <SidebarSection aria-label="Packs">
            <SidebarItem
              icon={APPEARANCE_MANAGE_SECTION.icon}
              active={section === APPEARANCE_MANAGE_SECTION.id}
              onClick={() => handleSectionClick(APPEARANCE_MANAGE_SECTION.id)}
            >
              {APPEARANCE_MANAGE_SECTION.label}
            </SidebarItem>
          </SidebarSection>
        </SidebarFrame>
      </aside>

      <div className="appearance-shell__content">
        <main className="appearance-shell__main">
          <AppearanceThemeEditorProvider openThemeEditor={openEditor}>
            <AnimatePresence mode="wait">
              {editing ? (
                <motion.div
                  key={contentKey}
                  className="appearance-shell__view"
                  {...viewTransition}
                >
                  <ThemeEditor
                    theme={editorTheme}
                    onClose={handleEditorClose}
                    backAriaLabel={editorBackAriaLabel}
                    requestCloseRef={editorRequestCloseRef}
                    onCloseRequestCancelled={handleEditorCloseCancelled}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key={contentKey}
                  className="appearance-shell__view"
                  {...viewTransition}
                >
                  <AppearanceSectionPanel
                    section={section}
                    focusPackId={focusPackId}
                    onFocusConsumed={handleFocusConsumed}
                    onOpenPack={openPack}
                    onLeavePackDetail={goBackFromPack}
                    packDetailBackAriaLabel={packDetailBackAriaLabel}
                    packSelectedKey={packSelectedKey}
                    onPackSelectedKeyChange={setPackSelectedKey}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </AppearanceThemeEditorProvider>
        </main>
      </div>
    </div>
  );
}
