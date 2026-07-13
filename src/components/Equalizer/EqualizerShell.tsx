import { useMemo, useState, type CSSProperties } from "react";
import {
  BUILTIN_PRESETS,
  resolvePreset,
} from "../../lib/equalizer/builtinPresets";
import {
  EQ_BAND_FREQUENCIES_HZ,
  EQ_REFERENCE_LINES_DB,
  formatEqBandFrequencyLabel,
  formatEqScaleDb,
  gainDbToRatio,
} from "../../lib/equalizer/types";
import { useEqualizerStore } from "../../store/useEqualizerStore";
import { Button } from "../common/Button/Button";
import { Switch } from "../common/Switch/Switch";
import { ContextMenuItem } from "../ContextMenu/ContextMenu";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from "../common/Modal/Modal";
import { NativeSelect } from "../common/NativeSelect/NativeSelect";
import type { SelectOption } from "../common/Select/selectTypes";
import { MenuButton } from "../MenuButton/MenuButton";
import { EqualizerBandSlider } from "./EqualizerBandSlider";
import { TextInput } from "../common/TextInput/TextInput";
import { FormField } from "../common/Field/Field";
import {
  IconCopy,
  IconDelete,
  IconPencil,
  IconReset
} from "../icons";
import "./EqualizerShell.css";

type PresetDialogMode = "save" | "rename" | null;

