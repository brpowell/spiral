#[cfg(test)]
mod ogg_opus_support {
    use crate::audio_formats;
    use crate::audio_properties;
    use crate::file_playback::decoder::StreamingDecoder;
    use crate::metadata_reader;
    use crate::metadata_writer;
    use crate::models::TrackMetadataUpdate;
    use crate::test_fixtures::{ogg, opus};
    use std::path::Path;

    #[test]
    fn ogg_opus_allowlist_accepts_extensions() {
        assert!(audio_formats::is_supported_audio_file(Path::new(
            "/music/a.ogg"
        )));
        assert!(audio_formats::is_supported_audio_file(Path::new(
            "/music/a.opus"
        )));
    }

    #[test]
    fn read_ogg_fixture_properties() {
        let props = audio_properties::read_audio_properties(&ogg::minimal_fixture_path());
        assert_eq!(props.codec.as_deref(), Some("vorbis"));
        assert!(props.sample_rate.unwrap_or(0) > 0);
    }

    #[test]
    fn read_opus_fixture_properties() {
        let props = audio_properties::read_audio_properties(&opus::minimal_fixture_path());
        assert_eq!(props.codec.as_deref(), Some("opus"));
        assert!(props.sample_rate.unwrap_or(0) > 0);
    }

    #[test]
    fn parse_ogg_fixture_metadata() {
        let app_data = std::env::temp_dir().join(format!("spiral-ogg-meta-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&app_data);
        let result = metadata_reader::parse_track_metadata(
            &app_data,
            ogg::minimal_fixture_path().to_str().unwrap(),
            true,
        )
        .expect("parse ogg metadata");
        assert_eq!(result.codec.as_deref(), Some("vorbis"));
        assert!(result.duration_seconds.unwrap_or(0.0) > 0.0);
        let _ = std::fs::remove_dir_all(&app_data);
    }

    #[test]
    fn parse_opus_fixture_metadata() {
        let app_data =
            std::env::temp_dir().join(format!("spiral-opus-meta-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&app_data);
        let result = metadata_reader::parse_track_metadata(
            &app_data,
            opus::minimal_fixture_path().to_str().unwrap(),
            true,
        )
        .expect("parse opus metadata");
        assert_eq!(result.codec.as_deref(), Some("opus"));
        assert!(result.duration_seconds.unwrap_or(0.0) > 0.0);
        let _ = std::fs::remove_dir_all(&app_data);
    }

    #[test]
    fn ogg_metadata_write_round_trip() {
        let dir = std::env::temp_dir().join(format!("spiral-ogg-write-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let audio = ogg::copy_minimal(&dir, "tagged.ogg");
        let metadata = TrackMetadataUpdate {
            title: "OGG Title".to_string(),
            artist: Some("OGG Artist".to_string()),
            album: Some("OGG Album".to_string()),
            album_artist: None,
            track_number: Some(2),
            total_tracks: None,
            disc_number: None,
            total_discs: None,
            year: Some(2024),
            genre: Some("Electronic".to_string()),
            art_path: None,
            art_changed: false,
            lyrics: None,
            lyrics_changed: false,
            ..Default::default()
        };
        metadata_writer::write_track_metadata(&audio, &metadata).expect("write ogg");

        let tags = metadata_reader::read_basic_tags(&audio);
        assert_eq!(tags.title.as_deref(), Some("OGG Title"));
        assert_eq!(tags.artist.as_deref(), Some("OGG Artist"));
        assert_eq!(tags.album.as_deref(), Some("OGG Album"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn streaming_decoder_opens_ogg_and_opus() {
        let mut ogg = StreamingDecoder::open(&ogg::minimal_fixture_path()).expect("open ogg");
        assert!(ogg.duration_seconds() > 0.0);
        assert!(ogg.next_sample().is_some());

        let mut opus = StreamingDecoder::open(&opus::minimal_fixture_path()).expect("open opus");
        assert!(opus.sample_rate() > 0);
        assert!(opus.next_sample().is_some());
    }
}
