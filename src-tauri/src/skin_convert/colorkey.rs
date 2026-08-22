//! ffmpeg-parity `colorkey` plus optional spill decontamination.

use image::{Rgb, Rgba, RgbaImage};

#[derive(Debug, Clone, Copy)]
pub struct ConvertOptions {
    pub similarity: f32,
    pub blend: f32,
    /// When true, unpremultiply keyed spill against the key color (Rust-only).
    pub decontaminate: bool,
    /// When true, pixels that colorkey classifies as fully opaque keep their
    /// existing alpha (preserves native PNG soft-alpha). When false, alpha is
    /// overwritten to 255 — matching ffmpeg `colorkey` behavior.
    pub preserve_source_alpha: bool,
}

impl Default for ConvertOptions {
    fn default() -> Self {
        Self {
            similarity: crate::skin_convert::DEFAULT_SIMILARITY,
            blend: crate::skin_convert::DEFAULT_BLEND,
            decontaminate: true,
            preserve_source_alpha: true,
        }
    }
}

/// Applies ffmpeg-style distance-based colorkey to a single RGBA frame.
///
/// Distance matches `vf_colorkey.c`:
/// `diff = sqrt((dr² + dg² + db²) / (255² * 3))`
pub fn colorkey_frame(img: &RgbaImage, key: Rgb<u8>, options: ConvertOptions) -> RgbaImage {
    let key_rgb = [key[0], key[1], key[2]];
    let key_f = [
        key[0] as f32 / 255.0,
        key[1] as f32 / 255.0,
        key[2] as f32 / 255.0,
    ];
    let mut out = img.clone();
    let blend = options.blend;
    let similarity = options.similarity;

    for px in out.pixels_mut() {
        let diff = color_distance_ffmpeg([px[0], px[1], px[2]], key_rgb);
        let alpha = colorkey_alpha(diff, similarity, blend);

        if alpha >= 1.0 {
            if options.preserve_source_alpha {
                // Leave RGB and any existing alpha untouched.
                continue;
            }
            *px = Rgba([px[0], px[1], px[2], 255]);
            continue;
        }

        let a_u8 = (alpha * 255.0).round().clamp(0.0, 255.0) as u8;
        if a_u8 == 0 {
            *px = Rgba([0, 0, 0, 0]);
            continue;
        }

        if options.decontaminate {
            let orig = [
                px[0] as f32 / 255.0,
                px[1] as f32 / 255.0,
                px[2] as f32 / 255.0,
            ];
            let clean = decontaminate(orig, key_f, alpha);
            *px = Rgba([
                (clean[0] * 255.0).round().clamp(0.0, 255.0) as u8,
                (clean[1] * 255.0).round().clamp(0.0, 255.0) as u8,
                (clean[2] * 255.0).round().clamp(0.0, 255.0) as u8,
                a_u8,
            ]);
        } else {
            *px = Rgba([px[0], px[1], px[2], a_u8]);
        }
    }
    out
}

/// Euclidean RGB distance normalized by the cube diagonal (ffmpeg formula).
pub fn color_distance_ffmpeg(rgb: [u8; 3], key: [u8; 3]) -> f32 {
    let dr = rgb[0] as f64 - key[0] as f64;
    let dg = rgb[1] as f64 - key[1] as f64;
    let db = rgb[2] as f64 - key[2] as f64;
    ((dr * dr + dg * dg + db * db) / (255.0 * 255.0 * 3.0)).sqrt() as f32
}

pub fn colorkey_alpha(diff: f32, similarity: f32, blend: f32) -> f32 {
    if blend > 0.0001 {
        ((diff - similarity) / blend).clamp(0.0, 1.0)
    } else if diff > similarity {
        1.0
    } else {
        0.0
    }
}

