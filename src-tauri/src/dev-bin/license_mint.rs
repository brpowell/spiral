//! PoC Direct mint CLI — provisional mint, finalize, and local HTTP stub.
//!
//! Private key stays on the developer machine; never ship with the app.
//!
//! See `tools/license-mint/README.md`.

use chrono::Utc;
use serde::Deserialize;
use spiral_lib::license::mint::{
    finalize, load_signing_key, mint_provisional, write_spcard_file, MintProvisionalParams,
    MintStore, DEFAULT_EXPIRY_BUFFER_MINUTES, DEFAULT_REFUND_WINDOW_DAYS,
};
use spiral_lib::license::{
    serialize_grant, serialize_spcard, DirectMintProof, DirectProofVerifier, Grant, LicenseSku,
    ProofOfPurchaseVerifier, SigningKey, POC_DIRECT_MINT_GRANT,
};
use std::env;
use std::fs;
use std::io::{self, Cursor};
use std::path::{Path, PathBuf};
use std::process;
use std::sync::{Arc, Mutex};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

const DEFAULT_BIND: &str = "127.0.0.1:8787";
const FINALIZE_PATH: &str = "/v1/license/finalize";

fn usage() -> &'static str {
    "Spiral PoC license mint — provisional .spcard, finalize, local HTTP stub.\n\
     \n\
     Usage:\n\
       license_mint provisional --purchase-id <ID> [OPTIONS]\n\
       license_mint finalize --purchase-id <ID> [OPTIONS]\n\
       license_mint serve [OPTIONS]\n\
     \n\
     Shared options:\n\
       --key <PATH>           Ed25519 private seed (32 raw bytes)\n\
                              (default: docs/license/poc-keys/ed25519-private.raw)\n\
       --store <PATH>         idempotency ledger JSON\n\
                              (default: tools/license-mint/.mint-store/grants.json)\n\
       -h, --help             show this help\n\
     \n\
     provisional options:\n\
       --purchase-id <ID>     originalPurchaseId (required)\n\
       --out <PATH>           write .spcard to PATH (default: stdout)\n\
       --grant <SECRET>       proof presented to DirectProofVerifier\n\
                              (default: same as trusted grant)\n\
       Trusted grant:         env SPIRAL_MINT_GRANT, else spiral-poc-mint-grant\n\
       --refund-days <N>      refund window in days (default: 14)\n\
       --buffer-mins <N>      expiry buffer minutes (default: 5)\n\
       --product-id <ID>      productId (default: spiral)\n\
       --sku <SKU>            standard | founder (default: standard)\n\
     \n\
     finalize options:\n\
       --purchase-id <ID>     originalPurchaseId (required)\n\
       --out <PATH>           write grant JSON to PATH (default: stdout)\n\
     \n\
     serve options:\n\
       --bind <ADDR>          listen address (default: 127.0.0.1:8787)\n\
     \n\
     Dogfood tip: mint with --refund-days 0 --buffer-mins 0 to reach\n\
     readyToFinalize immediately after install.\n\
     \n\
     Idempotency: reminting / re-finalizing the same --purchase-id returns the\n\
     same grant."
}

fn repo_root_from_cwd() -> PathBuf {
    let mut dir = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    for _ in 0..6 {
        if dir
            .join("docs/license/poc-keys/ed25519-private.raw")
            .is_file()
        {
            return dir;
        }
        if !dir.pop() {
            break;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn default_key_path(root: &Path) -> PathBuf {
    root.join("docs/license/poc-keys/ed25519-private.raw")
}

fn default_store_path(root: &Path) -> PathBuf {
    root.join("tools/license-mint/.mint-store/grants.json")
}

fn require_value<'a>(args: &'a [String], i: &mut usize, flag: &str) -> &'a str {
    *i += 1;
    match args.get(*i) {
        Some(v) => v.as_str(),
        None => {
            eprintln!("{flag} requires a value");
            process::exit(1);
        }
    }
}

fn parse_u32_flag(args: &[String], i: &mut usize, flag: &str) -> u32 {
    let value = require_value(args, i, flag);
    match value.parse::<u32>() {
        Ok(n) => n,
        Err(_) => {
            eprintln!("{flag} must be a non-negative integer, got {value}");
            process::exit(1);
        }
    }
}

fn load_key_and_store(key_path: &Path, store_path: &Path) -> (SigningKey, MintStore) {
    let signing_key = match load_signing_key(key_path) {
        Ok(k) => k,
        Err(e) => {
            eprintln!("{e}");
            process::exit(1);
        }
    };
    let store = match MintStore::load(store_path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("{e}");
            process::exit(1);
        }
    };
    (signing_key, store)
}

