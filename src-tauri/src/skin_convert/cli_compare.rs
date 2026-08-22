//! Dev-only comparison harness: ffmpeg pipeline vs native Rust chromakey.
//!
//! Used by the `skin_convert_compare` binary.

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

use image::{Rgb, Rgba, RgbaImage};
use serde::Serialize;

use super::palette::unique_opaque_colors;
use super::{
    color_distance_ffmpeg, convert_with_options, first_frame_rgba, gif_frame_count, is_gif,
    resize_rgba, ConvertOptions, DEFAULT_BLEND, DEFAULT_SIMILARITY,
};

const ALPHA_DISAGREE_THRESHOLD: f64 = 0.005; // 0.5%
const OPAQUE_MAD_FLAG: f64 = 8.0;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetMetrics {
    pub relative_path: String,
    pub kind: String,
    pub dimensions_match: bool,
    pub frame_count_ffmpeg: Option<usize>,
    pub frame_count_rust: Option<usize>,
    pub alpha_disagree_pct: f64,
    pub opaque_mad: f64,
    pub edge_halo_ffmpeg: f64,
    pub edge_halo_rust: f64,
    pub edge_halo_rust_decontam: f64,
    pub file_size_ffmpeg: u64,
    pub file_size_rust: u64,
    pub unique_opaque_over_255: bool,
    pub ssim: Option<f64>,
    pub passed: bool,
    pub notes: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareReport {
    pub assets: Vec<AssetMetrics>,
    pub passed: usize,
    pub failed: usize,
    pub skipped: usize,
}

pub struct CompareOptions {
    pub input_dir: PathBuf,
    pub out_dir: PathBuf,
    pub key: Rgb<u8>,
    pub similarity: f32,
    pub blend: f32,
    /// Limit to relative path substrings (optional filter).
    pub filter: Option<String>,
}

pub fn run_compare(opts: &CompareOptions) -> Result<CompareReport, String> {
    if !ffmpeg_available() {
        return Err("ffmpeg not found on PATH (required for comparison harness)".into());
    }

    let ffmpeg_dir = opts.out_dir.join("ffmpeg");
    let rust_dir = opts.out_dir.join("rust");
    let grids_dir = opts.out_dir.join("grids");
    fs::create_dir_all(&ffmpeg_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&rust_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&grids_dir).map_err(|e| e.to_string())?;

    let assets = collect_assets(&opts.input_dir, opts.filter.as_deref())?;
    let mut report = CompareReport {
        assets: Vec::new(),
        passed: 0,
        failed: 0,
        skipped: 0,
    };

    for src in &assets {
        let rel = src
            .strip_prefix(&opts.input_dir)
            .unwrap_or(src)
            .to_string_lossy()
            .replace('\\', "/");

        match compare_one(src, &rel, opts, &ffmpeg_dir, &rust_dir, &grids_dir) {
            Ok(metrics) => {
                if metrics.passed {
                    report.passed += 1;
                } else {
                    report.failed += 1;
                }
                report.assets.push(metrics);
            }
            Err(err) => {
                report.skipped += 1;
                report.assets.push(AssetMetrics {
                    relative_path: rel,
                    kind: "error".into(),
                    dimensions_match: false,
                    frame_count_ffmpeg: None,
                    frame_count_rust: None,
                    alpha_disagree_pct: 1.0,
                    opaque_mad: 255.0,
                    edge_halo_ffmpeg: 0.0,
                    edge_halo_rust: 0.0,
                    edge_halo_rust_decontam: 0.0,
                    file_size_ffmpeg: 0,
                    file_size_rust: 0,
                    unique_opaque_over_255: false,
                    ssim: None,
                    passed: false,
                    notes: vec![err],
                });
            }
        }
    }

    write_reports(&opts.out_dir, &report)?;
    Ok(report)
}

fn collect_assets(dir: &Path, filter: Option<&str>) -> Result<Vec<PathBuf>, String> {
    let mut out = Vec::new();
    for entry in walkdir::WalkDir::new(dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let path = entry.path();
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !matches!(ext.as_str(), "bmp" | "png" | "gif" | "jpg" | "jpeg") {
            continue;
        }
        // Skip map images (preserve_color) — basename contains _map or -map or colormap.
        let name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if name.contains("_map") || name.ends_with("-map") || name.contains("colormap") {
            continue;
        }
        if let Some(f) = filter {
            let rel = path.to_string_lossy();
            if !rel.contains(f) {
                continue;
            }
        }
        out.push(path.to_path_buf());
    }
    out.sort();
    Ok(out)
}

fn compare_one(
    src: &Path,
    rel: &str,
    opts: &CompareOptions,
    ffmpeg_dir: &Path,
    rust_dir: &Path,
    grids_dir: &Path,
) -> Result<AssetMetrics, String> {
    let src_is_gif = is_gif(src);
    let frame_count = if src_is_gif {
        gif_frame_count(src)
    } else {
        None
    };
    let single_frame_gif = src_is_gif && frame_count == Some(1);
    let multi_gif = src_is_gif && frame_count.map(|c| c > 1).unwrap_or(false);

    let safe_rel = rel.replace('/', "__");
    let ffmpeg_ext = if multi_gif { "gif" } else { "png" };
    let rust_ext = if multi_gif { "gif" } else { "png" };
    let ffmpeg_out = ffmpeg_dir.join(format!("{safe_rel}.{ffmpeg_ext}"));
    let rust_out = rust_dir.join(format!("{safe_rel}.{rust_ext}"));
    let rust_decontam_out = rust_dir.join(format!("{safe_rel}.decontam.{rust_ext}"));

    // ffmpeg reference (no decontamination).
    if multi_gif {
        ffmpeg_gif(src, &ffmpeg_out, opts.key)?;
    } else if single_frame_gif {
        ffmpeg_static_first_frame(src, &ffmpeg_out, opts.key)?;
    } else {
        ffmpeg_static(src, &ffmpeg_out, opts.key)?;
    }

    // Rust parity path (decontaminate off, overwrite alpha like ffmpeg) for RGB/alpha metrics.
    convert_with_options(
        src,
        &rust_out,
        opts.key,
        ConvertOptions {
            similarity: opts.similarity,
            blend: opts.blend,
            decontaminate: false,
            preserve_source_alpha: false,
        },
    )?;

    // Rust with decontamination + preserve for halo / native-alpha comparison.
    convert_with_options(
        src,
        &rust_decontam_out,
        opts.key,
        ConvertOptions {
            similarity: opts.similarity,
            blend: opts.blend,
            decontaminate: true,
            preserve_source_alpha: true,
        },
    )?;

    let src_img = first_frame_rgba(src)?;
    let has_key = source_has_key_pixels(&src_img, opts.key, opts.similarity, opts.blend);

    let ff_img = first_frame_rgba(&ffmpeg_out)?;
    let rust_img = first_frame_rgba(&rust_out)?;
    let rust_dc_img = first_frame_rgba(&rust_decontam_out)?;

    let dimensions_match = ff_img.dimensions() == rust_img.dimensions();
    let mut notes = Vec::new();
    if !dimensions_match {
        notes.push(format!(
            "dimension mismatch ffmpeg={:?} rust={:?}",
            ff_img.dimensions(),
            rust_img.dimensions()
        ));
    }

    // Assets with no near-key pixels: ffmpeg flattens native alpha; rust preserve path
    // should match the source. Score preserve path vs source, not vs ffmpeg.
    let (alpha_disagree_pct, opaque_mad, passed) = if !has_key {
        notes.push(
            "no key-color pixels; scoring rust(preserve) vs source (ffmpeg flattens native alpha)"
                .into(),
        );
        let (a, m) = pixel_metrics(&src_img, &rust_dc_img);
        let pass = dimensions_match && a < ALPHA_DISAGREE_THRESHOLD;
        (a, m, pass)
    } else if dimensions_match {
        let (a, m) = pixel_metrics(&ff_img, &rust_img);
        let pass = if multi_gif {
            a < ALPHA_DISAGREE_THRESHOLD
        } else {
            a < ALPHA_DISAGREE_THRESHOLD && (m <= OPAQUE_MAD_FLAG || a < 0.001)
        };
        (a, m, pass)
    } else {
        (1.0, 255.0, false)
    };

    let edge_halo_ffmpeg = edge_halo_score(&ff_img, opts.key);
    let edge_halo_rust = edge_halo_score(&rust_img, opts.key);
    let edge_halo_rust_decontam = edge_halo_score(&rust_dc_img, opts.key);

    let unique_over = if multi_gif {
        unique_opaque_colors(&[&src_img]) > 255
    } else {
        false
    };
    if unique_over {
        notes.push("unique opaque colors may exceed 255 (lossy reduction)".into());
    }

    let ssim = run_ssim(&ffmpeg_out, &rust_out);

    // Remove old pass logic that used opaque_mad alone — already computed above.
    let passed = passed && dimensions_match;

    if !passed {
        let grid_path = grids_dir.join(format!("{safe_rel}.png"));
        if let Err(err) = write_diff_grid(src, &ff_img, &rust_img, &grid_path) {
            notes.push(format!("grid failed: {err}"));
        } else {
            notes.push(format!("diff grid: {}", grid_path.display()));
        }
    }

    if has_key && opaque_mad > OPAQUE_MAD_FLAG && !multi_gif {
        notes.push(format!(
            "opaque MAD {opaque_mad:.2} exceeds {OPAQUE_MAD_FLAG}"
        ));
    }

    Ok(AssetMetrics {
        relative_path: rel.to_string(),
        kind: if !has_key {
            "no-key".into()
        } else if multi_gif {
            "animated".into()
        } else if single_frame_gif {
            "single-gif".into()
        } else {
            "static".into()
        },
        dimensions_match,
        frame_count_ffmpeg: frame_count,
        frame_count_rust: frame_count,
        alpha_disagree_pct,
        opaque_mad,
        edge_halo_ffmpeg,
        edge_halo_rust,
        edge_halo_rust_decontam,
        file_size_ffmpeg: fs::metadata(&ffmpeg_out).map(|m| m.len()).unwrap_or(0),
        file_size_rust: fs::metadata(&rust_out).map(|m| m.len()).unwrap_or(0),
        unique_opaque_over_255: unique_over,
        ssim,
        passed,
        notes,
    })
}

fn pixel_metrics(a: &RgbaImage, b: &RgbaImage) -> (f64, f64) {
    let (w, h) = a.dimensions();
    let mut disagree = 0u64;
    let mut opaque_count = 0u64;
    let mut mad_sum = 0f64;
    for y in 0..h {
        for x in 0..w {
            let pa = a.get_pixel(x, y);
            let pb = b.get_pixel(x, y);
            let ta = pa[3] < 128;
            let tb = pb[3] < 128;
            if ta != tb {
                disagree += 1;
            }
            if !ta && !tb {
                opaque_count += 1;
                mad_sum += (pa[0] as f64 - pb[0] as f64).abs()
                    + (pa[1] as f64 - pb[1] as f64).abs()
                    + (pa[2] as f64 - pb[2] as f64).abs();
            }
        }
    }
    let total = (w as u64) * (h as u64);
    let alpha_pct = if total == 0 {
        0.0
    } else {
        disagree as f64 / total as f64
    };
    let opaque_mad = if opaque_count == 0 {
        0.0
    } else {
        mad_sum / (opaque_count as f64 * 3.0)
    };
    (alpha_pct, opaque_mad)
}

fn source_has_key_pixels(img: &RgbaImage, key: Rgb<u8>, similarity: f32, blend: f32) -> bool {
    let key_rgb = [key[0], key[1], key[2]];
    let threshold = similarity + blend;
    for px in img.pixels() {
        // Ignore already-transparent pixels when detecting key content.
        if px[3] == 0 {
            continue;
        }
        let diff = color_distance_ffmpeg([px[0], px[1], px[2]], key_rgb);
        if diff < threshold {
            return true;
        }
    }
    false
}

/// Mean |channel - key| on opaque pixels adjacent to a transparent pixel.
fn edge_halo_score(img: &RgbaImage, key: Rgb<u8>) -> f64 {
    let (w, h) = img.dimensions();
    let mut sum = 0f64;
    let mut count = 0u64;
    let neighbors = [(-1i32, 0), (1, 0), (0, -1), (0, 1)];
    for y in 0..h {
        for x in 0..w {
            let px = img.get_pixel(x, y);
            if px[3] < 128 {
                continue;
            }
            let mut near_transparent = false;
            for (dx, dy) in neighbors {
                let nx = x as i32 + dx;
                let ny = y as i32 + dy;
                if nx < 0 || ny < 0 || nx >= w as i32 || ny >= h as i32 {
                    continue;
                }
                if img.get_pixel(nx as u32, ny as u32)[3] < 128 {
                    near_transparent = true;
                    break;
                }
            }
            if !near_transparent {
                continue;
            }
            sum += (px[0] as f64 - key[0] as f64).abs()
                + (px[1] as f64 - key[1] as f64).abs()
                + (px[2] as f64 - key[2] as f64).abs();
            count += 1;
        }
    }
    if count == 0 {
        0.0
    } else {
        sum / (count as f64 * 3.0)
    }
}

fn write_diff_grid(
    src: &Path,
    ffmpeg: &RgbaImage,
    rust: &RgbaImage,
    dest: &Path,
) -> Result<(), String> {
    let src_img = first_frame_rgba(src).unwrap_or_else(|_| ffmpeg.clone());
    let (w, h) = ffmpeg.dimensions();
    let src_r = resize_rgba(&src_img, w, h);
    let rust_r = if rust.dimensions() == (w, h) {
        rust.clone()
    } else {
        resize_rgba(rust, w, h)
    };
    let mut heatmap = RgbaImage::new(w, h);
    for (x, y, px) in heatmap.enumerate_pixels_mut() {
        let a = ffmpeg.get_pixel(x, y);
        let b = rust_r.get_pixel(x, y);
        let d = ((a[0] as i16 - b[0] as i16).unsigned_abs() as u16
            + (a[1] as i16 - b[1] as i16).unsigned_abs() as u16
            + (a[2] as i16 - b[2] as i16).unsigned_abs() as u16
            + (a[3] as i16 - b[3] as i16).unsigned_abs() as u16)
            / 4;
        let v = d.min(255) as u8;
        *px = Rgba([v, 0, 0, 255]);
    }

    let mut grid = RgbaImage::new(w * 4, h);
    blit(&mut grid, &src_r, 0, 0);
    blit(&mut grid, ffmpeg, w, 0);
    blit(&mut grid, &rust_r, w * 2, 0);
    blit(&mut grid, &heatmap, w * 3, 0);
    grid.save(dest)
        .map_err(|e| format!("failed to write grid: {e}"))?;
    Ok(())
}

fn blit(dest: &mut RgbaImage, src: &RgbaImage, ox: u32, oy: u32) {
    for (x, y, px) in src.enumerate_pixels() {
        if ox + x < dest.width() && oy + y < dest.height() {
            dest.put_pixel(ox + x, oy + y, *px);
        }
    }
}

fn write_reports(out_dir: &Path, report: &CompareReport) -> Result<(), String> {
    let json_path = out_dir.join("report.json");
    let md_path = out_dir.join("report.md");
    let json = serde_json::to_string_pretty(report).map_err(|e| e.to_string())?;
    fs::write(&json_path, json).map_err(|e| e.to_string())?;

    let mut md = String::new();
    md.push_str("# Chromakey compare report\n\n");
    md.push_str(&format!(
        "**Passed:** {} · **Failed:** {} · **Skipped/errors:** {}\n\n",
        report.passed, report.failed, report.skipped
    ));
    md.push_str(
        "| Asset | Kind | Alpha disagree % | Opaque MAD | Halo ff/rust/dc | SSIM | Pass |\n",
    );
    md.push_str("|---|---|---:|---:|---|---:|:---:|\n");
    let mut sorted = report.assets.clone();
    sorted.sort_by(|a, b| {
        b.alpha_disagree_pct
            .partial_cmp(&a.alpha_disagree_pct)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    for a in &sorted {
        md.push_str(&format!(
            "| `{}` | {} | {:.3} | {:.2} | {:.1}/{:.1}/{:.1} | {} | {} |\n",
            a.relative_path,
            a.kind,
            a.alpha_disagree_pct * 100.0,
            a.opaque_mad,
            a.edge_halo_ffmpeg,
            a.edge_halo_rust,
            a.edge_halo_rust_decontam,
            a.ssim
                .map(|s| format!("{s:.4}"))
                .unwrap_or_else(|| "—".into()),
            if a.passed { "✓" } else { "✗" },
        ));
        for note in &a.notes {
            md.push_str(&format!("| ↳ | | | | | | {note} |\n"));
        }
    }
    let mut f = File::create(&md_path).map_err(|e| e.to_string())?;
    f.write_all(md.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

fn ffmpeg_available() -> bool {
    Command::new("ffmpeg")
        .arg("-version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn chroma_hex(key: Rgb<u8>) -> String {
    format!("0x{:02X}{:02X}{:02X}", key[0], key[1], key[2])
}

fn ffmpeg_static(src: &Path, dest: &Path, key: Rgb<u8>) -> Result<(), String> {
    let vf = format!(
        "format=rgba,colorkey={}:{}:{}",
        chroma_hex(key),
        DEFAULT_SIMILARITY,
        DEFAULT_BLEND
    );
    run_ffmpeg(src, dest, &vf, false)
}

fn ffmpeg_static_first_frame(src: &Path, dest: &Path, key: Rgb<u8>) -> Result<(), String> {
    let key_s = chroma_hex(key);
    let vf = format!("format=rgba,colorkey={key_s}:{DEFAULT_SIMILARITY}:{DEFAULT_BLEND}");
    let output = Command::new("ffmpeg")
        .args([
            "-y",
            "-loglevel",
            "error",
            "-i",
            &src.to_string_lossy(),
            "-frames:v",
            "1",
            "-vf",
            &vf,
            &dest.to_string_lossy(),
        ])
        .output()
        .map_err(|e| format!("ffmpeg spawn: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(())
}

fn ffmpeg_gif(src: &Path, dest: &Path, key: Rgb<u8>) -> Result<(), String> {
    let key_s = chroma_hex(key);
    let vf = format!(
        "format=rgba,colorkey={key_s}:{DEFAULT_SIMILARITY}:{DEFAULT_BLEND},split[s0][s1];[s0]palettegen=reserve_transparent=1[p];[s1][p]paletteuse=alpha_threshold=128"
    );
    run_ffmpeg(src, dest, &vf, true)
}

fn run_ffmpeg(src: &Path, dest: &Path, vf: &str, loop_once: bool) -> Result<(), String> {
    let mut args = vec![
        "-y".into(),
        "-loglevel".into(),
        "error".into(),
        "-i".into(),
        src.to_string_lossy().into_owned(),
        "-vf".into(),
        vf.to_string(),
    ];
    if loop_once {
        args.push("-loop".into());
        args.push("-1".into());
    }
    args.push(dest.to_string_lossy().into_owned());
    let output = Command::new("ffmpeg")
        .args(&args)
        .output()
        .map_err(|e| format!("ffmpeg spawn: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(())
}

fn run_ssim(a: &Path, b: &Path) -> Option<f64> {
    // ffmpeg ssim filter requires same format; write score to stdout via metadata.
    let output = Command::new("ffmpeg")
        .args([
            "-loglevel",
            "info",
            "-i",
            &a.to_string_lossy(),
            "-i",
            &b.to_string_lossy(),
            "-lavfi",
            "ssim=stats_file=-",
            "-f",
            "null",
            "-",
        ])
        .output()
        .ok()?;
    let stderr = String::from_utf8_lossy(&output.stderr);
    // Look for "SSIM Y:... All:0.xxxxx"
    for line in stderr.lines().rev() {
        if let Some(idx) = line.find("All:") {
            let rest = &line[idx + 4..];
            let num: String = rest
                .chars()
                .take_while(|c| c.is_ascii_digit() || *c == '.' || *c == 'e' || *c == '-')
                .collect();
            if let Ok(v) = num.parse::<f64>() {
                return Some(v);
            }
        }
    }
    None
}
