//! Integrity-keyed frontend (anti-tamper): the release frontend bundle ships
//! encrypted, and its key is derived at runtime from `SHA-256(__TEXT,__text)` —
//! the same code region the self-hash guards cover. A clean build reproduces the
//! exact key the build pipeline used, so the custom asset protocol decrypts and
//! the UI runs. A binary whose code was patched (a cracked license branch, a
//! neutralised guard) hashes to a different key, the frontend fails to decrypt,
//! and there is no working app to extract. Forging the clean hash while keeping
//! a patch is a SHA-256 second-preimage — infeasible — so the attacker must
//! choose between an unpatched (still-guarded) binary and a non-functional one.
//!
//! The pipeline (`scripts/release/encrypt-frontend.mjs`) and this module share a
//! byte-exact stream cipher: keystream block `i` of a segment is
//! `SHA-256(key ‖ LE32(stream_id) ‖ LE64(i))`, XORed into the data. `stream_id`
//! is distinct per segment (0 = manifest, 1.. = files) so no keystream repeats.
//! The shared test vectors below pin the two implementations together, exactly
//! as `selfcheck`'s FNV reference vector pins the guard hash.
//!
//! Confidentiality of the UI code is not the goal (a running webview must hold
//! the plaintext — that ceiling is unavoidable); binding the UI to an intact
//! binary is. Everything here is release-only: `tauri dev` loads Vite directly
//! and never touches this path.

use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::io::{Seek, SeekFrom};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};

/// Custom URI scheme the webview loads the decrypted frontend from in a
/// release build (`spiralfe://localhost/…`). Dev loads Vite directly.
pub const SCHEME: &str = "spiralfe";

/// Bundle-resource filename of the encrypted frontend container.
pub const RESOURCE_NAME: &str = "frontend.spe";

/// The decrypted frontend. Set by the background decrypt started in
/// [`begin_activation`]; absent in dev, with encryption off, until decryption
/// finishes, or forever when decryption fails (patched binary).
static ACTIVE: OnceLock<Frontend> = OnceLock::new();

/// Fast synchronous decision (set before any window is created): does this build
/// ship an encrypted bundle, so windows should load via the custom scheme? This
/// is decided from the 4-byte container magic alone, so the actual (heavier)
/// decryption can run on a background thread concurrent with WebKit init rather
/// than blocking startup.
static USE_SCHEME: OnceLock<bool> = OnceLock::new();

/// Set once the background decrypt has finished (whether it succeeded or not),
/// so the request handler waits only while decryption is genuinely in flight.
static ACTIVATION_DONE: AtomicBool = AtomicBool::new(false);

/// Container magic (`"SPE1"`): first 4 bytes of an encrypted bundle.
const MAGIC: [u8; 4] = *b"SPE1";

/// One keystream block: `SHA-256(key ‖ LE32(stream_id) ‖ LE64(block))`.
fn keystream_block(key: &[u8; 32], stream_id: u32, block: u64) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(key);
    h.update(stream_id.to_le_bytes());
    h.update(block.to_le_bytes());
    h.finalize().into()
}

/// XOR `data` in place with the keystream for `stream_id` (counter from 0).
fn xor_stream(key: &[u8; 32], stream_id: u32, data: &mut [u8]) {
    let mut block: u64 = 0;
    let mut off = 0usize;
    while off < data.len() {
        let ks = keystream_block(key, stream_id, block);
        let n = (data.len() - off).min(32);
        for i in 0..n {
            data[off + i] ^= ks[i];
        }
        off += n;
        block += 1;
    }
}

/// Derive the frontend key from this executable's patched `__text` region.
/// `None` on an unpatched build (no stable region) or any read error.
pub fn derive_key() -> Option<[u8; 32]> {
    let (off, len) = crate::selfcheck::text_region()?;
    let exe = std::env::current_exe().ok()?;
    let mut f = File::open(&exe).ok()?;
    f.seek(SeekFrom::Start(off)).ok()?;
    let mut hasher = Sha256::new();
    let mut remaining = len;
    let mut buf = [0u8; 64 * 1024];
    while remaining > 0 {
        let want = remaining.min(buf.len() as u64) as usize;
        let n = f.read(&mut buf[..want]).ok()?;
        if n == 0 {
            return None; // truncated
        }
        hasher.update(&buf[..n]);
        remaining -= n as u64;
    }
    Some(hasher.finalize().into())
}

