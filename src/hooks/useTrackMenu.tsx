import { useCallback, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ContextMenu,
  ContextMenuHeading,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSubmenu,
} from "../components/ContextMenu/ContextMenu";
import { ContextMenuRatingItem } from "../components/ContextMenu/ContextMenuRatingItem";
import { RemoveTrackDialog } from "../components/RemoveTrackDialog/RemoveTrackDialog";
import {
  IconAddToQueue,
  IconAlbums,
  IconArtists,
  IconConvert,
  IconDelete,
  IconEditInfo, IconOpenFolder,
  IconPlaylistAdd,
  IconPlaylists,
  IconRemoveFromPlaylist,
  IconRemoveFromQueue
} from "../components/icons";
import { applyTrackRating } from "../lib/applyTrackRating";
import { revealInFileManagerLabel } from "../lib/fileManager";
import type { CanonicalRating } from "../lib/trackRating";
import { revealPathInFileManager } from "../lib/tauri";
import { openConvertForTrackIds } from "../lib/convertTracks";
import { isTrackConvertible } from "../lib/pendingImportTrack";
import {
  PlaylistContextMenuIcon,
  usePlaylistTracksById,
} from "../components/PlaylistArt/PlaylistContextMenuIcon";
import { showPlaylistAddedToast } from "../lib/playlistToast";
import { recentPlaylists, sortedPlaylists } from "../lib/playlists";
import type { Playlist } from "../types/playlist";
import { tracksForContextAction } from "../lib/trackSelection";
import { albumKey } from "../lib/albums";
import {
  hasNavigableAlbum,
  hasNavigableArtist,
  navigationArtistKey,
} from "../lib/trackNavigation";
import { useNavigationStore } from "../store/useNavigationStore";
import { usePlayerStore } from "../store/usePlayerStore";
import { usePlaylistStore } from "../store/usePlaylistStore";
import type { Track } from "../types/track";
import { useContextMenu } from "./useContextMenu";

interface UseTrackMenuOptions {
  playlistId?: number;
  disabled?: boolean;
}

