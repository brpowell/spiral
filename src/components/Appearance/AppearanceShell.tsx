import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { AppearanceSection } from "../../lib/appearanceWindow";
import { useAppearanceSection } from "../../hooks/useAppearanceSection";
import { useAppearancePackDetail } from "../../hooks/useAppearancePackDetail";
import { viewTransition } from "../../lib/motion";
import { SidebarItem } from "../layout/SidebarItem/SidebarItem";
import {
  APPEARANCE_SECTIONS,
  getAppearanceSectionConfig,
} from "./appearanceSections";
import { AppearancePackDetailProvider } from "./AppearancePackDetailContext";
import { AppearancePackDetailView } from "./AppearancePackDetailView";
import { SkinsSection } from "./SkinsSection";
import { ThemesSection } from "./ThemesSection";
import { VisualizersSection } from "./VisualizersSection";
import "./AppearanceShell.css";

function AppearanceSectionPanel({ section }: { section: AppearanceSection }) {
  switch (section) {
    case "themes":
      return <ThemesSection />;
    case "visualizers":
      return <VisualizersSection />;
    case "skins":
      return <SkinsSection />;
  }
}

export function AppearanceShell() {
  const [section, setSection] = useAppearanceSection();
  const { detail, openDetail, closeDetail } = useAppearancePackDetail();
  const config = getAppearanceSectionConfig(section);

  useEffect(() => {
    closeDetail();
  }, [section, closeDetail]);

  const contentKey =
    detail != null
      ? `detail-${section}-${detail.kind}-${detail.id}`
      : `list-${section}`;

  return (
    <div className="appearance-shell">
      <aside className="appearance-shell__sidebar" aria-label="Appearance sections">
        <header className="appearance-shell__sidebar-header">
          <h1 className="appearance-shell__title">Appearance</h1>
        </header>
        <nav>
          <ul className="appearance-shell__nav">
            {APPEARANCE_SECTIONS.map((item) => (
              <li key={item.id}>
                <SidebarItem
                  icon={item.icon}
                  active={section === item.id}
                  onClick={() => setSection(item.id)}
                >
                  {item.label}
                </SidebarItem>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <div className="appearance-shell__content">
        <header className="appearance-shell__content-header">
          <h2 className="appearance-shell__section-title">{config.label}</h2>
        </header>
        <main className="appearance-shell__main">
          <AppearancePackDetailProvider openDetail={openDetail}>
            <AnimatePresence mode="wait">
              {detail != null ? (
                <motion.div
                  key={contentKey}
                  className="appearance-shell__view"
                  {...viewTransition}
                >
                  <AppearancePackDetailView
                    section={section}
                    ref={detail}
                    onBack={closeDetail}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key={contentKey}
                  className="appearance-shell__view"
                  {...viewTransition}
                >
                  <AppearanceSectionPanel section={section} />
                </motion.div>
              )}
            </AnimatePresence>
          </AppearancePackDetailProvider>
        </main>
      </div>
    </div>
  );
}
