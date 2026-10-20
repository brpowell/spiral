import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import type { AppearanceSection } from "../../lib/appearanceWindow";
import { useAppearanceSection } from "../../hooks/useAppearanceSection";
import { useAppearanceThemeEditor } from "../../hooks/useAppearanceThemeEditor";
import { viewTransition } from "../../lib/motion";
import { useItemUpdatesStore } from "../../store/useItemUpdatesStore";
import { useThemeStore } from "../../store/useThemeStore";
import {
  SidebarFrame,
  SidebarList,
  SidebarSection,
} from "../layout/SidebarChrome";
import { SidebarItem } from "../layout/SidebarItem/SidebarItem";
import {
  StatusIndicator,
  StatusIndicatorAnchor,
} from "../common/StatusIndicator/StatusIndicator";
import { IconDownload } from "../icons";
import { ThemeEditor } from "../ThemeEditor/ThemeEditor";
import {
  APPEARANCE_CATALOG_SECTION,
  APPEARANCE_CONTENT_SECTIONS,
  getAppearanceSectionConfig,
} from "./appearanceSections";
import { AppearanceThemeEditorProvider } from "./AppearanceThemeEditorContext";
import { ItemDetailView } from "./ItemDetailView";
import { RegistryBrowseSection } from "./RegistryBrowseSection";
import { StudioSidebarActions } from "./StudioSidebarActions";
import { SkinsSection } from "./SkinsSection";
import { SoundsSection } from "./SoundsSection";
import { ThemesSection } from "./ThemesSection";
import { VisualizersSection } from "./VisualizersSection";
import "./AppearanceShell.css";

function AppearanceSectionPanel({
  section,
  detailItemId,
  onOpenItem,
  onLeaveDetail,
  onDetailItemIdChange,
  detailBackAriaLabel,
}: {
  section: AppearanceSection;
  detailItemId: string | null;
  onOpenItem: (effectiveId: string) => void;
  onLeaveDetail: () => void;
  onDetailItemIdChange: (effectiveId: string) => void;
  detailBackAriaLabel: string;
}) {
  if (detailItemId != null) {
    return (
      <ItemDetailView
        itemId={detailItemId}
        backAriaLabel={detailBackAriaLabel}
        onBack={onLeaveDetail}
        onItemIdChange={onDetailItemIdChange}
      />
    );
  }
  switch (section) {
    case "themes":
      return <ThemesSection onOpenItem={onOpenItem} />;
    case "visualizers":
      return <VisualizersSection onOpenItem={onOpenItem} />;
    case "skins":
      return <SkinsSection onOpenItem={onOpenItem} />;
    case "sounds":
      return <SoundsSection onOpenItem={onOpenItem} />;
    case "catalog":
      return <RegistryBrowseSection />;
  }
}

