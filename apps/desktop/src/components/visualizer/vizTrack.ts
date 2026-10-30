import { normalizeArtistName, parseArtistField } from "../../lib/artistNames";

/**
 * One performer credited on {@link VizFrameTrack}.
 * Names follow the track's credit order.
 */
export interface VizFrameTrackArtist {
  /** Display name. Already trimmed. */
  name: string;
  /**
   * Library portrait, or `null` when this artist has none.
   * Pass it to `ctx.drawImage`. The longest edge is at most 512px.
   * Read it from the current frame. It stays valid only while this same
   * portrait is still the one the host is showing.
   */
  portrait: ImageBitmap | null;
}

/**
 * The loaded track, as a draw module sees it.
 *
 * When nothing is loaded, {@link id} is `null`, {@link title} is `""`,
 * {@link album} and {@link art} are `null`, and {@link artists} is empty.
 * {@link artColors} is still filled with the host fallback palette so a
 * module always has swatches to paint with.
 */
export interface VizFrameTrack {
  /**
   * Library track id, or the synthetic id of a CD track.
   * `null` when nothing is loaded. Stable for a recording, so a module can
   * tell two tracks apart when their titles match.
   */
  id: number | null;
  /** Track title. `""` when nothing is loaded. */
  title: string;
  /** Album title. `null` when the track has none, or when nothing is loaded. */
  album: string | null;
  /**
   * Performer credits, in listed order. A credit string such as
   * `"Portishead; Massive Attack"` becomes one entry per name.
   * When the performer field is empty, this is a single entry for the album artist.
   * Empty when nothing is loaded and there is no album artist either.
   */
  artists: VizFrameTrackArtist[];
  /**
   * Album cover, or `null` when the track has none.
   * Pass it to `ctx.drawImage`. The longest edge is at most 512px.
   * Read it from the current frame. It stays valid only while this same
   * cover is still the one the host is showing.
   */
  art: ImageBitmap | null;
  /**
   * Cover swatches as CSS hex colors, in a stable sample order.
   * When the track has no cover, this is the host fallback palette rather than
   * an empty list.
   */
  artColors: string[];
}

export const EMPTY_VIZ_TRACK: VizFrameTrack = {
  id: null,
  title: "",
  album: null,
  artists: [],
  art: null,
  artColors: [],
};

/** Synthetic id for {@link withPreviewTrackIdentity}; library ids are positive. */
export const PREVIEW_TRACK_ID = -1;

/**
 * Gives a preview an identity when nothing is loaded. Some modules only draw
 * their subject once they have a track to follow (Dream Cube places a cube per
 * track), so a Studio card or onboarding thumbnail with an empty track would
 * show none. Leaves a real loaded track untouched.
 */
export function withPreviewTrackIdentity(track: VizFrameTrack): VizFrameTrack {
  if (track.id != null || track.title !== "") return track;
  return { ...track, id: PREVIEW_TRACK_ID, title: "Preview" };
}

/** Wire form of {@link VizFrameTrack}. Bitmaps travel in a separate message. */
export interface VizTrackWire {
  id: number | null;
  title: string;
  album: string | null;
  artists: { name: string; portraitId: string | null }[];
  artId: string | null;
  artColors: string[];
}

export interface VizTrackMedia {
  art: { id: string; bitmap: ImageBitmap } | null;
  portraits: { id: string; bitmap: ImageBitmap }[];
}

/**
 * Track image as raw pixels. WebKit cannot structured-clone ImageBitmap, so
 * this is what actually crosses into the worker.
 */
export interface VizTrackImagePayload {
  id: string;
  width: number;
  height: number;
  pixels: ArrayBuffer;
}

export interface VizTrackCredit {
  name: string;
  /** Key into the artist-image store. */
  key: string;
}

const imageIds = new WeakMap<ImageBitmap, string>();
/**
 * Image source (a file path) → the opaque id sent to the worker. Pack code can
 * observe raw worker messages, so paths never go on the wire. One entry per
 * distinct image path seen this session.
 */
