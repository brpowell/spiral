//! Parse MMC CD-Text packs (Format = CDTEXT / READ TOC Format 5).
//! Shared by Windows IOCTL and Linux SG_IO paths.

use std::collections::HashMap;

const PACK_LEN: usize = 18;
const TEXT_LEN: usize = 12;
const HEADER_LEN: usize = 4;

const PACK_TITLE: u8 = 0x80;
const PACK_PERFORMER: u8 = 0x81;

#[derive(Debug, Default, Clone)]
pub struct ParsedCdText {
    pub album: Option<String>,
    pub artist: Option<String>,
    pub track_titles: HashMap<u32, String>,
}

impl ParsedCdText {
    pub fn is_empty(&self) -> bool {
        self.album.is_none() && self.artist.is_none() && self.track_titles.is_empty()
    }
}

/// Parse a full CD-Text TOC response (Length + reserved + packs).
pub fn parse_cd_text_response(raw: &[u8]) -> ParsedCdText {
    if raw.len() < HEADER_LEN {
        return ParsedCdText::default();
    }
    let length = u16::from_be_bytes([raw[0], raw[1]]) as usize;
    // Length excludes the Length field itself; includes reserved + packs.
    let total = length.saturating_add(2);
    if total > raw.len() || length < 2 {
        return ParsedCdText::default();
    }
    let packs = &raw[HEADER_LEN..total];
    parse_cd_text_packs(packs)
}

/// Parse a contiguous sequence of 18-byte CD-Text packs (no TOC header).
fn parse_cd_text_packs(packs: &[u8]) -> ParsedCdText {
    if packs.is_empty() || packs.len() % PACK_LEN != 0 {
        return ParsedCdText::default();
    }

    let mut titles: HashMap<u32, String> = HashMap::new();
    let mut artist: Option<String> = None;

    let mut buffer: Vec<u8> = Vec::new();
    let mut tab_buffer: Vec<u8> = Vec::new();
    let mut prev_type: Option<u8> = None;

    for chunk in packs.chunks_exact(PACK_LEN) {
        let pack_type = chunk[0];
        let track = chunk[1] & 0x7f;
        let bncp = chunk[3];
        let block = (bncp >> 4) & 0x07;
        let db_chars = (bncp >> 7) & 0x01 != 0;
        let text = &chunk[4..4 + TEXT_LEN];

        // Prefer language block 0; skip double-byte packs (rare).
        if block != 0 || db_chars {
            continue;
        }

        if pack_type != PACK_TITLE && pack_type != PACK_PERFORMER {
            buffer.clear();
            prev_type = None;
            continue;
        }

        if prev_type != Some(pack_type) {
            buffer.clear();
            prev_type = Some(pack_type);
        }

        let mut cur_track = track;
        let mut j = 0usize;
        while j < TEXT_LEN {
            if text[j] != 0 {
                buffer.push(text[j]);
                j += 1;
                continue;
            }

            // End of string (NUL). Lone TAB repeats the previous track's value.
            let value = if buffer == b"\t" {
                if cur_track == 0 {
                    buffer.clear();
                    j += 1;
                    cur_track = cur_track.saturating_add(1);
                    continue;
                }
                String::from_utf8_lossy(&tab_buffer).into_owned()
            } else {
                if !buffer.is_empty() {
                    tab_buffer = buffer.clone();
                }
                decode_latin1(&buffer)
            };

            if !value.is_empty() {
                match pack_type {
                    PACK_TITLE => {
                        titles.insert(u32::from(cur_track), value);
                    }
                    PACK_PERFORMER if cur_track == 0 => {
                        // Disc-level only — matches macOS CdDiscCdText.
                        artist = Some(value);
                    }
                    _ => {}
                }
            }

            buffer.clear();
            cur_track = cur_track.saturating_add(1);
            j += 1;
        }
    }

    let album = titles.remove(&0).filter(|s| !s.is_empty());
    let track_titles: HashMap<u32, String> = titles
        .into_iter()
        .filter(|(n, s)| *n >= 1 && !s.is_empty())
        .collect();

    ParsedCdText {
        album,
        artist: artist.filter(|s| !s.is_empty()),
        track_titles,
    }
}

