//! Static path: BMP/PNG/JPEG/single-frame GIF → PNG with real alpha.

use std::path::Path;

use image::{Rgb, RgbaImage};

use super::colorkey::{colorkey_frame, ConvertOptions};

pub fn convert(
    src: &Path,
    dest: &Path,
    key: Rgb<u8>,
    options: ConvertOptions,
) -> Result<(), String> {
    let img = image::open(src)
        .map_err(|e| format!("failed to open {}: {e}", src.display()))?
        .to_rgba8();
    convert_rgba(&img, dest, key, options)
}

pub fn convert_rgba(
    img: &RgbaImage,
    dest: &Path,
    key: Rgb<u8>,
    options: ConvertOptions,
) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
    }
    let out = colorkey_frame(img, key, options);
    out.save(dest)
        .map_err(|e| format!("failed to write {}: {e}", dest.display()))?;
    Ok(())
}