/// A decrypted frontend: maps a request path (e.g. `index.html`,
/// `assets/index-ABC.js`) to its bytes and content type.
pub struct Frontend {
    files: HashMap<String, (Vec<u8>, String)>,
}

impl Frontend {
    /// Look up a served path (leading `/` optional).
    pub fn get(&self, path: &str) -> Option<&(Vec<u8>, String)> {
        let key = path.trim_start_matches('/');
        self.files.get(key)
    }

    pub fn len(&self) -> usize {
        self.files.len()
    }

    pub fn is_empty(&self) -> bool {
        self.files.is_empty()
    }
}

#[derive(serde::Deserialize)]
struct ManifestEntry {
    /// Served path (no leading slash), e.g. `assets/index-ABC.js`.
    p: String,
    /// Plaintext length in bytes.
    len: u64,
    /// Content type to serve with.
    ct: String,
}

/// Parse + decrypt an encrypted bundle with `key`. Returns `None` if the bytes
/// aren't a valid container (wrong magic/truncated) or the manifest won't parse
/// — callers treat that as "no decryptable frontend" (wrong key, etc.).
pub fn decrypt(bundle: &[u8], key: &[u8; 32]) -> Option<Frontend> {
    if bundle.len() < 8 || bundle[..4] != MAGIC {
        return None;
    }
    let manifest_len = u32::from_le_bytes(bundle[4..8].try_into().ok()?) as usize;
    let body = &bundle[8..];
    if body.len() < manifest_len {
        return None;
    }
    let mut manifest_bytes = body[..manifest_len].to_vec();
    xor_stream(key, 0, &mut manifest_bytes); // stream 0 = manifest
    let entries: Vec<ManifestEntry> = serde_json::from_slice(&manifest_bytes).ok()?;

    let mut files = HashMap::new();
    let mut cursor = manifest_len;
    for (idx, e) in entries.iter().enumerate() {
        let stream_id = (idx as u32).checked_add(1)?; // 1.. = files
        let seg_len = e.len as usize;
        if body.len() < cursor + seg_len {
            return None;
        }
        let mut seg = body[cursor..cursor + seg_len].to_vec();
        xor_stream(key, stream_id, &mut seg);
        cursor += seg_len;
        files.insert(e.p.clone(), (seg, e.ct.clone()));
    }
    Some(Frontend { files })
}

/// Decide synchronously whether this build serves an encrypted frontend (from
/// the 4-byte container magic alone — cheap), then kick off the actual key
/// derivation + decryption on a BACKGROUND thread so it overlaps WebKit init
/// instead of blocking startup. Call once, before any window is created.
/// [`is_active`] reads the decision and picks the window URL.
///
/// The webview does not request assets until well after this returns, and the
/// decrypt finishes in ~tens of ms, so the handler never actually waits. A
/// missing/sentinel resource (dev / encryption off) → no scheme, normal
/// embedded frontend. A present-but-undecryptable bundle (patched binary) →
/// scheme chosen but nothing ever served, which is the intended "no UI" outcome.
pub fn begin_activation(app: &AppHandle) {
    let use_scheme = resource_is_container(app);
    let _ = USE_SCHEME.set(use_scheme);
    if !use_scheme {
        ACTIVATION_DONE.store(true, Ordering::Release);
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || decrypt_into_active(&app));
}

/// True iff the bundle resource exists and starts with the container magic —
/// read from just the first 4 bytes, so it is near-instant.
fn resource_is_container(app: &AppHandle) -> bool {
    let Ok(path) = app
        .path()
        .resolve(RESOURCE_NAME, tauri::path::BaseDirectory::Resource)
    else {
        return false;
    };
    let Ok(mut f) = File::open(&path) else {
        return false;
    };
    let mut head = [0u8; 4];
    f.read_exact(&mut head).is_ok() && head == MAGIC
}

