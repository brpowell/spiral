//! Vorbis-comment metadata for OGG Vorbis and Opus-in-OGG containers via lofty.

use std::path::Path;

use lofty::config::WriteOptions;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::prelude::Accessor;
use lofty::probe::Probe;
use lofty::tag::{ItemKey, ItemValue, Tag, TagItem};

use crate::artist_tags::{join_artist_field, parse_artist_field};
use crate::lyrics_tags;
use crate::metadata_reader::BasicTags;
use crate::metadata_writer::MetadataWriteError;
use crate::models::TrackMetadataUpdate;
use crate::rating_tags;

const RATING_KEY: &str = "RATING";

fn rating_item_key() -> ItemKey {
    ItemKey::Unknown(RATING_KEY.to_string())
}

fn open_tagged(path: &Path) -> Result<lofty::file::TaggedFile, String> {
    Probe::open(path)
        .map_err(|e| format!("Failed to open {}: {e}", path.display()))?
        .guess_file_type()
        .map_err(|e| format!("Failed to guess format for {}: {e}", path.display()))?
        .read()
        .map_err(|e| format!("Failed to read {}: {e}", path.display()))
}

fn primary_tag(tagged: &lofty::file::TaggedFile) -> Option<&Tag> {
    tagged.primary_tag().or_else(|| tagged.first_tag())
}

fn primary_tag_mut(tagged: &mut lofty::file::TaggedFile) -> &mut Tag {
    if tagged.primary_tag().is_none() {
        tagged.insert_tag(Tag::new(tagged.primary_tag_type()));
    }
    tagged
        .primary_tag_mut()
        .expect("tag inserted above")
}

pub fn read_vorbis_container_tags(path: &Path) -> (BasicTags, Option<(Vec<u8>, String)>) {
    let mut tags = BasicTags::default();
    let mut art = None;

    let Ok(tagged) = open_tagged(path) else {
        return (tags, art);
    };

    let Some(tag) = primary_tag(&tagged) else {
        if let Some(duration) = duration_from_properties(&tagged) {
            tags.duration_seconds = Some(duration);
        }
        return (tags, art);
    };

    tags.title = tag.title().map(|s| s.to_string());
    let artists: Vec<&str> = tag.get_strings(&ItemKey::TrackArtist).collect();
    if !artists.is_empty() {
        tags.artist = join_artist_field(artists);
    }
    tags.album = tag.album().map(|s| s.to_string());
    let album_artists: Vec<&str> = tag.get_strings(&ItemKey::AlbumArtist).collect();
    if !album_artists.is_empty() {
        tags.album_artist = join_artist_field(album_artists);
    }
    if let Some(value) = tag.track() {
        let (number, slash_total) = crate::metadata_reader::parse_number_pair(&value.to_string());
        tags.track_number = number;
        tags.total_tracks = slash_total;
    }
    if let Some(t) = tag.track_total() {
        tags.total_tracks = Some(t as i32);
    }
    if let Some(value) = tag.disk() {
        let (number, slash_total) = crate::metadata_reader::parse_number_pair(&value.to_string());
        tags.disc_number = number;
        tags.total_discs = slash_total;
    }
    if let Some(t) = tag.disk_total() {
        tags.total_discs = Some(t as i32);
    }
    if let Some(year) = tag.year() {
        tags.year = Some(year as i32);
    }
    tags.genre = tag.genre().map(|s| s.to_string());
    tags.rating = rating_tags::read_vorbis_rating(tag);
    tags.lyrics = lyrics_tags::read_lyrics_from_vorbis(tag);

    if let Some(duration) = duration_from_properties(&tagged) {
        tags.duration_seconds = Some(duration);
    }

    if let Some(picture) = tag.pictures().first() {
        let mime = picture
            .mime_type()
            .map(|m| m.as_str().to_string())
            .unwrap_or_else(|| "image/jpeg".to_string());
        art = Some((picture.data().to_vec(), mime));
    }

    (tags, art)
}

fn duration_from_properties(tagged: &lofty::file::TaggedFile) -> Option<f64> {
    let duration = tagged.properties().duration();
    let seconds = duration.as_secs_f64();
    if seconds > 0.0 { Some(seconds) } else { None }
}

fn set_multi_value(tag: &mut Tag, key: ItemKey, values: &[String]) {
    tag.remove_key(&key);
    for value in values {
        tag.insert(TagItem::new(key.clone(), ItemValue::Text(value.clone())));
    }
}

fn picture_mime(path: &str) -> MimeType {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".png") {
        MimeType::Png
    } else {
        MimeType::Jpeg
    }
}

