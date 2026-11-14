// Desktop shell for TST Motion. The editor itself is the web code in ../src,
// shown in the system WebView (WebView2 on Windows).
use std::path::{Path, PathBuf};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::Manager;

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

// ---------- backup copies on disk ----------
// Every few minutes the editor sends a full .tstm copy of the open project. They live in
// Documents\TST Motion Backups\<project id>\, newest 5 per project, so work survives even if
// the program's own storage is lost (uninstall, broken profile).

const KEEP_BACKUPS: usize = 5;

fn backup_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .document_dir()
        .map(|d| d.join("TST Motion Backups"))
        .map_err(|e| e.to_string())
}

/// Undo encodeURIComponent (header values must be ASCII).
fn uri_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Only letters, digits and a few safe marks, so a name can never leave its folder.
fn clean(s: &str) -> String {
    let t: String = s
        .chars()
        .map(|c| if c.is_alphanumeric() || " -_().".contains(c) { c } else { ' ' })
        .collect();
    let t = t.trim().trim_matches('.').to_string();
    if t.is_empty() { "project".into() } else { t.chars().take(60).collect() }
}

fn header(req: &Request, name: &str) -> Result<String, String> {
    req.headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(uri_decode)
        .ok_or_else(|| format!("missing {name}"))
}

#[tauri::command]
fn backup_save(app: tauri::AppHandle, request: Request) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else { return Err("expected file bytes".into()) };
    let id = clean(&header(&request, "x-id")?);
    let file = format!("{}.tstm", clean(&header(&request, "x-file")?));
    let dir = backup_root(&app)?.join(&id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(".writing");
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join(&file)).map_err(|e| e.to_string())?;
    // file names start with the date and time, so name order is age order
    let mut all: Vec<PathBuf> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "tstm"))
        .collect();
    all.sort();
    while all.len() > KEEP_BACKUPS {
        let _ = std::fs::remove_file(all.remove(0));
    }
    Ok(())
}

#[derive(serde::Serialize)]
struct BackupInfo {
    path: String,
    file: String,
    size: u64,
}

#[tauri::command]
fn backup_list(app: tauri::AppHandle) -> Result<Vec<BackupInfo>, String> {
    let root = backup_root(&app)?;
    let mut out = Vec::new();
    let Ok(dirs) = std::fs::read_dir(&root) else { return Ok(out) };
    for d in dirs.filter_map(|e| e.ok()) {
        let Ok(files) = std::fs::read_dir(d.path()) else { continue };
        for f in files.filter_map(|e| e.ok()) {
            let p = f.path();
            if !p.extension().is_some_and(|x| x == "tstm") { continue; }
            out.push(BackupInfo {
                path: p.to_string_lossy().into_owned(),
                file: p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(),
                size: f.metadata().map(|m| m.len()).unwrap_or(0),
            });
        }
    }
    out.sort_by(|a, b| b.file.cmp(&a.file));
    Ok(out)
}

fn inside(root: &Path, p: &Path) -> bool {
    match (root.canonicalize(), p.canonicalize()) {
        (Ok(r), Ok(q)) => q.starts_with(r),
        _ => false,
    }
}

/// Bytes of one backup. Only files inside the backup folder can be read.
#[tauri::command]
fn backup_read(app: tauri::AppHandle, path: String) -> Result<Response, String> {
    let root = backup_root(&app)?;
    let p = PathBuf::from(path);
    if !inside(&root, &p) { return Err("not a backup".into()); }
    std::fs::read(p).map(Response::new).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
// ---------- timelapse ----------
// Copies the program's own window (what the user sees, nothing else on screen), made smaller to
// fit `max_w`. Returns width and height (u32, little-endian) followed by the BGRA pixels.
#[cfg(windows)]
#[tauri::command]
fn capture_window(window: tauri::WebviewWindow, max_w: u32) -> Result<Response, String> {
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::Graphics::Gdi::*;
    use windows::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
    use windows::Win32::UI::WindowsAndMessaging::GetClientRect;
    let raw = window.hwnd().map_err(|e| e.to_string())?.0 as *mut core::ffi::c_void;
    let hwnd = HWND(raw);
    unsafe {
        let mut r = RECT::default();
        GetClientRect(hwnd, &mut r).map_err(|e| e.to_string())?;
        let (w, h) = ((r.right - r.left).max(1), (r.bottom - r.top).max(1));
        let k = (max_w.max(16) as f64 / w as f64).min(1.0);
        let (tw, th) = (((w as f64 * k).round() as i32).max(1), ((h as f64 * k).round() as i32).max(1));
        let wdc = GetDC(Some(hwnd));
        let full_dc = CreateCompatibleDC(Some(wdc));
        let full = CreateCompatibleBitmap(wdc, w, h);
        let old1 = SelectObject(full_dc, full.into());
        // 1 = client area only, 2 = include GPU-drawn content (the web view)
        let ok = PrintWindow(hwnd, full_dc, PRINT_WINDOW_FLAGS(3)).as_bool();
        let small_dc = CreateCompatibleDC(Some(wdc));
        let small = CreateCompatibleBitmap(wdc, tw, th);
        let old2 = SelectObject(small_dc, small.into());
        SetStretchBltMode(small_dc, HALFTONE);
        let _ = StretchBlt(small_dc, 0, 0, tw, th, Some(full_dc), 0, 0, w, h, SRCCOPY);
        let mut bi = BITMAPINFO::default();
        bi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bi.bmiHeader.biWidth = tw;
        bi.bmiHeader.biHeight = -th; // top row first
        bi.bmiHeader.biPlanes = 1;
        bi.bmiHeader.biBitCount = 32;
        let mut out = vec![0u8; 8 + (tw * th * 4) as usize];
        out[0..4].copy_from_slice(&(tw as u32).to_le_bytes());
        out[4..8].copy_from_slice(&(th as u32).to_le_bytes());
        SelectObject(small_dc, old2);
        let lines = GetDIBits(small_dc, small, 0, th as u32, Some(out[8..].as_mut_ptr() as *mut _), &mut bi, DIB_RGB_COLORS);
        SelectObject(full_dc, old1);
        let _ = DeleteObject(small.into());
        let _ = DeleteObject(full.into());
        let _ = DeleteDC(small_dc);
        let _ = DeleteDC(full_dc);
        ReleaseDC(Some(hwnd), wdc);
        if !ok || lines == 0 {
            return Err("capture failed".into());
        }
        Ok(Response::new(out))
    }
}
#[cfg(not(windows))]
#[tauri::command]
fn capture_window(_max_w: u32) -> Result<Response, String> {
    Err("not supported".into())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![startup_file_name, startup_file_bytes, backup_save, backup_list, backup_read, capture_window])
        .run(tauri::generate_context!())
        .expect("error while running TST Motion");
}
