//! Shared audio and archive fixtures for unit tests.

#[cfg(test)]
pub mod m4a {
    use std::path::{Path, PathBuf};

    /// iTunes-like layout: `moov` before `mdat`.
    pub fn moov_before_mdat_fixture_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/moov_before_mdat.m4a")
    }

    pub fn copy_moov_before_mdat(dir: &Path, dest_name: &str) -> PathBuf {
        let dest = dir.join(dest_name);
        std::fs::copy(moov_before_mdat_fixture_path(), &dest)
            .unwrap_or_else(|_| panic!("copy moov-before-mdat fixture to {}", dest.display()));
        dest
    }
}

#[cfg(test)]
pub mod wav {
    use std::io::Write;
    use std::path::{Path, PathBuf};

    pub fn tagged_fixture_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/tagged.wav")
    }

    pub fn write_minimal(path: &Path) {
        let channels: u16 = 2;
        let sample_rate: u32 = 48_000;
        let bits_per_sample: u16 = 16;
        let block_align = channels * (bits_per_sample / 8);
        let byte_rate = sample_rate * u32::from(block_align);
        let samples: [i16; 4] = [0, 0, 0, 0];
        let data_bytes = samples.len() * 2;

        let mut file = std::fs::File::create(path).unwrap();
        file.write_all(b"RIFF").unwrap();
        file.write_all(&(36u32 + data_bytes as u32).to_le_bytes())
            .unwrap();
        file.write_all(b"WAVE").unwrap();
        file.write_all(b"fmt ").unwrap();
        file.write_all(&16u32.to_le_bytes()).unwrap();
        file.write_all(&1u16.to_le_bytes()).unwrap();
        file.write_all(&channels.to_le_bytes()).unwrap();
        file.write_all(&sample_rate.to_le_bytes()).unwrap();
        file.write_all(&byte_rate.to_le_bytes()).unwrap();
        file.write_all(&block_align.to_le_bytes()).unwrap();
        file.write_all(&bits_per_sample.to_le_bytes()).unwrap();
        file.write_all(b"data").unwrap();
        file.write_all(&(data_bytes as u32).to_le_bytes()).unwrap();
        for sample in samples {
            file.write_all(&sample.to_le_bytes()).unwrap();
        }
    }
}

#[cfg(test)]
pub mod ogg {
    use std::path::{Path, PathBuf};

    pub fn minimal_fixture_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/minimal.ogg")
    }

    pub fn copy_minimal(dir: &Path, dest_name: &str) -> PathBuf {
        let dest = dir.join(dest_name);
        std::fs::copy(minimal_fixture_path(), &dest)
            .unwrap_or_else(|_| panic!("copy ogg fixture to {}", dest.display()));
        dest
    }
}

#[cfg(test)]
pub mod opus {
    use std::path::PathBuf;

    pub fn minimal_fixture_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/minimal.opus")
    }
}

#[cfg(test)]
pub mod mp3 {
    use std::path::{Path, PathBuf};

    pub fn minimal_fixture_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/minimal.mp3")
    }

    pub fn copy_minimal(dir: &Path, dest_name: &str) -> PathBuf {
        let dest = dir.join(dest_name);
        std::fs::copy(minimal_fixture_path(), &dest)
            .unwrap_or_else(|_| panic!("copy mp3 fixture to {}", dest.display()));
        dest
    }
}

#[cfg(test)]
pub mod flac {
    use std::path::PathBuf;

    pub fn minimal_fixture_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/minimal.flac")
    }
}

/// Small zip archives, including hostile ones, for importer tests.
#[cfg(test)]
pub mod zips {
    use std::fs::File;
    use std::io::Write;
    use std::path::Path;
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    pub fn write_stored(path: &Path, entries: &[(&str, &[u8])]) {
        write(path, entries, CompressionMethod::Stored);
    }

    pub fn write_deflated(path: &Path, entries: &[(&str, &[u8])]) {
        write(path, entries, CompressionMethod::Deflated);
    }

    fn write(path: &Path, entries: &[(&str, &[u8])], method: CompressionMethod) {
        let mut zip = ZipWriter::new(File::create(path).unwrap());
        let options = SimpleFileOptions::default().compression_method(method);
        for (name, bytes) in entries {
            zip.start_file(*name, options).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
    }

    /// A stored archive whose headers claim every entry is one byte long while the
    /// data is `len` bytes, so declared-size checks alone would let it through.
    /// Entry data is `b'A'` filler so it cannot contain a header signature.
    pub fn write_understated(path: &Path, names: &[&str], len: usize) {
        let data = vec![b'A'; len];
        let entries: Vec<(&str, &[u8])> = names.iter().map(|n| (*n, data.as_slice())).collect();
        write_stored(path, &entries);

        let mut bytes = std::fs::read(path).unwrap();
        // Uncompressed size: offset 22 in a local header, 24 in a central directory header.
        for (signature, offset) in [(b"PK\x03\x04", 22), (b"PK\x01\x02", 24)] {
            let starts: Vec<usize> = bytes
                .windows(4)
                .enumerate()
                .filter(|(_, w)| w == signature)
                .map(|(i, _)| i)
                .collect();
            assert_eq!(starts.len(), names.len(), "unexpected zip layout");
            for start in starts {
                bytes[start + offset..start + offset + 4].copy_from_slice(&1u32.to_le_bytes());
            }
        }
        std::fs::write(path, bytes).unwrap();
    }
}
