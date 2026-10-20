import type { ReactNode } from "react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  fetchMusicBrainzEntity,
  getMusicBrainzEntity,
  peekMusicBrainzEntity,
  searchMusicBrainzEntities,
} from "../../lib/tauri";
import { parseUuidMbid } from "../../lib/mbid";
import {
  musicBrainzEntityUrl,
  musicBrainzHitFacts,
  musicBrainzHitTitle,
} from "../../lib/musicBrainzEntityDisplay";
import { useLibrarySettingsStore } from "../../store/useLibrarySettingsStore";
import type {
  MusicBrainzEntityHit,
  MusicBrainzEntityKind,
  MusicBrainzEntityLookup,
} from "../../types/musicbrainz";
import { AlertConfirmation } from "../common/AlertConfirmation/AlertConfirmation";
import { Button } from "../common/Button/Button";
import { Checkbox } from "../common/Checkbox/Checkbox";
import { FormField } from "../common/Field/Field";
import { TextInput } from "../common/TextInput/TextInput";
import {
  IconDownload,
  IconExternalLink,
  IconPencil,
  IconSearch,
} from "../icons";
import {
  MusicBrainzEntityCard,
  MusicBrainzEntityCardSkeleton,
} from "./MusicBrainzEntityCard";
import { MusicBrainzSearchPicker } from "./MusicBrainzSearchPicker";
import "./MusicBrainzEditorTab.css";

export type MusicBrainzEditorTabProps = {
  kind: MusicBrainzEntityKind;
  mbid: string;
  /** When true (bulk mixed IDs), skip lookup/Open but allow Search (assignable only). */
  mixed?: boolean;
  /** Overrides the kind-default placeholder (e.g. bulk mixed values). */
  placeholder?: string;
  /**
   * `assignable` — search / edit / Save & fetch (album, artist).
   * `derived` — read-only ID from album release (track / CD track).
   */
  assignment?: "assignable" | "derived";
  /**
   * Derived: album grouping has a shared release MBID (album-wide, not just
   * this track). When false, show Missing release even if a recording ID exists.
   */
  hasAlbumRelease?: boolean;
  /** Derived: track is connected to an album (has album title). */
  hasAlbum?: boolean;
  /** Derived: album title for empty-state copy. */
  albumTitle?: string;
  /** Derived: open album editor / release search when release is missing. */
  onSearchAlbumRelease?: () => void;
  /**
   * Derived empty recording: why we have no MBID yet.
   * `resolving` — checking cached release tracklist
   * `releaseCacheMiss` — album has a release ID but entity/tracklist not cached
   * `unmatched` — tracklist present, no disc/track slot match
   */
  derivedEmptyKind?: "resolving" | "releaseCacheMiss" | "unmatched";
  /** After a successful get/fetch that produced a card (assignable or Fetch). */
  onEntityLookup?: (lookup: MusicBrainzEntityLookup) => void;
  /** Assignable: open the search picker once on mount (then call onAutoOpenSearchConsumed). */
  autoOpenSearch?: boolean;
  onAutoOpenSearchConsumed?: () => void;
  /** Assignable only — ignored while `assignment="derived"`. */
  onMbidChange?: (value: string) => void;
  /** Album title (or artist name) used to search MusicBrainz when the picker opens. */
  searchQuery?: string;
  /** Artist filter for release/recording search. */
  searchArtist?: string;
};

type LookupState =
  | { status: "idle" }
  | { status: "loading"; mbid: string }
  | { status: "ready"; mbid: string; hit: MusicBrainzEntityHit }
  | { status: "cacheMiss"; mbid: string }
  | { status: "notFound"; mbid: string }
  | { status: "error"; mbid: string };

function fetchTitleKey(kind: MusicBrainzEntityKind): string {
  switch (kind) {
    case "release":
      return "editor.musicBrainz.fetchReleaseTitle";
    case "recording":
      return "editor.musicBrainz.fetchRecordingTitle";
    case "artist":
      return "editor.musicBrainz.fetchArtistTitle";
  }
}

function fetchDetailsKey(kind: MusicBrainzEntityKind): string {
  switch (kind) {
    case "release":
      return "editor.musicBrainz.fetchReleaseDetails";
    case "recording":
      return "editor.musicBrainz.fetchRecordingDetails";
    case "artist":
      return "editor.musicBrainz.fetchArtistDetails";
  }
}

