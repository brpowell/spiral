import { AnimatePresence, motion } from "framer-motion";
import { useLayoutEffect, useMemo, useRef } from "react";
import { isTrackImporting } from "@/lib/import/pendingImportTrack";
import { applyArtistImages } from "@/lib/artists/artistArt";
import { groupTracksIntoAlbums } from "@/lib/albums/albums";
import { groupTracksIntoGenres } from "@/lib/genres/genres";
import { groupTracksIntoArtists } from "@/lib/artists/artists";
import { viewTransition } from "@/lib/ui/motion";
import { useArtistImageStore } from "@/store/useArtistImageStore";
import { useNavigationStore } from "@/store/useNavigationStore";
import { usePlayerStore } from "@/store/usePlayerStore";
import { AlbumDetailView } from "@/views/AlbumDetailView";
import { AlbumsView } from "@/views/AlbumsView";
import { ArtistDetailView } from "@/views/ArtistDetailView";
import { ArtistsView } from "@/views/ArtistsView";
import { PlaylistDetailView } from "@/views/PlaylistDetailView";
import { GenreDetailView } from "@/views/GenreDetailView";
import { GenresView } from "@/views/GenresView";
import { CdDetailView } from "@/views/CdDetailView";
import { TracksView } from "@/views/TracksView";
import "./MainContent.css";

export function MainContent() {
  const library = usePlayerStore((s) => s.library);
  const imagesByKey = useArtistImageStore((s) => s.imagesByKey);
  const view = useNavigationStore((s) => s.view);
  const albumKey = useNavigationStore((s) => s.albumKey);
  const artistKey = useNavigationStore((s) => s.artistKey);
  const artistBrowseMode = useNavigationStore((s) => s.artistBrowseMode);
  const genreKey = useNavigationStore((s) => s.genreKey);
  const playlistId = useNavigationStore((s) => s.playlistId);
  const cdDriveId = useNavigationStore((s) => s.cdDriveId);

  const liveLibrary = useMemo(
    () => library.filter((track) => !isTrackImporting(track)),
    [library],
  );
  const albums = useMemo(
    () => groupTracksIntoAlbums(liveLibrary),
    [liveLibrary],
  );
  const genres = useMemo(
    () => groupTracksIntoGenres(liveLibrary),
    [liveLibrary],
  );
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
            ? `artist-${artistKey}`
            : view === "genres" && genreKey != null
              ? `genre-${genreKey}`
              : view;

  const mainRef = useRef<HTMLElement>(null);
  const scrollTopRef = useRef(0);

  // A new page starts at the top. Without this, the incoming view fades in above the viewport
  // while the old one (still scrolled) fades out, then snaps into place when the old one unmounts.
  // The outgoing view is shifted by the scroll we remove so it stays put while it fades.
  useLayoutEffect(() => {
    const main = mainRef.current;
    const previousTop = scrollTopRef.current;
    if (!main || previousTop <= 0) return;
    main.scrollTop = 0;
    scrollTopRef.current = 0;
    for (const el of main.querySelectorAll<HTMLElement>(
      ":scope > [data-view-key]",
    )) {
      if (el.dataset.viewKey !== contentKey) {
        el.style.translate = `0 ${-previousTop}px`;
      }
    }
  }, [contentKey]);

  const viewProps = { ...viewTransition, "data-view-key": contentKey };

  return (
    <main
      ref={mainRef}
      className="main-content"
      onScroll={(e) => {
        scrollTopRef.current = e.currentTarget.scrollTop;
      }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {cdDriveId != null ? (
          <motion.div
            key={contentKey}
            className="main-content__view main-content__view--contained"
            {...viewProps}
          >
            <CdDetailView
              driveId={cdDriveId}
              albums={albums}
              artists={artists}
            />
          </motion.div>
        ) : playlistId != null ? (
          <motion.div
            key={contentKey}
            className="main-content__view main-content__view--contained"
            {...viewProps}
          >
            <PlaylistDetailView playlistId={playlistId} />
          </motion.div>
        ) : albumKey != null ? (
          <motion.div
            key={contentKey}
            className="main-content__view main-content__view--contained"
            {...viewProps}
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
            {...viewProps}
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
            {...viewProps}
          >
            <TracksView tracks={library} />
          </motion.div>
        ) : view === "albums" ? (
          <motion.div
            key={contentKey}
            className="main-content__view main-content__view--contained"
            {...viewProps}
          >
            <AlbumsView albums={albums} artists={artists} />
          </motion.div>
        ) : view === "artists" ? (
          <motion.div
            key={contentKey}
            className="main-content__view main-content__view--contained"
            {...viewProps}
          >
            <ArtistsView
              artists={artists}
              albums={albums}
              browseMode={artistBrowseMode}
            />
          </motion.div>
        ) : view === "genres" && genreKey != null ? (
          <motion.div
            key={contentKey}
            className="main-content__view main-content__view--contained"
            {...viewProps}
          >
            <GenreDetailView genres={genres} genreKey={genreKey} />
          </motion.div>
        ) : view === "genres" ? (
          <motion.div
            key={contentKey}
            className="main-content__view main-content__view--contained"
            {...viewProps}
          >
            <GenresView genres={genres} />
          </motion.div>
        ) : (
          <motion.div
            key={contentKey}
            className="main-content__view main-content__placeholder"
            {...viewProps}
          >
            <p>Coming soon.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