fn write_grant_out(out: Option<&Path>, grant: &Grant) {
    let json = match serialize_grant(grant) {
        Ok(j) => j,
        Err(e) => {
            eprintln!("{e}");
            process::exit(1);
        }
    };
    if let Some(path) = out {
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                if let Err(e) = fs::create_dir_all(parent) {
                    eprintln!("failed to create output dir {}: {e}", parent.display());
                    process::exit(1);
                }
            }
        }
        if let Err(e) = fs::write(path, format!("{json}\n")) {
            eprintln!("failed to write {}: {e}", path.display());
            process::exit(1);
        }
    } else {
        println!("{json}");
    }
}

fn parse_sku_flag(value: &str) -> LicenseSku {
    match value {
        "standard" => LicenseSku::Standard,
        "founder" => LicenseSku::Founder,
        other => {
            eprintln!("--sku must be standard or founder, got {other}");
            process::exit(1);
        }
    }
}

fn cmd_provisional(args: &[String]) {
    let mut purchase_id: Option<String> = None;
    let mut out: Option<PathBuf> = None;
    let mut grant: Option<String> = None;
    let mut key_path: Option<PathBuf> = None;
    let mut store_path: Option<PathBuf> = None;
    let mut refund_days = DEFAULT_REFUND_WINDOW_DAYS;
    let mut buffer_mins = DEFAULT_EXPIRY_BUFFER_MINUTES;
    let mut product_id: Option<String> = None;
    let mut sku = LicenseSku::Standard;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--purchase-id" => {
                purchase_id = Some(require_value(args, &mut i, "--purchase-id").into())
            }
            "--out" => out = Some(PathBuf::from(require_value(args, &mut i, "--out"))),
            "--grant" => grant = Some(require_value(args, &mut i, "--grant").into()),
            "--key" => key_path = Some(PathBuf::from(require_value(args, &mut i, "--key"))),
            "--store" => store_path = Some(PathBuf::from(require_value(args, &mut i, "--store"))),
            "--refund-days" => refund_days = parse_u32_flag(args, &mut i, "--refund-days"),
            "--buffer-mins" => buffer_mins = parse_u32_flag(args, &mut i, "--buffer-mins"),
            "--product-id" => product_id = Some(require_value(args, &mut i, "--product-id").into()),
            "--sku" => sku = parse_sku_flag(require_value(args, &mut i, "--sku")),
            other => {
                eprintln!("Unknown option: {other}\n\n{}", usage());
                process::exit(1);
            }
        }
        i += 1;
    }

    let Some(purchase_id) = purchase_id else {
        eprintln!("--purchase-id is required\n\n{}", usage());
        process::exit(1);
    };

    let root = repo_root_from_cwd();
    let key_path = key_path.unwrap_or_else(|| default_key_path(&root));
    let store_path = store_path.unwrap_or_else(|| default_store_path(&root));
    let expected_grant =
        env::var("SPIRAL_MINT_GRANT").unwrap_or_else(|_| POC_DIRECT_MINT_GRANT.to_string());
    let presented_grant = grant.unwrap_or_else(|| expected_grant.clone());

    let verifier = DirectProofVerifier::new(expected_grant);
    let purchase = match verifier.verify(&DirectMintProof {
        mint_grant: presented_grant,
        original_purchase_id: purchase_id,
        product_id,
        sku: Some(sku),
    }) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("Proof rejected: {e}");
            process::exit(1);
        }
    };

    let (signing_key, mut store) = load_key_and_store(&key_path, &store_path);
    let params = MintProvisionalParams::from_verified(&purchase, refund_days, buffer_mins);
    let result = match mint_provisional(&signing_key, &mut store, &params, Utc::now()) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Mint failed: {e}");
            process::exit(1);
        }
    };

    let status = if result.reused {
        "Reused grant"
    } else {
        "Minted provisional"
    };
    let expires = result
        .card
        .grants
        .first()
        .and_then(|g| g.expires_at.as_deref())
        .unwrap_or("null");
    let purchase_id = result
        .card
        .grants
        .first()
        .map(|g| g.original_purchase_id.as_str())
        .unwrap_or("");

    if let Some(path) = out {
        if let Err(e) = write_spcard_file(&path, &result.card) {
            eprintln!("{e}");
            process::exit(1);
        }
        eprintln!("{status} → {} ({})", path.display(), purchase_id);
        eprintln!(
            "expiresAt={expires}  sku={}  store={}",
            result.card.grants[0].sku.as_str(),
            store.path().display()
        );
    } else {
        match serialize_spcard(&result.card) {
            Ok(json) => println!("{json}"),
            Err(e) => {
                eprintln!("{e}");
                process::exit(1);
            }
        }
        eprintln!(
            "# {} purchaseId={} sku={} expiresAt={expires}",
            if result.reused { "reused" } else { "minted" },
            purchase_id,
            result.card.grants[0].sku.as_str(),
        );
    }
}

