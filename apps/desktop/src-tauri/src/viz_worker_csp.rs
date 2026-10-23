//! Content-Security-Policy for the visualizer draw-module worker.
//!
//! A dedicated worker takes its policy from the worker script's own response,
//! and Tauri only attaches the configured CSP to HTML assets. Without this
//! header, pack code in the worker runs with no CSP at all. The frontend twin
//! is `src/components/visualizer/sandbox/workerCsp.ts`; keep the two policies
//! identical (a frontend test checks), and the worker refuses to load packs
//! when the policy is missing.

use std::borrow::Cow;

use tauri::http::{header::CONTENT_SECURITY_POLICY, HeaderValue, Request, Response};

pub const VIZ_WORKER_CSP: &str = "default-src 'none'; script-src 'self' blob:";

/// Vite emits the worker as `assets/vizRenderer.worker-<hash>.js`.
fn is_viz_worker_path(path: &str) -> bool {
    path.strip_prefix("/assets/vizRenderer.worker-")
        .and_then(|rest| rest.strip_suffix(".js"))
        .is_some_and(|hash| {
            !hash.is_empty()
                && hash
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        })
}

/// `on_web_resource_request` hook for every app webview.
pub fn apply(request: Request<Vec<u8>>, response: &mut Response<Cow<'static, [u8]>>) {
    if is_viz_worker_path(request.uri().path()) {
        response.headers_mut().insert(
            CONTENT_SECURITY_POLICY,
            HeaderValue::from_static(VIZ_WORKER_CSP),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn served(uri: &str) -> Option<String> {
        let request = Request::builder().uri(uri).body(Vec::new()).unwrap();
        let mut response = Response::new(Cow::Borrowed(&b""[..]));
        apply(request, &mut response);
        response
            .headers()
            .get(CONTENT_SECURITY_POLICY)
            .map(|value| value.to_str().unwrap().to_string())
    }

    #[test]
    fn worker_script_gets_the_policy_on_every_platform_origin() {
        for uri in [
            "tauri://localhost/assets/vizRenderer.worker-ST3T67C8.js",
            "http://tauri.localhost/assets/vizRenderer.worker-a_b-C.js",
            "https://tauri.localhost/assets/vizRenderer.worker-ST3T67C8.js?v=1",
        ] {
            assert_eq!(served(uri).as_deref(), Some(VIZ_WORKER_CSP), "{uri}");
        }
    }

    #[test]
    fn other_assets_are_untouched() {
        for uri in [
            "tauri://localhost/assets/index-8Yblr29A.js",
            "tauri://localhost/index.html",
            "tauri://localhost/assets/vizRenderer.worker-.js",
            "tauri://localhost/assets/vizRenderer.worker-x/y.js",
            "tauri://localhost/other/vizRenderer.worker-ST3T67C8.js",
        ] {
            assert_eq!(served(uri), None, "{uri}");
        }
    }

    #[test]
    fn policy_blocks_eval_network_and_asset_reads() {
        assert!(!VIZ_WORKER_CSP.contains("unsafe-eval"));
        assert!(VIZ_WORKER_CSP.contains("default-src 'none'"));
        assert!(!VIZ_WORKER_CSP.contains("asset:"));
    }
}