/// Derive the key from this binary's `__text`, decrypt the bundle, and publish
/// it. Runs on the background thread. Always marks activation done at the end so
/// the request handler never waits past a genuine decrypt.
fn decrypt_into_active(app: &AppHandle) {
    let outcome = (|| {
        let path = app
            .path()
            .resolve(RESOURCE_NAME, tauri::path::BaseDirectory::Resource)
            .ok()?;
        let bundle = std::fs::read(&path).ok()?;
        let Some(key) = derive_key() else {
            diag("frontend_crypt: encrypted bundle present but __text region unavailable");
            return None;
        };
        match decrypt(&bundle, &key) {
            Some(fe) if !fe.is_empty() => {
                diag(&format!("frontend_crypt: active ({} files)", fe.len()));
                Some(fe)
            }
            _ => {
                diag("frontend_crypt: bundle present but did not decrypt (integrity mismatch)");
                None
            }
        }
    })();
    if let Some(fe) = outcome {
        let _ = ACTIVE.set(fe);
    }
    ACTIVATION_DONE.store(true, Ordering::Release);
}

/// Emit an internal diagnostic ONLY when `SPIRAL_FE_TRACE` is set. Shipping
/// builds are silent — an end user must never see frontend_crypt internals (and
/// a tamperer gets no decryption breadcrumbs). Build verification / the smoke
/// gate sets the var to observe boot.
fn diag(msg: &str) {
    if std::env::var_os("SPIRAL_FE_TRACE").is_some() {
        eprintln!("{msg}");
    }
}

/// Whether this build serves the encrypted frontend over the custom scheme (the
/// fast decision from [`begin_activation`]). Used to pick the window URL at
/// creation time — it must not block on the background decrypt.
pub fn is_active() -> bool {
    *USE_SCHEME.get().unwrap_or(&false)
}

/// The decrypted frontend for the request handler. Decryption runs on a
/// background thread started before any window; by the time the webview requests
/// assets it is normally finished, but wait briefly if it is still in flight so
/// an early request isn't dropped. Returns as soon as activation is done — so a
/// failed decrypt (tampered binary) returns `None` promptly rather than waiting.
fn active() -> Option<&'static Frontend> {
    if let Some(fe) = ACTIVE.get() {
        return Some(fe);
    }
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
    while !ACTIVATION_DONE.load(Ordering::Acquire) && std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(1));
    }
    ACTIVE.get()
}

/// The window URL for a decrypted-frontend build: `spiralfe://localhost/<path>`
/// (the path may carry a query string, which the frontend reads client-side).
pub fn window_url(path_and_query: &str) -> Option<tauri::Url> {
    tauri::Url::parse(&format!("{SCHEME}://localhost/{path_and_query}")).ok()
}

