//! Process environment WebKitGTK needs before GTK starts on Linux.
//!
//! NVIDIA's proprietary driver on Wayland breaks WebKitGTK's DMA-BUF renderer
//! when explicit sync is on: the web process crashes and the compositor drops
//! the app with "Error 71 (Protocol error) dispatching to Wayland display".
//! Turning explicit sync off keeps GPU compositing, unlike
//! `WEBKIT_DISABLE_DMABUF_RENDERER`, which falls back to slow shared-memory
//! copies. Other drivers ignore the variable.

const NV_DISABLE_EXPLICIT_SYNC: &str = "__NV_DISABLE_EXPLICIT_SYNC";

/// Call first thing in `run()`, before any thread starts: `set_var` is not
/// thread-safe. A value the user already set is left alone.
pub fn apply() {
    apply_to(NV_DISABLE_EXPLICIT_SYNC);
}

fn apply_to(key: &str) {
    if std::env::var_os(key).is_none() {
        std::env::set_var(key, "1");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sets_unset_variable() {
        let key = "SPIRAL_TEST_LINUX_WEBKIT_ENV_UNSET";
        std::env::remove_var(key);
        apply_to(key);
        assert_eq!(std::env::var(key).as_deref(), Ok("1"));
    }

    #[test]
    fn keeps_user_value() {
        let key = "SPIRAL_TEST_LINUX_WEBKIT_ENV_USER";
        std::env::set_var(key, "0");
        apply_to(key);
        assert_eq!(std::env::var(key).as_deref(), Ok("0"));
    }
}
