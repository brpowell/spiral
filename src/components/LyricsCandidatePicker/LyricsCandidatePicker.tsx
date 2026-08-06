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
  onClose: () => void;
};

function LibraryTrackFields({ track }: { track: LyricsLibraryTrackRef }) {
  return (
    <dl className="lyrics-candidate-picker__library-fields">
      <div>
        <dt className="lyrics-candidate-picker__field-label">Title</dt>
        <dd className="lyrics-candidate-picker__field-value">{track.title}</dd>
      </div>
      <div>
        <dt className="lyrics-candidate-picker__field-label">Artist</dt>
        <dd className="lyrics-candidate-picker__field-value">
          {track.artist.trim() || "—"}
        </dd>
      </div>
      <div>
        <dt className="lyrics-candidate-picker__field-label">Album</dt>
        <dd className="lyrics-candidate-picker__field-value">
          {track.album.trim() || "—"}
        </dd>
      </div>
      {track.durationSeconds != null ? (
        <div>
          <dt className="lyrics-candidate-picker__field-label">Duration</dt>
          <dd className="lyrics-candidate-picker__field-value">
            {formatLyricsDuration(track.durationSeconds)}
          </dd>
        </div>
      ) : null}
    </dl>
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
}: LyricsCandidatePickerProps) {
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
          <ModalTitle id="lyrics-candidate-title">Match lyrics</ModalTitle>
          <ModalDescription>
            Multiple LRCLIB results matched this track. Choose the correct
            lyrics to use.
          </ModalDescription>
        </ModalHeaderMain>
      </ModalHeader>
      <ModalBody className="lyrics-candidate-picker__body">
        <div className="lyrics-candidate-picker__layout">
          {libraryTrack ? (
            <section
              className="lyrics-candidate-picker__library"
              aria-label="Your track"
            >
              <h3 className="lyrics-candidate-picker__library-heading">
                Your track
              </h3>
              <LibraryTrackFields track={libraryTrack} />
            </section>
          ) : null}

          <div className="lyrics-candidate-picker__results">
            <h3 className="lyrics-candidate-picker__results-heading">
              Results
            </h3>
            <ul className="lyrics-candidate-picker__list">
              {candidates.map((candidate) => (
                <li key={candidate.id}>
                  <button
                    type="button"
                    className="lyrics-candidate-picker__option"
                    onClick={() => onSelect(candidate)}
                  >
                    <span className="lyrics-candidate-picker__option-main">
                      <span className="lyrics-candidate-picker__option-title">
                        {lyricsCandidateLabel(candidate)}
                      </span>
                      <span className="lyrics-candidate-picker__option-details">
                        {lyricsCandidateDetails(candidate)}
                      </span>
                    </span>
                    <span className="lyrics-candidate-picker__option-meta">
                      {candidateFormatBadge(candidate)}
                      <span className="lyrics-candidate-picker__option-duration">
                        {lyricsCandidateDurationMeta(
                          candidate,
                          libraryTrack?.durationSeconds,
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </ModalBody>
      <ModalFooter onCancel={onClose} cancelLabel="Skip for now">
        {null}
      </ModalFooter>
    </Modal>
  );
}
