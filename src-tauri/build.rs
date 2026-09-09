use std::env;
use std::path::PathBuf;

fn main() {
    #[cfg(target_os = "macos")]
    {
        println!("cargo:rustc-link-lib=framework=DiscRecording");
        println!("cargo:rustc-link-lib=framework=CoreFoundation");
    }

    link_libmp3lame();

    // Dev loads builtin packs from CARGO_MANIFEST_DIR (packs::paths). Skip
    // copying `bundle.resources` so tauri-build does not emit
    // cargo:rerun-if-changed for every file under packs/builtin — otherwise
    // editing a skin CSS/JSON forces a full Rust rebuild.
    if tauri_build::is_dev() && std::env::var_os("TAURI_CONFIG").is_none() {
        std::env::set_var("TAURI_CONFIG", r#"{"bundle":{"resources":[]}}"#);
    }

    tauri_build::build()
}

/// Dylib-link the fetched native-lame artifact. Never compile LAME C.
fn link_libmp3lame() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let target = env::var("TARGET").expect("TARGET set by cargo");
    let lib_dir = manifest.join("native").join("lame").join(&target);
    println!("cargo:rerun-if-changed=native/lame.lock.json");
    println!("cargo:rerun-if-changed={}", lib_dir.display());

    let runtime = runtime_lib_name(&target);
    let runtime_path = lib_dir.join(runtime);
    if !runtime_path.is_file() {
        panic!(
            "libmp3lame shared library not found at {}\n\
Run `npm run bootstrap` (needs `gh` auth to spiral-powered/native-lame, contents: read).\n\
There is no static LAME fallback.",
            runtime_path.display()
        );
    }

    let search = lib_dir.canonicalize().unwrap_or_else(|_| lib_dir.clone());
    println!("cargo:rustc-link-search=native={}", search.display());
    if target.contains("windows") {
        println!("cargo:rustc-link-lib=dylib=libmp3lame");
        #[cfg(windows)]
        copy_windows_dll(&runtime_path);
    } else if target.contains("apple-darwin") {
        println!("cargo:rustc-link-lib=dylib=mp3lame");
        println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Frameworks");
        add_debug_fetch_rpath(&search);
    } else {
        println!("cargo:rustc-link-lib=dylib=mp3lame");
        println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN");
        println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN/../lib/spiral");
        add_debug_fetch_rpath(&search);
    }
}

/// cargo test / tauri dev only — do not bake the fetch path into installers.
fn add_debug_fetch_rpath(search: &std::path::Path) {
    if env::var("PROFILE").as_deref() != Ok("release") {
        println!("cargo:rustc-link-arg=-Wl,-rpath,{}", search.display());
    }
}

fn runtime_lib_name(target: &str) -> &'static str {
    if target.contains("apple-darwin") {
        "libmp3lame.0.dylib"
    } else if target.contains("windows") {
        "libmp3lame.dll"
    } else {
        "libmp3lame.so.0"
    }
}

/// cargo test bins live in target/<profile>/deps; Windows loads DLLs from the
/// exe directory (and the profile dir for the main binary).
#[cfg(windows)]
fn copy_windows_dll(dll: &std::path::Path) {
    use std::fs;
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    let Some(profile_dir) = out_dir.ancestors().nth(3) else {
        return;
    };
    for dest_dir in [profile_dir.to_path_buf(), profile_dir.join("deps")] {
        let _ = fs::create_dir_all(&dest_dir);
        let dest = dest_dir.join("libmp3lame.dll");
        if let Err(err) = fs::copy(dll, &dest) {
            println!(
                "cargo:warning=could not copy {} to {}: {err}",
                dll.display(),
                dest.display()
            );
        }
    }
}
