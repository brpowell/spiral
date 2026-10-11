export interface CoverArtCandidate {
  url: string;
  thumbnailUrl: string | null;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  canonicalRank: number;
}
