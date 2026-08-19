fn main() {
    #[cfg(target_os = "macos")]
    {
        println!("cargo:rustc-link-lib=framework=DiscRecording");
        println!("cargo:rustc-link-lib=framework=CoreFoundation");
    }

    // Dev loads builtin packs from CARGO_MANIFEST_DIR (packs::paths). Skip
    // copying `bundle.resources` so tauri-build does not emit
    // cargo:rerun-if-changed for every file under packs/builtin — otherwise
    // editing a skin CSS/JSON forces a full Rust rebuild.
    if tauri_build::is_dev() && std::env::var_os("TAURI_CONFIG").is_none() {
        std::env::set_var("TAURI_CONFIG", r#"{"bundle":{"resources":[]}}"#);
    }

    tauri_build::build()
}
