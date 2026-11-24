//! Front art: from the pictures embedded in audio files into the artwork
//! registry and the album folders under `Artwork/albums/`.
//!
//! Each album folder keeps its art human-readable: the image most of its
//! tracks embed is `front.<ext>`, and a track with other art gets
//! `NN - title - front.<ext>`. The registry, not the folder, says which image a
//! track shows; the folder is never scanned to find art.

use crate::artwork_paths::{
    album_artist_for_path, album_artwork_dir, album_title_for_path, ensure_inside_album_artwork,
    ext_from_mime_or_bytes, override_art_filename, FRONT_STEM,
};
use crate::artwork_registry::{
    self, files_in, sha256_hex, ArtworkFile, ArtworkKind, EmbeddedPicture,
};
use crate::ids::TrackId;
use crate::models::{Track, TrackInput};
use rusqlite::Connection;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

/// The track whose front art is being placed, with the tags that name its
/// album folder and override file.
#[derive(Debug, Clone, Copy)]
pub struct FrontTarget<'a> {
    pub track_id: &'a TrackId,
    pub album_artist: Option<&'a str>,
    pub artist: Option<&'a str>,
    pub album: Option<&'a str>,
    pub title: &'a str,
    pub track_number: Option<i32>,
}

impl<'a> FrontTarget<'a> {
    pub fn of_track(track: &'a Track) -> Self {
        Self {
            track_id: &track.id,
            album_artist: track.album_artist.as_deref(),
            artist: track.artist.as_deref(),
            album: track.album.as_deref(),
            title: &track.title,
            track_number: track.track_number,
        }
    }

    pub fn of_input(track_id: &'a TrackId, input: &'a TrackInput) -> Self {
        Self {
            track_id,
            album_artist: input.album_artist.as_deref(),
            artist: input.artist.as_deref(),
            album: input.album.as_deref(),
            title: &input.title,
            track_number: input.track_number,
        }
    }

    pub fn album_dir(&self, library_root: &Path) -> PathBuf {
        album_artwork_dir(library_root, self.album_artist, self.artist, self.album)
    }
}

/// The picture embedded in `path` for `picture`, if any.
pub fn read_embedded(path: &Path, picture: EmbeddedPicture) -> Option<Vec<u8>> {
    match picture {
        EmbeddedPicture::CoverFront => crate::metadata_reader::read_embedded_art_bytes(path)
            .map(|(bytes, _)| bytes)
            .filter(|bytes| !bytes.is_empty()),
    }
}

fn read_embedded_front(path: &Path) -> Option<Vec<u8>> {
    ArtworkKind::Front
        .embedded_picture()
        .and_then(|picture| read_embedded(path, picture))
}

/// Link a track's front art to `bytes`, keeping a copy in its album folder:
/// the folder's copy of that image when it has one (rewritten when damaged),
/// else `front.<ext>` when the folder has no front yet, else an override named
/// for the track. Returns the image's hash. Old images are left for
/// [`artwork_registry::prune`].
pub fn place_front(
    conn: &Connection,
    library_root: &Path,
    target: &FrontTarget<'_>,
    bytes: &[u8],
) -> Result<String, String> {
    let hash = sha256_hex(bytes);
    let dir = target.album_dir(library_root);
    ensure_inside_album_artwork(library_root, &dir)?;
    let in_dir = files_in(conn, library_root, &dir)?;
    match in_dir.iter().find(|f| f.hash == hash) {
        Some(file) => {
            if !file.is_intact(library_root) {
                let path = file
                    .path(library_root)
                    .ok_or_else(|| format!("bad artwork path {}", file.rel_path))?;
                artwork_registry::store(conn, library_root, &path, bytes)?;
            }
        }
        None => {
            let ext = ext_from_mime_or_bytes("", bytes);
            let fronts: Vec<&ArtworkFile> = in_dir.iter().filter(|f| f.is_album_front()).collect();
            // A front only this track shows is replaced rather than kept beside
            // an override.
            let mut shared = false;
            for front in &fronts {
                shared |= artwork_registry::tracks_with_art(conn, ArtworkKind::Front, &front.hash)?
                    .iter()
                    .any(|id| id != target.track_id);
            }
            let dest = if shared {
                let name =
                    override_art_filename(target.track_number, target.title, FRONT_STEM, ext);
                artwork_registry::free_name(conn, library_root, &dir.join(name), &hash)?
            } else {
                let dest = dir.join(format!("{FRONT_STEM}.{ext}"));
                let dest_rel = crate::artwork_paths::to_library_relative(library_root, &dest);
                for front in fronts {
                    if Some(&front.rel_path) != dest_rel.as_ref() {
                        artwork_registry::remove_file(conn, library_root, front)?;
                    }
                }
                dest
            };
            artwork_registry::store(conn, library_root, &dest, bytes)?;
        }
    }
    artwork_registry::set_track_art(conn, target.track_id, ArtworkKind::Front, Some(&hash))?;
    Ok(hash)
}