fn decode_latin1(bytes: &[u8]) -> String {
    bytes.iter().map(|&b| b as char).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pack(pack_type: u8, track: u8, seq: u8, block: u8, text: &[u8; TEXT_LEN]) -> [u8; PACK_LEN] {
        let mut out = [0u8; PACK_LEN];
        out[0] = pack_type;
        out[1] = track;
        out[2] = seq;
        out[3] = (block & 0x07) << 4;
        out[4..16].copy_from_slice(text);
        // CRC left zeroed — parser does not validate.
        out
    }

    fn text12(s: &str) -> [u8; TEXT_LEN] {
        let mut t = [0u8; TEXT_LEN];
        let bytes = s.as_bytes();
        let n = bytes.len().min(TEXT_LEN);
        t[..n].copy_from_slice(&bytes[..n]);
        t
    }

    #[test]
    fn parse_album_artist_and_track_titles() {
        // Album "My Album\0" + track1 "First Song\0" + track2 "Second\0" across packs.
        // "My Album\0First" = 8+1+5 = 14 → needs 2 packs for titles start.
        let mut packs = Vec::new();
        packs.extend_from_slice(&pack(
            PACK_TITLE,
            0,
            0,
            0,
            &text12("My Album\0Fir"),
        ));
        packs.extend_from_slice(&pack(
            PACK_TITLE,
            1,
            1,
            0,
            &text12("st Song\0Seco"),
        ));
        packs.extend_from_slice(&pack(
            PACK_TITLE,
            2,
            2,
            0,
            &text12("nd\0"),
        ));
        packs.extend_from_slice(&pack(
            PACK_PERFORMER,
            0,
            3,
            0,
            &text12("My Artist\0"),
        ));

        let parsed = parse_cd_text_packs(&packs);
        assert_eq!(parsed.album.as_deref(), Some("My Album"));
        assert_eq!(parsed.artist.as_deref(), Some("My Artist"));
        assert_eq!(parsed.track_titles.get(&1).map(String::as_str), Some("First Song"));
        assert_eq!(parsed.track_titles.get(&2).map(String::as_str), Some("Second"));
    }

    #[test]
    fn parse_response_header_and_ignore_other_block() {
        let pack0 = pack(PACK_TITLE, 0, 0, 0, &text12("Album Zero\0"));
        let pack1 = pack(PACK_TITLE, 0, 0, 1, &text12("Other Lang\0"));
        let packs_len = PACK_LEN * 2;
        let length = (2 + packs_len) as u16; // reserved + packs
        let mut raw = Vec::new();
        raw.extend_from_slice(&length.to_be_bytes());
        raw.extend_from_slice(&[0, 0]); // reserved
        raw.extend_from_slice(&pack0);
        raw.extend_from_slice(&pack1);

        let parsed = parse_cd_text_response(&raw);
        assert_eq!(parsed.album.as_deref(), Some("Album Zero"));
        assert!(!parsed.track_titles.values().any(|t| t.contains("Other")));
    }

    #[test]
    fn empty_or_malformed_returns_empty() {
        assert!(parse_cd_text_response(&[]).is_empty());
        assert!(parse_cd_text_packs(&[0u8; 17]).is_empty());
        assert!(parse_cd_text_response(&[0, 0, 0, 0]).is_empty());
    }

    #[test]
    fn latin1_high_bytes_decode() {
        let mut payload = [0u8; TEXT_LEN];
        // "Caf\xe9\0" — café in ISO-8859-1
        payload[0] = b'C';
        payload[1] = b'a';
        payload[2] = b'f';
        payload[3] = 0xe9;
        payload[4] = 0;
        let packs = pack(PACK_TITLE, 0, 0, 0, &payload);
        let parsed = parse_cd_text_packs(&packs);
        assert_eq!(parsed.album.as_deref(), Some("Café"));
    }
}
