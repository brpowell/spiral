//! Parse and apply MusicBrainz identifier tags. No file I/O.
//!
//! Picard’s Vorbis name `MUSICBRAINZ_TRACKID` stores a **recording** UUID, not the
//! MusicBrainz *track* (release-track) entity. ID3 `TXXX:MusicBrainz Track Id` is
//! that release-track id — do not read it as a recording.

use crate::mbid::parse_uuid_mbid;
use crate::models::TrackMetadataUpdate;
use id3::frame::{ExtendedText, UniqueFileIdentifier};
use id3::{Tag, TagLike};
use lofty::tag::{ItemKey, ItemValue, Tag as LoftyTag, TagItem};
use metaflac::Tag as FlacTag;
use mp4ameta::ident::{FreeformIdent, FreeformIdentStatic, APPLE_ITUNES_MEAN};
use mp4ameta::{Data, Tag as Mp4Tag};

const UFID_OWNER: &str = "http://musicbrainz.org";

const TXXX_RECORDING: &str = "MusicBrainz Recording Id";
const TXXX_RELEASE: &str = "MusicBrainz Album Id";
const TXXX_ARTIST: &str = "MusicBrainz Artist Id";
const TXXX_ALBUM_ARTIST: &str = "MusicBrainz Album Artist Id";

const VORBIS_RECORDING: &str = "MUSICBRAINZ_TRACKID";
const VORBIS_RELEASE: &str = "MUSICBRAINZ_ALBUMID";
const VORBIS_ARTIST: &str = "MUSICBRAINZ_ARTISTID";
const VORBIS_ALBUM_ARTIST: &str = "MUSICBRAINZ_ALBUMARTISTID";

const ITUNES_RECORDING: FreeformIdentStatic =
    FreeformIdent::new_static(APPLE_ITUNES_MEAN, "MusicBrainz Track Id");
const ITUNES_RELEASE: FreeformIdentStatic =
    FreeformIdent::new_static(APPLE_ITUNES_MEAN, "MusicBrainz Album Id");
const ITUNES_ARTIST: FreeformIdentStatic =
    FreeformIdent::new_static(APPLE_ITUNES_MEAN, "MusicBrainz Artist Id");
const ITUNES_ALBUM_ARTIST: FreeformIdentStatic =
    FreeformIdent::new_static(APPLE_ITUNES_MEAN, "MusicBrainz Album Artist Id");

/// Canonical in-memory MusicBrainz IDs for one audio file.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FileMbids {
    pub recording: Option<String>,
    pub release: Option<String>,
    pub artists: Vec<String>,
    pub album_artists: Vec<String>,
}

impl FileMbids {
    pub fn from_metadata(metadata: &TrackMetadataUpdate) -> Self {
        Self {
            recording: parse_uuid_mbid(metadata.recording_mbid.as_deref()),
            release: parse_uuid_mbid(metadata.release_mbid.as_deref()),
            artists: parse_uuid_list(&metadata.artist_mbids),
            album_artists: parse_uuid_list(&metadata.album_artist_mbids),
        }
    }
}

fn parse_uuid_list(ids: &[String]) -> Vec<String> {
    ids.iter()
        .filter_map(|id| parse_uuid_mbid(Some(id)))
        .collect()
}

fn mbid_from_ufid_identifier(identifier: &[u8]) -> Option<String> {
    if let Ok(text) = std::str::from_utf8(identifier) {
        if let Some(id) = parse_uuid_mbid(Some(text)) {
            return Some(id);
        }
    }
    if identifier.len() == 16 {
        let hex = hex::encode(identifier);
        let formatted = format!(
            "{}-{}-{}-{}-{}",
            &hex[0..8],
            &hex[8..12],
            &hex[12..16],
            &hex[16..20],
            &hex[20..32]
        );
        return parse_uuid_mbid(Some(&formatted));
    }
    None
}

fn first_txxx<'a>(tag: &'a Tag, description: &str) -> Option<&'a str> {
    tag.extended_texts().find_map(|ext| {
        ext.description
            .eq_ignore_ascii_case(description)
            .then_some(ext.value.as_str())
    })
}