/// Make `bytes` the album's shared front (`front.<ext>` in the track's album
/// folder, replacing the front it had) and link the track to it. What the
/// album editor sets. Tracks still linked to the old front keep that image.
pub fn place_album_front(
    conn: &Connection,
    library_root: &Path,
    target: &FrontTarget<'_>,
    bytes: &[u8],
) -> Result<String, String> {
    let hash = sha256_hex(bytes);
    let dir = target.album_dir(library_root);
    ensure_inside_album_artwork(library_root, &dir)?;
    let dest = dir.join(format!(
        "{FRONT_STEM}.{}",
        ext_from_mime_or_bytes("", bytes)
    ));
    let dest_rel = crate::artwork_paths::to_library_relative(library_root, &dest);
    for front in files_in(conn, library_root, &dir)?
        .into_iter()
        .filter(|f| f.is_album_front() && Some(&f.rel_path) != dest_rel.as_ref())
    {
        if front.hash != hash {
            artwork_registry::remove_file(conn, library_root, &front)?;
        }
    }
    let already = dest_rel
        .as_deref()
        .map(|rel| artwork_registry::file_at(conn, rel))
        .transpose()?
        .flatten()
        .is_some_and(|f| f.hash == hash && f.is_intact(library_root));
    let on_disk = fs::read(&dest).ok().is_some_and(|b| b == bytes);
    if !already {
        if on_disk {
            artwork_registry::register(conn, library_root, &dest, bytes)?;
        } else {
            artwork_registry::store(conn, library_root, &dest, bytes)?;
        }
    }
    artwork_registry::set_track_art(conn, target.track_id, ArtworkKind::Front, Some(&hash))?;
    Ok(hash)
}

/// For a track with no front art of its own: keep the image it is linked to,
/// else show its album folder's front.
pub fn link_front_without_art(
    conn: &Connection,
    library_root: &Path,
    target: &FrontTarget<'_>,
) -> Result<(), String> {
    if artwork_registry::track_art(conn, target.track_id, ArtworkKind::Front)?.is_some() {
        return Ok(());
    }
    let dir = target.album_dir(library_root);
    if let Some(front) = files_in(conn, library_root, &dir)?
        .into_iter()
        .find(ArtworkFile::is_album_front)
    {
        artwork_registry::set_track_art(
            conn,
            target.track_id,
            ArtworkKind::Front,
            Some(&front.hash),
        )?;
    }
    Ok(())
}

/// Link a track's front art to what its file embeds, else the image at
/// `fallback` (art set for a file that can't hold one), else as
/// [`link_front_without_art`]. Then prune.
pub fn link_front_from_file(
    conn: &Connection,
    library_root: &Path,
    target: &FrontTarget<'_>,
    file_path: &Path,
    fallback: Option<&Path>,
) -> Result<(), String> {
    let bytes = read_embedded_front(file_path).or_else(|| {
        fallback
            .and_then(|p| fs::read(p).ok())
            .filter(|b| !b.is_empty())
    });
    match bytes {
        Some(bytes) => {
            place_front(conn, library_root, target, &bytes)?;
        }
        None => link_front_without_art(conn, library_root, target)?,
    }
    artwork_registry::prune(conn, library_root)?;
    Ok(())
}

/// An embedded front picture read during a scan, held in app data until the
/// track is saved, so the scan doesn't keep every picture in memory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StagedFront {
    pub hash: String,
    pub path: PathBuf,
}

pub fn staging_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("artwork-staging")
}

