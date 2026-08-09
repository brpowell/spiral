import { useTranslation } from "react-i18next";
import type { LyricsSearchCandidate } from "../../types/lyrics";
import { formatLyricsFormatLabel } from "../../lib/lyrics";
import {
  formatLyricsDuration,
  lyricsCandidateDetails,
  lyricsCandidateDurationMeta,
  lyricsCandidateLabel,
  type LyricsLibraryTrackRef,
} from "../../lib/lyricsFetch";
import { Badge } from "../common/Badge/Badge";
import { ChoiceList, ChoiceOption } from "../common/ChoiceOption/ChoiceOption";
import { Separator } from "../common/Separator/Separator";
import {
  Modal,
  ModalBody,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalHeaderMain,
  ModalTitle,
} from "../common/Modal/Modal";
import "./LyricsCandidatePicker.css";

export type LyricsCandidatePickerProps = {
  open: boolean;
  candidates: LyricsSearchCandidate[];
  libraryTrack?: LyricsLibraryTrackRef | null;
  onSelect: (candidate: LyricsSearchCandidate) => void;
  /** Backdrop / Escape / X — leave remaining work intact when used from a queue. */
  onClose: () => void;
  /**
   * Footer "Skip for now". Defaults to `onClose` for single-item callers
   * (Track Editor, Now Playing).
   */
  onSkip?: () => void;
  /**
   * When reviewing multiple ambiguous tracks, show “Track N of M” in the header.
   * Omitted (or total ≤ 1) for solo Choose flows.
   */
  queuePosition?: { current: number; total: number };
};

function LibraryTrackCard({ track }: { track: LyricsLibraryTrackRef }) {
  const album = track.album.trim();
  const metaParts = [
    album || null,
    track.durationSeconds != null
      ? formatLyricsDuration(track.durationSeconds)
      : null,
  ].filter((part): part is string => Boolean(part));

  return (
    <div className="lyrics-candidate-picker__library-card">
      <p className="lyrics-candidate-picker__library-title">{track.title}</p>
      <p className="lyrics-candidate-picker__library-artist">
        {track.artist.trim() || "—"}
      </p>
      {metaParts.length > 0 ? (
        <>
          <Separator />
          <p className="lyrics-candidate-picker__library-meta">
            {metaParts.join(" · ")}
          </p>
        </>
      ) : null}
    </div>
  );
}

function candidateFormatBadge(candidate: LyricsSearchCandidate) {
  const format = candidate.lyrics.format;
  return (
    <Badge variant={format === "plain" ? "neutral" : "accent"}>
      {formatLyricsFormatLabel(format)}
    </Badge>
  );
}

export function LyricsCandidatePicker({
  open,
  candidates,
  libraryTrack,
  onSelect,
  onClose,
  onSkip,
  queuePosition,
}: LyricsCandidatePickerProps) {
  const { t } = useTranslation("library");
  const showQueueProgress = queuePosition != null && queuePosition.total > 1;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      panelClassName="lyrics-candidate-picker__panel"
      labelledBy="lyrics-candidate-title"
    >
      <ModalHeader>
        <ModalHeaderMain>
          <div className="lyrics-candidate-picker__title-row">
            <ModalTitle id="lyrics-candidate-title">
              {t("lyrics.candidatePicker.title")}
            </ModalTitle>
            {showQueueProgress ? (
              <Badge aria-live="polite">
                {t("lyrics.candidatePicker.queueProgress", {
                  current: queuePosition.current,
                  total: queuePosition.total,
                })}
              </Badge>
            ) : null}
          </div>
          <ModalDescription>
            {t("lyrics.candidatePicker.description")}
          </ModalDescription>
        </ModalHeaderMain>
      </ModalHeader>
      <ModalBody className="lyrics-candidate-picker__body">
        <div className="lyrics-candidate-picker__layout">
          {libraryTrack ? (
            <section
              className="lyrics-candidate-picker__library"
              aria-label={t("lyrics.candidatePicker.yourTrack")}
            >
              <h3 className="lyrics-candidate-picker__library-heading">
                {t("lyrics.candidatePicker.yourTrack")}
              </h3>
              <LibraryTrackCard track={libraryTrack} />
            </section>
          ) : null}

          <div className="lyrics-candidate-picker__results">
            <h3 className="lyrics-candidate-picker__results-heading">
              {t("lyrics.candidatePicker.results")}
            </h3>
            <ChoiceList className="lyrics-candidate-picker__list">
              {candidates.map((candidate) => (
                <li key={candidate.id}>
                  <ChoiceOption
                    title={lyricsCandidateLabel(candidate)}
                    details={lyricsCandidateDetails(candidate)}
                    meta={
                      <>
                        {candidateFormatBadge(candidate)}
                        {lyricsCandidateDurationMeta(
                          candidate,
                          libraryTrack?.durationSeconds,
                        )}
                      </>
                    }
                    onClick={() => onSelect(candidate)}
                  />
                </li>
              ))}
            </ChoiceList>
          </div>
        </div>
      </ModalBody>
      <ModalFooter
        onCancel={onSkip ?? onClose}
        cancelLabel={t("lyrics.candidatePicker.skip")}
      >
        {null}
      </ModalFooter>
    </Modal>
  );
}
