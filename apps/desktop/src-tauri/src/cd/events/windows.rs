//! Windows volume / optical device change notifications for the CD monitor.
#![cfg(target_os = "windows")]

use std::sync::mpsc::Sender;
use std::thread;

use windows::core::PCWSTR;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, PostQuitMessage,
    RegisterClassW, TranslateMessage, CW_USEDEFAULT, HWND_MESSAGE, MSG, WINDOW_EX_STYLE,
    WINDOW_STYLE, WM_DESTROY, WM_DEVICECHANGE, WNDCLASSW,
};

use super::MonitorWake;

unsafe extern "system" fn wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_DEVICECHANGE => {
            // DBT_DEVICEARRIVAL / DBT_DEVICEREMOVECOMPLETE / DBT_DEVNODES_CHANGED, etc.
            // Any device change is enough to invalidate presence and re-probe.
            if let Some(tx) = WAKE_TX.with(|cell| cell.borrow().clone()) {
                let _ = tx.send(MonitorWake::DeviceStatusChanged);
            }
            LRESULT(1)
        }
        WM_DESTROY => {
            PostQuitMessage(0);
            LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

thread_local! {
    static WAKE_TX: std::cell::RefCell<Option<Sender<MonitorWake>>> = const { std::cell::RefCell::new(None) };
}

fn class_name() -> Vec<u16> {
    "SpiralCdMonitor\0".encode_utf16().collect()
}

/// Start a message-only window that forwards `WM_DEVICECHANGE` to the CD monitor.
pub fn start_volume_events(tx: Sender<MonitorWake>) -> Result<(), String> {
    thread::Builder::new()
        .name("cd-device-events".into())
        .spawn(move || {
            if let Err(err) = run_message_loop(tx) {
                eprintln!("cd monitor: windows device events failed: {err}");
            }
        })
        .map_err(|err| format!("Failed to start CD device event thread: {err}"))?;
    Ok(())
}

fn run_message_loop(tx: Sender<MonitorWake>) -> Result<(), String> {
    WAKE_TX.with(|cell| {
        *cell.borrow_mut() = Some(tx);
    });

    let class = class_name();
    unsafe {
        let hinstance = GetModuleHandleW(None).map_err(|err| format!("GetModuleHandleW: {err}"))?;

        let wc = WNDCLASSW {
            lpfnWndProc: Some(wnd_proc),
            hInstance: hinstance.into(),
            lpszClassName: PCWSTR(class.as_ptr()),
            ..Default::default()
        };

        let atom = RegisterClassW(&wc);
        if atom == 0 {
            return Err("RegisterClassW failed for CD monitor window".into());
        }

        let hwnd = CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            PCWSTR(class.as_ptr()),
            PCWSTR::null(),
            WINDOW_STYLE::default(),
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            Some(HWND_MESSAGE),
            None,
            Some(hinstance.into()),
            None,
        )
        .map_err(|err| format!("CreateWindowExW failed: {err}"))?;

        if hwnd.is_invalid() {
            return Err("CreateWindowExW returned invalid HWND".into());
        }

        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }

    Ok(())
}
