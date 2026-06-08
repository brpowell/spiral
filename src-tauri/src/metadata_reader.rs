use crate::art_cache;
use crate::models::TrackInput;
use id3::{Tag, TagLike};
use metaflac::Tag as FlacTag;
use mp4ameta::Tag as Mp4Tag;
use std::path::{Path, PathBuf};

const ARTIST_JOIN_DELIMITER: &str = " / ";

#[derive(Debug, Default, Clone)]
pub struct BasicTags {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,
    pub year: Option<i32>,
    pub genre: Option<String>,
    pub duration_seconds: Option<f64>,
}

fn join_tag_values<'a, I>(values: I) -> Option<String>
where
    I: IntoIterator<Item = &'a str>,
{
    let parts: Vec<String> = values
        .into_iter()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(ARTIST_JOIN_DELIMITER))
    }
}

fn audio_extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
}

pub fn filename_title(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Unknown Track")
        .to_string()
}

fn parse_year(value: &str) -> Option<i32> {
    let year_str = value.trim().get(..4)?;
    year_str.parse().ok()
}

fn parse_track_number(value: &str) -> Option<i32> {
    value
        .split('/')
        .next()
        .and_then(|s| s.trim().parse().ok())
}

fn cache_embedded_art(
    app_data_dir: &Path,
    file_path: &str,
    bytes: &[u8],
    mime: &str,
) -> Option<String> {
    let ext = art_cache::ext_from_mime(mime);
    art_cache::write_bytes_to_art_cache(app_data_dir, file_path, bytes, ext)
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
}

fn read_mp3_tags(path: &Path) -> (BasicTags, Option<(Vec<u8>, String)>) {
    let mut tags = BasicTags::default();
    let mut art = None;

    let Ok(tag) = Tag::read_from_path(path) else {
        return (tags, art);
    };

    tags.title = tag.title().map(|s| s.to_string());
    tags.artist = tag.artist().map(|s| s.to_string());
    tags.album = tag.album().map(|s| s.to_string());
    tags.album_artist = tag.album_artist().map(|s| s.to_string());
    tags.track_number = tag.track().map(|n| n as i32);
    tags.disc_number = tag.disc().map(|n| n as i32);
    tags.year = tag.year();
    tags.genre = tag.genre().map(|s| s.to_string());

    if let Some(picture) = tag.pictures().next() {
        art = Some((picture.data.clone(), picture.mime_type.clone()));
    }

    (tags, art)
}

fn read_flac_tags(path: &Path) -> (BasicTags, Option<(Vec<u8>, String)>) {
    let mut tags = BasicTags::default();
    let mut art = None;

    let Ok(tag) = FlacTag::read_from_path(path) else {
        return (tags, art);
    };

    if let Some(mut v) = tag.get_vorbis("TITLE") {
        tags.title = v.next().map(|s| s.to_string());
    }
    if let Some(v) = tag.get_vorbis("ARTIST") {
        tags.artist = join_tag_values(v);
    }
    if let Some(mut v) = tag.get_vorbis("ALBUM") {
        tags.album = v.next().map(|s| s.to_string());
    }
    if let Some(v) = tag.get_vorbis("ALBUMARTIST") {
        tags.album_artist = join_tag_values(v);
    }
    if let Some(mut v) = tag.get_vorbis("TRACKNUMBER") {
        if let Some(value) = v.next() {
            tags.track_number = parse_track_number(value);
        }
    }
    if let Some(mut v) = tag.get_vorbis("DISCNUMBER") {
        if let Some(value) = v.next() {
            tags.disc_number = parse_track_number(value);
        }
    }
    if let Some(mut v) = tag.get_vorbis("DATE") {
        if let Some(value) = v.next() {
            tags.year = parse_year(value);
        }
    }
    if let Some(mut v) = tag.get_vorbis("GENRE") {
        tags.genre = v.next().map(|s| s.to_string());
    }

    if let Some(streaminfo) = tag.get_streaminfo() {
        if streaminfo.sample_rate > 0 && streaminfo.total_samples > 0 {
            tags.duration_seconds =
                Some(streaminfo.total_samples as f64 / streaminfo.sample_rate as f64);
        }
    }

    if let Some(picture) = tag.pictures().next() {
        art = Some((picture.data.clone(), picture.mime_type.clone()));
    }

    (tags, art)
}