/// Hold `bytes` for [`adopt_staged_front`]. Pictures are kept by hash, so an
/// album's tracks share one file.
pub fn stage_front(app_data_dir: &Path, bytes: &[u8]) -> Option<StagedFront> {
    if bytes.is_empty() {
        return None;
    }
    let hash = sha256_hex(bytes);
    let path = staging_dir(app_data_dir).join(&hash);
    if fs::metadata(&path).map_or(true, |m| m.len() != bytes.len() as u64) {
        fs::create_dir_all(path.parent()?).ok()?;
        fs::write(&path, bytes).ok()?;
    }
    Some(StagedFront { hash, path })
}

/// Link a saved track's front art to the picture its read staged, or as
/// [`link_front_without_art`] when it had none. A staged file another scan
/// already cleaned up is read again from the track's file.
pub fn adopt_staged_front(
    conn: &Connection,
    library_root: &Path,
    track_id: &TrackId,
    input: &TrackInput,
) -> Result<(), String> {
    let target = FrontTarget::of_input(track_id, input);
    let Some(staged) = &input.staged_front else {
        return link_front_without_art(conn, library_root, &target);
    };
    let dir = target.album_dir(library_root);
    let placed = files_in(conn, library_root, &dir)?
        .iter()
        .any(|f| f.hash == staged.hash && f.is_intact(library_root));
    if placed {
        return artwork_registry::set_track_art(
            conn,
            track_id,
            ArtworkKind::Front,
            Some(&staged.hash),
        );
    }
    let is_staged = |b: &Vec<u8>| sha256_hex(b) == staged.hash;
    let bytes = fs::read(&staged.path)
        .ok()
        .filter(is_staged)
        .or_else(|| read_embedded_front(Path::new(&input.file_path)).filter(is_staged));
    match bytes {
        Some(bytes) => place_front(conn, library_root, &target, &bytes).map(|_| ()),
        None => link_front_without_art(conn, library_root, &target),
    }
}

/// Delete the staged pictures of `inputs` once they are saved.
pub fn discard_staged<'a>(inputs: impl IntoIterator<Item = &'a TrackInput>) {
    for staged in inputs.into_iter().filter_map(|i| i.staged_front.as_ref()) {
        let _ = fs::remove_file(&staged.path);
    }
}

#[derive(Debug, Clone)]
pub struct TrackArtSource {
    pub track_id: TrackId,
    pub title: String,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,
    /// The embedded picture, when the file has one.
    pub bytes: Option<Vec<u8>>,
    /// The file can't hold a picture, so its link is the only record of its art.
    pub keeps_link: bool,
}

fn track_sort_key(t: &TrackArtSource) -> (i32, i32, String) {
    (
        t.disc_number.unwrap_or(1),
        t.track_number.unwrap_or(i32::MAX),
        t.title.to_ascii_lowercase(),
    )
}

/// Choose canonical SHA: largest group; ties → lowest disc/track/title among members.
fn pick_canonical_sha(
    groups: &HashMap<String, Vec<usize>>,
    tracks: &[TrackArtSource],
) -> Option<String> {
    let mut best: Option<(usize, (i32, i32, String), String)> = None;
    for (sha, indices) in groups {
        let count = indices.len();
        let min_key = indices
            .iter()
            .map(|&i| track_sort_key(&tracks[i]))
            .min()
            .unwrap_or((i32::MAX, i32::MAX, String::new()));
        let candidate = (count, min_key, sha.clone());
        match &best {
            None => best = Some(candidate),
            Some(current) => {
                // Prefer higher count; on equal count prefer smaller sort key.
                if candidate.0 > current.0 || (candidate.0 == current.0 && candidate.1 < current.1)
                {
                    best = Some(candidate);
                }
            }
        }
    }
    best.map(|(_, _, sha)| sha)
}

