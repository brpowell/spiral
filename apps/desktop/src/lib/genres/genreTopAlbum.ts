import { groupTracksIntoAlbums } from "@/lib/albums/albums";
import {
  aggregateScores,
  rankByScore,
  type TrackScores,
} from "@/lib/popularity/popularity";
import type { Album } from "@/types/album";
import type { Genre } from "./genres";

/**
 * The album to represent a genre: the most popular one among the genre's own
 * tracks, as long as it has artwork. With no listening signal on any album that
 * has art, the one with the most tracks in the genre stands in (ties go to the
 * first by title). Null when none of the genre's albums has artwork.
 */
export function topAlbumForGenre(
  genre: Pick<Genre, "tracks">,
  scores: TrackScores,
): Album | null {
  const albums = groupTracksIntoAlbums([...genre.tracks])
    .filter((album) => album.artPath != null)
    .sort((a, b) => a.title.localeCompare(b.title));
  if (albums.length === 0) return null;

  const ranked = rankByScore(albums, (album) =>
    aggregateScores(album.tracks, scores),
  );
  if (ranked[0]) return ranked[0].item;

  return albums.reduce((best, album) =>
    album.tracks.length > best.tracks.length ? album : best,
  );
}