fn all_txxx(tag: &Tag, description: &str) -> Vec<String> {
    tag.extended_texts()
        .filter(|ext| ext.description.eq_ignore_ascii_case(description))
        .flat_map(|ext| ext.value.split(['/', ';']))
        .filter_map(|part| parse_uuid_mbid(Some(part)))
        .collect()
}

fn remove_txxx(tag: &mut Tag, description: &str) {
    tag.frames_vec_mut().retain(|frame| {
        if frame.id() != "TXXX" {
            return true;
        }
        match frame.content().extended_text() {
            Some(ext) => !ext.description.eq_ignore_ascii_case(description),
            None => false,
        }
    });
}

fn push_txxx(tag: &mut Tag, description: &str, value: &str) {
    tag.frames_vec_mut().push(
        ExtendedText {
            description: description.to_string(),
            value: value.to_string(),
        }
        .into(),
    );
}

fn push_txxx_list(tag: &mut Tag, description: &str, ids: &[String]) {
    remove_txxx(tag, description);
    if ids.is_empty() {
        return;
    }
    // The id3 crate uniqueness-keys TXXX by description, so multi-credit IDs
    // share one frame (Picard uses repeated TXXX; we also split `/` on read).
    push_txxx(tag, description, &ids.join("/"));
}

pub fn read_id3_mbids(tag: &Tag) -> FileMbids {
    let recording = tag
        .unique_file_identifiers()
        .find(|ufid| ufid.owner_identifier.eq_ignore_ascii_case(UFID_OWNER))
        .and_then(|ufid| mbid_from_ufid_identifier(&ufid.identifier))
        .or_else(|| parse_uuid_mbid(first_txxx(tag, TXXX_RECORDING)));

    FileMbids {
        recording,
        release: parse_uuid_mbid(first_txxx(tag, TXXX_RELEASE)),
        artists: all_txxx(tag, TXXX_ARTIST),
        album_artists: all_txxx(tag, TXXX_ALBUM_ARTIST),
    }
}

pub fn apply_mbids_to_id3(tag: &mut Tag, mbids: &FileMbids) {
    tag.remove_unique_file_identifier_by_owner_identifier(UFID_OWNER);
    if let Some(id) = &mbids.recording {
        tag.add_frame(UniqueFileIdentifier {
            owner_identifier: UFID_OWNER.to_string(),
            identifier: id.as_bytes().to_vec(),
        });
    }

    push_txxx_list(tag, TXXX_RECORDING, mbids.recording.as_slice());
    push_txxx_list(tag, TXXX_RELEASE, mbids.release.as_slice());
    push_txxx_list(tag, TXXX_ARTIST, &mbids.artists);
    push_txxx_list(tag, TXXX_ALBUM_ARTIST, &mbids.album_artists);
}

fn first_vorbis(tag: &FlacTag, key: &str) -> Option<String> {
    tag.get_vorbis(key)
        .and_then(|mut values| values.next().and_then(|value| parse_uuid_mbid(Some(value))))
}

fn all_vorbis(tag: &FlacTag, key: &str) -> Vec<String> {
    tag.get_vorbis(key)
        .map(|values| {
            values
                .filter_map(|value| parse_uuid_mbid(Some(value)))
                .collect()
        })
        .unwrap_or_default()
}

pub fn read_flac_mbids(tag: &FlacTag) -> FileMbids {
    FileMbids {
        recording: first_vorbis(tag, VORBIS_RECORDING),
        release: first_vorbis(tag, VORBIS_RELEASE),
        artists: all_vorbis(tag, VORBIS_ARTIST),
        album_artists: all_vorbis(tag, VORBIS_ALBUM_ARTIST),
    }
}

fn set_or_remove_vorbis(tag: &mut FlacTag, key: &str, values: &[String]) {
    if values.is_empty() {
        tag.remove_vorbis(key);
    } else {
        tag.set_vorbis(key, values.to_vec());
    }
}

pub fn apply_mbids_to_flac(tag: &mut FlacTag, mbids: &FileMbids) {
    set_or_remove_vorbis(tag, VORBIS_RECORDING, mbids.recording.as_slice());
    set_or_remove_vorbis(tag, VORBIS_RELEASE, mbids.release.as_slice());
    set_or_remove_vorbis(tag, VORBIS_ARTIST, &mbids.artists);
    set_or_remove_vorbis(tag, VORBIS_ALBUM_ARTIST, &mbids.album_artists);
}

