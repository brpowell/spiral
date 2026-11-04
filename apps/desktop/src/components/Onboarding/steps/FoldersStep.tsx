import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  countTracksBySource,
  describeSourceError,
} from "../../../lib/sourceAccess";
import {
  addSource,
  pickMusicFolder,
  removeSource,
  setImportSource,
} from "../../../lib/tauri";
import { useOnboardingStore } from "../../../store/useOnboardingStore";
import { usePlayerStore } from "../../../store/usePlayerStore";
import { useSourcesStore } from "../../../store/useSourcesStore";
import type { Source } from "../../../types/source";
import { Button } from "../../common/Button/Button";
import { IconPlus } from "../../icons";
import { SourceCard } from "../../PreferencesModal/SourceCard";
import { SourceEditFlow } from "../../PreferencesModal/SourceEditFlow";

/**
 * "It's already organized": add the root folders the user's music lives in.
 * Each becomes a source, played where it is and left unorganized. Lists every
 * folder source, so going Back and returning keeps what was added.
 *
 * Folders show as the same cards as in Preferences, actions in their menu.
 * Each opens the Edit music source dialog once added, so its organize
 * settings can be set (organizing starts off); Edit reopens it.
 *
 * Folders added here can be removed again. One that was already a source
 * (onboarding replayed) may carry playlists and history, so removing it is
 * left to Preferences, which confirms first.
 *
 * A new library's empty `Tracks` isn't listed: it only holds the place until
 * a folder is added here (see `settleFolders`).
 */
export function FoldersStep() {
  const { t } = useTranslation("common");
  const allSources = useSourcesStore((s) => s.sources);
  const placeholderSourceId = useOnboardingStore((s) => s.placeholderSourceId);
  const sources = useMemo(
    () => allSources.filter((source) => source.id !== placeholderSourceId),
    [allSources, placeholderSourceId],
  );
  const library = usePlayerStore((s) => s.library);
  const counts = useMemo(() => countTracksBySource(library), [library]);
  const addedSourceIds = useOnboardingStore((s) => s.addedSourceIds);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Source | null>(null);
  // The folder just added, whose dialog finishes adding it (Cancel undoes).
  const [addingId, setAddingId] = useState<number | null>(null);

  const add = async () => {
    if (adding) return;
    setAdding(true);
    setError(null);
    try {
      const folder = await pickMusicFolder();
      if (!folder) return;
      const source = await addSource(folder);
      useSourcesStore.getState().applySource(source);
      useOnboardingStore.getState().noteSourceAdded(source.id);
      setAddingId(source.id);
      setEditing(source);
    } catch (err) {
      setError(describeSourceError(err));
    } finally {
      setAdding(false);
    }
  };

  const makeDefault = async (source: Source) => {
    setError(null);
    try {
      await setImportSource(source.id);
      await useSourcesStore.getState().loadSources();
    } catch (err) {
      setError(describeSourceError(err));
    }
  };

  const remove = async (source: Source) => {
    if (removingId != null) return;
    setRemovingId(source.id);
    setError(null);
    try {
      // Its tracks leave the library; the files on disk stay.
      await removeSource(source.id);
      useOnboardingStore.getState().noteSourceRemoved(source.id);
      await useSourcesStore.getState().loadSources();
      await usePlayerStore.getState().loadLibrary({ preservePlayback: true });
    } catch (err) {
      setError(describeSourceError(err));
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="onboarding-folders">
      {sources.length > 0 ? (
        <ul
          className="sources-section__list onboarding-folders__list"
          aria-label={t("onboarding.folders.listAria")}
        >
          {sources.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              count={counts.get(source.id) ?? { total: 0, missing: 0 }}
              busy={removingId != null}
              onEdit={() => {
                setError(null);
                setAddingId(null);
                setEditing(source);
              }}
              onMakeDefault={() => void makeDefault(source)}
              onRemove={
                addedSourceIds.includes(source.id)
                  ? () => void remove(source)
                  : undefined
              }
            />
          ))}
        </ul>
      ) : null}
      <Button
        variant="outline"
        className="onboarding-folders__add"
        onClick={() => void add()}
        isLoading={adding}
        loadingLabel={t("onboarding.folders.adding")}
      >
        <IconPlus aria-hidden />
        {t("onboarding.folders.add")}
      </Button>
      {error ? (
        <p className="onboarding__error" role="alert">
          {error}
        </p>
      ) : null}
      <SourceEditFlow
        source={editing}
        onClose={() => setEditing(null)}
        onSaving={() => setError(null)}
        deferOrganize
        onCancelAdd={
          addingId != null ? (source) => void remove(source) : undefined
        }
      />
    </div>
  );
}
