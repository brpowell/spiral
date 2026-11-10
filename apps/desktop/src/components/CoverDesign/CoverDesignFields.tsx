import { useRef, type CSSProperties } from "react";
import { Button } from "@/components/common/Button/Button";
import { cssColorToHex } from "@/components/common/ColorField/ColorField";
import { IconClose, IconShuffle } from "@/components/icons";
import { PlaylistIconPicker } from "@/components/PlaylistEditorModal/PlaylistIconPicker";
import { t } from "@/lib/i18n/i18n";
import {
  DEFAULT_PLAYLIST_COVER_GRADIENT_END,
  defaultPlaylistDesignCover,
  randomPlaylistCoverColors,
} from "@/lib/playlists/playlistCoverPresets";
import "./CoverDesignFields.css";

/** A designed cover: solid or gradient background plus an icon. */
export interface CoverDesignValue {
  background: string;
  backgroundEnd: string | null;
  icon: string;
}

function CoverColorButton({
  value,
  label,
  onChange,
}: {
  value: string;
  label: string;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const openPicker = () => {
    const input = inputRef.current;
    if (!input) return;
    try {
      input.showPicker();
    } catch {
      input.click();
    }
  };

  return (
    <span className="cover-design__swatch-hit">
      <Button
        variant="secondary"
        className="cover-design__swatch"
        style={
          {
            "--btn-face": value,
            "--btn-face-hover": value,
          } as CSSProperties
        }
        aria-label={label}
        onClick={openPicker}
      />
      <input
        ref={inputRef}
        type="color"
        className="cover-design__swatch-input"
        value={value}
        tabIndex={-1}
        aria-hidden
        onChange={(e) => onChange(e.target.value)}
      />
    </span>
  );
}

interface CoverDesignFieldsProps extends CoverDesignValue {
  onChange: (design: CoverDesignValue) => void;
  inert?: boolean;
}

/**
 * Colour and icon controls for a designed cover. Shared by the playlist and
 * genre editors; callers own the state and draw their own preview.
 */
export function CoverDesignFields({
  background,
  backgroundEnd,
  icon,
  onChange,
  inert,
}: CoverDesignFieldsProps) {
  const pickerBackground =
    cssColorToHex(background) ?? defaultPlaylistDesignCover().coverBackground;
  const pickerBackgroundEnd =
    cssColorToHex(backgroundEnd ?? "") ?? DEFAULT_PLAYLIST_COVER_GRADIENT_END;

  const update = (patch: Partial<CoverDesignValue>) =>
    onChange({ background, backgroundEnd, icon, ...patch });

  return (
    <div className="cover-design" inert={inert}>
      <div className="cover-design__colors">
        <label className="cover-design__color-picker">
          <span className="cover-design__color-picker-label">
            {t("library:editor.playlist.colorStart")}
          </span>
          <CoverColorButton
            value={pickerBackground}
            label={t("library:editor.playlist.colorStart")}
            onChange={(value) => update({ background: value })}
          />
        </label>
        {backgroundEnd ? (
          <Button
            variant="secondary"
            size="sm"
            iconOnly
            className="cover-design__color-action"
            aria-label={t("library:editor.playlist.swapColors")}
            onClick={() =>
              update({ background: backgroundEnd, backgroundEnd: background })
            }
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="m16 3 4 4-4 4" />
              <path d="M20 7H4" />
              <path d="m8 21-4-4 4-4" />
              <path d="M4 17h16" />
            </svg>
          </Button>
        ) : null}
        <div className="cover-design__color-picker">
          <span className="cover-design__color-picker-label">
            {t("library:editor.playlist.colorEnd")}
          </span>
          {backgroundEnd ? (
            <span className="cover-design__color-swatch">
              <CoverColorButton
                value={pickerBackgroundEnd}
                label={t("library:editor.playlist.colorEnd")}
                onChange={(value) => update({ backgroundEnd: value })}
              />
              <button
                type="button"
                className="cover-design__color-clear"
                aria-label={t("library:editor.playlist.clearSecondColor")}
                onClick={() => update({ backgroundEnd: null })}
              >
                <IconClose />
              </button>
            </span>
          ) : (
            <Button
              variant="secondary"
              className="cover-design__swatch cover-design__color-add"
              aria-label={t("library:editor.playlist.addSecondColor")}
              onClick={() =>
                update({ backgroundEnd: DEFAULT_PLAYLIST_COVER_GRADIENT_END })
              }
            >
              +
            </Button>
          )}
        </div>
        <Button
          variant="secondary"
          size="sm"
          iconOnly
          className="cover-design__color-action"
          aria-label={t("library:editor.playlist.randomizeColors")}
          onClick={() => {
            const next = randomPlaylistCoverColors(backgroundEnd != null, {
              background,
              backgroundEnd,
            });
            update({
              background: next.coverBackground,
              backgroundEnd: next.coverBackgroundEnd,
            });
          }}
        >
          <IconShuffle aria-hidden />
        </Button>
      </div>
      <PlaylistIconPicker
        value={icon}
        onChange={(value) => update({ icon: value })}
      />
    </div>
  );
}
