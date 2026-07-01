import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import {
  formatSourceEncodingProfileLabel,
  loadConvertProfileOptions,
  type EncodingProfileId,
  type EncodingProfileSelectOption,
} from "../../lib/encodingProfiles";
import type { ConvertMode } from "../../lib/convertTracks";
import { useConvertStore } from "../../store/useConvertStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { Button } from "../common/Button/Button";
import {
  Field,
  FieldLabel,
  FormField,
} from "../common/Field/Field";
import {
  Modal,
  ModalBody,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalHeaderMain,
  ModalTitle,
} from "../common/Modal/Modal";
import { RadioGroup, RadioGroupItem } from "../common/RadioGroup/RadioGroup";
import { Select } from "../common/Select/Select";
import "./ConvertConfirmModal.css";

function formatTrackSummary(
  title: string,
  artist: string | null,
  album: string | null,
): string {
  const artistAlbum = [artist, album].filter(Boolean).join(" · ");
  return artistAlbum ? `${title} — ${artistAlbum}` : title;
}

export function ConvertConfirmModal() {
  const prompt = useConvertStore((state) => state.prompt);
  const confirmConvert = useConvertStore((state) => state.confirmConvert);
  const cancelConvert = useConvertStore((state) => state.cancelConvert);
  const library = usePlayerStore((state) => state.library);

  const titleId = useId();
  const outcomeLabelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const submittingRef = useRef(false);

  const tracks = useMemo(() => {
    if (!prompt) return [];
    return prompt.trackIds
      .map((id) => library.find((track) => track.id === id))
      .filter((track): track is NonNullable<typeof track> => track != null);
  }, [library, prompt]);

  const sampleTrack = tracks[0] ?? null;

  const sourcePaths = useMemo(
    () => tracks.map((track) => track.filePath),
    [tracks],
  );

  const [profileOptions, setProfileOptions] = useState<
    EncodingProfileSelectOption[]
  >([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profileId, setProfileId] = useState<EncodingProfileId>("apple-aac");
  const [sourceProfileId, setSourceProfileId] = useState<string | null>(null);
  const [mode, setMode] = useState<ConvertMode>("add_new");

  const open = prompt != null;
  const promptKey = prompt?.trackIds.join(",") ?? "";

  useFocusTrap(panelRef, open);

  useEffect(() => {
    if (!open || sourcePaths.length === 0) return;

    let cancelled = false;
    submittingRef.current = false;
    setMode("add_new");
    setProfilesLoading(true);
    setProfileOptions([]);
    setSourceProfileId(null);

    void loadConvertProfileOptions(sourcePaths)
      .then((result) => {
        if (cancelled) return;
        setProfileOptions(result.profileOptions);
        setSourceProfileId(result.sourceProfileId);
        if (result.defaultProfileId) {
          setProfileId(result.defaultProfileId);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setProfilesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, promptKey, sourcePaths]);

  useEffect(() => {
    if (!open || profileOptions.length === 0) return;
    if (profileOptions.some((option) => option.value === profileId)) return;
    setProfileId(profileOptions[0]?.value as EncodingProfileId);
  }, [open, profileId, profileOptions]);

  const handleConfirm = useCallback(async () => {
    if (submittingRef.current || !open) return;
    submittingRef.current = true;
    try {
      await confirmConvert({ profileId, mode });
    } catch (err) {
      console.error("confirmConvert failed:", err);
      submittingRef.current = false;
    }
  }, [confirmConvert, mode, open, profileId]);

  const handleCancel = useCallback(() => {
    if (submittingRef.current) return;
    cancelConvert();
  }, [cancelConvert]);

  const trackCount = tracks.length;
  const sourceFormatLabel =
    sampleTrack != null
      ? formatSourceEncodingProfileLabel({
          sourceProfileId,
          codec: sampleTrack.codec,
        })
      : null;

  return (
    <Modal
      open={open}
      onClose={handleCancel}
      size="xl"
      panelRef={panelRef}
      labelledBy={titleId}
    >
      <ModalHeader>
        <ModalHeaderMain>
          <ModalTitle id={titleId}>
            {trackCount === 1 ? "Convert track" : `Convert ${trackCount} tracks`}
          </ModalTitle>
          {sampleTrack != null ? (
            <ModalDescription>
              {trackCount === 1
                ? formatTrackSummary(
                  sampleTrack.title,
                  sampleTrack.artist,
                  sampleTrack.album,
                )
                : `${trackCount} selected tracks will be transcoded.`}
              {sourceFormatLabel != null ? (
                <>
                  {" "}
                  <span className="convert-confirm-modal__source-format">
                    Current format: {sourceFormatLabel}
                  </span>
                </>
              ) : null}
            </ModalDescription>
          ) : null}
        </ModalHeaderMain>
      </ModalHeader>

      {sampleTrack != null && (
        <ModalBody>
          <FormField
            label="Convert to"
            className="convert-confirm-modal__profile-field"
          >
            <Select
              value={profileId}
              onChange={setProfileId}
              options={profileOptions}
              disabled={profilesLoading || profileOptions.length === 0}
              aria-label="Convert encoding profile"
            />
          </FormField>

          <FormField
            label="Library outcome"
            labelId={outcomeLabelId}
            description="Both options preserve track metadata and playlist entries."
            descriptionPosition="below-control"
            className="convert-confirm-modal__outcome"
          >
            <RadioGroup
              name="convert-mode"
              value={mode}
              onChange={setMode}
              orientation="vertical"
              aria-labelledby={outcomeLabelId}
            >
              <Field orientation="horizontal">
                <RadioGroupItem value="add_new" id="convert-mode-add-new" />
                <FieldLabel htmlFor="convert-mode-add-new">
                  Add as new tracks
                </FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <RadioGroupItem value="replace" id="convert-mode-replace" />
                <FieldLabel htmlFor="convert-mode-replace">
                  Replace existing with new versions
                </FieldLabel>
              </Field>
            </RadioGroup>
          </FormField>
        </ModalBody>
      )}

      <ModalFooter onCancel={handleCancel}>
        <Button
          variant={mode === "replace" ? "danger" : "primary"}
          onClick={() => void handleConfirm()}
          disabled={profilesLoading || profileOptions.length === 0}
        >
          {mode === "replace" ? "Convert & Replace" : "Convert & Add"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
