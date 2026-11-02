import { useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { stopPlaybackForLibraryRelocate } from "../../../lib/libraryRelocatePlayback";
import { describeSourceError } from "../../../lib/sourceAccess";
import {
  addSource,
  getLibrary,
  inspectLibraryDestination,
  pickLibraryFolder,
  pickMusicFolder,
  relocateLibrary,
  rescanSource,
  setSourceOrganize,
} from "../../../lib/tauri";
import { useArtistImageStore } from "../../../store/useArtistImageStore";
import { useLibrarySettingsStore } from "../../../store/useLibrarySettingsStore";
import { usePlayerStore } from "../../../store/usePlayerStore";
import { usePlaylistStore } from "../../../store/usePlaylistStore";
import { useSourcesStore } from "../../../store/useSourcesStore";
import type {
  LibraryDestinationInfo,
  LibraryRelocateMode,
} from "../../../types/library";
import type { Source } from "../../../types/source";
import { LibraryRelocateDialog } from "../../PreferencesModal/LibraryRelocateDialog";
import {
  OrganizePreviewDialog,
  type OrganizeRequest,
} from "../../PreferencesModal/OrganizePreviewDialog";
import { Button } from "../../common/Button/Button";
import { Switch } from "../../common/Switch/Switch";
import { IconOpenFolder } from "../../icons";

/** Splits `/Users/me/Music/Spiral Library` into its parent folder and final name. */
function splitLibraryPath(path: string): { parent: string; name: string } {
  const trimmed = path.replace(/[\\/]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (cut < 0) return { parent: "", name: trimmed };
  return { parent: trimmed.slice(0, cut + 1), name: trimmed.slice(cut + 1) };
}

/**
 * A first-time user's Spiral folder already exists (the app creates it at
 * launch) but is empty, so asking "move or start fresh?" would imply they had
 * one. Pick the obvious mode for them instead: use an existing Spiral folder
 * there, import music found there, or just move the empty one.
 */
function firstRunMode(info: LibraryDestinationInfo): LibraryRelocateMode {
  if (info.hasDatabase) return "switch";
  return info.audioFileCount > 0 ? "freshImport" : "move";
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Pick where the Spiral folder lives. Mirrors Preferences → Library → Spiral folder. */
export function LibraryStep() {
  const { t } = useTranslation(["common", "preferences"]);
  const settings = useLibrarySettingsStore((s) => s.settings);
  const applyLibrarySettings = useLibrarySettingsStore(
    (s) => s.applyLibrarySettings,
  );
  const [info, setInfo] = useState<LibraryDestinationInfo | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choosingRef = useRef(false);
  const libraryRoot = settings?.libraryRoot ?? "";
  const { parent, name } = splitLibraryPath(libraryRoot);

  const choose = async () => {
    if (choosingRef.current || busy) return;
    choosingRef.current = true;
    setChoosing(true);
    setError(null);
    try {
      const folder = await pickLibraryFolder(settings?.libraryRoot);
      if (!folder || folder === settings?.libraryRoot) return;
      const inspected = await inspectLibraryDestination(folder);
      if (inspected.blockedReason) {
        setError(inspected.blockedReason);
        return;
      }
      if ((await getLibrary()).length === 0) {
        await relocate(inspected, firstRunMode(inspected));
      } else {
        // Existing library (e.g. replaying onboarding): confirm like Preferences.
        setInfo(inspected);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      choosingRef.current = false;
      setChoosing(false);
    }
  };

  const relocate = async (
    target: LibraryDestinationInfo,
    mode: LibraryRelocateMode,
  ) => {
    setBusy(true);
    setError(null);
    try {
      // Same guard as Preferences: audio must not keep reading the old library.
      stopPlaybackForLibraryRelocate();
      applyLibrarySettings(await relocateLibrary(target.path, mode));
      setInfo(null);
      try {
        await usePlayerStore.getState().loadLibrary();
        await usePlaylistStore.getState().loadPlaylists();
        await useArtistImageStore.getState().loadArtistImages();
        await useSourcesStore.getState().loadSources();
      } catch (err) {
        setError(
          t("preferences:library.reloadFailed", { message: errorMessage(err) }),
        );
      }
    } catch (err) {
      setError(errorMessage(err));
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (mode: LibraryRelocateMode) => {
    if (info) await relocate(info, mode);
  };

  return (
    <>
      <div className="onboarding-path" title={libraryRoot}>
        <span className="onboarding-path__icon" aria-hidden="true">
          <IconOpenFolder width={28} height={28} />
        </span>
        <span
          className="onboarding-path__text"
          role="textbox"
          aria-readonly="true"
          aria-label={t("common:onboarding.library.pathAria")}
        >
          {parent ? (
            <span className="onboarding-path__parent">{parent}</span>
          ) : null}
          <span className="onboarding-path__name">{name}</span>
        </span>
      </div>
      <Button
        variant="outline"
        onClick={() => void choose()}
        disabled={!settings || busy}
        isLoading={choosing}
      >
        {t("common:onboarding.library.change")}
      </Button>
      {error ? (
        <p className="onboarding__error" role="alert">
          {error}
        </p>
      ) : null}

      <MusicFolderChoice disabled={!settings || busy || choosing} />

      <LibraryRelocateDialog
        open={info != null}
        title={
          info?.hasDatabase
            ? t("preferences:relocate.switchTitle")
            : info && info.audioFileCount > 0
              ? t("preferences:relocate.changeTitle")
              : t("preferences:relocate.moveTitle")
        }
        primary={
          info?.hasDatabase
            ? { label: t("preferences:relocate.switchPrimary"), mode: "switch" }
            : { label: t("preferences:relocate.movePrimary"), mode: "move" }
        }
        secondary={
          info?.hasDatabase
            ? undefined
            : info && info.audioFileCount > 0
              ? {
                  label: t("preferences:relocate.importFound", {
                    count: info.audioFileCount,
                  }),
                  mode: "freshImport",
                }
              : {
                  label: t("preferences:relocate.freshPrimary"),
                  mode: "fresh",
                }
        }
        busy={busy}
        onClose={() => {
          if (!busy) setInfo(null);
        }}
        onConfirm={confirm}
      >
        {info?.hasDatabase ? (
          <p>{t("preferences:relocate.hasDatabase")}</p>
        ) : info && info.audioFileCount > 0 ? (
          <p>
            <Trans
              i18nKey="relocate.foundFiles"
              ns="preferences"
              count={info.audioFileCount}
              values={{ count: info.audioFileCount, path: info.path }}
              components={{ code: <code /> }}
            />
          </p>
        ) : (
          <p>{t("preferences:relocate.empty")}</p>
        )}
      </LibraryRelocateDialog>
    </>
  );
}

/**
 * "I already have a music folder": add it as a source, played where it is.
 * Then ask whether Spiral should organize it; off by default, and turning it
 * on goes through the organize preview. Optional; Next skips it.
 */
function MusicFolderChoice({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation("common");
  const sourcesById = useSourcesStore((s) => s.sourcesById);
  const [added, setAdded] = useState<Source[]>([]);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [organizing, setOrganizing] = useState<OrganizeRequest | null>(null);

  const add = async () => {
    if (adding) return;
    setAdding(true);
    setError(null);
    try {
      const folder = await pickMusicFolder();
      if (!folder) return;
      const source = await addSource(folder);
      useSourcesStore.getState().applySource(source);
      setAdded((prev) => [...prev, source]);
    } catch (err) {
      setError(describeSourceError(err));
    } finally {
      setAdding(false);
    }
  };

  const toggleOrganize = async (source: Source, on: boolean) => {
    if (busyId != null) return;
    setBusyId(source.id);
    setError(null);
    try {
      if (on) {
        // The folder was just added; finish scanning it so the preview sees every file.
        await rescanSource(source.id);
        setOrganizing({ source });
      } else {
        useSourcesStore
          .getState()
          .applySource(await setSourceOrganize(source.id, false));
      }
    } catch (err) {
      setError(describeSourceError(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="onboarding-music-folder">
      <h2 className="onboarding-music-folder__title">
        {t("onboarding.library.musicFolderTitle")}
      </h2>
      <p className="onboarding-music-folder__description">
        {t("onboarding.library.musicFolderDescription")}
      </p>
      {added.map((source) => {
        const current = sourcesById.get(source.id) ?? source;
        const path = current.rootPath ?? "";
        return (
          <div key={source.id} className="onboarding-music-folder__source">
            <p className="onboarding-music-folder__added" role="status">
              {t("onboarding.library.musicFolderAdded", { path })}
            </p>
            <Switch
              alignStart
              checked={current.autoOrganize}
              disabled={disabled || busyId != null}
              onChange={(e) => void toggleOrganize(current, e.target.checked)}
            >
              <span className="onboarding-music-folder__organize">
                <span>{t("onboarding.library.organizeAsk")}</span>
                <span className="onboarding-music-folder__description">
                  {t("onboarding.library.organizeAskDescription")}
                </span>
              </span>
            </Switch>
          </div>
        );
      })}
      <Button
        variant="outline"
        onClick={() => void add()}
        disabled={disabled}
        isLoading={adding}
      >
        {added.length > 0
          ? t("onboarding.library.musicFolderAnother")
          : t("onboarding.library.musicFolderPick")}
      </Button>
      {error ? (
        <p className="onboarding__error" role="alert">
          {error}
        </p>
      ) : null}
      <OrganizePreviewDialog
        request={organizing}
        onClose={() => setOrganizing(null)}
        onApplied={() => useSourcesStore.getState().loadSources()}
      />
    </section>
  );
}