/// Rebuild one album folder from its tracks' embedded pictures and relink the
/// tracks: the majority image is `front.<ext>`, each other image an override
/// named for its first track. Tracks without a picture show the front; one
/// whose file can't hold a picture keeps its link. Recorded files in the folder
/// that are no longer used there go (unless they are an image's only copy).
pub fn write_album_unique_art(
    conn: &Connection,
    library_root: &Path,
    album_artist: Option<&str>,
    artist: Option<&str>,
    album: Option<&str>,
    tracks: &[TrackArtSource],
) -> Result<(), String> {
    let album_dir = album_artwork_dir(library_root, album_artist, artist, album);
    ensure_inside_album_artwork(library_root, &album_dir)?;

    let mut groups: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, track) in tracks.iter().enumerate() {
        if let Some(bytes) = &track.bytes {
            groups.entry(sha256_hex(bytes)).or_default().push(i);
        }
    }
    let canonical = pick_canonical_sha(&groups, tracks);
    let mut kept: HashSet<String> = HashSet::new();

    if let Some(canonical) = &canonical {
        let bytes = tracks[groups[canonical][0]]
            .bytes
            .as_deref()
            .unwrap_or_default();
        let target = target_for(&tracks[groups[canonical][0]], album_artist, artist, album);
        let hash = place_album_front(conn, library_root, &target, bytes)?;
        kept.extend(rel_paths_in(conn, library_root, &album_dir, &hash)?);
    }
    let mut others: Vec<(&String, &Vec<usize>)> = groups
        .iter()
        .filter(|(sha, _)| Some(*sha) != canonical.as_ref())
        .collect();
    others.sort_by_key(|(_, indices)| indices.iter().map(|&i| track_sort_key(&tracks[i])).min());
    for (sha, indices) in others {
        let first = indices
            .iter()
            .copied()
            .min_by_key(|&i| track_sort_key(&tracks[i]))
            .unwrap_or(indices[0]);
        let bytes = tracks[first].bytes.as_deref().unwrap_or_default();
        let target = target_for(&tracks[first], album_artist, artist, album);
        place_front(conn, library_root, &target, bytes)?;
        kept.extend(rel_paths_in(conn, library_root, &album_dir, sha)?);
    }

    for track in tracks {
        let hash = match &track.bytes {
            Some(bytes) => Some(sha256_hex(bytes)),
            None if track.keeps_link => continue,
            None => canonical.clone(),
        };
        artwork_registry::set_track_art(
            conn,
            &track.track_id,
            ArtworkKind::Front,
            hash.as_deref(),
        )?;
    }

    for file in files_in(conn, library_root, &album_dir)? {
        if kept.contains(&file.rel_path) {
            continue;
        }
        let elsewhere = artwork_registry::files_for_hash(conn, &file.hash)?
            .iter()
            .any(|f| f.rel_path != file.rel_path && f.is_intact(library_root));
        let used_here = tracks.iter().any(|t| {
            t.keeps_link
                && artwork_registry::track_art(conn, &t.track_id, ArtworkKind::Front)
                    .ok()
                    .flatten()
                    .as_deref()
                    == Some(file.hash.as_str())
        });
        if elsewhere && !used_here {
            artwork_registry::remove_file(conn, library_root, &file)?;
        }
    }
    Ok(())
}

fn target_for<'a>(
    track: &'a TrackArtSource,
    album_artist: Option<&'a str>,
    artist: Option<&'a str>,
    album: Option<&'a str>,
) -> FrontTarget<'a> {
    FrontTarget {
        track_id: &track.track_id,
        album_artist,
        artist,
        album,
        title: &track.title,
        track_number: track.track_number,
    }
}

fn rel_paths_in(
    conn: &Connection,
    library_root: &Path,
    dir: &Path,
    hash: &str,
) -> Result<Vec<String>, String> {
    Ok(files_in(conn, library_root, dir)?
        .into_iter()
        .filter(|f| f.hash == hash)
        .map(|f| f.rel_path)
        .collect())
}

