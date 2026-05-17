#![cfg(target_os = "macos")]

use objc2::rc::autoreleasepool;
use objc2::MainThreadMarker;
use objc2_app_kit::{NSModalResponseOK, NSOpenPanel};
use objc2_foundation::{NSArray, NSString};

const AUDIO_EXTENSIONS: &[&str] = &["mp3", "flac", "aac", "wav", "m4a"];

/// Native open panel that allows selecting multiple audio files and/or folders.
pub fn pick_library_paths() -> Option<Vec<String>> {
    autoreleasepool(|_| {
        let mtm = MainThreadMarker::new()?;
        let panel = NSOpenPanel::openPanel(mtm);

        panel.setCanChooseDirectories(true);
        panel.setCanChooseFiles(true);
        panel.setAllowsMultipleSelection(true);
        panel.setMessage(Some(&NSString::from_str(
            "Select audio files or folders to add to your library",
        )));

        let extensions: Vec<_> = AUDIO_EXTENSIONS
            .iter()
            .map(|ext| NSString::from_str(ext))
            .collect();
        let allowed = NSArray::from_retained_slice(&extensions);
        #[allow(deprecated)]
        panel.setAllowedFileTypes(Some(&allowed));

        if panel.runModal() != NSModalResponseOK {
            return None;
        }

        let urls = panel.URLs();
        let mut paths = Vec::with_capacity(urls.len());
        for url in urls.iter() {
            if let Some(path) = url.path() {
                paths.push(path.to_string());
            }
        }

        if paths.is_empty() { None } else { Some(paths) }
    })
}