function emptyTitleKey(kind: MusicBrainzEntityKind): string {
  switch (kind) {
    case "release":
      return "editor.musicBrainz.emptyRelease";
    case "recording":
      return "editor.musicBrainz.emptyRecording";
    case "artist":
      return "editor.musicBrainz.emptyArtist";
  }
}

function idPlaceholderKey(kind: MusicBrainzEntityKind): string {
  switch (kind) {
    case "release":
      return "editor.musicBrainz.idPlaceholderRelease";
    case "recording":
      return "editor.musicBrainz.idPlaceholderRecording";
    case "artist":
      return "editor.musicBrainz.idPlaceholderArtist";
  }
}

function searchForKey(kind: MusicBrainzEntityKind): string {
  switch (kind) {
    case "release":
      return "editor.musicBrainz.searchForRelease";
    case "recording":
      return "editor.musicBrainz.searchForRecording";
    case "artist":
      return "editor.musicBrainz.searchForArtist";
  }
}

function searchDifferentKey(kind: MusicBrainzEntityKind): string {
  switch (kind) {
    case "release":
      return "editor.musicBrainz.searchDifferentRelease";
    case "recording":
      return "editor.musicBrainz.searchDifferentRecording";
    case "artist":
      return "editor.musicBrainz.searchDifferentArtist";
  }
}

