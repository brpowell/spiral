import type { ReactNode } from "react";
import { DragDropProvider } from "@dnd-kit/react";
import { move } from "@dnd-kit/helpers";
import { openAppearanceWindow } from "../../lib/appearanceWindow";
import { isCdSidebarDiscReady } from "../../lib/cdTracks";
import {
  CLICKABLE_ITEM_POINTER_SENSOR,
  SORT_KEYBOARD_SENSOR,
} from "../../lib/dndSortSensors";
import {
  type NavView,
  useNavigationStore,
} from "../../store/useNavigationStore";
import { usePlaylistStore } from "../../store/usePlaylistStore";
import { useCdStore } from "../../store/useCdStore";
import {
  IconAlbums,
  IconArtists,
  IconTracks,
  IconPalette,
  IconPlaylistAdd,
} from "../icons";
import { SidebarItem } from "./SidebarItem/SidebarItem";
import { SidebarPlaylistItem } from "./SidebarPlaylistItem";
import { SidebarCdDriveItem } from "./SidebarCdDriveItem";
import "./Sidebar.css";

/** Allow drag from the inner button while sorting the whole <li>. */
const PLAYLIST_SORT_SENSORS = [
  CLICKABLE_ITEM_POINTER_SENSOR,
  SORT_KEYBOARD_SENSOR,
];

const NAV_ITEMS: {
  view: NavView;
  label: string;
  icon: ReactNode;
  enabled: boolean;
}[] = [
    { view: "library", label: "Tracks", icon: <IconTracks />, enabled: true },
    { view: "albums", label: "Albums", icon: <IconAlbums />, enabled: true },
    { view: "artists", label: "Artists", icon: <IconArtists />, enabled: true },
  ];

export function Sidebar() {
  const view = useNavigationStore((s) => s.view);
  const playlistId = useNavigationStore((s) => s.playlistId);
  const cdDriveId = useNavigationStore((s) => s.cdDriveId);
  const setView = useNavigationStore((s) => s.setView);
  const playlists = usePlaylistStore((s) => s.playlists);
  const reorderPlaylists = usePlaylistStore((s) => s.reorderPlaylists);
  const cdDrives = useCdStore((s) => s.drives);
  const discsByDriveId = useCdStore((s) => s.discsByDriveId);
  const cdtextAttemptedDriveIds = useCdStore((s) => s.cdtextAttemptedDriveIds);
  const readyCdDrives = cdDrives.filter((drive) =>
    isCdSidebarDiscReady(
      discsByDriveId[drive.id],
      cdtextAttemptedDriveIds.has(drive.id),
    ),
  );
  const openPlaylistEditor = usePlaylistStore((s) => s.openPlaylistEditor);

  return (
    <nav className="sidebar" aria-label="Main navigation">
      <ul className="sidebar__list">
        {NAV_ITEMS.map((item) => {
          const isActive = item.view === view && playlistId == null && cdDriveId == null;
          return (
            <li key={item.view}>
              <SidebarItem
                icon={item.icon}
                active={isActive}
                disabled={!item.enabled}
                onClick={() => item.enabled && setView(item.view)}
              >
                {item.label}
              </SidebarItem>
            </li>
          );
        })}
      </ul>

      {readyCdDrives.length > 0 ? (
        <section className="sidebar__devices" aria-label="Devices">
          <h2 className="sidebar__section-label">Devices</h2>
          <ul className="sidebar__device-list">
            {readyCdDrives.map((drive) => (
              <SidebarCdDriveItem key={drive.id} drive={drive} />
            ))}
          </ul>
        </section>
      ) : null}

      <section className="sidebar__playlists" aria-label="Playlists">
        <h2 className="sidebar__section-label">Playlists</h2>
        <div className="sidebar__playlist-body">
          {playlists.length === 0 ? (
            <p className="sidebar__playlists-empty">No playlists yet</p>
          ) : (
            <DragDropProvider
              sensors={PLAYLIST_SORT_SENSORS}
              onDragEnd={(event) => {
                if (event.canceled) return;
                const next = move(playlists, event);
                const unchanged = next.every(
                  (playlist, index) => playlist.id === playlists[index]?.id,
                );
                if (unchanged) return;
                void reorderPlaylists(next.map((playlist) => playlist.id));
              }}
            >
              <ul className="sidebar__playlist-list">
                {playlists.map((playlist, index) => (
                  <SidebarPlaylistItem
                    key={playlist.id}
                    playlist={playlist}
                    index={index}
                  />
                ))}
              </ul>
            </DragDropProvider>
          )}
        </div>
        <SidebarItem
          icon={<IconPlaylistAdd />}
          className="sidebar__playlist-create"
          onClick={() => openPlaylistEditor("new")}
        >
          New Playlist
        </SidebarItem>
      </section>

      <div className="sidebar__footer">
        <SidebarItem
          icon={<IconPalette />}
          aria-label="Appearance"
          onClick={() => {
            void openAppearanceWindow();
          }}
        >
          Appearance
        </SidebarItem>
      </div>
    </nav>
  );
}
