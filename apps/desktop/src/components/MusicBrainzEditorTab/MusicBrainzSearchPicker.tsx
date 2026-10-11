import { useTranslation } from "react-i18next";
import {
  musicBrainzHitFacts,
  musicBrainzHitTitle,
} from "../../lib/musicBrainzEntityDisplay";
import type {
  MusicBrainzEntityHit,
  MusicBrainzEntityKind,
} from "../../types/musicbrainz";
import { ChoiceList } from "../common/ChoiceOption/ChoiceOption";
import {
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalDescription,
  ModalHeader,
  ModalHeaderMain,
  ModalTitle,
} from "../common/Modal/Modal";
import {
  MusicBrainzEntityCard,
  MusicBrainzEntityCardSkeleton,
} from "./MusicBrainzEntityCard";
import "./MusicBrainzSearchPicker.css";

const SKELETON_HIT_COUNT = 5;

export type MusicBrainzSearchPickerProps = {
  open: boolean;
  kind: MusicBrainzEntityKind;
  query: string;
  artist: string;
  busy: boolean;
  hits: MusicBrainzEntityHit[];
  error: string | null;
  onSelect: (hit: MusicBrainzEntityHit) => void;
  onClose: () => void;
};

function searchTitleKey(kind: MusicBrainzEntityKind): string {
  switch (kind) {
    case "release":
      return "editor.musicBrainz.searchTitleRelease";
    case "recording":
      return "editor.musicBrainz.searchTitleRecording";
    case "artist":
      return "editor.musicBrainz.searchTitleArtist";
  }
}

export function MusicBrainzSearchPicker({
  open,
  kind,
  query,
  artist,
  busy,
  hits,
  error,
  onSelect,
  onClose,
}: MusicBrainzSearchPickerProps) {
  const { t } = useTranslation(["library", "common"]);
  const subject =
    query.trim() ||
    (kind === "release"
      ? t("common:unknownAlbum")
      : kind === "artist"
        ? t("common:unknownArtist")
        : t("common:untitled"));
  const artistName = artist.trim();
  const description =
    kind !== "artist" && artistName
      ? t("library:editor.musicBrainz.searchDescription", {
          query: subject,
          artist: artistName,
        })
      : subject;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      panelClassName="musicbrainz-search-picker"
      labelledBy="musicbrainz-search-title"
    >
      <ModalHeader fade>
        <ModalHeaderMain>
          <ModalTitle id="musicbrainz-search-title">
            {t(searchTitleKey(kind))}
          </ModalTitle>
          <ModalDescription>{description}</ModalDescription>
        </ModalHeaderMain>
        <ModalCloseButton onClick={onClose} />
      </ModalHeader>
      <ModalBody className="musicbrainz-search-picker__body">
        {error ? (
          <p className="musicbrainz-search-picker__error" role="alert">
            {error}
          </p>
        ) : null}

        {busy ? (
          <div
            role="status"
            aria-busy="true"
            aria-label={t("library:editor.musicBrainz.searching")}
          >
            <ChoiceList>
              {Array.from({ length: SKELETON_HIT_COUNT }, (_, index) => (
                <li key={index}>
                  <MusicBrainzEntityCardSkeleton selectable />
                </li>
              ))}
            </ChoiceList>
          </div>
        ) : null}

        {!busy && !error && hits.length === 0 ? (
          <p className="musicbrainz-search-picker__empty">
            {t("library:editor.musicBrainz.searchNoResults")}
          </p>
        ) : null}

        {!busy && hits.length > 0 ? (
          <ChoiceList>
            {hits.map((hit) => (
              <li key={hit.mbid}>
                <MusicBrainzEntityCard
                  title={musicBrainzHitTitle(hit)}
                  facts={musicBrainzHitFacts(hit)}
                  onClick={() => onSelect(hit)}
                />
              </li>
            ))}
          </ChoiceList>
        ) : null}
      </ModalBody>
    </Modal>
  );
}
