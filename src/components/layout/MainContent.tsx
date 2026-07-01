import { AnimatePresence, motion } from "framer-motion";
import { useMemo } from "react";
import { isTrackImporting } from "../../lib/pendingImportTrack";
import { applyArtistImages } from "../../lib/artistArt";
import { groupTracksIntoAlbums } from "../../lib/albums";
import { groupTracksIntoArtists } from "../../lib/artists";
import { viewTransition } from "../../lib/motion";
import { useArtistImageStore } from "../../store/useArtistImageStore";
import { useNavigationStore } from "../../store/useNavigationStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { AlbumDetailView } from "../../views/AlbumDetailView";
import { AlbumsView } from "../../views/AlbumsView";
import { ArtistDetailView } from "../../views/ArtistDetailView";
import { ArtistsView } from "../../views/ArtistsView";
import { PlaylistDetailView } from "../../views/PlaylistDetailView";
import { CdDetailView } from "../../views/CdDetailView";
import { TracksView } from "../../views/TracksView";
import "./MainContent.css";

export function MainContent() {
  const library = usePlayerStore((s) => s.library);
  const imagesByKey = useArtistImageStore((s) => s.imagesByKey);
  const view = useNavigationStore((s) => s.view);
  const albumKey = useNavigationStore((s) => s.albumKey);
  const artistKey = useNavigationStore((s) => s.artistKey);
  const artistBrowseMode = useNavigationStore((s) => s.artistBrowseMode);
  const playlistId = useNavigationStore((s) => s.playlistId);
  const cdDriveId = useNavigationStore((s) => s.cdDriveId);

  const liveLibrary = useMemo(
    () => library.filter((track) => !isTrackImporting(track)),
    [library],
  );
  const albums = useMemo(() => groupTracksIntoAlbums(liveLibrary), [liveLibrary]);
  const artists = useMemo(() => {
    const grouped = groupTracksIntoArtists(liveLibrary, artistBrowseMode);
    return applyArtistImages(grouped, imagesByKey);
  }, [liveLibrary, artistBrowseMode, imagesByKey]);
  const performerArtists = useMemo(() => {
    const grouped = groupTracksIntoArtists(liveLibrary, "performers");
    return applyArtistImages(grouped, imagesByKey);
  }, [liveLibrary, imagesByKey]);

  const contentKey =
    cdDriveId != null
      ? `cd-${cdDriveId}`
      : playlistId != null
        ? `playlist-${playlistId}`
        : albumKey != null
          ? `album-${albumKey}`
          : artistKey != null
            ? `artist-${artistBrowseMode}-${artistKey}`
            : view;

  return (
    <main className="main-content">
      <AnimatePresence mode="wait">
        {cdDriveId != null ? (
          <motion.div
            key={contentKey}
            className="main-content__view main-content__view--contained"
            {...viewTransition}
          >
            <CdDetailView driveId={cdDriveId} albums={albums} artists={artists} />
          </motion.div>
        ) : playlistId != null ? (
          <motion.div
            key={contentKey}
            className="main-content__view main-content__view--contained"
            {...viewTransition}
          >
            <PlaylistDetailView playlistId={playlistId} artists={artists} />
          </motion.div>
        ) : albumKey != null ? (
          <motion.div
            key={contentKey}
            className="main-content__view main-content__view--contained"
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
              performerArtists={performerArtists}
              artistKey={artistKey}
              browseMode={artistBrowseMode}
            />
          </motion.div>
        ) : view === "library" ? (
          <motion.div
            key={contentKey}
            className="main-content__view main-content__view--contained"
            {...viewTransition}
          >
            <TracksView tracks={library} />
          </motion.div>
        ) : view === "albums" ? (
          <motion.div
            key={contentKey}
            className="main-content__view main-content__view--contained"
            {...viewTransition}
          >
            <AlbumsView albums={albums} />
          </motion.div>
        ) : view === "artists" ? (
          <motion.div
            key={contentKey}
            className="main-content__view main-content__view--contained"
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
