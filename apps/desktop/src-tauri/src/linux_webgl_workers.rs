//! Turn on WebGL for `OffscreenCanvas` in WebKitGTK webviews.
//!
//! Pack visualizers render in a worker on a transferred `OffscreenCanvas`.
//! WebKitGTK ships the stable `AllowWebGLInWorkers` feature switched off, so
//! `getContext("webgl2")` there returns null and WebGL visualizers (Dream Cube)
//! draw nothing. Safari enables it, so macOS never hit this.
//!
//! The feature API arrived in WebKitGTK 2.42, newer than the `webkit2gtk`
//! bindings, so the functions are looked up at runtime: an older WebKitGTK
//! still starts, and WebGL visualizers stay blank there as before.

use std::ffi::{c_char, c_int, c_void, CStr};
use std::sync::OnceLock;

const FEATURE: &CStr = c"AllowWebGLInWorkers";

struct FeatureApi {
    get_all_features: unsafe extern "C" fn() -> *mut c_void,
    list_get_length: unsafe extern "C" fn(*mut c_void) -> usize,
    list_get: unsafe extern "C" fn(*mut c_void, usize) -> *mut c_void,
    list_unref: unsafe extern "C" fn(*mut c_void),
    feature_get_identifier: unsafe extern "C" fn(*mut c_void) -> *const c_char,
    set_feature_enabled: unsafe extern "C" fn(*mut c_void, *mut c_void, c_int),
    #[cfg(test)]
    get_feature_enabled: unsafe extern "C" fn(*mut c_void, *mut c_void) -> c_int,
}

fn feature_api() -> Option<&'static FeatureApi> {
    static API: OnceLock<Option<FeatureApi>> = OnceLock::new();
    API.get_or_init(|| {
        // SAFETY: each field's type is the documented WebKitGTK 2.42 signature.
        unsafe {
            Some(FeatureApi {
                get_all_features: sym(c"webkit_settings_get_all_features")?,
                list_get_length: sym(c"webkit_feature_list_get_length")?,
                list_get: sym(c"webkit_feature_list_get")?,
                list_unref: sym(c"webkit_feature_list_unref")?,
                feature_get_identifier: sym(c"webkit_feature_get_identifier")?,
                set_feature_enabled: sym(c"webkit_settings_set_feature_enabled")?,
                #[cfg(test)]
                get_feature_enabled: sym(c"webkit_settings_get_feature_enabled")?,
            })
        }
    })
    .as_ref()
}

/// Look up a loaded C function as `F`.
///
/// # Safety
/// `F` must be the `extern "C" fn` type matching the symbol's signature.
unsafe fn sym<F: Copy>(name: &CStr) -> Option<F> {
    const { assert!(size_of::<F>() == size_of::<*mut c_void>()) };
    let ptr = libc::dlsym(libc::RTLD_DEFAULT, name.as_ptr());
    (!ptr.is_null()).then(|| std::mem::transmute_copy::<*mut c_void, F>(&ptr))
}

/// Run `f` with the `AllowWebGLInWorkers` feature, if this WebKitGTK has it.
fn with_feature<T>(api: &FeatureApi, f: impl FnOnce(*mut c_void) -> T) -> Option<T> {
    // SAFETY: the list is owned here and unreffed after use; features it
    // returns stay valid while the list is alive.
    unsafe {
        let list = (api.get_all_features)();
        if list.is_null() {
            return None;
        }
        let found = (0..(api.list_get_length)(list))
            .map(|i| (api.list_get)(list, i))
            .find(|&feature| {
                let id = (api.feature_get_identifier)(feature);
                !id.is_null() && CStr::from_ptr(id) == FEATURE
            });
        let result = found.map(f);
        (api.list_unref)(list);
        result
    }
}

/// Enable the feature on a `WebKitSettings*`. Returns false when this
/// WebKitGTK lacks the feature API or the feature.
fn enable_on_settings(settings: *mut c_void) -> bool {
    let Some(api) = feature_api() else {
        return false;
    };
    // SAFETY: `settings` is a live WebKitSettings*; `feature` comes from the list.
    with_feature(api, |feature| unsafe {
        (api.set_feature_enabled)(settings, feature, 1)
    })
    .is_some()
}

/// Call for each webview when its page starts loading, before visualizer
/// workers are created.
pub fn enable(webview: &tauri::Webview) {
    let _ = webview.with_webview(|platform| {
        use webkit2gtk::glib::object::ObjectType;
        use webkit2gtk::WebViewExt;
        if let Some(settings) = platform.inner().settings() {
            if !enable_on_settings(settings.as_ptr().cast()) {
                static WARNED: std::sync::Once = std::sync::Once::new();
                WARNED.call_once(|| {
                    eprintln!("WebKitGTK lacks AllowWebGLInWorkers; WebGL visualizers stay blank")
                });
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enables_webgl_in_workers_on_settings() {
        // The C constructor, not `Settings::new()`, which demands GTK be
        // initialized on the main thread; WebKitSettings itself does not.
        // SAFETY: returns a new owned WebKitSettings*, released at the end.
        let ptr: *mut c_void = unsafe { webkit2gtk::ffi::webkit_settings_new() }.cast();
        let api = feature_api().expect("WebKitGTK >= 2.42 feature API");
        // SAFETY: live settings and a feature from the list.
        let enabled = |api: &FeatureApi| {
            with_feature(api, |f| unsafe { (api.get_feature_enabled)(ptr, f) != 0 })
                .expect("AllowWebGLInWorkers feature")
        };
        assert!(!enabled(api), "off by default in WebKitGTK");
        assert!(enable_on_settings(ptr));
        assert!(enabled(api));
        // SAFETY: drops the reference returned by webkit_settings_new.
        unsafe { webkit2gtk::glib::gobject_ffi::g_object_unref(ptr.cast()) };
    }
}