fn decontaminate(orig: [f32; 3], key: [f32; 3], alpha: f32) -> [f32; 3] {
    if alpha <= 0.0 {
        return orig;
    }
    std::array::from_fn(|i| ((orig[i] - (1.0 - alpha) * key[i]) / alpha).clamp(0.0, 1.0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::RgbaImage;

    #[test]
    fn exact_magenta_fully_transparent() {
        let mut img = RgbaImage::new(2, 1);
        img.put_pixel(0, 0, Rgba([255, 0, 255, 255]));
        img.put_pixel(1, 0, Rgba([10, 20, 30, 255]));
        let out = colorkey_frame(
            &img,
            Rgb([255, 0, 255]),
            ConvertOptions {
                similarity: 0.08,
                blend: 0.05,
                decontaminate: true,
                preserve_source_alpha: true,
            },
        );
        assert_eq!(out.get_pixel(0, 0)[3], 0);
        assert_eq!(out.get_pixel(1, 0), &Rgba([10, 20, 30, 255]));
    }

    #[test]
    fn distance_formula_matches_ffmpeg() {
        // Identical color → 0
        assert!((color_distance_ffmpeg([255, 0, 255], [255, 0, 255])).abs() < 1e-6);
        // Pure red vs magenta: dr=0, dg=0, db=255
        let expected = ((255.0_f64 * 255.0) / (255.0 * 255.0 * 3.0)).sqrt() as f32;
        let d = color_distance_ffmpeg([255, 0, 0], [255, 0, 255]);
        assert!((d - expected).abs() < 1e-5, "got {d} expected {expected}");
    }

    #[test]
    fn blend_band_alpha_ramps() {
        let similarity = 0.08_f32;
        let blend = 0.05_f32;
        assert_eq!(colorkey_alpha(0.07, similarity, blend), 0.0);
        assert_eq!(colorkey_alpha(0.08, similarity, blend), 0.0);
        let mid = colorkey_alpha(0.105, similarity, blend);
        assert!((mid - 0.5).abs() < 1e-5, "mid={mid}");
        let top = colorkey_alpha(0.13, similarity, blend);
        assert!((top - 1.0).abs() < 1e-5, "top={top}");
    }

    #[test]
    fn decontaminate_moves_away_from_key() {
        // Pixel in blend band with spill toward magenta.
        let mut img = RgbaImage::new(1, 1);
        // Choose RGB so diff is mid-blend relative to magenta.
        // Magenta = (255,0,255). Use (255, 40, 255): only G differs.
        img.put_pixel(0, 0, Rgba([255, 40, 255, 255]));
        let key = Rgb([255, 0, 255]);
        let diff = color_distance_ffmpeg([255, 40, 255], [255, 0, 255]);
        let alpha = colorkey_alpha(diff, 0.08, 0.05);
        assert!(alpha > 0.0 && alpha < 1.0, "diff={diff} alpha={alpha}");

        let with = colorkey_frame(
            &img,
            key,
            ConvertOptions {
                similarity: 0.08,
                blend: 0.05,
                decontaminate: true,
                preserve_source_alpha: true,
            },
        );
        let without = colorkey_frame(
            &img,
            key,
            ConvertOptions {
                similarity: 0.08,
                blend: 0.05,
                decontaminate: false,
                preserve_source_alpha: true,
            },
        );
        // Without decontaminate keeps original G; with should push G higher (away from 0).
        assert_eq!(without.get_pixel(0, 0)[1], 40);
        assert!(
            with.get_pixel(0, 0)[1] > without.get_pixel(0, 0)[1],
            "decontaminated G={} vs {}",
            with.get_pixel(0, 0)[1],
            without.get_pixel(0, 0)[1]
        );
        assert_eq!(with.get_pixel(0, 0)[3], without.get_pixel(0, 0)[3]);
    }

    #[test]
    fn zero_blend_hard_threshold() {
        assert_eq!(colorkey_alpha(0.07, 0.08, 0.0), 0.0);
        assert_eq!(colorkey_alpha(0.09, 0.08, 0.0), 1.0);
    }
}
