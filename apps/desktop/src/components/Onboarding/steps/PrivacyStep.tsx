import type { ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useLibrarySettingsStore } from "../../../store/useLibrarySettingsStore";
import type { LibrarySettingsPatch } from "../../../types/library";
import { Checkbox } from "../../common/Checkbox/Checkbox";

/** One checkbox with its explanatory note underneath. */
function Option({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: ReactNode;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div>
      <Checkbox
        alignStart
        disabled={disabled}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      >
        {label}
      </Checkbox>
      <p className="onboarding-options__hint">{description}</p>
    </div>
  );
}

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
      <Option
        label={t("onboarding.privacy.history")}
        description={
          <Trans
            i18nKey="onboarding.privacy.historyDescription"
            ns="common"
            components={{ strong: <strong /> }}
          />
        }
        disabled={!settings}
        checked={settings?.listeningHistoryEnabled ?? false}
        onChange={(checked) => patch({ listeningHistoryEnabled: checked })}
      />
      {/* Update labels and descriptions are shared with Preferences → Updates. */}
      <Option
        label={t("preferences:updates.automatic.label")}
        description={t("preferences:updates.automatic.description")}
        disabled={!settings}
        checked={settings?.automaticUpdateChecksEnabled ?? false}
        onChange={(checked) => patch({ automaticUpdateChecksEnabled: checked })}
      />
      <Option
        label={t("preferences:updates.automaticItems.label")}
        description={t("preferences:updates.automaticItems.description")}
        disabled={!settings}
        checked={settings?.automaticItemUpdateChecksEnabled ?? false}
        onChange={(checked) =>
          patch({ automaticItemUpdateChecksEnabled: checked })
        }
      />
    </div>
  );
}