/// Serve one asset request for the custom scheme. Unknown extension-less paths
/// fall back to `index.html` (SPA / query-only aux windows); anything else 404s.
pub fn handle_request(uri_path: &str) -> tauri::http::Response<std::borrow::Cow<'static, [u8]>> {
    use std::borrow::Cow;
    use tauri::http::{header::CONTENT_TYPE, Response, StatusCode};
    let not_found = || {
        Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Cow::Borrowed(&b""[..]))
            .unwrap()
    };
    // `active()` borrows from the 'static ACTIVE cell, so we can serve the
    // already-decrypted bytes by reference — no per-request copy of the ~1.8 MB
    // JS / 0.7 MB worker.
    let Some(fe) = active() else {
        return not_found();
    };
    let path = uri_path.trim_start_matches('/');
    let lookup = if path.is_empty() { "index.html" } else { path };
    let serve = fe.get(lookup).or_else(|| {
        // Navigation request (no file extension) → the SPA entry point.
        if !lookup.contains('.') {
            fe.get("index.html")
        } else {
            None
        }
    });
    if std::env::var_os("SPIRAL_FE_TRACE").is_some() {
        diag(&format!(
            "frontend_crypt: serve {lookup} -> {}",
            if serve.is_some() { "200" } else { "miss" }
        ));
    }
    match serve {
        Some((bytes, ct)) => {
            // Vite content-hashes asset filenames, so `assets/*` are immutable and
            // safe to cache forever — this is what stops the webview re-fetching
            // (and us re-serving) the big JS/worker on every window and reload.
            // index.html isn't hashed, so keep it uncached.
            let cache = if lookup == "index.html" {
                "no-store"
            } else {
                "public, max-age=31536000, immutable"
            };
            Response::builder()
                .status(StatusCode::OK)
                .header(CONTENT_TYPE, ct)
                .header("Cache-Control", cache)
                .body(Cow::Borrowed(bytes.as_slice()))
                .unwrap()
        }
        None => not_found(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // These pin the Rust cipher to the JS pipeline byte-for-byte. The same
    // literals appear in scripts/release/encrypt-frontend.mjs's self-check, so
    // the two implementations cannot silently diverge (cf. selfcheck's FNV
    // reference vector). Computed once with Node's crypto.
    #[test]
    fn keystream_matches_reference_vector() {
        // SHA-256(0^32 ‖ LE32(0) ‖ LE64(0)).
        let ks = keystream_block(&[0u8; 32], 0, 0);
        assert_eq!(
            hex::encode(ks),
            "85759b3811ff7dc47b03792ac85317be51431a3f9e01dcafce317ed736a391b0"
        );
    }

    #[test]
    fn xor_stream_matches_reference_vector() {
        // key2 = SHA-256("spiral-key"); XOR "spiral" under stream_id 7.
        let key2: [u8; 32] = Sha256::digest(b"spiral-key").into();
        assert_eq!(
            hex::encode(key2),
            "a3edd81c5d9654097953e3f0fbd2d88a9753eac6fff20c0c63b3eeb1c45831a2"
        );
        let mut data = b"spiral".to_vec();
        xor_stream(&key2, 7, &mut data);
        assert_eq!(hex::encode(&data), "d7751e0a52d7");
        // XORing again restores the plaintext (stream cipher is its own inverse).
        xor_stream(&key2, 7, &mut data);
        assert_eq!(&data, b"spiral");
    }

    #[test]
    fn round_trips_a_small_bundle() {
        // Build a container exactly as the JS pipeline does, then decrypt it.
        let key = [0x5au8; 32];
        let files: Vec<(&str, &str, &[u8])> = vec![
            (
                "index.html",
                "text/html",
                b"<!doctype html><title>x</title>",
            ),
            ("assets/app.js", "text/javascript", b"console.log(1)"),
            ("assets/big.bin", "application/octet-stream", &[7u8; 100]),
        ];
        let manifest: Vec<serde_json::Value> = files
            .iter()
            .map(|(p, ct, data)| serde_json::json!({ "p": p, "len": data.len(), "ct": ct }))
            .collect();
        let mut manifest_bytes = serde_json::to_vec(&manifest).unwrap();
        xor_stream(&key, 0, &mut manifest_bytes);

        let mut bundle = Vec::new();
        bundle.extend_from_slice(&MAGIC);
        bundle.extend_from_slice(&(manifest_bytes.len() as u32).to_le_bytes());
        bundle.extend_from_slice(&manifest_bytes);
        for (idx, (_, _, data)) in files.iter().enumerate() {
            let mut seg = data.to_vec();
            xor_stream(&key, idx as u32 + 1, &mut seg);
            bundle.extend_from_slice(&seg);
        }

        let fe = decrypt(&bundle, &key).expect("decrypts");
        assert_eq!(fe.len(), 3);
        assert_eq!(fe.get("index.html").unwrap().1, "text/html");
        assert_eq!(fe.get("/assets/app.js").unwrap().0, b"console.log(1)");
        assert_eq!(fe.get("assets/big.bin").unwrap().0, vec![7u8; 100]);

        // A wrong key must NOT yield a valid manifest (no accidental decrypt).
        assert!(decrypt(&bundle, &[0u8; 32]).is_none());
    }
}
