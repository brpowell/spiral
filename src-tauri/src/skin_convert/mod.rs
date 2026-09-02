//! Native chromakey conversion for WMP skin assets (no ffmpeg dependency).
//!
//! Static sources (BMP/PNG/JPEG/single-frame GIF) → PNG with real alpha.
//! Multi-frame GIFs → indexed GIF with shared palette + Floyd–Steinberg dither.

mod anim_path;
pub mod cli_compare;
mod colorkey;
mod palette;
mod static_path;

use std::fs::File;
use std::io::BufReader;
use std::path::{Path, PathBuf};

use image::codecs::gif::GifDecoder;
use image::imageops::FilterType;
use image::{AnimationDecoder, Delay, Frame, Rgb, RgbaImage};

pub use colorkey::{color_distance_ffmpeg, colorkey_frame, ConvertOptions};

pub const DEFAULT_SIMILARITY: f32 = 0.08;
pub const DEFAULT_BLEND: f32 = 0.05;
pub const ALPHA_THRESHOLD: u8 = 128;

/// Convert a source asset with chromakey. Dispatches by format and GIF frame count.
///
/// Single-frame GIFs are routed to the static PNG path (destination extension is
/// forced to `.png` when the caller passed a `.gif` dest).
pub fn convert(
    src: &Path,
    dest: &Path,
    key: Rgb<u8>,
    similarity: f32,
    blend: f32,
) -> Result<(), String> {
    convert_with_options(
        src,
        dest,
        key,
        ConvertOptions {
            similarity,
            blend,
            decontaminate: true,
            preserve_source_alpha: true,
        },
    )
}

pub fn convert_with_options(
    src: &Path,
    dest: &Path,
    key: Rgb<u8>,
    options: ConvertOptions,
) -> Result<(), String> {
    if is_gif(src) {
        let frames = decode_gif_frames(src)?;
        if frames.is_empty() {
            return Err(format!("GIF has no frames: {}", src.display()));
        }
        if frames.len() == 1 {
            let dest = force_png_dest(dest);
            return static_path::convert_rgba(frames[0].buffer(), &dest, key, options);
        }
        return anim_path::convert(&frames, dest, key, options);
    }

    static_path::convert(src, dest, key, options)
}

/// Peek GIF frame count. Returns `None` if the path is not a GIF or cannot be opened.
/// Stops after detecting a second frame for efficiency.
pub fn gif_frame_count(path: &Path) -> Option<usize> {
    if !is_gif(path) {
        return None;
    }
    let file = File::open(path).ok()?;
    let decoder = GifDecoder::new(BufReader::new(file)).ok()?;
    let mut count = 0usize;
    for frame in decoder.into_frames() {
        if frame.is_err() {
            return None;
        }
        count += 1;
        if count > 1 {
            return Some(count);
        }
    }
    Some(count)
}

pub fn is_gif(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("gif"))
        .unwrap_or(false)
}

fn force_png_dest(dest: &Path) -> PathBuf {
    if dest
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("png"))
        .unwrap_or(false)
    {
        return dest.to_path_buf();
    }
    dest.with_extension("png")
}

fn decode_gif_frames(src: &Path) -> Result<Vec<Frame>, String> {
    let file = File::open(src).map_err(|e| format!("failed to open {}: {e}", src.display()))?;
    let decoder = GifDecoder::new(BufReader::new(file))
        .map_err(|e| format!("failed to decode GIF {}: {e}", src.display()))?;
    decoder
        .into_frames()
        .collect_frames()
        .map_err(|e| format!("failed to read GIF frames {}: {e}", src.display()))
}

/// GIF frame delay is stored in centiseconds (10ms units).
///
/// Delays under 2cs mean "unspecified" in practice: GIF89a permits 0, and
/// authoring tools of the WMP era routinely emitted 0 or 1. Every mainstream
/// viewer — including WMP — renders those at 100ms, so normalize to that
/// instead of preserving the literal value, which plays ~10x too fast. Explicit
/// holds (2cs and up) are kept as authored.
pub(crate) fn delay_to_centiseconds(delay: Delay) -> u16 {
    const UNSPECIFIED_CS: u16 = 10;
    let (numer, denom) = delay.numer_denom_ms();
    if denom == 0 {
        return UNSPECIFIED_CS;
    }
    let ms = (u64::from(numer) + u64::from(denom) / 2) / u64::from(denom);
    let centiseconds = ((ms + 5) / 10).min(u64::from(u16::MAX)) as u16;
    if centiseconds < 2 {
        return UNSPECIFIED_CS;
    }
    centiseconds
}

