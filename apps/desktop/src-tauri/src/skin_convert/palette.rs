//! NeuQuant shared palette + Floyd–Steinberg dithering.

use image::RgbaImage;

use super::ALPHA_THRESHOLD;

/// Shared palette for multi-frame GIF encode.
/// `palette_rgb` is 256 * 3 bytes (RGB triples); index 255 is reserved transparent.
pub struct SharedPalette {
    pub palette_rgb: Vec<u8>,
    pub transparent_index: u8,
    pub opaque_count: usize,
}

/// Build one shared palette across all keyed frames.
/// Fully-transparent pixels are excluded from the sample set.
pub fn build_shared_palette(frames: &[&RgbaImage]) -> SharedPalette {
    let mut sample: Vec<u8> = Vec::new();
    for frame in frames {
        for px in frame.pixels() {
            if px[3] == 0 {
                continue;
            }
            sample.extend_from_slice(&[px[0], px[1], px[2], px[3]]);
        }
    }

    let transparent_index = 255u8;
    let mut palette_rgb = vec![0u8; 256 * 3];

    if sample.is_empty() {
        return SharedPalette {
            palette_rgb,
            transparent_index,
            opaque_count: 0,
        };
    }

    // NeuQuant requires colors >= 64; we request 255 and reserve index 255 for transparency.
    let color_count = 255usize;
    let quant = color_quant::NeuQuant::new(10, color_count, &sample);
    let map = quant.color_map_rgb();
    let opaque_count = map.len() / 3;
    let copy_len = (opaque_count * 3).min(255 * 3);
    palette_rgb[..copy_len].copy_from_slice(&map[..copy_len]);
    // Index 255 stays black placeholder for transparent.

    SharedPalette {
        palette_rgb,
        transparent_index,
        opaque_count,
    }
}

/// Count unique opaque RGB colors across frames (pre-key or post-key).
pub fn unique_opaque_colors(frames: &[&RgbaImage]) -> usize {
    use std::collections::HashSet;
    let mut set = HashSet::new();
    for frame in frames {
        for px in frame.pixels() {
            if px[3] > 0 {
                set.insert([px[0], px[1], px[2]]);
            }
        }
    }
    set.len()
}

/// Floyd–Steinberg dither against the shared palette.
/// Transparent pixels (`a < ALPHA_THRESHOLD`) get `transparent_index` and do not
/// propagate error.
pub fn dither_frame(img: &RgbaImage, palette: &SharedPalette) -> Vec<u8> {
    let (w, h) = img.dimensions();
    let n = (w * h) as usize;
    let mut error_buf = vec![[0f32; 3]; n];
    let mut indices = vec![0u8; n];
    let opaque_count = palette.opaque_count.max(1).min(255);
    let transparent_index = palette.transparent_index;

    for y in 0..h {
        for x in 0..w {
            let idx = (y * w + x) as usize;
            let px = img.get_pixel(x, y);

            if px[3] < ALPHA_THRESHOLD {
                indices[idx] = transparent_index;
                continue;
            }

            let target = [
                (px[0] as f32 + error_buf[idx][0]).clamp(0.0, 255.0),
                (px[1] as f32 + error_buf[idx][1]).clamp(0.0, 255.0),
                (px[2] as f32 + error_buf[idx][2]).clamp(0.0, 255.0),
            ];
            let (nearest_i, nearest_rgb) =
                nearest_palette_entry(&palette.palette_rgb, opaque_count, target);
            indices[idx] = nearest_i;

            let err = [
                target[0] - nearest_rgb[0] as f32,
                target[1] - nearest_rgb[1] as f32,
                target[2] - nearest_rgb[2] as f32,
            ];
            diffuse_error(&mut error_buf, w, h, x, y, err);
        }
    }
    indices
}

fn nearest_palette_entry(
    palette_rgb: &[u8],
    opaque_count: usize,
    target: [f32; 3],
) -> (u8, [u8; 3]) {
    let mut best_i = 0u8;
    let mut best_dist = f32::MAX;
    let mut best_rgb = [0u8; 3];
    for i in 0..opaque_count {
        let o = i * 3;
        let rgb = [palette_rgb[o], palette_rgb[o + 1], palette_rgb[o + 2]];
        let dr = target[0] - rgb[0] as f32;
        let dg = target[1] - rgb[1] as f32;
        let db = target[2] - rgb[2] as f32;
        let dist = dr * dr + dg * dg + db * db;
        if dist < best_dist {
            best_dist = dist;
            best_i = i as u8;
            best_rgb = rgb;
        }
    }
    (best_i, best_rgb)
}

fn diffuse_error(error_buf: &mut [[f32; 3]], w: u32, h: u32, x: u32, y: u32, err: [f32; 3]) {
    // Standard Floyd–Steinberg: 7/16 right, 3/16 bottom-left, 5/16 bottom, 1/16 bottom-right
    let neighbors: [(i32, i32, f32); 4] = [
        (1, 0, 7.0 / 16.0),
        (-1, 1, 3.0 / 16.0),
        (0, 1, 5.0 / 16.0),
        (1, 1, 1.0 / 16.0),
    ];
    for (dx, dy, weight) in neighbors {
        let nx = x as i32 + dx;
        let ny = y as i32 + dy;
        if nx < 0 || ny < 0 || nx >= w as i32 || ny >= h as i32 {
            continue;
        }
        let nidx = (ny as u32 * w + nx as u32) as usize;
        error_buf[nidx][0] += err[0] * weight;
        error_buf[nidx][1] += err[1] * weight;
        error_buf[nidx][2] += err[2] * weight;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};

    #[test]
    fn empty_sample_all_transparent_palette() {
        let mut img = RgbaImage::new(2, 2);
        for px in img.pixels_mut() {
            *px = Rgba([255, 0, 255, 0]);
        }
        let pal = build_shared_palette(&[&img]);
        assert_eq!(pal.opaque_count, 0);
        assert_eq!(pal.transparent_index, 255);
        let indices = dither_frame(&img, &pal);
        assert!(indices.iter().all(|&i| i == 255));
    }

    #[test]
    fn dither_skips_transparent_and_maps_opaque() {
        let mut img = RgbaImage::new(2, 1);
        img.put_pixel(0, 0, Rgba([0, 0, 0, 0]));
        img.put_pixel(1, 0, Rgba([10, 20, 30, 255]));
        let pal = build_shared_palette(&[&img]);
        assert!(pal.opaque_count >= 1);
        let indices = dither_frame(&img, &pal);
        assert_eq!(indices[0], pal.transparent_index);
        assert_ne!(indices[1], pal.transparent_index);
    }
}
