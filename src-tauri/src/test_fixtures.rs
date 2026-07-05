//! Shared audio fixtures for unit tests.

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
