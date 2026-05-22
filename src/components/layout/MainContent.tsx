import { AnimatePresence, motion } from "framer-motion";
import { useMemo } from "react";
import { groupTracksIntoAlbums } from "../../lib/albums";
import { useNavigationStore } from "../../store/useNavigationStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { AlbumDetailView } from "../../views/AlbumDetailView";
import { AlbumsView } from "../../views/AlbumsView";
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
  const view = useNavigationStore((s) => s.view);
  const albumKey = useNavigationStore((s) => s.albumKey);
  const playlistId = useNavigationStore((s) => s.playlistId);

  const albums = useMemo(() => groupTracksIntoAlbums(library), [library]);

  const contentKey =
    playlistId != null
      ? `playlist-${playlistId}`
      : albumKey != null
        ? `album-${albumKey}`
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
            <AlbumDetailView albums={albums} albumKey={albumKey} />
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