fn read_mp4_tags(path: &Path) -> (BasicTags, Option<(Vec<u8>, String)>) {
    let mut tags = BasicTags::default();
    let mut art = None;

    let Ok(tag) = Mp4Tag::read_from_path(path) else {
        return (tags, art);
    };

    tags.title = tag.title().map(|s| s.to_string());
    tags.artist = tag.artist().map(|s| s.to_string());
    tags.album = tag.album().map(|s| s.to_string());
    tags.album_artist = tag.album_artist().map(|s| s.to_string());
    tags.track_number = tag.track_number().map(|n| n as i32);
    tags.disc_number = tag.disc_number().map(|n| n as i32);
    tags.year = tag.year().and_then(|value| parse_year(value));
    tags.genre = tag.genre().map(|s| s.to_string());
    let duration = tag.duration().as_secs_f64();
    if duration > 0.0 {
        tags.duration_seconds = Some(duration);
    }

    if let Some(picture) = tag.artwork() {
        let mime = match picture.fmt {
            mp4ameta::ImgFmt::Png => "image/png",
            mp4ameta::ImgFmt::Jpeg => "image/jpeg",
            mp4ameta::ImgFmt::Bmp => "image/bmp",
        };
        art = Some((picture.data.to_vec(), mime.to_string()));
    }

    (tags, art)
}

fn read_wav_duration(path: &Path) -> Option<f64> {
    let data = std::fs::read(path).ok()?;
    if data.len() < 44 || &data[0..4] != b"RIFF" || &data[8..12] != b"WAVE" {
        return None;
    }

    let mut offset = 12usize;
    let mut byte_rate = None;
    let mut data_size = None;

    while offset + 8 <= data.len() {
        let chunk_id = &data[offset..offset + 4];
        let chunk_size = u32::from_le_bytes(data[offset + 4..offset + 8].try_into().ok()?) as usize;
        offset += 8;
        if offset + chunk_size > data.len() {
            break;
        }

        if chunk_id == b"fmt " && chunk_size >= 16 {
            byte_rate = Some(u32::from_le_bytes(data[offset + 8..offset + 12].try_into().ok()?));
        } else if chunk_id == b"data" {
            data_size = Some(chunk_size);
        }

        offset += chunk_size + (chunk_size % 2);
    }

    if let (Some(rate), Some(size)) = (byte_rate, data_size) {
        if rate > 0 {
            return Some(size as f64 / rate as f64);
        }
    }

    None
}

pub fn read_basic_tags(path: &Path) -> BasicTags {
    let ext = match audio_extension(path) {
        Some(e) => e,
        None => return BasicTags::default(),
    };

    let (tags, _) = match ext.as_str() {
        "mp3" => read_mp3_tags(path),
        "flac" => read_flac_tags(path),
        "m4a" | "aac" | "mp4" => read_mp4_tags(path),
        "wav" => {
            let mut tags = BasicTags::default();
            tags.duration_seconds = read_wav_duration(path);
            (tags, None)
        }
        _ => (BasicTags::default(), None),
    };

    tags
}

pub fn parse_track_metadata(
    app_data_dir: &Path,
    file_path: &str,
) -> Result<TrackInput, String> {
    let path = PathBuf::from(file_path);
    if !path.is_file() {
        return Err(format!("File not found: {file_path}"));
    }

    let ext = audio_extension(&path).unwrap_or_default();
    let (tags, art) = match ext.as_str() {
        "mp3" => read_mp3_tags(&path),
        "flac" => read_flac_tags(&path),
        "m4a" | "aac" | "mp4" => read_mp4_tags(&path),
        "wav" => {
            let mut tags = BasicTags::default();
            tags.duration_seconds = read_wav_duration(&path);
            (tags, None)
        }
        _ => (BasicTags::default(), None),
    };

    let art_path = art.and_then(|(bytes, mime)| {
        cache_embedded_art(app_data_dir, file_path, &bytes, &mime)
    });

    Ok(TrackInput {
        title: tags
            .title
            .unwrap_or_else(|| filename_title(&path)),
        artist: tags.artist,
        album: tags.album,
        album_artist: tags.album_artist,
        track_number: tags.track_number,
        disc_number: tags.disc_number,
        year: tags.year,
        genre: tags.genre,
        duration_seconds: tags.duration_seconds,
        file_path: file_path.to_string(),
        art_path,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn join_tag_values_joins_artists() {
        assert_eq!(
            join_tag_values(["A", " B "]),
            Some("A / B".to_string())
        );
        assert_eq!(join_tag_values::<[&str; 0]>([]), None);
    }

    #[test]
    fn filename_title_strips_extension() {
        assert_eq!(
            filename_title(Path::new("/music/My Song.mp3")),
            "My Song"
        );
    }

    #[test]
    fn parse_track_metadata_falls_back_to_filename() {
        let dir = std::env::temp_dir().join(format!("spiral-meta-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let file = dir.join("Plain.wav");
        let mut f = std::fs::File::create(&file).unwrap();
        use std::io::Write;
        writeln!(f, "not a real wav").unwrap();

        let app_data = dir.join("appdata");
        let result = parse_track_metadata(&app_data, file.to_str().unwrap()).unwrap();
        assert_eq!(result.title, "Plain");
        assert_eq!(result.file_path, file.to_string_lossy());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