export function AppearanceShell() {
  const { t } = useTranslation("studio");
  const [section, setSection, eventFocusItemId, clearEventFocusItemId] =
    useAppearanceSection();
  const {
    session: editorSession,
    openEditor,
    closeEditor,
  } = useAppearanceThemeEditor();
  const themes = useThemeStore((s) => s.themes);

  /** Item shown in the details view, if any. Lifted so it survives Theme Editor mount/unmount. */
  const [detailItemId, setDetailItemId] = useState<string | null>(null);

  const editorRequestCloseRef = useRef<(() => void) | null>(null);
  const afterEditorCloseRef = useRef<(() => void) | null>(null);

  const viewingDetail = detailItemId != null;

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

  const runAfterLeavingEditor = useCallback(
    (go: () => void) => {
      if (editorSession != null) {
        requestLeaveEditor(go);
        return;
      }
      go();
    },
    [editorSession, requestLeaveEditor],
  );

  const handleSectionClick = useCallback(
    (next: AppearanceSection) => {
      const go = () => {
        setDetailItemId(null);
        setSection(next);
      };
      if (editorSession != null) {
        requestLeaveEditor(go);
        return;
      }
      go();
    },
    [editorSession, requestLeaveEditor, setSection],
  );

  const openItem = useCallback(
    (effectiveId: string) => {
      const go = () => setDetailItemId(effectiveId);
      if (editorSession != null) {
        requestLeaveEditor(go);
        return;
      }
      go();
    },
    [editorSession, requestLeaveEditor],
  );

  // Deep link / external navigate straight to an item.
  useEffect(() => {
    if (eventFocusItemId) {
      setDetailItemId(eventFocusItemId);
      clearEventFocusItemId();
    }
  }, [clearEventFocusItemId, eventFocusItemId]);

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
  const sectionLabel = getAppearanceSectionConfig(section).label;
  const editorBackAriaLabel = viewingDetail
    ? t("backToDetails")
    : t("backToThemes");
  const detailBackAriaLabel = t("backTo", { section: sectionLabel });
  const contentKey = editing
    ? `editor-${editorSession.themeId}`
    : viewingDetail
      ? `detail-${detailItemId}`
      : `list-${section}`;

  const catalogLabel = t("catalog.sidebar");
  const collectionLabel = t("nav.collection");
  const pendingUpdates = useItemUpdatesStore((s) => s.pendingUpdates);
  const updatingItems = useItemUpdatesStore((s) => s.status === "updating");
  const updateAllPendingItems = useItemUpdatesStore(
    (s) => s.updateAllPendingItems,
  );
  const typesWithUpdates = useMemo(
    () => new Set(pendingUpdates.map((u) => u.itemType)),
    [pendingUpdates],
  );

  return (
    <div className="appearance-shell">
      <aside className="appearance-shell__sidebar">
        <SidebarFrame embedded aria-label={t("nav.sectionsAria")}>
          <StudioSidebarActions
            runAfterLeavingEditor={runAfterLeavingEditor}
            openThemeEditor={openEditor}
          >
            {pendingUpdates.length > 0 ? (
              <li>
                <SidebarItem
                  icon={<IconDownload />}
                  trailing={pendingUpdates.length}
                  disabled={updatingItems}
                  aria-label={t("actions.updateAllAria", {
                    count: pendingUpdates.length,
                  })}
                  onClick={() => void updateAllPendingItems()}
                >
                  {t("actions.updateAll")}
                </SidebarItem>
              </li>
            ) : null}
          </StudioSidebarActions>
          <SidebarSection label={collectionLabel}>
            <SidebarList>
              {APPEARANCE_CONTENT_SECTIONS.map((item) => (
                <li key={item.id}>
                  <SidebarItem
                    leading={
                      <StatusIndicatorAnchor className="sidebar-item__icon">
                        {item.icon}
                        {item.itemType != null &&
                        typesWithUpdates.has(item.itemType) ? (
                          <StatusIndicator />
                        ) : null}
                      </StatusIndicatorAnchor>
                    }
                    active={section === item.id}
                    onClick={() => handleSectionClick(item.id)}
                  >
                    {item.label}
                  </SidebarItem>
                </li>
              ))}
            </SidebarList>
          </SidebarSection>
          <SidebarSection label={t("catalog.section")}>
            <SidebarList>
              <li>
                <SidebarItem
                  icon={APPEARANCE_CATALOG_SECTION.icon}
                  active={section === APPEARANCE_CATALOG_SECTION.id}
                  onClick={() =>
                    handleSectionClick(APPEARANCE_CATALOG_SECTION.id)
                  }
                >
                  {catalogLabel}
                </SidebarItem>
              </li>
            </SidebarList>
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
                    detailItemId={detailItemId}
                    onOpenItem={openItem}
                    onLeaveDetail={() => setDetailItemId(null)}
                    onDetailItemIdChange={setDetailItemId}
                    detailBackAriaLabel={detailBackAriaLabel}
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
