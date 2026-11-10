// Desktop shell for TST Motion. The editor itself is the web code in ../src,
// shown in the system WebView (WebView2 on Windows).
use std::path::PathBuf;
use tauri::ipc::Response;

/// A .tstm file the program was opened with (double-click in Explorer).
fn startup_path() -> Option<PathBuf> {
    std::env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .find(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("tstm")) && p.is_file())
}

/// Name of the project file the program was opened with, if any.
#[tauri::command]
fn startup_file_name() -> Option<String> {
    startup_path().and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
}

/// Bytes of that file. Only this one file can be read, nothing else on disk.
#[tauri::command]
fn startup_file_bytes() -> Result<Response, String> {
    let p = startup_path().ok_or("no file")?;
    std::fs::read(p).map(Response::new).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![startup_file_name, startup_file_bytes])
        .run(tauri::generate_context!())
        .expect("error while running TST Motion");
}
