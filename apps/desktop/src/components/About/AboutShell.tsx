import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ABOUT_FOCUS_TAB_EVENT, type AboutTabId } from "../../lib/aboutWindow";
import { Tab, TabList, TabPanel, Tabs } from "../common/Tabs/Tabs";
import { AboutIdentityPanel } from "./AboutIdentityPanel";
import { CreditsPanel } from "./CreditsPanel";
import { LicensesPanel } from "./LicensesPanel";
import "./AboutShell.css";

function isAboutTabId(value: unknown): value is AboutTabId {
  return value === "credits" || value === "licenses";
}

export function AboutShell() {
  const { t } = useTranslation("about");
  const [activeTab, setActiveTab] = useState<AboutTabId>("credits");

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void listen<AboutTabId>(ABOUT_FOCUS_TAB_EVENT, (event) => {
      if (isAboutTabId(event.payload)) {
        setActiveTab(event.payload);
      }
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return (
    <div className="about-shell">
      <AboutIdentityPanel />

      <div className="about-shell__main">
        <Tabs
          value={activeTab}
          onChange={(value) => {
            if (isAboutTabId(value)) setActiveTab(value);
          }}
          variant="underline"
          className="about-shell__tabs"
        >
          <TabList
            fade
            aria-label={t("tabsAria")}
            className="about-shell__tab-list"
          >
            <Tab value="credits">{t("tabs.credits")}</Tab>
            <Tab value="licenses">{t("tabs.licenses")}</Tab>
          </TabList>
          <TabPanel
            value="credits"
            className="about-shell__tab-panel"
            keepMounted
          >
            <CreditsPanel />
          </TabPanel>
          <TabPanel
            value="licenses"
            className="about-shell__tab-panel"
            keepMounted
          >
            <LicensesPanel />
          </TabPanel>
        </Tabs>
      </div>
    </div>
  );
}
