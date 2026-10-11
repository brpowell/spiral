use std::fs;
use std::path::{Path, PathBuf};

use image::imageops::{self, FilterType};
use image::{GenericImageView, Rgb};

use crate::skin_convert::{self, ConvertOptions, DEFAULT_BLEND, DEFAULT_SIMILARITY};
use crate::wms_import::report::{GapReport, ReportKind};

#[derive(Debug, Clone)]
pub struct AssetJob {
    pub source_name: String,
    pub source_path: PathBuf,
    pub dest_rel: String,
    pub preserve_color: bool,
}

#[derive(Debug, Clone, Copy)]
pub struct RgbaKey {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

impl RgbaKey {
    pub fn to_rgb(self) -> Rgb<u8> {
        Rgb([self.r, self.g, self.b])
    }
}

pub fn parse_chroma(chroma: &str) -> Result<RgbaKey, String> {
    let hex = chroma.trim().trim_start_matches('#');
    if hex.len() != 6 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(format!("invalid chroma color: {chroma}"));
    }
    let r = u8::from_str_radix(&hex[0..2], 16).map_err(|e| e.to_string())?;
    let g = u8::from_str_radix(&hex[2..4], 16).map_err(|e| e.to_string())?;
    let b = u8::from_str_radix(&hex[4..6], 16).map_err(|e| e.to_string())?;
    Ok(RgbaKey { r, g, b })
}

pub fn convert_asset_jobs(
    jobs: &[AssetJob],
    assets_dir: &Path,
    chroma: &RgbaKey,
    report: &mut GapReport,
) {
    let key = chroma.to_rgb();
    let options = ConvertOptions {
        similarity: DEFAULT_SIMILARITY,
        blend: DEFAULT_BLEND,
        decontaminate: true,
        preserve_source_alpha: true,
    };
    for job in jobs {
        let dest = assets_dir.join(&job.dest_rel);
        if let Some(parent) = dest.parent() {
            if let Err(err) = fs::create_dir_all(parent) {
                report.add(
                    ReportKind::Info,
                    format!("mkdir failed for {}: {err}", dest.display()),
                    None,
                    Some(&job.dest_rel),
                );
                continue;
            }
        }
        if let Err(err) = convert_one(job, &dest, key, options) {
            report.add(
                ReportKind::Info,
                format!("convert failed for {}: {err}", job.source_name),
                None,
                Some(&job.dest_rel),
            );
        }
    }
}

fn convert_one(
    job: &AssetJob,
    dest: &Path,
    key: Rgb<u8>,
    options: ConvertOptions,
) -> Result<(), String> {
    if job.preserve_color {
        let img = image::open(&job.source_path)
            .map_err(|e| format!("failed to open {}: {e}", job.source_path.display()))?;
        img.save(dest)
            .map_err(|e| format!("failed to write {}: {e}", dest.display()))?;
        return Ok(());
    }

    skin_convert::convert_with_options(&job.source_path, dest, key, options)
}

pub fn write_preview_png(source_path: &Path, dest_path: &Path) -> Result<(), String> {
    if let Some(parent) = dest_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir preview: {e}"))?;
    }
    let img = image::open(source_path).map_err(|e| {
        format!(
            "failed to open preview source {}: {e}",
            source_path.display()
        )
    })?;
    let (w, h) = img.dimensions();
    if w == 0 || h == 0 {
        return Err("preview source has zero dimensions".into());
    }
    let scale = (320.0_f32 / w as f32).max(200.0_f32 / h as f32);
    let nw = ((w as f32) * scale).round().max(1.0) as u32;
    let nh = ((h as f32) * scale).round().max(1.0) as u32;
    let resized = imageops::resize(&img, nw, nh, FilterType::Lanczos3);
    let x = nw.saturating_sub(320) / 2;
    let y = nh.saturating_sub(200) / 2;
    let cropped = imageops::crop_imm(&resized, x, y, 320.min(nw), 200.min(nh)).to_image();
    cropped
        .save(dest_path)
        .map_err(|e| format!("failed to write preview: {e}"))?;
    Ok(())
}

pub fn raster_size_from_file(path: &Path) -> Option<(u32, u32)> {
    image::image_dimensions(path).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};
    use std::path::PathBuf;

    fn temp_path(name: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("spiral-wms-convert-{}-{name}", std::process::id()));
        p
    }

    #[test]
    fn convert_keys_magenta_via_skin_convert() {
        let mut img = RgbaImage::new(2, 1);
        img.put_pixel(0, 0, Rgba([255, 0, 255, 255]));
        img.put_pixel(1, 0, Rgba([10, 20, 30, 255]));
        let src = temp_path("src.png");
        let dest = temp_path("dest.png");
        img.save(&src).unwrap();
        let job = AssetJob {
            source_name: "src.png".into(),
            source_path: src.clone(),
            dest_rel: "dest.png".into(),
            preserve_color: false,
        };
        convert_one(&job, &dest, Rgb([255, 0, 255]), ConvertOptions::default()).unwrap();
        let out = image::open(&dest).unwrap().to_rgba8();
        assert_eq!(out.get_pixel(0, 0)[3], 0);
        assert_eq!(out.get_pixel(1, 0), &Rgba([10, 20, 30, 255]));
        let _ = fs::remove_file(&src);
        let _ = fs::remove_file(&dest);
    }

    #[test]
    fn preserve_color_copies_verbatim() {
        let mut img = RgbaImage::new(1, 1);
        img.put_pixel(0, 0, Rgba([255, 0, 255, 255]));
        let src = temp_path("map-src.png");
        let dest = temp_path("map-dest.png");
        img.save(&src).unwrap();
        let job = AssetJob {
            source_name: "map.png".into(),
            source_path: src.clone(),
            dest_rel: "map.png".into(),
            preserve_color: true,
        };
        convert_one(&job, &dest, Rgb([255, 0, 255]), ConvertOptions::default()).unwrap();
        let out = image::open(&dest).unwrap().to_rgba8();
        assert_eq!(out.get_pixel(0, 0), &Rgba([255, 0, 255, 255]));
        let _ = fs::remove_file(&src);
        let _ = fs::remove_file(&dest);
    }
}
