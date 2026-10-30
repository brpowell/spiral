import { Trans, useTranslation } from "react-i18next";
import { useLibrarySettingsStore } from "../../../store/useLibrarySettingsStore";
import type { LibrarySettingsPatch } from "../../../types/library";
import { Checkbox } from "../../common/Checkbox/Checkbox";

/** Listening history and update checks, all opt-out. */
export function PrivacyStep() {
  const { t } = useTranslation(["common", "preferences"]);
  const settings = useLibrarySettingsStore((s) => s.settings);
  const save = useLibrarySettingsStore((s) => s.saveLibrarySettings);

  const patch = (change: LibrarySettingsPatch) => {
    void save(change).catch((err: unknown) => {
      console.error("Failed to save onboarding setting:", err);
    });
  };

  return (
    <div className="onboarding-options">
      <div>
        <Checkbox
          alignStart
          disabled={!settings}
          checked={settings?.listeningHistoryEnabled ?? false}
          onChange={(e) => patch({ listeningHistoryEnabled: e.target.checked })}
        >
          {t("onboarding.privacy.history")}
        </Checkbox>
        <p className="onboarding-options__hint">
          <Trans
            i18nKey="onboarding.privacy.historyDescription"
            ns="common"
            components={{ strong: <strong /> }}
          />
        </p>
      </div>
      {/* Update labels and descriptions are shared with Preferences → Updates. */}
      <Checkbox
        alignStart
        disabled={!settings}
        checked={settings?.automaticUpdateChecksEnabled ?? false}
        onChange={(e) =>
          patch({ automaticUpdateChecksEnabled: e.target.checked })
        }
      >
        {t("preferences:updates.automatic.label")}
      </Checkbox>
      <div>
        <Checkbox
          alignStart
          disabled={!settings}
          checked={settings?.automaticItemUpdateChecksEnabled ?? false}
          onChange={(e) =>
            patch({ automaticItemUpdateChecksEnabled: e.target.checked })
          }
        >
          {t("preferences:updates.automaticItems.label")}
        </Checkbox>
        <p className="onboarding-options__hint">
          {t("preferences:updates.automaticItems.description")}
        </p>
      </div>
    </div>
  );
}
