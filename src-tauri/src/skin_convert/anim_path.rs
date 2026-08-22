//! Animated path: multi-frame GIF → indexed GIF with shared palette.

use std::fs::File;
use std::path::Path;

use gif::{DisposalMethod, Encoder, Frame as GifFrame};
use image::{Frame, Rgb, RgbaImage};

use super::colorkey::{colorkey_frame, ConvertOptions};
use super::delay_to_centiseconds;
use super::palette::{build_shared_palette, dither_frame};

pub fn convert(
    frames: &[Frame],
    dest: &Path,
    key: Rgb<u8>,
    options: ConvertOptions,
) -> Result<(), String> {
    if frames.is_empty() {
        return Err("no frames to encode".into());
    }

    let keyed: Vec<RgbaImage> = frames
        .iter()
        .map(|f| colorkey_frame(f.buffer(), key, options))
        .collect();

    let refs: Vec<&RgbaImage> = keyed.iter().collect();
    let palette = build_shared_palette(&refs);

    let (w, h) = keyed[0].dimensions();
    if w > u16::MAX as u32 || h > u16::MAX as u32 {
        return Err(format!("GIF dimensions too large: {w}x{h}"));
    }

    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
    }

    let file =
        File::create(dest).map_err(|e| format!("failed to create {}: {e}", dest.display()))?;
    // Omit set_repeat — no NETSCAPE loop extension (play once), matching legacy `-loop -1`.
    let mut encoder = Encoder::new(file, w as u16, h as u16, &palette.palette_rgb)
        .map_err(|e| format!("GIF encoder init failed: {e}"))?;

    for (i, keyed_frame) in keyed.iter().enumerate() {
        let indices = dither_frame(keyed_frame, &palette);
        let mut gif_frame = GifFrame::from_indexed_pixels(
            w as u16,
            h as u16,
            indices,
            Some(palette.transparent_index),
        );
        gif_frame.dispose = DisposalMethod::Background;
        gif_frame.delay = delay_to_centiseconds(frames[i].delay());
        encoder
            .write_frame(&gif_frame)
            .map_err(|e| format!("GIF encode frame {i} failed: {e}"))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Delay, Rgba};
    use std::path::PathBuf;

    fn temp_path(name: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!(
            "spiral-skin-convert-{}-{}",
            std::process::id(),
            name
        ));
        p
    }

    #[test]
    fn two_frame_gif_encodes_with_transparency() {
        let mut a = RgbaImage::new(4, 4);
        let mut b = RgbaImage::new(4, 4);
        for (x, y, px) in a.enumerate_pixels_mut() {
            if x < 2 {
                *px = Rgba([255, 0, 255, 255]); // keyed out
            } else {
                *px = Rgba([20, 40, 60, 255]);
            }
            let _ = y;
        }
        for (x, y, px) in b.enumerate_pixels_mut() {
            if x < 2 {
                *px = Rgba([255, 0, 255, 255]);
            } else {
                *px = Rgba([30, 50, 70, 255]);
            }
            let _ = y;
        }

        let frames = vec![
            Frame::from_parts(a, 0, 0, Delay::from_numer_denom_ms(100, 1)),
            Frame::from_parts(b, 0, 0, Delay::from_numer_denom_ms(100, 1)),
        ];
        let dest = temp_path("two-frame.gif");
        convert(
            &frames,
            &dest,
            Rgb([255, 0, 255]),
            ConvertOptions::default(),
        )
        .unwrap();
        assert!(dest.is_file());
        let decoded = image::open(&dest).unwrap().to_rgba8();
        assert_eq!(decoded.dimensions(), (4, 4));
        // Left half should be transparent after keying.
        assert_eq!(decoded.get_pixel(0, 0)[3], 0);
        let _ = std::fs::remove_file(&dest);
    }
}
