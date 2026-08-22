//! Compare ffmpeg chromakey pipeline vs native Rust skin_convert across wmp-skins.
//!
//! Usage:
//!   cargo run --manifest-path src-tauri/Cargo.toml --bin skin_convert_compare -- \
//!     --input wmp-skins --out /tmp/chroma-compare
//!
//! Optional: `--filter m_top_hov` to limit to matching paths.

use image::Rgb;
use spiral_lib::skin_convert::cli_compare::{run_compare, CompareOptions};
use spiral_lib::skin_convert::{DEFAULT_BLEND, DEFAULT_SIMILARITY};
use std::env;
use std::path::PathBuf;
use std::process;

fn print_help() {
    println!(
        "Usage: skin_convert_compare --input <dir> --out <dir> [options]

Options:
  --input     Directory of source assets (e.g. wmp-skins)
  --out       Output directory for ffmpeg/, rust/, grids/, report.md
  --chroma    Key color hex (default: #ff00ff)
  --filter    Only assets whose path contains this substring
  -h, --help  Show this help
"
    );
}

fn parse_chroma(chroma: &str) -> Result<Rgb<u8>, String> {
    let hex = chroma.trim().trim_start_matches('#');
    if hex.len() != 6 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(format!("invalid chroma: {chroma}"));
    }
    let r = u8::from_str_radix(&hex[0..2], 16).map_err(|e| e.to_string())?;
    let g = u8::from_str_radix(&hex[2..4], 16).map_err(|e| e.to_string())?;
    let b = u8::from_str_radix(&hex[4..6], 16).map_err(|e| e.to_string())?;
    Ok(Rgb([r, g, b]))
}

fn main() {
    let mut input: Option<PathBuf> = None;
    let mut out: Option<PathBuf> = None;
    let mut chroma = "#ff00ff".to_string();
    let mut filter: Option<String> = None;
    let mut help = false;

    let mut args = env::args().skip(1).peekable();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--input" => input = args.next().map(PathBuf::from),
            "--out" => out = args.next().map(PathBuf::from),
            "--chroma" => {
                if let Some(v) = args.next() {
                    chroma = v;
                }
            }
            "--filter" => filter = args.next(),
            "-h" | "--help" => help = true,
            other if other.starts_with('-') => {
                eprintln!("unknown flag {other}");
                process::exit(1);
            }
            _ => {}
        }
    }

    if help {
        print_help();
        return;
    }
    let (Some(input), Some(out)) = (input, out) else {
        print_help();
        process::exit(1);
    };

    let key = match parse_chroma(&chroma) {
        Ok(k) => k,
        Err(e) => {
            eprintln!("{e}");
            process::exit(1);
        }
    };

    match run_compare(&CompareOptions {
        input_dir: input,
        out_dir: out.clone(),
        key,
        similarity: DEFAULT_SIMILARITY,
        blend: DEFAULT_BLEND,
        filter,
    }) {
        Ok(report) => {
            println!(
                "wrote {}/report.md (passed={} failed={} skipped={})",
                out.display(),
                report.passed,
                report.failed,
                report.skipped
            );
            if report.failed > 0 || report.skipped > 0 {
                process::exit(1);
            }
        }
        Err(err) => {
            eprintln!("{err}");
            process::exit(1);
        }
    }
}