export function EqualizerShell() {
  const enabled = useEqualizerStore((s) => s.enabled);
  const presetId = useEqualizerStore((s) => s.presetId);
  const lastPresetId = useEqualizerStore((s) => s.lastPresetId);
  const bands = useEqualizerStore((s) => s.bands);
  const customPresets = useEqualizerStore((s) => s.customPresets);
  const preampGain = useEqualizerStore((s) => s.preampGain);
  const setEnabled = useEqualizerStore((s) => s.setEnabled);
  const setBand = useEqualizerStore((s) => s.setBand);
  const setPreampGain = useEqualizerStore((s) => s.setPreampGain);
  const applyPreset = useEqualizerStore((s) => s.applyPreset);
  const reset = useEqualizerStore((s) => s.reset);
  const saveCurrentAsPreset = useEqualizerStore((s) => s.saveCurrentAsPreset);
  const renameCustomPreset = useEqualizerStore((s) => s.renameCustomPreset);
  const deleteCustomPreset = useEqualizerStore((s) => s.deleteCustomPreset);

  const [dialogMode, setDialogMode] = useState<PresetDialogMode>(null);
  const [presetName, setPresetName] = useState("");

  const selectedPreset = resolvePreset(presetId, customPresets);
  const canEditPreset =
    presetId !== "manual" &&
    selectedPreset != null &&
    !selectedPreset.builtin;

  const presetOptions = useMemo((): SelectOption<string>[] => {
    const options: SelectOption<string>[] = BUILTIN_PRESETS.map((preset) => ({
      value: preset.id,
      label: preset.name,
    }));

    for (const preset of customPresets) {
      options.push({ value: preset.id, label: preset.name });
    }

    if (presetId === "manual") {
      options.unshift({
        value: "manual",
        label: "Manual",
        disabled: true,
      });
    }

    return options;
  }, [customPresets, presetId]);

  const canReset = useMemo(() => {
    const targetPresetId = presetId === "manual" ? lastPresetId : presetId;
    const targetPreset = resolvePreset(targetPresetId, customPresets);
    if (!targetPreset) return false;
    return bands.some((gain, index) => gain !== targetPreset.bands[index]);
  }, [bands, customPresets, lastPresetId, presetId]);

  const openSaveDialog = () => {
    setPresetName("");
    setDialogMode("save");
  };

  const openRenameDialog = () => {
    if (!canEditPreset || !selectedPreset) return;
    setPresetName(selectedPreset.name);
    setDialogMode("rename");
  };

  const closeDialog = () => {
    setDialogMode(null);
    setPresetName("");
  };

  const submitDialog = () => {
    const trimmed = presetName.trim();
    if (!trimmed) return;

    if (dialogMode === "save") {
      saveCurrentAsPreset(trimmed);
    } else if (dialogMode === "rename" && canEditPreset) {
      renameCustomPreset(presetId, trimmed);
    }

    closeDialog();
  };

  return (
    <div className="equalizer-shell">
      <div className="equalizer-shell__toolbar">
        <div className="equalizer-shell__toolbar-left">
          <NativeSelect
            className="equalizer-shell__preset-select"
            aria-label="Equalizer preset"
            value={presetId}
            options={presetOptions}
            onChange={(id) => {
              if (id !== "manual") {
                applyPreset(id);
              }
            }}
          />
          <Button
            className="equalizer-shell__reset"
            variant="secondary"
            size="sm"
            disabled={!canReset}
            onClick={() => reset()}
          >
            <IconReset />
            Reset
          </Button>
          <MenuButton ariaLabel="Equalizer actions" size="md">
            {(close) => (
              <>
                <ContextMenuItem
                  icon={<IconCopy />}
                  label="Save as preset"
                  onClick={() => {
                    close();
                    openSaveDialog();
                  }}
                />
                <ContextMenuItem
                  icon={<IconPencil />}
                  label="Rename preset"
                  disabled={!canEditPreset}
                  onClick={() => {
                    close();
                    openRenameDialog();
                  }}
                />
                <ContextMenuItem
                  icon={<IconDelete />}
                  label="Delete preset"
                  className="context-menu__danger"
                  disabled={!canEditPreset}
                  onClick={() => {
                    close();
                    deleteCustomPreset(presetId);
                  }}
                />
              </>
            )}
          </MenuButton>


        </div>

        <Switch
          className="equalizer-shell__enable"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        >
          Enable
        </Switch>
      </div>

      <div
        className={`equalizer-shell__bands-area${enabled ? "" : " equalizer-shell__bands-area--disabled"}`}
      >
        <div className="equalizer-shell__scale" aria-hidden>
          <span className="equalizer-shell__scale-unit">dB</span>
          <div className="equalizer-shell__scale-track">
            {EQ_REFERENCE_LINES_DB.map((gain) => (
              <span
                key={gain}
                className="equalizer-shell__scale-mark"
                style={
                  { "--eq-ratio": gainDbToRatio(gain) } as CSSProperties
                }
              >
                {formatEqScaleDb(gain)}
              </span>
            ))}
          </div>
        </div>

        <div className="equalizer-shell__bands">
          <div className="equalizer-shell__grid-lines" aria-hidden>
            {EQ_REFERENCE_LINES_DB.map((gain) => (
              <div
                key={gain}
                className={`equalizer-shell__grid-line${gain === 0 ? " equalizer-shell__grid-line--zero" : ""}`}
                style={
                  { "--eq-ratio": gainDbToRatio(gain) } as CSSProperties
                }
              />
            ))}
          </div>

          <div className="equalizer-shell__band equalizer-shell__band--preamp">
            <span className="equalizer-shell__band-label">Preamp</span>
            <div className="equalizer-shell__band-track">
              <EqualizerBandSlider
                aria-label="Preamp gain"
                value={preampGain}
                disabled={!enabled}
                onChange={setPreampGain}
              />
            </div>
          </div>

          {EQ_BAND_FREQUENCIES_HZ.map((frequency, index) => (
            <div key={frequency} className="equalizer-shell__band">
              <span className="equalizer-shell__band-label">
                {formatEqBandFrequencyLabel(frequency)}
              </span>
              <div className="equalizer-shell__band-track">
                <EqualizerBandSlider
                  aria-label={`${frequency} Hz band`}
                  value={bands[index]}
                  disabled={!enabled}
                  onChange={(gain) => setBand(index, gain)}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <Modal
        open={dialogMode != null}
        onClose={closeDialog}
        size="sm"
        labelledBy="equalizer-preset-dialog-title"
      >
        <ModalHeader>
          <ModalTitle id="equalizer-preset-dialog-title">
            {dialogMode === "rename" ? "Rename preset" : "Save preset"}
          </ModalTitle>
        </ModalHeader>
        <ModalBody>
          <FormField label="Name">
            <TextInput
              value={presetName}
              autoFocus
              onChange={(event) => setPresetName(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitDialog();
                }
              }}
            />
          </FormField>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={closeDialog}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!presetName.trim()}
            onClick={submitDialog}
          >
            {dialogMode === "rename" ? "Rename" : "Save"}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
