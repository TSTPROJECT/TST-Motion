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
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![startup_file_name, startup_file_bytes, backup_save, backup_list, backup_read])
        .run(tauri::generate_context!())
        .expect("error while running TST Motion");
}