pub fn write_vorbis_container_tag(
    target: &Path,
    metadata: &TrackMetadataUpdate,
) -> Result<(), MetadataWriteError> {
    let mut tagged = open_tagged(target).map_err(MetadataWriteError::Tag)?;
    let tag = primary_tag_mut(&mut tagged);

    tag.set_title(metadata.title.clone());
    if let Some(artist) = &metadata.artist {
        let values = parse_artist_field(artist);
        if values.is_empty() {
            tag.remove_key(&ItemKey::TrackArtist);
        } else {
            set_multi_value(tag, ItemKey::TrackArtist, &values);
        }
    }
    if let Some(album) = &metadata.album {
        tag.set_album(album.clone());
    } else {
        tag.remove_key(&ItemKey::AlbumTitle);
    }
    if let Some(album_artist) = &metadata.album_artist {
        let values = parse_artist_field(album_artist);
        if values.is_empty() {
            tag.remove_key(&ItemKey::AlbumArtist);
        } else {
            set_multi_value(tag, ItemKey::AlbumArtist, &values);
        }
    }
    if let Some(n) = metadata.track_number {
        tag.set_track(n as u32);
    } else {
        tag.remove_key(&ItemKey::TrackNumber);
    }
    if let Some(n) = metadata.total_tracks {
        tag.set_track_total(n as u32);
    }
    if let Some(n) = metadata.disc_number {
        tag.set_disk(n as u32);
    } else {
        tag.remove_key(&ItemKey::DiscNumber);
    }
    if let Some(n) = metadata.total_discs {
        tag.set_disk_total(n as u32);
    }
    if let Some(year) = metadata.year {
        tag.set_year(year as u32);
    } else {
        tag.remove_key(&ItemKey::Year);
    }
    if let Some(genre) = &metadata.genre {
        tag.set_genre(genre.clone());
    } else {
        tag.remove_key(&ItemKey::Genre);
    }

    if metadata.art_changed {
        tag.remove_picture_type(PictureType::CoverFront);
        if let Some(art_path) = &metadata.art_path {
            let data = std::fs::read(art_path).map_err(|e| {
                MetadataWriteError::Io(format!("Failed to read album art: {e}"))
            })?;
            let picture = Picture::new_unchecked(
                PictureType::CoverFront,
                Some(picture_mime(art_path)),
                None,
                data,
            );
            tag.set_picture(0, picture);
        }
    }

    if metadata.lyrics_changed {
        let (text, remove) = lyrics_tags::lyrics_text_for_embed(
            metadata,
            lyrics_tags::LyricsEmbedKind::SyncCapable,
        );
        lyrics_tags::apply_lyrics_to_vorbis(tag, &text, remove);
    }

    tagged
        .save_to_path(target, WriteOptions::default())
        .map_err(|e| MetadataWriteError::Tag(format!("Failed to write tags: {e}")))?;

    verify_readable(target)?;
    Ok(())
}

pub fn write_vorbis_container_lyrics(
    target: &Path,
    lyrics: Option<&crate::models::TrackLyricsInput>,
) -> Result<(), MetadataWriteError> {
    let mut tagged = open_tagged(target).map_err(MetadataWriteError::Tag)?;
    let tag = primary_tag_mut(&mut tagged);
    let (text, remove) =
        lyrics_tags::lyrics_text_for_embed_input(lyrics, lyrics_tags::LyricsEmbedKind::SyncCapable);
    lyrics_tags::apply_lyrics_to_vorbis(tag, &text, remove);

    tagged
        .save_to_path(target, WriteOptions::default())
        .map_err(|e| MetadataWriteError::Tag(format!("Failed to write lyrics: {e}")))?;

    verify_readable(target)?;
    Ok(())
}

pub fn write_vorbis_container_rating(
    target: &Path,
    canonical: u8,
) -> Result<(), MetadataWriteError> {
    let mut tagged = open_tagged(target).map_err(MetadataWriteError::Tag)?;
    let tag = primary_tag_mut(&mut tagged);
    let key = rating_item_key();

    if canonical == 0 {
        tag.remove_key(&key);
    } else {
        tag.insert_text(key, rating_tags::canonical_to_percent(canonical).to_string());
    }

    tagged
        .save_to_path(target, WriteOptions::default())
        .map_err(|e| MetadataWriteError::Tag(format!("Failed to write rating: {e}")))?;

    verify_readable(target)?;
    Ok(())
}

fn verify_readable(path: &Path) -> Result<(), MetadataWriteError> {
    open_tagged(path).map_err(|e| {
        MetadataWriteError::Tag(format!(
            "File is unreadable after tag write ({}): {e}",
            path.display()
        ))
    })?;
    Ok(())
}