fn first_lofty(tag: &LoftyTag, key: ItemKey) -> Option<String> {
    tag.get_strings(&key)
        .next()
        .and_then(|value| parse_uuid_mbid(Some(value)))
}

fn all_lofty(tag: &LoftyTag, key: ItemKey) -> Vec<String> {
    tag.get_strings(&key)
        .filter_map(|value| parse_uuid_mbid(Some(value)))
        .collect()
}

pub fn read_vorbis_mbids(tag: &LoftyTag) -> FileMbids {
    FileMbids {
        recording: first_lofty(tag, ItemKey::MusicBrainzRecordingId),
        release: first_lofty(tag, ItemKey::MusicBrainzReleaseId),
        artists: all_lofty(tag, ItemKey::MusicBrainzArtistId),
        album_artists: all_lofty(tag, ItemKey::MusicBrainzReleaseArtistId),
    }
}

fn set_lofty_values(tag: &mut LoftyTag, key: ItemKey, values: &[String]) {
    tag.remove_key(&key);
    for value in values {
        // `insert` replaces any existing item with the same key; Vorbis allows repeats.
        tag.push(TagItem::new(key.clone(), ItemValue::Text(value.clone())));
    }
}

pub fn apply_mbids_to_vorbis(tag: &mut LoftyTag, mbids: &FileMbids) {
    set_lofty_values(
        tag,
        ItemKey::MusicBrainzRecordingId,
        mbids.recording.as_slice(),
    );
    set_lofty_values(tag, ItemKey::MusicBrainzReleaseId, mbids.release.as_slice());
    set_lofty_values(tag, ItemKey::MusicBrainzArtistId, &mbids.artists);
    set_lofty_values(
        tag,
        ItemKey::MusicBrainzReleaseArtistId,
        &mbids.album_artists,
    );
}

fn first_mp4(tag: &Mp4Tag, ident: &FreeformIdentStatic) -> Option<String> {
    tag.strings_of(ident)
        .next()
        .and_then(|value| parse_uuid_mbid(Some(value)))
}

fn all_mp4(tag: &Mp4Tag, ident: &FreeformIdentStatic) -> Vec<String> {
    tag.strings_of(ident)
        .filter_map(|value| parse_uuid_mbid(Some(value)))
        .collect()
}

pub fn read_mp4_mbids(tag: &Mp4Tag) -> FileMbids {
    FileMbids {
        recording: first_mp4(tag, &ITUNES_RECORDING),
        release: first_mp4(tag, &ITUNES_RELEASE),
        artists: all_mp4(tag, &ITUNES_ARTIST),
        album_artists: all_mp4(tag, &ITUNES_ALBUM_ARTIST),
    }
}

fn set_mp4_values(tag: &mut Mp4Tag, ident: FreeformIdentStatic, values: &[String]) {
    tag.remove_data_of(&ident);
    for value in values {
        tag.add_data(ident, Data::Utf8(value.clone()));
    }
}

