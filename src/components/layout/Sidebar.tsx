import type { ReactNode } from "react";
import { DragDropProvider } from "@dnd-kit/react";
import { move } from "@dnd-kit/helpers";
import { useTranslation } from "react-i18next";
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
import { IconAlbums, IconArtists, IconTracks, IconPlaylistAdd } from "../icons";
import {
  SidebarFooter,
  SidebarFrame,
  SidebarList,
  SidebarSection,
} from "./SidebarChrome";
import { SidebarItem } from "./SidebarItem/SidebarItem";
import { SidebarMoreMenu } from "./SidebarMoreMenu";
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

/** Main-window library navigation rail. */
export function Sidebar() {
  const { t } = useTranslation("common");
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
    <SidebarFrame aria-label="Main navigation">
      <SidebarList>
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.view === view && playlistId == null && cdDriveId == null;
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
      </SidebarList>

      {readyCdDrives.length > 0 ? (
        <SidebarSection label="Devices">
          <ul className="sidebar__device-list">
            {readyCdDrives.map((drive) => (
              <SidebarCdDriveItem key={drive.id} drive={drive} />
            ))}
          </ul>
        </SidebarSection>
      ) : null}

      <SidebarSection label="Playlists" grow>
        <div className="sidebar__playlist-body">
          {playlists.length === 0 ? (
            <p className="sidebar__playlists-empty">
              {t("sidebar.playlistsEmpty")}
            </p>
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
      </SidebarSection>

      <SidebarFooter>
        <SidebarMoreMenu />
      </SidebarFooter>
    </SidebarFrame>
  );
}