export function useTrackMenu(
  track: Track,
  { playlistId, disabled = false }: UseTrackMenuOptions = {},
) {
  const library = usePlayerStore((s) => s.library);
  const selectedTrackIds = usePlayerStore((s) => s.selectedTrackIds);
  const manualQueueIds = usePlayerStore((s) => s.manualQueueIds);
  const openTrackEditor = usePlayerStore((s) => s.openTrackEditor);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const removeTracksFromLibrary = usePlayerStore((s) => s.removeTracksFromLibrary);
  const updateTrackInLibrary = usePlayerStore((s) => s.updateTrackInLibrary);
  const selectTracksInList = usePlayerStore((s) => s.selectTracksInList);
  const openAlbum = useNavigationStore((s) => s.openAlbum);
  const openArtist = useNavigationStore((s) => s.openArtist);
  const artistBrowseMode = useNavigationStore((s) => s.artistBrowseMode);

  const playlists = usePlaylistStore((s) => s.playlists);
  const addTracksToPlaylist = usePlaylistStore((s) => s.addTracksToPlaylist);
  const removeTracksFromPlaylist = usePlaylistStore(
    (s) => s.removeTracksFromPlaylist,
  );
  const openPlaylistEditor = usePlaylistStore((s) => s.openPlaylistEditor);

  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const submenuPanelRef = useRef<HTMLDivElement>(null);

  const recent = useMemo(() => recentPlaylists(playlists), [playlists]);
  const allSorted = useMemo(() => sortedPlaylists(playlists), [playlists]);
  const playlistTracksById = usePlaylistTracksById(playlists, library);

  const libraryIdSet = useMemo(
    () => new Set(library.map((t) => t.id)),
    [library],
  );

  const contextTrackIds = useMemo(
    () => tracksForContextAction(track.id, selectedTrackIds, libraryIdSet),
    [track.id, selectedTrackIds, libraryIdSet],
  );

  const contextTracks = useMemo(
    () =>
      contextTrackIds
        .map((id) => library.find((t) => t.id === id))
        .filter((t): t is Track => t != null),
    [contextTrackIds, library],
  );

  const anyInQueue = contextTrackIds.some((id) => manualQueueIds.includes(id));
  const bulkRemove = contextTracks.length > 1;
  const convertibleCount = contextTracks.filter((item) =>
    isTrackConvertible(item),
  ).length;

  const onBeforeOpen = useCallback(() => {
    if (!selectedTrackIds.includes(track.id)) {
      selectTracksInList(track.id, [track.id], {
        shiftKey: false,
        metaKey: false,
      });
    }
  }, [selectTracksInList, selectedTrackIds, track.id]);

  const { onContextMenu, closeMenu, open, anchor, position, menuRef } =
    useContextMenu({
      layoutDeps: [
        anyInQueue,
        bulkRemove,
        contextTracks.length,
        convertibleCount,
        playlistId,
        playlists.length,
        recent.length,
        allSorted.length,
        hasNavigableArtist(track),
        hasNavigableAlbum(track),
        artistBrowseMode,
        track.rating,
      ],
      onBeforeOpen,
      dismissExcludeRefs: [submenuPanelRef],
    });

  const openEditor = useCallback(() => {
    closeMenu();
    openTrackEditor(contextTrackIds);
  }, [closeMenu, openTrackEditor, contextTrackIds]);

  const handleAddToPlaylist = useCallback(
    (targetPlaylistId: number) => {
      const playlist = playlists.find((p) => p.id === targetPlaylistId);
      closeMenu();
      void addTracksToPlaylist(targetPlaylistId, contextTrackIds).then(() => {
        if (playlist) {
          showPlaylistAddedToast(contextTrackIds, library, playlist);
        }
      });
    },
    [closeMenu, addTracksToPlaylist, contextTrackIds, library, playlists],
  );

  const handleNewPlaylist = useCallback(() => {
    closeMenu();
    openPlaylistEditor("new", contextTrackIds);
  }, [closeMenu, openPlaylistEditor, contextTrackIds]);

  const handleRatingChange = useCallback(
    (rating: CanonicalRating) => {
      for (const contextTrack of contextTracks) {
        applyTrackRating(contextTrack, rating, updateTrackInLibrary);
      }
      closeMenu();
    },
    [closeMenu, contextTracks, updateTrackInLibrary],
  );

  const renderPlaylistItem = (playlist: Playlist) => (
    <ContextMenuItem
      key={playlist.id}
      icon={
        <PlaylistContextMenuIcon
          playlist={playlist}
          tracks={playlistTracksById.get(playlist.id) ?? []}
        />
      }
      label={playlist.title}
      onClick={() => handleAddToPlaylist(playlist.id)}
    />
  );

  const contextMenu = open ? (
    <ContextMenu
      open={open}
      anchor={anchor}
      position={position}
      menuRef={menuRef}
    >
      <ContextMenuItem
        icon={<IconEditInfo />}
        label={
          bulkRemove ? `Edit Info (${contextTracks.length})` : "Edit Info"
        }
        onClick={openEditor}
      />
      <ContextMenuRatingItem
        value={track.rating}
        onChange={handleRatingChange}
      />

      <ContextMenuSeparator />
      {hasNavigableArtist(track) ? (
        <ContextMenuItem
          icon={<IconArtists />}
          label="Go to Artist"
          onClick={() => {
            closeMenu();
            openArtist(navigationArtistKey(track, artistBrowseMode));
          }}
        />
      ) : null}
      {hasNavigableAlbum(track) ? (
        <ContextMenuItem
          icon={<IconAlbums />}
          label="Go to Album"
          onClick={() => {
            closeMenu();
            openAlbum(albumKey(track));
          }}
        />
      ) : null}
      <ContextMenuItem
        icon={<IconOpenFolder />}
        label={revealInFileManagerLabel()}
        onClick={() => {
          closeMenu();
          void revealPathInFileManager(track.filePath);
        }}
      />
      <ContextMenuSeparator />
      <ContextMenuItem
        icon={<IconAddToQueue />}
        label={
          bulkRemove
            ? `Add ${contextTracks.length} to Queue`
            : "Add to Queue"
        }
        onClick={() => {
          closeMenu();
          addToQueue(contextTrackIds);
        }}
      />
      {anyInQueue ? (
        <ContextMenuItem
          icon={<IconRemoveFromQueue />}
          label={
            bulkRemove
              ? `Remove ${contextTracks.length} from Queue`
              : "Remove from Queue"
          }
          onClick={() => {
            closeMenu();
            for (const id of contextTrackIds) {
              if (manualQueueIds.includes(id)) removeFromQueue(id);
            }
          }}
        />
      ) : null}
      <ContextMenuSeparator />
      <ContextMenuSubmenu
        label="Add to Playlist"
        icon={<IconPlaylists />}
        panelRef={submenuPanelRef}
      >
        <ContextMenuItem
          icon={<IconPlaylistAdd />}
          label="New Playlist…"
          onClick={handleNewPlaylist}
        />
        {recent.length > 0 ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuHeading>Recent playlists</ContextMenuHeading>
            {recent.map(renderPlaylistItem)}
          </>
        ) : null}
        {allSorted.length > 0 ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuHeading>All playlists</ContextMenuHeading>
            {allSorted.map(renderPlaylistItem)}
          </>
        ) : null}
      </ContextMenuSubmenu>
      {playlistId != null ? (
        <ContextMenuItem
          icon={<IconRemoveFromPlaylist />}
          label={
            bulkRemove
              ? `Remove ${contextTracks.length} from Playlist`
              : "Remove from Playlist"
          }
          onClick={() => {
            closeMenu();
            void removeTracksFromPlaylist(playlistId, contextTrackIds);
          }}
        />
      ) : null}
      {convertibleCount > 0 ? (
        <ContextMenuItem
          icon={<IconConvert />}
          label={
            convertibleCount > 1
              ? `Convert ${convertibleCount} Tracks…`
              : "Convert…"
          }
          onClick={() => {
            closeMenu();
            openConvertForTrackIds(contextTrackIds);
          }}
        />
      ) : null}
      <ContextMenuSeparator />
      <ContextMenuItem
        icon={<IconDelete />}
        label={
          bulkRemove
            ? `Remove ${contextTracks.length} from Library`
            : "Remove from Library"
        }
        className="context-menu__danger"
        onClick={() => {
          closeMenu();
          setRemoveDialogOpen(true);
        }}
      />
    </ContextMenu>
  ) : null;

  const removeDialog = removeDialogOpen
    ? createPortal(
      <RemoveTrackDialog
        open={removeDialogOpen}
        tracks={contextTracks}
        onClose={() => setRemoveDialogOpen(false)}
        onRemove={(deleteFromDisk) =>
          removeTracksFromLibrary(
            contextTracks.map((t) => t.id),
            deleteFromDisk,
          )
        }
      />,
      document.body,
    )
    : null;

  return {
    onContextMenu: disabled ? undefined : onContextMenu,
    contextMenu: disabled ? null : contextMenu,
    removeDialog: disabled ? null : removeDialog,
  };
}