pub fn apply_mbids_to_mp4(tag: &mut Mp4Tag, mbids: &FileMbids) {
    set_mp4_values(tag, ITUNES_RECORDING, mbids.recording.as_slice());
    set_mp4_values(tag, ITUNES_RELEASE, mbids.release.as_slice());
    set_mp4_values(tag, ITUNES_ARTIST, &mbids.artists);
    set_mp4_values(tag, ITUNES_ALBUM_ARTIST, &mbids.album_artists);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::metadata_backup::MetadataBackupConfig;
    use crate::metadata_reader;
    use crate::metadata_writer;
    use crate::test_fixtures::{flac, m4a, ogg, opus, wav};
    use std::fs;
    use std::io::Write;
    use std::path::{Path, PathBuf};

    const RECORDING: &str = "550e8400-e29b-41d4-a716-446655440000";
    const RELEASE: &str = "1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b";
    const ARTIST_A: &str = "a74b1b3a-d5ba-4d8a-b656-e59347b6780e";
    const ARTIST_B: &str = "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d";
    const ALBUM_ARTIST: &str = "89ad4ac3-39f7-470e-963a-56509c546377";

    fn backup_off() -> MetadataBackupConfig {
        MetadataBackupConfig {
            enabled: false,
            retention_days: 14,
        }
    }

    fn sample_mbids() -> FileMbids {
        FileMbids {
            recording: Some(RECORDING.into()),
            release: Some(RELEASE.into()),
            artists: vec![ARTIST_A.into(), ARTIST_B.into()],
            album_artists: vec![ALBUM_ARTIST.into()],
        }
    }

    fn metadata_with(mbids: FileMbids) -> TrackMetadataUpdate {
        TrackMetadataUpdate {
            title: "Tagged Title".into(),
            recording_mbid: mbids.recording,
            release_mbid: mbids.release,
            artist_mbids: mbids.artists,
            album_artist_mbids: mbids.album_artists,
            ..Default::default()
        }
    }

    fn unique_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "spiral-mbid-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_minimal_mp3(path: &Path) {
        let mut f = fs::File::create(path).unwrap();
        f.write_all(&[0xFF, 0xFB, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00])
            .unwrap();
    }

    fn copy_flac(dir: &Path) -> PathBuf {
        let dest = dir.join("test.flac");
        fs::copy(flac::minimal_fixture_path(), &dest).unwrap();
        dest
    }

    fn file_mbids_from(tags: crate::metadata_reader::BasicTags) -> FileMbids {
        FileMbids {
            recording: tags.recording_mbid,
            release: tags.release_mbid,
            artists: tags.artist_mbids,
            album_artists: tags.album_artist_mbids,
        }
    }

    fn round_trip_path(path: &Path) {
        let expected = sample_mbids();
        metadata_writer::write_track_metadata(
            path,
            &metadata_with(expected.clone()),
            &backup_off(),
        )
        .unwrap_or_else(|e| panic!("write mbids {}: {e:?}", path.display()));
        let tags = metadata_reader::read_basic_tags(path);
        assert_eq!(
            file_mbids_from(tags),
            expected,
            "round-trip {}",
            path.display()
        );

        metadata_writer::write_track_metadata(
            path,
            &metadata_with(FileMbids::default()),
            &backup_off(),
        )
        .expect("clear mbids");
        let tags = metadata_reader::read_basic_tags(path);
        assert!(tags.recording_mbid.is_none());
        assert!(tags.release_mbid.is_none());
        assert!(tags.artist_mbids.is_empty());
        assert!(tags.album_artist_mbids.is_empty());
    }

    #[test]
    fn id3_apply_round_trips_and_does_not_use_track_id_txxx() {
        let mut tag = Tag::new();
        apply_mbids_to_id3(&mut tag, &sample_mbids());
        assert_eq!(read_id3_mbids(&tag), sample_mbids());

        let ufid = tag
            .unique_file_identifiers()
            .find(|u| u.owner_identifier == UFID_OWNER)
            .unwrap();
        assert_eq!(std::str::from_utf8(&ufid.identifier).unwrap(), RECORDING);
        assert!(first_txxx(&tag, TXXX_RECORDING).is_some());

        apply_mbids_to_id3(&mut tag, &FileMbids::default());
        assert_eq!(read_id3_mbids(&tag), FileMbids::default());

        push_txxx(&mut tag, "MusicBrainz Track Id", RECORDING);
        assert!(read_id3_mbids(&tag).recording.is_none());
    }

    #[test]
    fn id3_reads_recording_from_txxx_when_ufid_absent() {
        let mut tag = Tag::new();
        push_txxx(&mut tag, TXXX_RECORDING, RECORDING);
        assert_eq!(read_id3_mbids(&tag).recording.as_deref(), Some(RECORDING));
    }

    #[test]
    fn id3_reads_repeated_and_slash_joined_artist_txxx() {
        let mut repeated = Tag::new();
        push_txxx(&mut repeated, TXXX_ARTIST, ARTIST_A);
        push_txxx(&mut repeated, TXXX_ARTIST, ARTIST_B);
        assert_eq!(
            read_id3_mbids(&repeated).artists,
            vec![ARTIST_A.to_string(), ARTIST_B.to_string()]
        );

        let mut joined = Tag::new();
        push_txxx(&mut joined, TXXX_ARTIST, &format!("{ARTIST_A}/{ARTIST_B}"));
        assert_eq!(
            read_id3_mbids(&joined).artists,
            vec![ARTIST_A.to_string(), ARTIST_B.to_string()]
        );
    }

    #[test]
    fn mp3_wav_flac_m4a_ogg_opus_write_read_clear() {
        let dir = unique_dir("formats");

        let mp3 = dir.join("song.mp3");
        write_minimal_mp3(&mp3);
        round_trip_path(&mp3);

        let wav_path = dir.join("song.wav");
        wav::write_minimal(&wav_path);
        round_trip_path(&wav_path);

        round_trip_path(&copy_flac(&dir));
        round_trip_path(&m4a::copy_moov_before_mdat(&dir, "song.m4a"));
        round_trip_path(&ogg::copy_minimal(&dir, "test.ogg"));
        let opus_path = dir.join("test.opus");
        fs::copy(opus::minimal_fixture_path(), &opus_path).unwrap();
        round_trip_path(&opus_path);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_tags_are_empty() {
        let dir = unique_dir("missing");
        let mp3 = dir.join("plain.mp3");
        write_minimal_mp3(&mp3);
        let tags = metadata_reader::read_basic_tags(&mp3);
        assert!(tags.recording_mbid.is_none());
        assert!(tags.release_mbid.is_none());
        assert!(tags.artist_mbids.is_empty());
        assert!(tags.album_artist_mbids.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn picard_flac_vorbis_names_import_into_track_input() {
        let dir = unique_dir("picard-flac");
        let audio = copy_flac(&dir);
        let mut tag = FlacTag::read_from_path(&audio).unwrap();
        tag.set_vorbis(VORBIS_RECORDING, vec![RECORDING.to_string()]);
        tag.set_vorbis(VORBIS_RELEASE, vec![RELEASE.to_string()]);
        tag.set_vorbis(
            VORBIS_ARTIST,
            vec![ARTIST_A.to_string(), ARTIST_B.to_string()],
        );
        tag.set_vorbis(VORBIS_ALBUM_ARTIST, vec![ALBUM_ARTIST.to_string()]);
        tag.save().unwrap();

        let app_data = dir.join("appdata");
        let input = metadata_reader::parse_track_metadata(&app_data, audio.to_str().unwrap(), true)
            .unwrap();
        assert_eq!(input.recording_mbid.as_deref(), Some(RECORDING));
        assert_eq!(input.release_mbid.as_deref(), Some(RELEASE));
        assert_eq!(
            input.artist_mbids,
            vec![ARTIST_A.to_string(), ARTIST_B.to_string()]
        );
        assert_eq!(input.album_artist_mbids, vec![ALBUM_ARTIST.to_string()]);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn lyrics_projection_does_not_clear_mbids() {
        let dir = unique_dir("lyrics-keep");
        let mp3 = dir.join("song.mp3");
        write_minimal_mp3(&mp3);
        metadata_writer::write_track_metadata(&mp3, &metadata_with(sample_mbids()), &backup_off())
            .unwrap();

        metadata_writer::write_lyrics_projection(
            &mp3,
            Some(&crate::lyrics_tags::track_lyrics_input_from_plain("Keep")),
            &backup_off(),
        )
        .unwrap();

        let tags = metadata_reader::read_basic_tags(&mp3);
        assert_eq!(file_mbids_from(tags), sample_mbids());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn invalid_uuid_is_not_written() {
        let dir = unique_dir("invalid");
        let mp3 = dir.join("song.mp3");
        write_minimal_mp3(&mp3);
        metadata_writer::write_track_metadata(
            &mp3,
            &TrackMetadataUpdate {
                title: "Title".into(),
                recording_mbid: Some("not-a-uuid".into()),
                artist_mbids: vec!["also-bad".into()],
                ..Default::default()
            },
            &backup_off(),
        )
        .unwrap();
        let tags = metadata_reader::read_basic_tags(&mp3);
        assert!(tags.recording_mbid.is_none());
        assert!(tags.artist_mbids.is_empty());
        let tag = Tag::read_from_path(&mp3).unwrap();
        assert_eq!(tag.unique_file_identifiers().count(), 0);
        let _ = fs::remove_dir_all(&dir);
    }
}
