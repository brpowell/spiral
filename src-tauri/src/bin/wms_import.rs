use spiral_lib::wms_import::{import_wms_skin, ImportWmsOptions};
use std::env;
use std::path::PathBuf;
use std::process;

fn print_help() {
    println!(
        "Usage: wms_import --input <wms|wmz|dir> --out <skin-dir> [options]

Options:
  --input     Path to a .wmz, .wms, or folder containing one .wms
  --out       Skin contribution directory (skin.json + assets/)
  --id        Override skin id (default: slug from theme id / filename)
  --chroma    Transparency key (default: #ff00ff)
  --dry-run   Parse and report only; do not write files
  -h, --help  Show this help
"
    );
}

fn main() {
    let mut input: Option<PathBuf> = None;
    let mut out: Option<PathBuf> = None;
    let mut id: Option<String> = None;
    let mut chroma: Option<String> = None;
    let mut dry_run = false;
    let mut help = false;

    let mut args = env::args().skip(1).peekable();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--input" => {
                input = args.next().map(PathBuf::from);
            }
            "--out" => {
                out = args.next().map(PathBuf::from);
            }
            "--id" => {
                id = args.next();
            }
            "--chroma" => {
                chroma = args.next();
            }
            "--dry-run" => dry_run = true,
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

    match import_wms_skin(&ImportWmsOptions {
        input,
        out,
        id,
        chroma,
        dry_run,
    }) {
        Ok(result) => {
            if let Some(path) = &result.skin_path {
                println!("wrote {}", path.display());
            }
            if let Some(path) = &result.report_path {
                println!("wrote {}", path.display());
            }
            if dry_run {
                println!("dry-run: report ({} chars)", result.report_markdown.len());
            }
            if !result.layout_ok {
                eprintln!("layout validation failed:\n{}", result.errors.join("\n"));
                process::exit(1);
            }
        }
        Err(err) => {
            eprintln!("{err}");
            process::exit(1);
        }
    }
}