const opaqueImageIds = new Map<string, string>();

/** Register a decoded track image under its source key (a file path). */
export function registerVizImage(key: string, bitmap: ImageBitmap): void {
  let id = opaqueImageIds.get(key);
  if (id === undefined) {
    id = `img-${opaqueImageIds.size + 1}`;
    opaqueImageIds.set(key, id);
  }
  imageIds.set(bitmap, id);
}

export function vizImageId(bitmap: ImageBitmap | null): string | null {
  if (!bitmap) return null;
  return imageIds.get(bitmap) ?? null;
}

/** Performer names, or the album artist when the performer credit is empty. */
export function vizTrackCredits(
  artist: string | null | undefined,
  albumArtist: string | null | undefined,
): VizTrackCredit[] {
  const performers = parseArtistField(artist);
  const names =
    performers.length > 0
      ? performers
      : [albumArtist?.trim() || artist?.trim() || ""].filter(Boolean);
  return names.map((name) => ({
    name,
    key: normalizeArtistName(name),
  }));
}

/** Names and images, before cover swatches are attached on the frame. */
export type VizFrameTrackBody = Omit<VizFrameTrack, "artColors">;

export function vizTrackBodiesEqual(
  a: VizFrameTrackBody,
  b: VizFrameTrackBody,
): boolean {
  if (
    a.id !== b.id ||
    a.title !== b.title ||
    a.album !== b.album ||
    a.art !== b.art
  ) {
    return false;
  }
  if (a.artists.length !== b.artists.length) return false;
  for (let i = 0; i < a.artists.length; i++) {
    const left = a.artists[i];
    const right = b.artists[i];
    if (!left || !right) return false;
    if (left.name !== right.name || left.portrait !== right.portrait) {
      return false;
    }
  }
  return true;
}

/**
 * Split a track into the per-frame wire payload and any bitmaps the worker
 * has not been given yet. Bitmap ids are opaque tokens assigned at decode time.
 */
export function splitVizTrack(track: VizFrameTrack): {
  wire: VizTrackWire;
  media: VizTrackMedia;
} {
  const artId = vizImageId(track.art);
  const portraits: { id: string; bitmap: ImageBitmap }[] = [];
  const seenPortraits = new Set<string>();
  const artists = track.artists.map((artist) => {
    const portraitId = vizImageId(artist.portrait);
    if (artist.portrait && portraitId && !seenPortraits.has(portraitId)) {
      seenPortraits.add(portraitId);
      portraits.push({ id: portraitId, bitmap: artist.portrait });
    }
    return { name: artist.name, portraitId };
  });

  return {
    wire: {
      id: track.id,
      title: track.title,
      album: track.album,
      artists,
      artId,
      artColors: track.artColors,
    },
    media: {
      art: track.art && artId ? { id: artId, bitmap: track.art } : null,
      portraits,
    },
  };
}

export function materializeVizTrack(
  wire: VizTrackWire,
  artById: ReadonlyMap<string, ImageBitmap>,
  portraitsById: ReadonlyMap<string, ImageBitmap>,
): VizFrameTrack {
  return {
    id: wire.id,
    title: wire.title,
    album: wire.album,
    art: wire.artId ? (artById.get(wire.artId) ?? null) : null,
    artColors: wire.artColors,
    artists: wire.artists.map((artist) => ({
      name: artist.name,
      portrait: artist.portraitId
        ? (portraitsById.get(artist.portraitId) ?? null)
        : null,
    })),
  };
}

/** Drop cached bitmaps the current track no longer references. */
export function retainVizImages(
  bitmaps: Map<string, ImageBitmap>,
  live: ReadonlySet<string>,
): void {
  for (const [id, bitmap] of bitmaps) {
    if (live.has(id)) continue;
    bitmap.close();
    bitmaps.delete(id);
  }
}
