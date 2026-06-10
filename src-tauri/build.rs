fn main() {
    #[cfg(target_os = "macos")]
    {
        println!("cargo:rustc-link-lib=framework=DiscRecording");
        println!("cargo:rustc-link-lib=framework=CoreFoundation");
    }

    tauri_build::build()
}
