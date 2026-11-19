import { useMemo, type RefObject } from "react";
import {
  ContextMenuHeading,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSubmenu,
} from "@/components/ContextMenu/ContextMenu";
import { IconPlaylistAdd, IconPlaylists } from "@/components/icons";
import {
  PlaylistContextMenuIcon,
  usePlaylistTracksById,
} from "@/components/PlaylistArt/PlaylistContextMenuIcon";
import { t } from "@/lib/i18n/i18n";
import { showPlaylistAddedToast } from "@/lib/playlists/playlistToast";
import { recentPlaylists, sortedPlaylists } from "@/lib/playlists/playlists";
import { usePlayerStore } from "@/store/usePlayerStore";
import { usePlaylistStore } from "@/store/usePlaylistStore";
import type { Playlist } from "@/types/playlist";

interface AddToPlaylistSubmenuProps {
  trackIds: number[];
  /** Closes the parent menu once a choice is made. */
  closeMenu: () => void;
  /** Pass the same ref to the parent menu's `dismissExcludeRefs`. */
  panelRef: RefObject<HTMLDivElement | null>;
}

/** "Add to Playlist" flyout: new playlist, recent playlists, all playlists. */
export function AddToPlaylistSubmenu({
  trackIds,
  closeMenu,
  panelRef,
}: AddToPlaylistSubmenuProps) {
  const library = usePlayerStore((s) => s.library);
  const playlists = usePlaylistStore((s) => s.playlists);
  const addTracksToPlaylist = usePlaylistStore((s) => s.addTracksToPlaylist);
  const openPlaylistEditor = usePlaylistStore((s) => s.openPlaylistEditor);

  const recent = useMemo(() => recentPlaylists(playlists), [playlists]);
  const allSorted = useMemo(() => sortedPlaylists(playlists), [playlists]);
  const playlistTracksById = usePlaylistTracksById(playlists, library);

  const addTo = (playlist: Playlist) => {
    closeMenu();
    void addTracksToPlaylist(playlist.id, trackIds).then(() => {
      showPlaylistAddedToast(trackIds, library, playlist);
    });
  };

  const renderItem = (playlist: Playlist) => (
    <ContextMenuItem
      key={playlist.id}
      icon={
        <PlaylistContextMenuIcon
          playlist={playlist}
          tracks={playlistTracksById.get(playlist.id) ?? []}
        />
      }
      label={playlist.title}
      onClick={() => addTo(playlist)}
    />
  );

  return (
    <ContextMenuSubmenu
      label={t("library:actions.addToPlaylist")}
      icon={<IconPlaylists />}
      panelRef={panelRef}
    >
      <ContextMenuItem
        icon={<IconPlaylistAdd />}
        label={t("library:actions.newPlaylist")}
        onClick={() => {
          closeMenu();
          openPlaylistEditor("new", trackIds);
        }}
      />
      {recent.length > 0 ? (
        <>
          <ContextMenuSeparator />
          <ContextMenuHeading>
            {t("library:actions.recentPlaylists")}
          </ContextMenuHeading>
          {recent.map(renderItem)}
        </>
      ) : null}
      {allSorted.length > 0 ? (
        <>
          <ContextMenuSeparator />
          <ContextMenuHeading>
            {t("library:actions.allPlaylists")}
          </ContextMenuHeading>
          {allSorted.map(renderItem)}
        </>
      ) : null}
    </ContextMenuSubmenu>
  );
}
