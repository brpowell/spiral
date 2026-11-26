//! Serves a `Library.db` over the host API for development.
//!
//! ```text
//! dev-host --db <Library.db> [--spiral-folder <dir>] [--cache-dir <dir>]
//!          [--addr 127.0.0.1:7878] [--token <t>]
//! ```
//!
//! The token comes from `--token` or `SPIRAL_DEV_TOKEN`; there is no default.
//! Resized artwork goes to `--cache-dir`, by default `spiral-dev-host-cache`
//! in the OS temp dir. It is refused inside the Spiral folder.

use spiral_host_api::{router, serve, DevTokenAuth, HostApi, SqliteHostLibrary};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

const USAGE: &str = "usage: dev-host --db <Library.db> [--spiral-folder <dir>] \
                     [--cache-dir <dir>] [--addr <ip:port>] [--token <token>]\n\
                     The token can also come from SPIRAL_DEV_TOKEN.";

struct Args {
    db: PathBuf,
    spiral_folder: PathBuf,
    cache_dir: PathBuf,
    addr: SocketAddr,
    token: String,
}

fn parse_args() -> Result<Args, String> {
    let mut db = None;
    let mut spiral_folder = None;
    let mut cache_dir = None;
    let mut addr: SocketAddr = "127.0.0.1:7878".parse().unwrap();
    let mut token = None;
    let mut args = std::env::args().skip(1);
    while let Some(flag) = args.next() {
        if flag == "-h" || flag == "--help" {
            return Err(USAGE.into());
        }
        let mut value = || args.next().ok_or_else(|| format!("{flag} needs a value"));
        match flag.as_str() {
            "--db" => db = Some(PathBuf::from(value()?)),
            "--spiral-folder" => spiral_folder = Some(PathBuf::from(value()?)),
            "--cache-dir" => cache_dir = Some(PathBuf::from(value()?)),
            "--addr" => {
                let v = value()?;
                addr = v.parse().map_err(|e| format!("--addr {v}: {e}"))?;
            }
            "--token" => token = Some(value()?),
            other => return Err(format!("unknown argument {other}\n{USAGE}")),
        }
    }
    let db = db.ok_or_else(|| format!("--db is required\n{USAGE}"))?;
    let spiral_folder = match spiral_folder {
        Some(folder) => folder,
        None => match db.parent() {
            Some(parent) if !parent.as_os_str().is_empty() => parent.to_path_buf(),
            _ => PathBuf::from("."),
        },
    };
    let token = token
        .or_else(|| std::env::var("SPIRAL_DEV_TOKEN").ok())
        .filter(|t| !t.is_empty())
        .ok_or("refusing to start without a token: pass --token or set SPIRAL_DEV_TOKEN")?;
    let cache_dir = cache_dir.unwrap_or_else(|| std::env::temp_dir().join("spiral-dev-host-cache"));
    Ok(Args {
        db,
        spiral_folder,
        cache_dir,
        addr,
        token,
    })
}

/// Refuses `cache_dir` inside the Spiral folder, whose `Artwork/` the
/// desktop app owns, then creates it. Checked first, so a refused folder is
/// never created.
fn check_cache_dir(cache_dir: &Path, spiral_folder: &Path) -> Result<(), String> {
    let cache =
        resolve(cache_dir).map_err(|e| format!("--cache-dir {}: {e}", cache_dir.display()))?;
    if let Ok(spiral) = std::fs::canonicalize(spiral_folder) {
        if cache.starts_with(&spiral) {
            return Err(format!(
                "--cache-dir {} is inside the Spiral folder; pick a folder outside it",
                cache_dir.display()
            ));
        }
    }
    std::fs::create_dir_all(cache_dir)
        .map_err(|e| format!("can't create --cache-dir {}: {e}", cache_dir.display()))
}

/// `path` with symlinks resolved, though its last parts may not exist yet:
/// its nearest existing ancestor canonicalized, plus the rest.
fn resolve(path: &Path) -> std::io::Result<PathBuf> {
    let path = std::path::absolute(path)?;
    let mut missing = Vec::new();
    let mut existing = path.as_path();
    loop {
        match std::fs::canonicalize(existing) {
            Ok(base) => return Ok(missing.into_iter().rev().fold(base, |p, part| p.join(part))),
            Err(e) => {
                let (Some(parent), Some(name)) = (existing.parent(), existing.file_name()) else {
                    return Err(e);
                };
                missing.push(name.to_owned());
                existing = parent;
            }
        }
    }
}

#[tokio::main]
async fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    let args = match parse_args() {
        Ok(args) => args,
        Err(message) => {
            eprintln!("{message}");
            return ExitCode::from(2);
        }
    };
    if let Err(message) = check_cache_dir(&args.cache_dir, &args.spiral_folder) {
        eprintln!("{message}");
        return ExitCode::from(2);
    }
    let library = match SqliteHostLibrary::open(&args.db, &args.spiral_folder).await {
        Ok(library) => library,
        Err(e) => {
            eprintln!("can't open {}: {e}", args.db.display());
            return ExitCode::FAILURE;
        }
    };
    let listener = match tokio::net::TcpListener::bind(args.addr).await {
        Ok(listener) => listener,
        Err(e) => {
            eprintln!("can't listen on {}: {e}", args.addr);
            return ExitCode::FAILURE;
        }
    };
    tracing::info!(
        addr = %args.addr,
        db = %args.db.display(),
        spiral_folder = %args.spiral_folder.display(),
        cache_dir = %args.cache_dir.display(),
        "dev-host listening"
    );
    let app = router(HostApi::new(
        library,
        DevTokenAuth::new(args.token),
        args.cache_dir,
    ));
    let shutdown = async {
        let _ = tokio::signal::ctrl_c().await;
        tracing::info!("shutting down");
    };
    match serve(listener, app, shutdown).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("server error: {e}");
            ExitCode::FAILURE
        }
    }
}