/// Flatten a multi-frame GIF to its first frame as RGBA (for compare grids / SSIM).
pub fn first_frame_rgba(path: &Path) -> Result<RgbaImage, String> {
    if is_gif(path) {
        let frames = decode_gif_frames(path)?;
        let frame = frames
            .into_iter()
            .next()
            .ok_or_else(|| format!("GIF has no frames: {}", path.display()))?;
        return Ok(frame.into_buffer());
    }
    Ok(image::open(path)
        .map_err(|e| format!("failed to open {}: {e}", path.display()))?
        .to_rgba8())
}

pub fn resize_rgba(img: &RgbaImage, w: u32, h: u32) -> RgbaImage {
    image::imageops::resize(img, w, h, FilterType::Triangle)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};

    fn temp_png_path(name: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!(
            "spiral-skin-convert-{}-{name}.png",
            std::process::id()
        ));
        p
    }

    #[test]
    fn unspecified_delays_normalize_to_the_viewer_default() {
        for ms in [0, 10] {
            assert_eq!(
                delay_to_centiseconds(Delay::from_numer_denom_ms(ms, 1)),
                10,
                "{ms}ms should render at the 100ms viewer default"
            );
        }
    }

    #[test]
    fn authored_delays_are_preserved() {
        for (ms, cs) in [(20, 2), (100, 10), (200, 20), (1000, 100)] {
            assert_eq!(delay_to_centiseconds(Delay::from_numer_denom_ms(ms, 1)), cs);
        }
    }

    #[test]
    fn convert_static_magenta_to_transparent() {
        let mut img = RgbaImage::new(2, 1);
        img.put_pixel(0, 0, Rgba([255, 0, 255, 255]));
        img.put_pixel(1, 0, Rgba([10, 20, 30, 255]));
        let src = temp_png_path("src");
        let dest = temp_png_path("dest");
        img.save(&src).unwrap();
        convert(
            &src,
            &dest,
            Rgb([255, 0, 255]),
            DEFAULT_SIMILARITY,
            DEFAULT_BLEND,
        )
        .unwrap();
        let out = image::open(&dest).unwrap().to_rgba8();
        assert_eq!(out.get_pixel(0, 0)[3], 0);
        assert_eq!(out.get_pixel(1, 0), &Rgba([10, 20, 30, 255]));
        let _ = std::fs::remove_file(&src);
        let _ = std::fs::remove_file(&dest);
    }

    #[test]
    fn single_frame_gif_writes_png() {
        // Encode a 1x1 magenta GIF via the gif crate, then convert.
        let src = {
            let mut p = std::env::temp_dir();
            p.push(format!(
                "spiral-skin-convert-{}-one.gif",
                std::process::id()
            ));
            let file = File::create(&p).unwrap();
            let palette = [255u8, 0, 255, 10, 20, 30];
            let mut enc = gif::Encoder::new(file, 2, 1, &palette).unwrap();
            let frame = gif::Frame::from_indexed_pixels(2, 1, vec![0u8, 1], None);
            enc.write_frame(&frame).unwrap();
            drop(enc);
            p
        };
        let mut dest = std::env::temp_dir();
        dest.push(format!(
            "spiral-skin-convert-{}-one-out.gif",
            std::process::id()
        ));
        convert(
            &src,
            &dest,
            Rgb([255, 0, 255]),
            DEFAULT_SIMILARITY,
            DEFAULT_BLEND,
        )
        .unwrap();
        let png = dest.with_extension("png");
        assert!(png.is_file(), "expected PNG at {}", png.display());
        assert!(
            !dest.exists(),
            "should not leave a .gif dest for single-frame"
        );
        let out = image::open(&png).unwrap().to_rgba8();
        assert_eq!(out.dimensions(), (2, 1));
        assert_eq!(out.get_pixel(0, 0)[3], 0);
        let _ = std::fs::remove_file(&src);
        let _ = std::fs::remove_file(&png);
    }
}
