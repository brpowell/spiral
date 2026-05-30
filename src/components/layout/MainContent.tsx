import { AnimatePresence, motion } from "framer-motion";
import { useMemo } from "react";
import { applyArtistImages } from "../../lib/artistArt";
import { groupTracksIntoAlbums } from "../../lib/albums";
import { groupTracksIntoArtists } from "../../lib/artists";
import { useArtistImageStore } from "../../store/useArtistImageStore";
import { useNavigationStore } from "../../store/useNavigationStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { AlbumDetailView } from "../../views/AlbumDetailView";
import { AlbumsView } from "../../views/AlbumsView";
import { ArtistDetailView } from "../../views/ArtistDetailView";
import { ArtistsView } from "../../views/ArtistsView";
import { PlaylistDetailView } from "../../views/PlaylistDetailView";
import { TracksView } from "../../views/TracksView";
import "./MainContent.css";

const viewTransition = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.08 },
};

export function MainContent() {
  const library = usePlayerStore((s) => s.library);
  const imagesByKey = useArtistImageStore((s) => s.imagesByKey);
  const view = useNavigationStore((s) => s.view);
  const albumKey = useNavigationStore((s) => s.albumKey);
  const artistKey = useNavigationStore((s) => s.artistKey);
  const artistBrowseMode = useNavigationStore((s) => s.artistBrowseMode);
  const playlistId = useNavigationStore((s) => s.playlistId);

  const albums = useMemo(() => groupTracksIntoAlbums(library), [library]);
  const artists = useMemo(() => {
    const grouped = groupTracksIntoArtists(library, artistBrowseMode);
    return applyArtistImages(grouped, imagesByKey);
  }, [library, artistBrowseMode, imagesByKey]);

  const contentKey =
    playlistId != null
      ? `playlist-${playlistId}`
      : albumKey != null
        ? `album-${albumKey}`
        : artistKey != null
          ? `artist-${artistBrowseMode}-${artistKey}`
          : view;

  return (
    <main className="main-content">
      <AnimatePresence mode="wait">
        {playlistId != null ? (
          <motion.div
            key={contentKey}
            className="main-content__view"
            {...viewTransition}
          >
            <PlaylistDetailView playlistId={playlistId} />
          </motion.div>
        ) : albumKey != null ? (
          <motion.div
            key={contentKey}
            className="main-content__view"
            {...viewTransition}
          >
            <AlbumDetailView
              albums={albums}
              artists={artists}
              albumKey={albumKey}
            />
          </motion.div>
        ) : artistKey != null ? (
          <motion.div
            key={contentKey}
            className="main-content__view"
            {...viewTransition}
          >
            <ArtistDetailView
              albums={albums}
              artists={artists}
              artistKey={artistKey}
              browseMode={artistBrowseMode}
            />
          </motion.div>
        ) : view === "library" ? (
          <motion.div
            key={contentKey}
            className="main-content__view"
            {...viewTransition}
          >
            <TracksView tracks={library} />
          </motion.div>
        ) : view === "albums" ? (
          <motion.div
            key={contentKey}
            className="main-content__view"
            {...viewTransition}
          >
            <AlbumsView albums={albums} />
          </motion.div>
        ) : view === "artists" ? (
          <motion.div
            key={contentKey}
            className="main-content__view"
            {...viewTransition}
          >
            <ArtistsView
              artists={artists}
              albums={albums}
              browseMode={artistBrowseMode}
            />
          </motion.div>
        ) : (
          <motion.div
            key={contentKey}
            className="main-content__view main-content__placeholder"
            {...viewTransition}
          >
            <p>Coming soon.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
