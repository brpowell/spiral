import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import {
  coverArtThumbSrc,
  coverOptionMetaText,
  isCoverArtThumbReady,
} from "../../lib/coverArtThumbs";
import type { CoverArtCandidate } from "../../types/coverArt";
import {
  Modal,
  ModalBody,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalHeaderMain,
  ModalTitle,
} from "../common/Modal/Modal";
import "./AlbumArtPicker.css";

export type AlbumArtType = "front" | "portrait";

export const ART_TYPE_LABEL_KEY = {
  front: "editor.artTypes.front",
  portrait: "editor.artTypes.portrait",
} as const;

function CoverOptionMeta({ candidate }: { candidate: CoverArtCandidate }) {
  const meta = coverOptionMetaText(candidate);
  if (!meta) return null;
  return <span className="album-art-picker__meta">{meta}</span>;
}

function CoverThumb({ src, round }: { src: string; round?: boolean }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(() => isCoverArtThumbReady(src));

  useLayoutEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) setLoaded(true);
  }, [src]);

  return (
    <span
      className={
        round
          ? "album-art-picker__thumb album-art-picker__thumb--round"
          : "album-art-picker__thumb"
      }
    >
      <img
        ref={imgRef}
        src={src}
        alt=""
        className={loaded ? "is-loaded" : undefined}
        decoding="async"
        onLoad={() => setLoaded(true)}
      />
    </span>
  );
}

export type AlbumArtPickerProps = {
  open: boolean;
  artType: AlbumArtType;
  subtitle?: string;
  candidates: CoverArtCandidate[];
  selectedUrl: string | null;
  fetching: boolean;
  fetchMessage: string | null;
  onSelect: (url: string) => void;
  onClose: () => void;
};

export function AlbumArtPicker({
  open,
  artType,
  subtitle,
  candidates,
  selectedUrl,
  fetching,
  fetchMessage,
  onSelect,
  onClose,
}: AlbumArtPickerProps) {
  const { t } = useTranslation("library");
  const panelRef = useRef<HTMLDivElement>(null);
  const typeLabel = t(ART_TYPE_LABEL_KEY[artType]);

  useFocusTrap(panelRef, open);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      panelClassName="album-art-picker__panel"
      panelRef={panelRef}
      labelledBy="album-art-picker-title"
    >
      <ModalHeader fade>
        <ModalHeaderMain>
          <ModalTitle id="album-art-picker-title">
            {t("editor.artPicker.title", { type: typeLabel })}
          </ModalTitle>
          {subtitle ? <ModalDescription>{subtitle}</ModalDescription> : null}
        </ModalHeaderMain>
      </ModalHeader>

      <ModalBody className="album-art-picker__body">
        {fetching ? (
          <div
            className="album-art-picker__status"
            role="status"
            aria-live="polite"
          >
            <span className="album-art-picker__spinner" aria-hidden />
            <span>{t("editor.fetchingArtStatus")}</span>
          </div>
        ) : fetchMessage ? (
          <p className="album-art-picker__status" role="status">
            {fetchMessage}
          </p>
        ) : (
          <ul
            className="album-art-picker__grid"
            aria-label={t("editor.artPicker.optionsAria", { type: typeLabel })}
          >
            {candidates.map((candidate) => {
              const thumbSrc = coverArtThumbSrc(candidate);
              const selected = selectedUrl === candidate.url;

              return (
                <li key={candidate.url}>
                  <button
                    type="button"
                    className={
                      selected
                        ? "album-art-picker__option album-art-picker__option--selected"
                        : "album-art-picker__option"
                    }
                    onClick={() => onSelect(candidate.url)}
                    aria-pressed={selected}
                  >
                    <CoverThumb src={thumbSrc} round={artType === "portrait"} />
                    <CoverOptionMeta candidate={candidate} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </ModalBody>

      <ModalFooter fade onCancel={onClose}>
        {null}
      </ModalFooter>
    </Modal>
  );
}