fn cmd_finalize(args: &[String]) {
    let mut purchase_id: Option<String> = None;
    let mut out: Option<PathBuf> = None;
    let mut key_path: Option<PathBuf> = None;
    let mut store_path: Option<PathBuf> = None;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--purchase-id" => {
                purchase_id = Some(require_value(args, &mut i, "--purchase-id").into())
            }
            "--out" => out = Some(PathBuf::from(require_value(args, &mut i, "--out"))),
            "--key" => key_path = Some(PathBuf::from(require_value(args, &mut i, "--key"))),
            "--store" => store_path = Some(PathBuf::from(require_value(args, &mut i, "--store"))),
            other => {
                eprintln!("Unknown option: {other}\n\n{}", usage());
                process::exit(1);
            }
        }
        i += 1;
    }

    let Some(purchase_id) = purchase_id else {
        eprintln!("--purchase-id is required\n\n{}", usage());
        process::exit(1);
    };

    let root = repo_root_from_cwd();
    let key_path = key_path.unwrap_or_else(|| default_key_path(&root));
    let store_path = store_path.unwrap_or_else(|| default_store_path(&root));
    let (signing_key, mut store) = load_key_and_store(&key_path, &store_path);

    let result = match finalize(&signing_key, &mut store, &purchase_id, Utc::now()) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Finalize failed: {e}");
            process::exit(1);
        }
    };

    let status = if result.reused {
        "Reused permanent grant"
    } else {
        "Finalized permanent grant"
    };
    eprintln!(
        "{status} purchaseId={} sku={} store={}",
        result.grant.original_purchase_id,
        result.grant.sku.as_str(),
        store.path().display()
    );
    write_grant_out(out.as_deref(), &result.grant);
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FinalizeRequestBody {
    original_purchase_id: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorBody {
    code: &'static str,
    message: String,
}

fn json_response(status: StatusCode, body: String) -> Response<Cursor<Vec<u8>>> {
    let header = Header::from_bytes(
        &b"Content-Type"[..],
        &b"application/json; charset=utf-8"[..],
    )
    .expect("valid header");
    Response::from_data(body.into_bytes())
        .with_status_code(status)
        .with_header(header)
}

fn error_response(
    status: StatusCode,
    code: &'static str,
    message: impl Into<String>,
) -> Response<Cursor<Vec<u8>>> {
    let body = serde_json::to_string_pretty(&ErrorBody {
        code,
        message: message.into(),
    })
    .unwrap_or_else(|_| r#"{"code":"serialize_failed","message":"error"}"#.to_string());
    json_response(status, body)
}

fn handle_finalize_http(
    request: &mut Request,
    signing_key: &SigningKey,
    store: &Mutex<MintStore>,
) -> Response<Cursor<Vec<u8>>> {
    let mut body = String::new();
    if let Err(e) = io::Read::read_to_string(request.as_reader(), &mut body) {
        return error_response(
            StatusCode(400),
            "invalid_json",
            format!("failed to read request body: {e}"),
        );
    }

    let parsed: FinalizeRequestBody = match serde_json::from_str(&body) {
        Ok(p) => p,
        Err(e) => {
            return error_response(
                StatusCode(400),
                "invalid_json",
                format!("request body must be JSON with originalPurchaseId: {e}"),
            );
        }
    };

    let mut store = match store.lock() {
        Ok(s) => s,
        Err(_) => {
            return error_response(StatusCode(500), "store_io", "mint store lock poisoned");
        }
    };

    match finalize(
        signing_key,
        &mut store,
        &parsed.original_purchase_id,
        Utc::now(),
    ) {
        Ok(result) => match serialize_grant(&result.grant) {
            Ok(json) => json_response(StatusCode(200), json),
            Err(e) => error_response(StatusCode(500), e.code, e.message),
        },
        Err(e) => {
            let status = match e.code {
                "unknown_purchase" => StatusCode(404),
                "refunded" => StatusCode(403),
                "invalid_purchase_id" | "invalid_json" => StatusCode(400),
                _ => StatusCode(500),
            };
            error_response(status, e.code, e.message)
        }
    }
}

fn cmd_serve(args: &[String]) {
    let mut key_path: Option<PathBuf> = None;
    let mut store_path: Option<PathBuf> = None;
    let mut bind = DEFAULT_BIND.to_string();

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--key" => key_path = Some(PathBuf::from(require_value(args, &mut i, "--key"))),
            "--store" => store_path = Some(PathBuf::from(require_value(args, &mut i, "--store"))),
            "--bind" => bind = require_value(args, &mut i, "--bind").to_string(),
            other => {
                eprintln!("Unknown option: {other}\n\n{}", usage());
                process::exit(1);
            }
        }
        i += 1;
    }

    let root = repo_root_from_cwd();
    let key_path = key_path.unwrap_or_else(|| default_key_path(&root));
    let store_path = store_path.unwrap_or_else(|| default_store_path(&root));
    let (signing_key, store) = load_key_and_store(&key_path, &store_path);
    let signing_key = Arc::new(signing_key);
    let store = Arc::new(Mutex::new(store));

    let server = match Server::http(&bind) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Failed to bind {bind}: {e}");
            process::exit(1);
        }
    };

    eprintln!(
        "PoC license mint listening on http://{bind}\n\
         POST {FINALIZE_PATH}  body: {{\"originalPurchaseId\":\"…\"}}\n\
         store={}",
        store_path.display()
    );

    for mut request in server.incoming_requests() {
        let method = request.method().clone();
        let url = request.url().to_string();
        let path = url.split('?').next().unwrap_or(&url);

        let response = if method == Method::Post && path == FINALIZE_PATH {
            handle_finalize_http(&mut request, &signing_key, &store)
        } else if method == Method::Get && (path == "/" || path == "/health") {
            json_response(
                StatusCode(200),
                r#"{"ok":true,"service":"spiral-license-mint"}"#.to_string(),
            )
        } else {
            error_response(
                StatusCode(404),
                "not_found",
                format!("no route for {method} {path}"),
            )
        };

        if let Err(e) = request.respond(response) {
            eprintln!("Failed to respond: {e}");
        }
    }
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.is_empty() || args.iter().any(|a| a == "-h" || a == "--help") {
        println!("{}", usage());
        if args.is_empty() {
            process::exit(1);
        }
        return;
    }

    let command = args[0].as_str();
    let rest = &args[1..];
    match command {
        "provisional" => cmd_provisional(rest),
        "finalize" => cmd_finalize(rest),
        "serve" => cmd_serve(rest),
        other => {
            eprintln!("Unknown command: {other}\n\n{}", usage());
            process::exit(1);
        }
    }
}
