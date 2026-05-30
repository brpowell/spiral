import { invoke } from "@tauri-apps/api/core";
import { parseBuffer, type IAudioMetadata } from "music-metadata";
import { normalizeArtistFieldFromTagValue } from "./artistNames";
import { cacheArtFromBytes } from "./tauri";
import type { TrackInput } from "../types/track";

const MIME_BY_EXT: Record<string, string> = {
  mp3: "audio/mpeg",
  flac: "audio/flac",
  aac: "audio/aac",
  wav: "audio/wav",
  m4a: "audio/mp4",
};

function extension(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot + 1).toLowerCase() : "";
}

function filenameTitle(path: string): string {
  const name = path.split(/[/\\]/).pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function firstString(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function firstNumber(value: number | undefined): number | null {
  return value ?? null;
}

async function extractEmbeddedArt(
  metadata: IAudioMetadata,
  filePath: string,
): Promise<string | null> {
  const pictures = metadata.common.picture;
  if (!pictures?.length) return null;

  const pic = pictures[0];
  if (!pic?.data?.length) return null;

  try {
    return await cacheArtFromBytes(Array.from(pic.data), filePath, pic.format);
  } catch (err) {
    console.warn(`Failed to cache embedded album art for ${filePath}:`, err);
    return null;
  }
}

export async function parseTrackMetadata(filePath: string): Promise<TrackInput> {
  const ext = extension(filePath);
  const mimeType = MIME_BY_EXT[ext] ?? "application/octet-stream";
  const data = await invoke<number[]>("read_file_bytes", { path: filePath });
  const buffer = new Uint8Array(data);
  const metadata = await parseBuffer(buffer, { mimeType });

  const trackNo = metadata.common.track?.no;
  const discNo = metadata.common.disk?.no;
  const artPath = await extractEmbeddedArt(metadata, filePath);

  return {
    title: firstString(metadata.common.title) ?? filenameTitle(filePath),
    artist: normalizeArtistFieldFromTagValue(metadata.common.artist),
    album: firstString(metadata.common.album),
    albumArtist: normalizeArtistFieldFromTagValue(metadata.common.albumartist),
    trackNumber: trackNo != null ? Math.trunc(trackNo) : null,
    discNumber: discNo != null ? Math.trunc(discNo) : null,
    year: metadata.common.year ?? null,
    genre: firstString(metadata.common.genre),
    durationSeconds: firstNumber(metadata.format.duration),
    filePath,
    artPath,
  };
}