/// Rebuild every album folder from embedded pictures, relink every track and
/// prune what nothing uses.
pub fn reconstruct_all_album_artwork(conn: &Connection, library_root: &Path) -> Result<(), String> {
    let tracks = crate::db::get_all_tracks(conn).map_err(|e| e.to_string())?;
    let mut albums: HashMap<(String, String), Vec<Track>> = HashMap::new();
    for track in tracks {
        let key = (
            album_artist_for_path(track.album_artist.as_deref(), track.artist.as_deref()),
            album_title_for_path(track.album.as_deref()),
        );
        albums.entry(key).or_default().push(track);
    }

    for album_tracks in albums.values() {
        let first = &album_tracks[0];
        let sources: Vec<TrackArtSource> = album_tracks
            .iter()
            .map(|t| {
                let path = Path::new(&t.file_path);
                TrackArtSource {
                    track_id: t.id.clone(),
                    title: t.title.clone(),
                    track_number: t.track_number,
                    disc_number: t.disc_number,
                    bytes: read_embedded_front(path),
                    keeps_link: !crate::metadata_writer::can_embed_art(path)
                        || t.missing_since.is_some(),
                }
            })
            .collect();
        write_album_unique_art(
            conn,
            library_root,
            first.album_artist.as_deref(),
            first.artist.as_deref(),
            first.album.as_deref(),
            &sources,
        )?;
    }
    artwork_registry::prune(conn, library_root)?;
    Ok(())
}