export function MusicBrainzEditorTab({
  kind,
  mbid,
  mixed = false,
  placeholder,
  assignment = "assignable",
  hasAlbumRelease = false,
  hasAlbum = false,
  albumTitle,
  onSearchAlbumRelease,
  derivedEmptyKind,
  onEntityLookup,
  autoOpenSearch = false,
  onAutoOpenSearchConsumed,
  onMbidChange,
  searchQuery = "",
  searchArtist,
}: MusicBrainzEditorTabProps) {
  const { t } = useTranslation(["library", "common"]);
  const derived = assignment === "derived";
  const confirmLinks =
    useLibrarySettingsStore(
      (s) => s.settings?.confirmMusicBrainzExternalLinks,
    ) ?? true;
  const saveLibrarySettings = useLibrarySettingsStore(
    (s) => s.saveLibrarySettings,
  );

  const [lookup, setLookup] = useState<LookupState>({ status: "idle" });
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchHits, setSearchHits] = useState<MusicBrainzEntityHit[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(mbid);
  /** Candidate ID while Save & fetch / Fetch is in flight. */
  const [pendingCommit, setPendingCommit] = useState<string | null>(null);
  const [idFieldError, setIdFieldError] = useState<
    "invalid" | "notFound" | "lookupError" | null
  >(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lookupGenRef = useRef(0);
  const searchGenRef = useRef(0);
  const skipCacheReadRef = useRef(false);
  const lookupBeforeCommitRef = useRef<LookupState>({ status: "idle" });
  const suppressBlurCancelRef = useRef(false);

  const parsedMbid = useMemo(
    () => (mixed && !mbid.trim() ? null : parseUuidMbid(mbid)),
    [mbid, mixed],
  );
  const canOpen = parsedMbid != null;
  const showMixed = mixed && !mbid.trim();
  const isEmpty = !showMixed && !mbid.trim();
  const idPlaceholder = derived
    ? t("editor.musicBrainz.idPlaceholderDerived")
    : (placeholder ?? t(idPlaceholderKey(kind)));
  const committing = pendingCommit != null;

  useEffect(() => {
    if (!editing && !committing) setDraft(mbid);
  }, [mbid, editing, committing]);

  // Cache-only read — never contacts MusicBrainz on open.
  // useLayoutEffect + memory peek avoids a loading flash when the parent warmed
  // the entity while another tab was visible.
  useLayoutEffect(() => {
    if (skipCacheReadRef.current) {
      skipCacheReadRef.current = false;
      return;
    }

    if (showMixed || parsedMbid == null) {
      lookupGenRef.current += 1;
      setLookup({ status: "idle" });
      return;
    }

    const mbidToLoad = parsedMbid;
    const peeked = peekMusicBrainzEntity(kind, mbidToLoad);
    if (peeked !== undefined) {
      lookupGenRef.current += 1;
      if (peeked == null) {
        setLookup({ status: "cacheMiss", mbid: mbidToLoad });
      } else {
        setLookup({
          status: "ready",
          mbid: mbidToLoad,
          hit: peeked.hit,
        });
        onEntityLookup?.(peeked);
      }
      return;
    }

    const gen = ++lookupGenRef.current;
    setLookup({ status: "loading", mbid: mbidToLoad });
    void getMusicBrainzEntity(kind, mbidToLoad)
      .then((lookupResult) => {
        if (gen !== lookupGenRef.current) return;
        if (lookupResult == null) {
          setLookup({ status: "cacheMiss", mbid: mbidToLoad });
        } else {
          setLookup({
            status: "ready",
            mbid: mbidToLoad,
            hit: lookupResult.hit,
          });
          onEntityLookup?.(lookupResult);
        }
      })
      .catch(() => {
        if (gen !== lookupGenRef.current) return;
        setLookup({ status: "cacheMiss", mbid: mbidToLoad });
      });
  }, [kind, showMixed, parsedMbid]);

  const openEntity = async () => {
    if (parsedMbid == null) return;
    await openUrl(musicBrainzEntityUrl(kind, parsedMbid));
  };

  const handleOpenClick = () => {
    if (!canOpen) return;
    if (confirmLinks) {
      setDontShowAgain(false);
      setConfirmOpen(true);
      return;
    }
    void openEntity();
  };

  const handleConfirmOpen = async () => {
    if (dontShowAgain) {
      await saveLibrarySettings({ confirmMusicBrainzExternalLinks: false });
    }
    await openEntity();
  };

  useEffect(() => {
    return () => {
      lookupGenRef.current += 1;
      searchGenRef.current += 1;
    };
  }, []);

  const closeSearch = () => {
    searchGenRef.current += 1;
    setSearchOpen(false);
    setSearchHits([]);
    setSearchError(null);
    setSearchBusy(false);
  };

  const runSearch = async (query: string, artist: string) => {
    const gen = ++searchGenRef.current;
    setSearchBusy(true);
    setSearchError(null);
    try {
      const hits = await searchMusicBrainzEntities(
        kind,
        query,
        kind === "artist" ? null : artist,
      );
      if (gen !== searchGenRef.current) return;
      setSearchHits(hits);
    } catch {
      if (gen !== searchGenRef.current) return;
      setSearchHits([]);
      setSearchError(t("library:editor.musicBrainz.searchError"));
    } finally {
      if (gen === searchGenRef.current) setSearchBusy(false);
    }
  };

  const handleSearchOpen = () => {
    if (derived) return;
    closeSearch();
    const q = searchQuery.trim();
    setSearchBusy(Boolean(q));
    setSearchOpen(true);
    if (q) {
      void runSearch(q, searchArtist?.trim() ?? "");
    }
  };

  useEffect(() => {
    closeSearch();
    // Drop in-flight results when the search subject changes.
  }, [kind, searchQuery, searchArtist]);

  useEffect(() => {
    if (!autoOpenSearch || derived) return;
    handleSearchOpen();
    onAutoOpenSearchConsumed?.();
    // Intentionally once when autoOpenSearch becomes true.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenSearch]);

  const startEdit = () => {
    if (derived || committing) return;
    setDraft(mbid);
    setIdFieldError(null);
    setEditing(true);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.select();
    });
  };

  const cancelEdit = () => {
    setDraft(mbid);
    setIdFieldError(null);
    setEditing(false);
  };

  const abortCommitAttempt = (
    attempted: string,
    error: "notFound" | "lookupError",
  ) => {
    suppressBlurCancelRef.current = true;
    setPendingCommit(null);
    setDraft(attempted);
    setIdFieldError(error);
    setLookup(lookupBeforeCommitRef.current);
    if (!derived) {
      setEditing(true);
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) {
          el.focus();
          el.select();
        }
        suppressBlurCancelRef.current = false;
      });
    } else {
      suppressBlurCancelRef.current = false;
    }
  };

  const runFetch = (nextMbid: string, assignToForm: boolean) => {
    setIdFieldError(null);
    setEditing(false);
    setPendingCommit(nextMbid);
    lookupBeforeCommitRef.current = lookup;
    const gen = ++lookupGenRef.current;
    setLookup({ status: "loading", mbid: nextMbid });

    void fetchMusicBrainzEntity(kind, nextMbid)
      .then((lookupResult) => {
        if (gen !== lookupGenRef.current) return;
        if (lookupResult == null) {
          abortCommitAttempt(nextMbid, "notFound");
          return;
        }
        setPendingCommit(null);
        setIdFieldError(null);
        skipCacheReadRef.current = true;
        if (assignToForm) {
          onMbidChange?.(nextMbid);
        }
        setLookup({
          status: "ready",
          mbid: nextMbid,
          hit: lookupResult.hit,
        });
        onEntityLookup?.(lookupResult);
      })
      .catch(() => {
        if (gen !== lookupGenRef.current) return;
        abortCommitAttempt(nextMbid, "lookupError");
      });
  };

  const commitEdit = () => {
    if (derived || committing) return;
    const next = draft.trim();

    if (!next) {
      setEditing(false);
      setIdFieldError(null);
      setPendingCommit(null);
      skipCacheReadRef.current = true;
      lookupGenRef.current += 1;
      setLookup({ status: "idle" });
      onMbidChange?.("");
      return;
    }

    const parsed = parseUuidMbid(next);
    if (parsed == null) {
      setIdFieldError("invalid");
      return;
    }

    runFetch(parsed, true);
  };

  const handleSelectHit = (hit: MusicBrainzEntityHit) => {
    closeSearch();
    runFetch(hit.mbid, true);
  };

  const handleFetchClick = () => {
    if (committing || parsedMbid == null) return;
    runFetch(parsedMbid, false);
  };

  const selectIdIfLocked = () => {
    if (editing || committing) return;
    const el = inputRef.current;
    if (!el || !el.value) return;
    el.select();
  };

  const handleIdGroupBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!editing || committing || suppressBlurCancelRef.current) return;
    const next = e.relatedTarget;
    if (next instanceof Node && e.currentTarget.contains(next)) {
      return;
    }
    cancelEdit();
  };

  const handleSaveMouseDown = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
  };

  const handleIdKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!editing) return;
    if (e.key === "Enter") {
      e.preventDefault();
      commitEdit();
    }
  };

  const viewButton = (
    <Button
      variant="secondary"
      size="sm"
      onClick={handleOpenClick}
      disabled={!canOpen}
    >
      <IconExternalLink aria-hidden />
      {t("library:editor.musicBrainz.viewOnMusicBrainz")}
    </Button>
  );

  const fetchButton = (
    <Button
      variant="secondary"
      size="sm"
      onClick={handleFetchClick}
      disabled={committing || parsedMbid == null}
    >
      <IconDownload aria-hidden />
      {committing
        ? t("library:editor.musicBrainz.loadingEntity")
        : t("library:editor.musicBrainz.fetch")}
    </Button>
  );

  const assignableSearchActions = (
    <>
      <Button variant="secondary" size="sm" onClick={handleSearchOpen}>
        <IconSearch aria-hidden />
        {t(searchDifferentKey(kind))}
      </Button>
      {viewButton}
    </>
  );

  const missingReleaseCard = !hasAlbum ? (
    <MusicBrainzEntityCard
      title={t("library:editor.musicBrainz.missingReleaseTitle")}
      details={t("library:editor.musicBrainz.missingReleaseNeedAlbum")}
    />
  ) : (
    <MusicBrainzEntityCard
      title={t("library:editor.musicBrainz.missingReleaseTitle")}
      details={t("library:editor.musicBrainz.missingReleaseAssignToAlbum", {
        album: albumTitle?.trim() || t("common:untitled"),
      })}
      actions={
        onSearchAlbumRelease != null ? (
          <Button variant="secondary" size="sm" onClick={onSearchAlbumRelease}>
            <IconSearch aria-hidden />
            {t("library:editor.musicBrainz.searchForRelease")}
          </Button>
        ) : null
      }
    />
  );

  let entityBody: ReactNode;
  if (showMixed) {
    entityBody = (
      <p className="musicbrainz-editor-tab__status">
        {t("library:editor.musicBrainz.mixedIds")}
      </p>
    );
  } else if (derived && !hasAlbumRelease && !committing) {
    // Recording may still be present (e.g. Picard import) — keep the locked ID
    // above, but steer the user to assign a release on the album.
    entityBody = missingReleaseCard;
  } else if (isEmpty && !committing) {
    if (derived) {
      if (derivedEmptyKind == null || derivedEmptyKind === "resolving") {
        entityBody = (
          <MusicBrainzEntityCardSkeleton
            aria-label={t("library:editor.musicBrainz.loadingEntity")}
          />
        );
      } else if (derivedEmptyKind === "releaseCacheMiss") {
        entityBody = (
          <MusicBrainzEntityCard
            title={t("library:editor.musicBrainz.fetchReleaseTitle")}
            details={t(
              "library:editor.musicBrainz.recordingNeedsReleaseFetchDetails",
            )}
            actions={
              onSearchAlbumRelease != null ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onSearchAlbumRelease}
                >
                  <IconSearch aria-hidden />
                  {t("library:editor.musicBrainz.openAlbumMusicBrainz")}
                </Button>
              ) : null
            }
          />
        );
      } else {
        // Unmatched slot (or default when hasAlbumRelease).
        entityBody = (
          <MusicBrainzEntityCard
            title={t("library:editor.musicBrainz.emptyRecordingUnmatchedTitle")}
            details={t(
              "library:editor.musicBrainz.emptyRecordingUnmatchedDetails",
            )}
          />
        );
      }
    } else {
      entityBody = (
        <MusicBrainzEntityCard
          title={t(emptyTitleKey(kind))}
          actions={
            <Button variant="secondary" size="sm" onClick={handleSearchOpen}>
              <IconSearch aria-hidden />
              {t(searchForKey(kind))}
            </Button>
          }
        />
      );
    }
  } else if (parsedMbid == null && !committing) {
    entityBody = (
      <>
        <p className="musicbrainz-editor-tab__status">
          {t("library:editor.musicBrainz.invalidId")}
        </p>
        {!derived ? (
          <div className="musicbrainz-editor-tab__entity-actions">
            {assignableSearchActions}
          </div>
        ) : null}
      </>
    );
  } else if (lookup.status === "loading" || lookup.status === "idle") {
    entityBody = (
      <>
        <MusicBrainzEntityCardSkeleton
          withActions={committing}
          aria-label={t("library:editor.musicBrainz.loadingEntity")}
        />
        {!committing ? (
          <div className="musicbrainz-editor-tab__entity-actions">
            {derived ? viewButton : assignableSearchActions}
          </div>
        ) : null}
      </>
    );
  } else if (lookup.status === "cacheMiss") {
    entityBody = (
      <MusicBrainzEntityCard
        title={t(fetchTitleKey(kind))}
        details={t(fetchDetailsKey(kind))}
        actions={
          <>
            {fetchButton}
            {viewButton}
            {!derived ? (
              <Button variant="secondary" size="sm" onClick={handleSearchOpen}>
                <IconSearch aria-hidden />
                {t(searchDifferentKey(kind))}
              </Button>
            ) : null}
          </>
        }
      />
    );
  } else if (lookup.status === "error") {
    entityBody = (
      <>
        <p className="musicbrainz-editor-tab__status" role="alert">
          {t("library:editor.musicBrainz.lookupError")}
        </p>
        <div className="musicbrainz-editor-tab__entity-actions">
          {fetchButton}
          {viewButton}
          {!derived ? (
            <Button variant="secondary" size="sm" onClick={handleSearchOpen}>
              <IconSearch aria-hidden />
              {t(searchDifferentKey(kind))}
            </Button>
          ) : null}
        </div>
      </>
    );
  } else if (lookup.status === "notFound") {
    entityBody = (
      <>
        <p className="musicbrainz-editor-tab__status">
          {t("library:editor.musicBrainz.notFound")}
        </p>
        <div className="musicbrainz-editor-tab__entity-actions">
          {derived ? viewButton : assignableSearchActions}
        </div>
      </>
    );
  } else {
    entityBody = (
      <MusicBrainzEntityCard
        title={musicBrainzHitTitle(lookup.hit)}
        facts={musicBrainzHitFacts(lookup.hit)}
        actions={derived ? viewButton : assignableSearchActions}
      />
    );
  }

  const confirmUrl =
    parsedMbid != null ? musicBrainzEntityUrl(kind, parsedMbid) : "";
  const checkboxId = useId();
  const displayValue = editing ? draft : (pendingCommit ?? mbid);
  const idLabel = t("library:editor.musicBrainz.idLabel");

  return (
    <div className="musicbrainz-editor-tab">
      {!(derived && isEmpty) ? (
        <FormField
          label={idLabel}
          descriptionPosition="below-label"
          error={
            idFieldError === "invalid"
              ? t("library:editor.musicBrainz.invalidId")
              : idFieldError === "notFound"
                ? t("library:editor.musicBrainz.notFound")
                : idFieldError === "lookupError"
                  ? t("library:editor.musicBrainz.lookupError")
                  : undefined
          }
        >
          {derived ? (
            <TextInput
              ref={inputRef}
              className="musicbrainz-editor-tab__id-input musicbrainz-editor-tab__id-input--derived"
              value={displayValue}
              placeholder={idPlaceholder}
              readOnly
              onFocus={selectIdIfLocked}
              onClick={selectIdIfLocked}
              spellCheck={false}
              autoComplete="off"
              aria-label={idLabel}
            />
          ) : (
            <div
              role="group"
              className={
                editing
                  ? "musicbrainz-editor-tab__id-group"
                  : "musicbrainz-editor-tab__id-group musicbrainz-editor-tab__id-group--locked"
              }
              aria-label={idLabel}
              onBlur={handleIdGroupBlur}
            >
              <TextInput
                ref={inputRef}
                className="musicbrainz-editor-tab__id-input"
                value={displayValue}
                placeholder={idPlaceholder}
                readOnly={!editing || committing}
                onChange={(e) => {
                  setIdFieldError(null);
                  setDraft(e.target.value);
                }}
                onFocus={selectIdIfLocked}
                onClick={selectIdIfLocked}
                onEscape={editing ? cancelEdit : undefined}
                onKeyDown={handleIdKeyDown}
                spellCheck={false}
                autoComplete="off"
                aria-label={idLabel}
                aria-invalid={idFieldError != null || undefined}
              />
              <Button
                variant="secondary"
                size="sm"
                disabled={committing}
                onMouseDown={editing ? handleSaveMouseDown : undefined}
                onClick={() => (editing ? commitEdit() : startEdit())}
                aria-label={
                  editing || committing
                    ? t("library:editor.musicBrainz.saveAria")
                    : t("library:editor.musicBrainz.editAria")
                }
              >
                {editing || committing ? (
                  <>
                    <IconDownload aria-hidden />
                    {committing
                      ? t("library:editor.musicBrainz.loadingEntity")
                      : t("library:editor.musicBrainz.save")}
                  </>
                ) : (
                  <>
                    <IconPencil aria-hidden />
                    {t("library:editor.musicBrainz.edit")}
                  </>
                )}
              </Button>
            </div>
          )}
        </FormField>
      ) : null}

      <div
        className="musicbrainz-editor-tab__assigned"
        aria-label={t("library:editor.musicBrainz.assignedAria")}
      >
        {entityBody}
      </div>

      <div className="musicbrainz-editor-tab__apply-slot" aria-hidden />

      {!derived ? (
        <MusicBrainzSearchPicker
          open={searchOpen}
          kind={kind}
          query={searchQuery}
          artist={searchArtist ?? ""}
          busy={searchBusy}
          hits={searchHits}
          error={searchError}
          onSelect={handleSelectHit}
          onClose={closeSearch}
        />
      ) : null}

      <AlertConfirmation
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t("library:editor.musicBrainz.openConfirmTitle")}
        confirmLabel={t("library:editor.musicBrainz.openConfirmAction")}
        confirmVariant="primary"
        onConfirm={() => void handleConfirmOpen()}
      >
        <p>{t("library:editor.musicBrainz.openConfirmBody")}</p>
        <p className="musicbrainz-editor-tab__confirm-url">{confirmUrl}</p>
        <Checkbox
          id={checkboxId}
          className="alert-confirmation__option"
          checked={dontShowAgain}
          onChange={(e) => setDontShowAgain(e.target.checked)}
        >
          {t("library:editor.musicBrainz.dontShowAgain")}
        </Checkbox>
      </AlertConfirmation>
    </div>
  );
}
