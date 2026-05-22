import type { ReactNode } from "react";
import { ThemePicker } from "../ThemePicker/ThemePicker";
import { useThemeStore } from "../../store/useThemeStore";
import {
  type NavView,
  useNavigationStore,
} from "../../store/useNavigationStore";
import { usePlaylistStore } from "../../store/usePlaylistStore";
import {
  IconAlbums,
  IconArtists,
  IconTracks,
  IconPalette,
} from "../icons";
import { SidebarPlaylistItem } from "./SidebarPlaylistItem";
import "./Sidebar.css";

const NAV_ITEMS: {
  view: NavView;
  label: string;
  icon: ReactNode;
  enabled: boolean;
}[] = [
  { view: "library", label: "Tracks", icon: <IconTracks />, enabled: true },
  { view: "albums", label: "Albums", icon: <IconAlbums />, enabled: true },
  { view: "artists", label: "Artists", icon: <IconArtists />, enabled: false },
];

export function Sidebar() {
  const view = useNavigationStore((s) => s.view);
  const playlistId = useNavigationStore((s) => s.playlistId);
  const setView = useNavigationStore((s) => s.setView);
  const playlists = usePlaylistStore((s) => s.playlists);
  const setThemePickerOpen = useThemeStore((s) => s.setThemePickerOpen);
  const loadThemes = useThemeStore((s) => s.loadThemes);

  return (
    <nav className="sidebar" aria-label="Main navigation">
      <ul className="sidebar__list">
        {NAV_ITEMS.map((item) => {
          const isActive = item.view === view && playlistId == null;
          return (
            <li key={item.view}>
              <button
                type="button"
                className={
                  isActive
                    ? "sidebar__link sidebar__link--active"
                    : "sidebar__link"
                }
                disabled={!item.enabled}
                aria-current={isActive ? "page" : undefined}
                onClick={() => item.enabled && setView(item.view)}
              >
                <span className="sidebar__icon">{item.icon}</span>
                {item.label}
              </button>
            </li>
          );
        })}
      </ul>

      <section className="sidebar__playlists" aria-label="Playlists">
        <h2 className="sidebar__section-label">Playlists</h2>
        {playlists.length === 0 ? (
          <p className="sidebar__playlists-empty">No playlists yet</p>
        ) : (
          <ul className="sidebar__playlist-list">
            {playlists.map((playlist) => (
              <SidebarPlaylistItem key={playlist.id} playlist={playlist} />
            ))}
          </ul>
        )}
      </section>

      <div className="sidebar__footer">
        <button
          type="button"
          className="sidebar__link sidebar__link--settings"
          aria-label="Themes and appearance"
          onClick={() => {
            void loadThemes().then(() => setThemePickerOpen(true));
          }}
        >
          <span className="sidebar__icon">
            <IconPalette />
          </span>
          Themes
        </button>
      </div>

      <ThemePicker />
    </nav>
  );
}