/// Rewrite damaged front art from the tracks that embed it. An image linked as
/// a track's front with no intact copy is written again, where its damaged
/// copies were recorded (or placed in the track's album folder), from the first
/// of its tracks whose file still embeds exactly that image. Images that can't
/// be rebuilt stay as they are and show the placeholder. Returns how many
/// images were repaired.
pub fn repair_front_art(conn: &Connection, library_root: &Path) -> Result<usize, String> {
    let files = artwork_registry::all_files(conn)?;
    let links = artwork_registry::all_track_art(conn, ArtworkKind::Front)?;
    let mut checked: HashMap<&str, bool> = HashMap::new();
    let mut damaged: Vec<&String> = Vec::new();
    for hash in links.values() {
        if checked.contains_key(hash.as_str()) {
            continue;
        }
        let ok = files
            .get(hash)
            .is_some_and(|fs| fs.iter().any(|f| f.is_intact(library_root)));
        checked.insert(hash, ok);
        if !ok {
            damaged.push(hash);
        }
    }

    let mut repaired = 0;
    for hash in damaged {
        for track_id in artwork_registry::tracks_with_art(conn, ArtworkKind::Front, hash)? {
            let Some(track) =
                crate::db::get_track_by_id(conn, &track_id).map_err(|e| e.to_string())?
            else {
                continue;
            };
            if track.missing_since.is_some() {
                continue;
            }
            let Some(bytes) =
                read_embedded_front(Path::new(&track.file_path)).filter(|b| sha256_hex(b) == *hash)
            else {
                continue;
            };
            let copies = files.get(hash).map_or(&[][..], Vec::as_slice);
            if copies.is_empty() {
                place_front(conn, library_root, &FrontTarget::of_track(&track), &bytes)?;
            } else {
                for copy in copies {
                    if let Some(path) = copy.path(library_root) {
                        artwork_registry::store(conn, library_root, &path, &bytes)?;
                    }
                }
            }
            repaired += 1;
            break;
        }
    }
    Ok(repaired)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::artwork_registry::ArtworkFile;
    use crate::source_test_support::{add_managed_source, conn, TempDir};
    use rusqlite::params;

    struct Library {
        tmp: TempDir,
        conn: Connection,
        source: i64,
    }

    impl Library {
        fn new(label: &str) -> Self {
            let tmp = TempDir::new(label);
            let conn = conn();
            crate::sources::attach_spiral_folder(&conn, &tmp.0).unwrap();
            let source = add_managed_source(&conn, &tmp.dir("Tracks"));
            Self { tmp, conn, source }
        }

        fn root(&self) -> &Path {
            &self.tmp.0
        }

        fn track(&self, title: &str, number: i32, album: &str) -> TrackId {
            let id = TrackId::new();
            self.conn
                .execute(
                    "INSERT INTO tracks (id, title, artist, album, track_number, rel_path,
                                         date_added, source_id)
                     VALUES (?1, ?2, 'Artist', ?3, ?4, ?5, 'now', ?6)",
                    params![
                        id,
                        title,
                        album,
                        number,
                        format!("{album}/{title}.mp3"),
                        self.source
                    ],
                )
                .unwrap();
            id
        }

        fn target<'a>(
            &self,
            id: &'a TrackId,
            title: &'a str,
            number: i32,
            album: &'a str,
        ) -> FrontTarget<'a> {
            FrontTarget {
                track_id: id,
                album_artist: None,
                artist: Some("Artist"),
                album: Some(album),
                title,
                track_number: Some(number),
            }
        }

        fn front(&self, id: &TrackId) -> Option<String> {
            artwork_registry::track_art(&self.conn, id, ArtworkKind::Front).unwrap()
        }

        fn files(&self) -> Vec<(String, String)> {
            let mut files: Vec<(String, String)> = artwork_registry::all_files(&self.conn)
                .unwrap()
                .into_values()
                .flatten()
                .map(|f: ArtworkFile| (f.rel_path, f.hash))
                .collect();
            files.sort();
            files
        }

        fn rev(&self) -> i64 {
            self.conn
                .query_row("SELECT rev FROM library_meta", [], |r| r.get(0))
                .unwrap()
        }
    }

    fn source(id: &TrackId, title: &str, num: i32, bytes: Option<&[u8]>) -> TrackArtSource {
        TrackArtSource {
            track_id: id.clone(),
            title: title.into(),
            track_number: Some(num),
            disc_number: Some(1),
            bytes: bytes.map(<[u8]>::to_vec),
            keeps_link: false,
        }
    }

    #[test]
    fn an_album_with_two_covers_gets_a_front_and_an_override() {
        let lib = Library::new("two-covers");
        let common = b"CANONICAL-ART-BYTES";
        let other = b"UNIQUE-ART";
        let mut sources = Vec::new();
        for i in 1..=3 {
            let id = lib.track(&format!("T{i}"), i, "Album");
            sources.push(source(&id, &format!("T{i}"), i, Some(common)));
        }
        let alt = lib.track("Alt", 4, "Album");
        sources.push(source(&alt, "Alt", 4, Some(other)));
        let bare = lib.track("Bare", 5, "Album");
        sources.push(source(&bare, "Bare", 5, None));

        write_album_unique_art(
            &lib.conn,
            lib.root(),
            None,
            Some("Artist"),
            Some("Album"),
            &sources,
        )
        .unwrap();

        let (common_hash, other_hash) = (sha256_hex(common), sha256_hex(other));
        assert_eq!(
            lib.files(),
            vec![
                (
                    "Artwork/albums/Artist/Album/04 - Alt - front.jpg".into(),
                    other_hash.clone()
                ),
                (
                    "Artwork/albums/Artist/Album/front.jpg".into(),
                    common_hash.clone()
                ),
            ]
        );
        for s in &sources[..3] {
            assert_eq!(
                lib.front(&s.track_id).as_deref(),
                Some(common_hash.as_str())
            );
        }
        assert_eq!(lib.front(&alt).as_deref(), Some(other_hash.as_str()));
        // No picture of its own: it shows the album's front.
        assert_eq!(lib.front(&bare).as_deref(), Some(common_hash.as_str()));

        let mut track = crate::db::get_track_by_id(&lib.conn, &alt)
            .unwrap()
            .unwrap();
        crate::artwork_paths::hydrate_track_art_path(&lib.conn, lib.root(), &mut track);
        assert!(track.art_path.unwrap().ends_with("04 - Alt - front.jpg"));
    }

    #[test]
    fn tie_break_prefers_earlier_track() {
        let lib = Library::new("tie");
        let second = lib.track("Second", 2, "B");
        let first = lib.track("First", 1, "B");
        let sources = vec![
            source(&second, "Second", 2, Some(b"YYYY")),
            source(&first, "First", 1, Some(b"XXXX")),
        ];
        write_album_unique_art(
            &lib.conn,
            lib.root(),
            None,
            Some("Artist"),
            Some("B"),
            &sources,
        )
        .unwrap();
        let files = lib.files();
        assert!(files.contains(&(
            "Artwork/albums/Artist/B/front.jpg".into(),
            sha256_hex(b"XXXX")
        )));
        assert!(files.contains(&(
            "Artwork/albums/Artist/B/02 - Second - front.jpg".into(),
            sha256_hex(b"YYYY")
        )));
    }

    #[test]
    fn two_albums_with_one_cover_share_an_image_and_keep_their_own_files() {
        let lib = Library::new("shared");
        let cover = b"SAME-COVER";
        let a = lib.track("A", 1, "One");
        let b = lib.track("B", 1, "Two");
        place_front(&lib.conn, lib.root(), &lib.target(&a, "A", 1, "One"), cover).unwrap();
        place_front(&lib.conn, lib.root(), &lib.target(&b, "B", 1, "Two"), cover).unwrap();
        let hash = sha256_hex(cover);
        let images: i64 = lib
            .conn
            .query_row("SELECT COUNT(*) FROM artwork", [], |r| r.get(0))
            .unwrap();
        assert_eq!(images, 1);
        assert_eq!(
            lib.files(),
            vec![
                ("Artwork/albums/Artist/One/front.jpg".into(), hash.clone()),
                ("Artwork/albums/Artist/Two/front.jpg".into(), hash.clone()),
            ]
        );
        // Each track shows its own album's copy.
        let mut track = crate::db::get_track_by_id(&lib.conn, &b).unwrap().unwrap();
        crate::artwork_paths::hydrate_track_art_path(&lib.conn, lib.root(), &mut track);
        assert_eq!(
            track.art_path.unwrap(),
            lib.root()
                .join("Artwork/albums/Artist/Two/front.jpg")
                .to_string_lossy()
        );
    }

    #[test]
    fn a_track_without_art_shows_its_albums_front() {
        let lib = Library::new("bare");
        let a = lib.track("A", 1, "One");
        let b = lib.track("B", 2, "One");
        place_front(
            &lib.conn,
            lib.root(),
            &lib.target(&a, "A", 1, "One"),
            b"FRONT",
        )
        .unwrap();
        link_front_without_art(&lib.conn, lib.root(), &lib.target(&b, "B", 2, "One")).unwrap();
        assert_eq!(lib.front(&b), Some(sha256_hex(b"FRONT")));
    }

    #[test]
    fn unlinked_images_are_pruned_with_their_files() {
        let lib = Library::new("prune");
        let a = lib.track("A", 1, "One");
        place_front(
            &lib.conn,
            lib.root(),
            &lib.target(&a, "A", 1, "One"),
            b"OLD",
        )
        .unwrap();
        place_front(
            &lib.conn,
            lib.root(),
            &lib.target(&a, "A", 1, "One"),
            b"NEW",
        )
        .unwrap();
        assert_eq!(artwork_registry::prune(&lib.conn, lib.root()).unwrap(), 1);
        // No other track showed the old front, so the new image replaced it.
        assert_eq!(
            lib.files(),
            vec![(
                "Artwork/albums/Artist/One/front.jpg".into(),
                sha256_hex(b"NEW")
            )]
        );
        assert_eq!(
            fs::read(lib.root().join("Artwork/albums/Artist/One/front.jpg")).unwrap(),
            b"NEW"
        );

        // A front another track shows stays; the new image is an override.
        let b = lib.track("B", 2, "One");
        link_front_without_art(&lib.conn, lib.root(), &lib.target(&b, "B", 2, "One")).unwrap();
        place_front(
            &lib.conn,
            lib.root(),
            &lib.target(&a, "A", 1, "One"),
            b"NEWER",
        )
        .unwrap();
        assert_eq!(
            lib.files(),
            vec![
                (
                    "Artwork/albums/Artist/One/01 - A - front.jpg".into(),
                    sha256_hex(b"NEWER")
                ),
                (
                    "Artwork/albums/Artist/One/front.jpg".into(),
                    sha256_hex(b"NEW")
                ),
            ]
        );
        lib.conn
            .execute("DELETE FROM tracks WHERE id = ?1", [&b])
            .unwrap();

        lib.conn
            .execute("DELETE FROM tracks WHERE id = ?1", [&a])
            .unwrap();
        artwork_registry::prune(&lib.conn, lib.root()).unwrap();
        assert!(lib.files().is_empty());
        assert!(!lib.root().join("Artwork/albums/Artist").exists());
    }

    #[test]
    fn a_damaged_front_is_rewritten_from_the_tracks_tags() {
        let lib = Library::new("repair");
        let tracks = lib.root().join("Tracks");
        fs::create_dir_all(tracks.join("One")).unwrap();
        let audio = tracks.join("One/A.mp3");
        crate::test_fixtures::mp3::copy_minimal(&tracks.join("One"), "A.mp3");
        let art = lib.root().join("cover.jpg");
        let cover = b"\xFF\xD8\xFF\xE0embedded-cover";
        fs::write(&art, cover).unwrap();
        crate::metadata_writer::write_track_metadata(
            &audio,
            &crate::models::TrackMetadataUpdate {
                title: "A".into(),
                art_path: Some(art.to_string_lossy().into_owned()),
                art_changed: true,
                ..Default::default()
            },
        )
        .unwrap();
        let a = lib.track("A", 1, "One");
        link_front_from_file(
            &lib.conn,
            lib.root(),
            &lib.target(&a, "A", 1, "One"),
            &audio,
            None,
        )
        .unwrap();
        let front = lib.root().join("Artwork/albums/Artist/One/front.jpg");
        assert_eq!(fs::read(&front).unwrap(), cover);

        // Changed by hand: damaged, not taken as new art.
        fs::write(&front, b"something else").unwrap();
        let mut track = crate::db::get_track_by_id(&lib.conn, &a).unwrap().unwrap();
        crate::artwork_paths::hydrate_track_art_path(&lib.conn, lib.root(), &mut track);
        assert_eq!(track.art_path, None, "a damaged copy shows the placeholder");
        assert_eq!(repair_front_art(&lib.conn, lib.root()).unwrap(), 1);
        assert_eq!(fs::read(&front).unwrap(), cover);
        assert_eq!(lib.front(&a), Some(sha256_hex(cover)));

        // Gone: written again in its place.
        fs::remove_file(&front).unwrap();
        assert_eq!(repair_front_art(&lib.conn, lib.root()).unwrap(), 1);
        assert_eq!(fs::read(&front).unwrap(), cover);
        assert_eq!(repair_front_art(&lib.conn, lib.root()).unwrap(), 0);
    }

    #[test]
    fn staged_pictures_are_adopted_on_save() {
        let lib = Library::new("staged");
        let app_data = lib.root().join("AppData");
        let a = lib.track("A", 1, "One");
        let input = TrackInput {
            title: "A".into(),
            artist: Some("Artist".into()),
            album: Some("One".into()),
            track_number: Some(1),
            staged_front: stage_front(&app_data, b"STAGED"),
            ..Default::default()
        };
        adopt_staged_front(&lib.conn, lib.root(), &a, &input).unwrap();
        discard_staged([&input]);
        assert_eq!(lib.front(&a), Some(sha256_hex(b"STAGED")));
        assert_eq!(
            lib.files(),
            vec![(
                "Artwork/albums/Artist/One/front.jpg".into(),
                sha256_hex(b"STAGED")
            )]
        );
        assert!(!input.staged_front.unwrap().path.exists());
    }

    #[test]
    fn every_front_write_moves_the_library_rev() {
        let lib = Library::new("rev");
        let a = lib.track("A", 1, "One");
        let b = lib.track("B", 2, "One");
        let mut last = lib.rev();
        let mut moved = |what: &str| {
            let now = lib.rev();
            assert!(now > last, "{what} did not move rev");
            last = now;
        };
        place_front(
            &lib.conn,
            lib.root(),
            &lib.target(&a, "A", 1, "One"),
            b"ONE",
        )
        .unwrap();
        moved("place_front");
        place_album_front(
            &lib.conn,
            lib.root(),
            &lib.target(&a, "A", 1, "One"),
            b"TWO",
        )
        .unwrap();
        moved("place_album_front");
        link_front_without_art(&lib.conn, lib.root(), &lib.target(&b, "B", 2, "One")).unwrap();
        moved("link_front_without_art");
        let sources = vec![source(&a, "A", 1, Some(b"THREE")), source(&b, "B", 2, None)];
        write_album_unique_art(
            &lib.conn,
            lib.root(),
            None,
            Some("Artist"),
            Some("One"),
            &sources,
        )
        .unwrap();
        moved("write_album_unique_art");
        let input = TrackInput {
            title: "B".into(),
            artist: Some("Artist".into()),
            album: Some("One".into()),
            staged_front: stage_front(&lib.root().join("AppData"), b"FOUR"),
            ..Default::default()
        };
        adopt_staged_front(&lib.conn, lib.root(), &b, &input).unwrap();
        moved("adopt_staged_front");
    }
}
