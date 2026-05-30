import type { Album } from "../types/album";

export interface DiscographyYearGroup {
  year: number | null;
  label: string;
  albums: Album[];
}

export function groupAlbumsForTimeline(albums: Album[]): DiscographyYearGroup[] {
  const byYear = new Map<number | null, Album[]>();

  for (const album of albums) {
    const year = album.year;
    const list = byYear.get(year);
    if (list) list.push(album);
    else byYear.set(year, [album]);
  }

  const groups: DiscographyYearGroup[] = [];

  const knownYears = [...byYear.keys()].filter((y): y is number => y != null);
  knownYears.sort((a, b) => a - b);

  for (const year of knownYears) {
    const yearAlbums = byYear.get(year) ?? [];
    yearAlbums.sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
    );
    groups.push({
      year,
      label: String(year),
      albums: yearAlbums,
    });
  }

  const unknown = byYear.get(null);
  if (unknown?.length) {
    unknown.sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
    );
    groups.push({
      year: null,
      label: "—",
      albums: unknown,
    });
  }

  return groups;
}
