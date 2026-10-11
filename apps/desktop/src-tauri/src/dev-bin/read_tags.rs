use spiral_lib::tag_inspector::{collect_supported_audio_files, inspect_path, print_human_report};
use std::env;
use std::path::PathBuf;
use std::process;

fn usage() -> &'static str {
    "Read embedded audio tags using Spiral's metadata readers.\n\
     \n\
     Usage:\n\
       read_tags [OPTIONS] <PATH>...\n\
     \n\
     Options:\n\
       -r, --recursive   Walk directories for supported audio files\n\
           --json        Emit JSON (one object per file)\n\
       -h, --help        Show this help\n\
     \n\
     Supported extensions: mp3, flac, aac, wav, m4a, mp4, ogg, opus"
}

fn main() {
    let mut recursive = false;
    let mut json = false;
    let mut paths = Vec::new();

    for arg in env::args().skip(1) {
        match arg.as_str() {
            "-r" | "--recursive" => recursive = true,
            "--json" => json = true,
            "-h" | "--help" => {
                println!("{}", usage());
                return;
            }
            value => paths.push(PathBuf::from(value)),
        }
    }

    if paths.is_empty() {
        eprintln!("{}", usage());
        process::exit(1);
    }

    let files = collect_supported_audio_files(&paths, recursive);
    if files.is_empty() {
        eprintln!("No supported audio files found.");
        process::exit(1);
    }

    let mut reports = Vec::with_capacity(files.len());
    for path in files {
        reports.push(inspect_path(&path));
    }

    if json {
        for report in &reports {
            match serde_json::to_string_pretty(report) {
                Ok(json) => println!("{json}"),
                Err(err) => {
                    eprintln!("Failed to serialize report for {}: {err}", report.path);
                    process::exit(1);
                }
            }
        }
        return;
    }

    for report in &reports {
        print_human_report(report);
    }
}
