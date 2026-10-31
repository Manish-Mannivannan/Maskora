//! Project files and still exports (architecture §7.1, §9.4, §10.1).
//!
//! The frontend never names a path here either. Saving, opening, locating a
//! source and exporting each open a native dialog in Rust; the frontend gets
//! an opaque project token, source handles and display names.
//!
//! - A project is written atomically (a temporary file, then a rename), so an
//!   interrupted save leaves the previous file whole. Each source is stored
//!   with its digest and a path relative to the project file when one exists.
//! - Opening validates the format and refuses a newer schema safely. Each
//!   source is then classified against the local trust record (`trust.rs`):
//!   authorized (selected before, content unchanged), changed (approved
//!   content that differs from what the project was saved with), needing
//!   approval (unfamiliar, or changed since approval), or missing. Nothing
//!   the user has not approved is read.
//! - Saving over a project written in an older schema first keeps a copy of
//!   it beside the new file (architecture §14.3), once.
//! - An export is written atomically too, and overwrite, permission and
//!   disk-full outcomes are reported distinctly.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::sources::{MAX_SOURCE_BYTES, SourceInfo, SourceRegistry};
use crate::trust::{TrustStore, hash_file};

pub const PROJECT_FORMAT: &str = "maskora-project";
/// The newest project schema this build reads and writes.
pub const SCHEMA_VERSION: u64 = 2;
const MAX_PROJECT_BYTES: usize = 32 * 1024 * 1024;
const MAX_EXPORT_BYTES: usize = 1024 * 1024 * 1024;
const MAX_SOURCES: usize = 200;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectError {
    pub code: &'static str,
    pub message: String,
}

/// Take the one dialog turn, or refuse while another dialog is open.
fn dialog_turn() -> Result<crate::dialog_turn::Turn, ProjectError> {
    crate::dialog_turn::take().ok_or_else(|| err("dialogBusy", crate::dialog_turn::BUSY))
}

fn err(code: &'static str, message: impl Into<String>) -> ProjectError {
    ProjectError {
        code,
        message: message.into(),
    }
}

/// Project files this session has saved or opened, by opaque token.
#[derive(Default)]
pub struct ProjectFiles {
    paths: Mutex<HashMap<String, PathBuf>>,
}

impl ProjectFiles {
    pub fn register(&self, path: PathBuf) -> String {
        let token = format!("prj-{}", crate::sources::random_hex());
        self.paths
            .lock()
            .expect("project registry lock poisoned")
            .insert(token.clone(), path);
        token
    }
    pub fn path(&self, token: &str) -> Option<PathBuf> {
        self.paths
            .lock()
            .expect("project registry lock poisoned")
            .get(token)
            .cloned()
    }
}

/// Write `bytes` to `path` via a temporary file in the same folder and a rename,
/// so the destination is either the old file or the complete new one.
pub fn write_atomically(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    // A write interrupted before its rename (a crash, a power cut) leaves only a temporary file; clear those first.
    if let Ok(entries) = std::fs::read_dir(dir) {
        let prefix = format!(".{name}.");
        for entry in entries.flatten() {
            let n = entry.file_name().to_string_lossy().into_owned();
            if n.starts_with(&prefix) && n.ends_with(".tmp") {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
    let temp = dir.join(format!(".{name}.{}.tmp", crate::sources::random_hex()));
    let result = (|| {
        let mut file = std::fs::File::create(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temp, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

/// `to` relative to the directory `from`, with `/` separators; None across drives or roots.
pub fn relative_path(from: &Path, to: &Path) -> Option<String> {
    let from: Vec<Component> = from.components().collect();
    let to: Vec<Component> = to.components().collect();
    if from.first() != to.first() {
        return None;
    }
    let common = from.iter().zip(&to).take_while(|(a, b)| a == b).count();
    let mut parts: Vec<String> = vec!["..".into(); from.len() - common];
    parts.extend(
        to[common..]
            .iter()
            .map(|c| c.as_os_str().to_string_lossy().into_owned()),
    );
    Some(parts.join("/"))
}

/// `path` with `.` and `..` resolved lexically, so references can be compared and rebased.
fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in path.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    out.push("..");
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// A stored relative reference resolved against the project folder; refuses absolute paths and drive prefixes.
fn resolve_ref(dir: &Path, relative: &str) -> Option<PathBuf> {
    let rel = Path::new(relative);
    if rel.is_absolute()
        || rel
            .components()
            .any(|c| matches!(c, Component::Prefix(_) | Component::RootDir))
    {
        return None;
    }
    Some(normalize(&dir.join(rel)))
}

/// Limits a project document must keep, whatever the frontend validated (architecture §7.1).
const MAX_DEPTH: usize = 64;
const MAX_NUMBER: f64 = 1.0e9;
const MAX_STRING: usize = 100_000;
const MAX_ITEMS: usize = 100_000;

/// Refuse documents nested too deeply, numbers beyond any real setting, and oversized strings or lists.
fn check_bounds(value: &Value, depth: usize) -> Result<(), ProjectError> {
    let bad = |what: &str| {
        err(
            "invalidProject",
            format!("The project file has {what}; it was not read."),
        )
    };
    if depth > MAX_DEPTH {
        return Err(bad("values nested too deeply"));
    }
    match value {
        Value::Number(n) => match n.as_f64() {
            Some(x) if x.is_finite() && x.abs() <= MAX_NUMBER => Ok(()),
            _ => Err(bad("a number out of range")),
        },
        Value::String(t) if t.len() > MAX_STRING => Err(bad("an oversized text value")),
        Value::Array(items) => {
            if items.len() > MAX_ITEMS {
                return Err(bad("an oversized list"));
            }
            items.iter().try_for_each(|v| check_bounds(v, depth + 1))
        }
        Value::Object(map) => {
            if map.len() > MAX_ITEMS {
                return Err(bad("an oversized object"));
            }
            map.values().try_for_each(|v| check_bounds(v, depth + 1))
        }
        _ => Ok(()),
    }
}

/// Structural checks the native side owns: format, schema version, size, source list.
/// The frontend validates every value in detail.
pub fn validate_project(text: &str) -> Result<Value, ProjectError> {
    if text.len() > MAX_PROJECT_BYTES {
        return Err(err(
            "projectTooLarge",
            "The project file is larger than this version accepts.",
        ));
    }
    let value: Value = serde_json::from_str(text)
        .map_err(|_| err("invalidProject", "The file is not a Maskora project."))?;
    check_bounds(&value, 0)?;
    if value.get("format").and_then(Value::as_str) != Some(PROJECT_FORMAT) {
        return Err(err("invalidProject", "The file is not a Maskora project."));
    }
    match value.get("schemaVersion").and_then(Value::as_u64) {
        Some(v) if v > SCHEMA_VERSION => {
            return Err(err(
                "futureSchema",
                format!(
                    "The project was saved by a newer Maskora (schema {v}); this version reads up to {SCHEMA_VERSION}. The file was not changed."
                ),
            ));
        }
        Some(v) if v >= 1 => {}
        _ => {
            return Err(err(
                "invalidProject",
                "The project's schema version is missing or invalid.",
            ));
        }
    }
    let sources = value
        .get("sources")
        .and_then(Value::as_array)
        .ok_or_else(|| err("invalidProject", "The project lists no sources."))?;
    if sources.len() > MAX_SOURCES {
        return Err(err(
            "invalidProject",
            "The project lists more sources than this version accepts.",
        ));
    }
    for s in sources {
        let ok = s
            .get("id")
            .and_then(Value::as_str)
            .is_some_and(|v| !v.is_empty() && v.len() <= 100)
            && s.get("sha256")
                .and_then(Value::as_str)
                .is_some_and(|v| v.len() == 64 && v.bytes().all(|b| b.is_ascii_hexdigit()));
        if !ok {
            return Err(err(
                "invalidProject",
                "A source in the project has no valid identity.",
            ));
        }
    }
    Ok(value)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceOnOpen {
    pub id: String,
    pub file_name: String,
    /// authorized | changed | needsApproval | missing
    pub status: &'static str,
    /// For needsApproval: unfamiliar (never selected here) or contentChanged (differs from what was approved).
    pub reason: Option<&'static str>,
    pub source: Option<SourceInfo>,
}

/// Classify each source of a validated project against the trust record, authorizing only what it allows.
pub fn classify_sources(
    dir: &Path,
    project: &Value,
    trust: &TrustStore,
    registry: &SourceRegistry,
) -> Vec<SourceOnOpen> {
    let empty = vec![];
    let sources = project
        .get("sources")
        .and_then(Value::as_array)
        .unwrap_or(&empty);
    sources
        .iter()
        .map(|s| {
            let id = s.get("id").and_then(Value::as_str).unwrap_or_default();
            let saved = s.get("sha256").and_then(Value::as_str).unwrap_or_default();
            let reference = s.get("ref");
            let file_name = reference
                .and_then(|r| r.get("fileName"))
                .and_then(Value::as_str)
                .or_else(|| s.get("name").and_then(Value::as_str))
                .unwrap_or_default();
            let candidate = reference
                .and_then(|r| r.get("relativePath"))
                .and_then(Value::as_str)
                .and_then(|r| resolve_ref(dir, r))
                .or_else(|| {
                    (!file_name.is_empty() && !file_name.contains(['/', '\\']))
                        .then(|| dir.join(file_name))
                });
            classify_one(id, file_name, saved, candidate, trust, registry)
        })
        .collect()
}

/// Classify one source at `candidate` (where its reference points): only the trust record can authorize it.
pub fn classify_one(
    id: &str,
    file_name: &str,
    saved: &str,
    candidate: Option<PathBuf>,
    trust: &TrustStore,
    registry: &SourceRegistry,
) -> SourceOnOpen {
    let result = |status, reason, source| SourceOnOpen {
        id: id.to_owned(),
        file_name: file_name.to_owned(),
        status,
        reason,
        source,
    };
    let Some(path) = candidate.filter(|p| p.is_file()) else {
        return result("missing", None, None);
    };
    // Unrecorded paths are not even read: a project's path grants nothing.
    if !trust.knows(&path) {
        return result("needsApproval", Some("unfamiliar"), None);
    }
    let Ok((current, _)) = hash_file(&path, MAX_SOURCE_BYTES) else {
        return result("missing", None, None);
    };
    if !trust.trusts(&path, &current) {
        return result("needsApproval", Some("contentChanged"), None);
    }
    match registry.authorize(&path) {
        Ok(info) if current == saved => result("authorized", None, Some(info)),
        Ok(info) => result("changed", None, Some(info)),
        Err(_) => result("missing", None, None),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSource {
    id: String,
    handle: String,
}

/// What the frontend sends to save: the project JSON (without source paths) and its sources' handles.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRequest {
    json: String,
    sources: Vec<SaveSource>,
    /// The project this session opened or saved, if any.
    token: Option<String>,
    save_as: bool,
    suggested_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    token: String,
    name: String,
    overwritten: bool,
    /// The copy kept of an older-schema project this save replaced.
    backup: Option<String>,
}

fn io_error(error: &std::io::Error, what: &str) -> ProjectError {
    // Windows ERROR_DISK_FULL (112) and ERROR_HANDLE_DISK_FULL (39).
    if error.kind() == std::io::ErrorKind::StorageFull
        || matches!(error.raw_os_error(), Some(112 | 39))
    {
        err(
            "diskFull",
            format!("There is not enough disk space to write the {what}."),
        )
    } else if error.kind() == std::io::ErrorKind::PermissionDenied
        // Windows ERROR_SHARING_VIOLATION (32) and ERROR_LOCK_VIOLATION (33): open in another program.
        || matches!(error.raw_os_error(), Some(32 | 33))
    {
        err(
            "permissionDenied",
            format!(
                "Maskora is not allowed to write the {what} there (the file may be read-only or in use)."
            ),
        )
    } else {
        err("writeFailed", format!("The {what} could not be written."))
    }
}

/// Fill each source's reference (relative path and file name) and write the project,
/// keeping a copy of an older-schema file it replaces.
///
/// A source this session has not resolved (missing, or not yet approved) keeps
/// the reference it was opened with; saved into another folder, that reference
/// is rebased so it still names the same place.
pub fn write_project(
    path: &Path,
    mut project: Value,
    sources: &[(String, PathBuf)],
    previous_dir: Option<&Path>,
) -> Result<Written, ProjectError> {
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    if let Some(list) = project.get_mut("sources").and_then(Value::as_array_mut) {
        for s in list {
            let id = s
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            if let Some((_, source)) = sources.iter().find(|(i, _)| *i == id) {
                let file_name = source
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default();
                s["ref"] = serde_json::json!({ "relativePath": relative_path(dir, &normalize(source)), "fileName": file_name });
            } else if let Some(previous) = previous_dir
                && let Some(reference) = s.get_mut("ref")
                && let Some(old) = reference.get("relativePath").and_then(Value::as_str)
            {
                let rebased = resolve_ref(previous, old).and_then(|abs| relative_path(dir, &abs));
                reference["relativePath"] = rebased.map_or(Value::Null, Value::String);
            }
        }
    }
    let text = serde_json::to_string_pretty(&project)
        .map_err(|_| err("invalidProject", "The project could not be encoded."))?;
    let existed = path.exists();
    let backup = if existed {
        keep_older_schema(path)?
    } else {
        None
    };
    write_atomically(path, text.as_bytes()).map_err(|e| io_error(&e, "project"))?;
    Ok(Written {
        overwritten: existed,
        backup,
    })
}

pub struct Written {
    pub overwritten: bool,
    /// File name of the copy kept of an older-schema project, when one was made now.
    pub backup: Option<String>,
}

/// Before an older-schema project is replaced, copy it to "<name> (schema N backup).maskora.json"
/// beside it, unless that copy already exists. A file that is not a readable project is left alone.
fn keep_older_schema(path: &Path) -> Result<Option<String>, ProjectError> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Ok(None);
    };
    let Ok(old) = serde_json::from_str::<Value>(&text) else {
        return Ok(None);
    };
    let Some(version) = old.get("schemaVersion").and_then(Value::as_u64) else {
        return Ok(None);
    };
    if version >= SCHEMA_VERSION
        || old.get("format").and_then(Value::as_str) != Some(PROJECT_FORMAT)
    {
        return Ok(None);
    }
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let stem = name
        .strip_suffix(".maskora.json")
        .or_else(|| name.strip_suffix(".json"))
        .unwrap_or(&name);
    let backup_name = format!("{stem} (schema {version} backup).maskora.json");
    let backup = path.with_file_name(&backup_name);
    if backup.exists() {
        return Ok(None);
    }
    write_atomically(&backup, text.as_bytes())
        .map_err(|e| io_error(&e, "backup of the older project"))?;
    Ok(Some(backup_name))
}

/// Save the project. `token` saves over the file it came from unless `save_as`; otherwise a dialog asks where.
/// `Ok(None)` is a cancelled dialog.
#[tauri::command]
pub async fn save_project(
    app: tauri::AppHandle,
    request: SaveRequest,
    registry: tauri::State<'_, SourceRegistry>,
    projects: tauri::State<'_, ProjectFiles>,
) -> Result<Option<Saved>, ProjectError> {
    use tauri_plugin_dialog::DialogExt;
    let SaveRequest {
        json,
        sources,
        token,
        save_as,
        suggested_name,
    } = request;
    let project = validate_project(&json)?;
    if project.get("schemaVersion").and_then(Value::as_u64) != Some(SCHEMA_VERSION) {
        return Err(err(
            "invalidProject",
            "Projects are written with the current schema only.",
        ));
    }
    let mut paths = Vec::new();
    for s in &sources {
        let path = registry.path_of(&s.handle).ok_or_else(|| {
            err(
                "unauthorizedSource",
                "A source is not authorized in this session.",
            )
        })?;
        paths.push((s.id.clone(), path));
    }
    let previous = token.as_deref().and_then(|t| projects.path(t));
    let target = match previous.clone() {
        Some(path) if !save_as => path,
        _ => {
            let name: String = suggested_name
                .chars()
                .filter(|c| !"\\/:*?\"<>|".contains(*c))
                .take(80)
                .collect();
            let _turn = dialog_turn()?;
            let picked = app
                .dialog()
                .file()
                .set_title("Save project")
                .add_filter("Maskora project", &["json"])
                .set_file_name(format!(
                    "{}.maskora.json",
                    if name.is_empty() { "Untitled" } else { &name }
                ))
                .blocking_save_file();
            let Some(file) = picked else { return Ok(None) };
            file.into_path()
                .map_err(|_| err("writeFailed", "The chosen location is not a local file."))?
        }
    };
    let previous_dir = previous.as_deref().and_then(Path::parent);
    let written = write_project(&target, project, &paths, previous_dir)?;
    let name = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let token = projects.register(target);
    Ok(Some(Saved {
        token,
        name,
        overwritten: written.overwritten,
        backup: written.backup,
    }))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    token: String,
    name: String,
    json: String,
    sources: Vec<SourceOnOpen>,
}

/// Open a project chosen in a dialog. `Ok(None)` is a cancelled dialog.
#[tauri::command]
pub async fn open_project(
    app: tauri::AppHandle,
    registry: tauri::State<'_, SourceRegistry>,
    trust: tauri::State<'_, TrustStore>,
    projects: tauri::State<'_, ProjectFiles>,
) -> Result<Option<Opened>, ProjectError> {
    use tauri_plugin_dialog::DialogExt;
    let _turn = dialog_turn()?;
    let picked = app
        .dialog()
        .file()
        .set_title("Open project")
        .add_filter("Maskora project", &["json"])
        .blocking_pick_file();
    let Some(file) = picked else { return Ok(None) };
    let path = file
        .into_path()
        .map_err(|_| err("projectUnreadable", "The selection is not a local file."))?;
    let size = std::fs::metadata(&path)
        .map_err(|_| err("projectUnreadable", "The project file cannot be read."))?
        .len();
    if size as usize > MAX_PROJECT_BYTES {
        return Err(err(
            "projectTooLarge",
            "The project file is larger than this version accepts.",
        ));
    }
    let text = std::fs::read_to_string(&path)
        .map_err(|_| err("projectUnreadable", "The project file cannot be read."))?;
    let project = validate_project(&text)?;
    let dir = path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .to_path_buf();
    let sources = classify_sources(&dir, &project, &trust, &registry);
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let token = projects.register(path);
    Ok(Some(Opened {
        token,
        name,
        json: text,
        sources,
    }))
}

/// Ask the user to locate or approve one source, starting at the project's folder with its name filled in.
/// The choice is authorized and recorded as trusted, and its digest returned so the
/// frontend can tell a moved file from changed content. `Ok(None)` is a cancelled dialog.
#[tauri::command]
pub async fn locate_source(
    app: tauri::AppHandle,
    file_name: String,
    token: Option<String>,
    registry: tauri::State<'_, SourceRegistry>,
    trust: tauri::State<'_, TrustStore>,
    projects: tauri::State<'_, ProjectFiles>,
) -> Result<Option<Located>, ProjectError> {
    use tauri_plugin_dialog::DialogExt;
    let name: String = file_name
        .chars()
        .filter(|c| !"\\/:*?\"<>|".contains(*c))
        .take(200)
        .collect();
    let _turn = dialog_turn()?;
    let mut dialog = app
        .dialog()
        .file()
        .set_title(format!("Locate {name}"))
        .add_filter("PDF documents", &["pdf"])
        .set_file_name(&name);
    if let Some(dir) = token
        .as_deref()
        .and_then(|t| projects.path(t))
        .and_then(|p| p.parent().map(Path::to_path_buf))
    {
        dialog = dialog.set_directory(dir);
    }
    let Some(file) = dialog.blocking_pick_file() else {
        return Ok(None);
    };
    let path = file
        .into_path()
        .map_err(|_| err("sourceUnreadable", "The selection is not a local file."))?;
    crate::sources::authorize_and_remember(&path, &registry, &trust)
        .map(|(source, sha256)| Some(Located { source, sha256 }))
        .map_err(|e| err(e.code, e.message))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Located {
    source: SourceInfo,
    sha256: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Exported {
    name: String,
    overwritten: bool,
    bytes: usize,
}

/// The hard limit on an exported still's side in pixels (architecture §17.3); the interface offers less.
const MAX_EXPORT_SIDE: u32 = 16_384;

/// Refuse anything that is not a PNG of an accepted size, judged from its header.
fn check_png(png: &[u8]) -> Result<(), ProjectError> {
    const SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    if png.len() > MAX_EXPORT_BYTES
        || !png.starts_with(&SIGNATURE)
        || png.len() < 24
        || &png[12..16] != b"IHDR"
    {
        return Err(err(
            "invalidImage",
            "The export is not a PNG image of an accepted size.",
        ));
    }
    let side = |at: usize| u32::from_be_bytes([png[at], png[at + 1], png[at + 2], png[at + 3]]);
    let (width, height) = (side(16), side(20));
    if width == 0 || height == 0 || width > MAX_EXPORT_SIDE || height > MAX_EXPORT_SIDE {
        return Err(err(
            "exportTooLarge",
            format!("A {width} × {height} px image is beyond the {MAX_EXPORT_SIDE} px limit."),
        ));
    }
    Ok(())
}

/// Write `png` to `path`; reports whether an existing file was replaced.
pub fn write_png(path: &Path, png: &[u8]) -> Result<bool, ProjectError> {
    check_png(png)?;
    let existed = path.exists();
    write_atomically(path, png).map_err(|e| io_error(&e, "image"))?;
    Ok(existed)
}

/// Save an exported PNG (sent as the raw request body) where the user chooses. `Ok(None)` is a cancelled dialog.
#[tauri::command]
pub async fn export_png(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<Option<Exported>, ProjectError> {
    use tauri_plugin_dialog::DialogExt;
    let tauri::ipc::InvokeBody::Raw(png) = request.body() else {
        return Err(err(
            "invalidImage",
            "The export was not sent as image bytes.",
        ));
    };
    // Checked before the dialog, so a bad request never asks the user anything.
    check_png(png)?;
    let suggested: String = request
        .headers()
        .get("x-file-name")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("Maskora export.png")
        .chars()
        .filter(|c| !"\\/:*?\"<>|".contains(*c))
        .take(120)
        .collect();
    let _turn = dialog_turn()?;
    let picked = app
        .dialog()
        .file()
        .set_title("Export PNG")
        .add_filter("PNG image", &["png"])
        .set_file_name(&suggested)
        .blocking_save_file();
    let Some(file) = picked else { return Ok(None) };
    let path = file
        .into_path()
        .map_err(|_| err("writeFailed", "The chosen location is not a local file."))?;
    let overwritten = write_png(&path, png)?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(Some(Exported {
        name,
        overwritten,
        bytes: png.len(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_dir() -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("maskora-project-{}", crate::sources::random_hex()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    const SHA_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn project(sources: Value) -> String {
        json!({ "format": PROJECT_FORMAT, "schemaVersion": SCHEMA_VERSION, "sources": sources })
            .to_string()
    }

    #[test]
    fn relative_paths_cross_folders_but_not_drives() {
        assert_eq!(
            relative_path(Path::new("C:/a/b"), Path::new("C:/a/b/c.pdf")).as_deref(),
            Some("c.pdf")
        );
        assert_eq!(
            relative_path(Path::new("C:/a/b"), Path::new("C:/a/d/c.pdf")).as_deref(),
            Some("../d/c.pdf")
        );
        assert_eq!(
            relative_path(Path::new("C:/a"), Path::new("D:/a/c.pdf")),
            None
        );
        assert!(resolve_ref(Path::new("C:/p"), "C:/Windows/win.ini").is_none());
        assert!(resolve_ref(Path::new("C:/p"), "/etc/passwd").is_none());
    }

    #[test]
    fn validation_refuses_newer_schemas_other_formats_and_bad_sources() {
        assert!(validate_project(&project(json!([{ "id": "s1", "sha256": SHA_A }]))).is_ok());
        let future =
            json!({ "format": PROJECT_FORMAT, "schemaVersion": SCHEMA_VERSION + 1, "sources": [] })
                .to_string();
        assert_eq!(validate_project(&future).unwrap_err().code, "futureSchema");
        assert_eq!(
            validate_project(r#"{"format":"other","schemaVersion":1,"sources":[]}"#)
                .unwrap_err()
                .code,
            "invalidProject"
        );
        assert_eq!(
            validate_project("not json").unwrap_err().code,
            "invalidProject"
        );
        assert_eq!(
            validate_project(&project(json!([{ "id": "s1", "sha256": "short" }])))
                .unwrap_err()
                .code,
            "invalidProject"
        );
        assert_eq!(
            validate_project(&" ".repeat(MAX_PROJECT_BYTES + 1))
                .unwrap_err()
                .code,
            "projectTooLarge"
        );
    }

    #[test]
    // The read-only flag is cleared again only to delete the test folder.
    #[allow(clippy::permissions_set_readonly_false)]
    fn atomic_writes_replace_whole_files_and_leave_nothing_behind_on_failure() {
        let dir = temp_dir();
        let path = dir.join("p.maskora.json");
        write_atomically(&path, b"one").unwrap();
        write_atomically(&path, b"two").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"two");
        let mut perms = std::fs::metadata(&path).unwrap().permissions();
        perms.set_readonly(true);
        std::fs::set_permissions(&path, perms.clone()).unwrap();
        let e = write_png(&path, &png_header(1, 1)).unwrap_err();
        assert_eq!(e.code, "permissionDenied");
        assert_eq!(
            std::fs::read(&path).unwrap(),
            b"two",
            "the old file survives a failed write"
        );
        let leftovers = std::fs::read_dir(&dir)
            .unwrap()
            .filter(|e| {
                e.as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .ends_with(".tmp")
            })
            .count();
        assert_eq!(leftovers, 0);
        perms.set_readonly(false);
        std::fs::set_permissions(&path, perms).unwrap();
        assert_eq!(
            write_png(&dir.join("missing-folder/x.png"), &png_header(1, 1))
                .unwrap_err()
                .code,
            "writeFailed"
        );
        assert_eq!(
            write_png(&dir.join("x.png"), b"not a png")
                .unwrap_err()
                .code,
            "invalidImage"
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    /// A PNG signature and IHDR of the given size, enough for the header check.
    fn png_header(width: u32, height: u32) -> Vec<u8> {
        let mut v = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
        v.extend_from_slice(b"IHDR");
        v.extend_from_slice(&width.to_be_bytes());
        v.extend_from_slice(&height.to_be_bytes());
        v.extend_from_slice(&[8, 6, 0, 0, 0, 0, 0, 0, 0]);
        v
    }

    #[test]
    fn documents_out_of_bounds_are_refused_before_anything_else() {
        let deep = format!(
            "{{\"format\":\"maskora-project\",\"schemaVersion\":2,\"sources\":[],\"x\":{}{}}}",
            "[".repeat(80),
            "]".repeat(80)
        );
        assert_eq!(validate_project(&deep).unwrap_err().code, "invalidProject");
        let huge =
            json!({ "format": PROJECT_FORMAT, "schemaVersion": 2, "sources": [], "x": 1e300 })
                .to_string();
        assert!(
            validate_project(&huge)
                .unwrap_err()
                .message
                .contains("number out of range")
        );
        let long = json!({ "format": PROJECT_FORMAT, "schemaVersion": 2, "sources": [], "x": "a".repeat(200_000) })
            .to_string();
        assert!(
            validate_project(&long)
                .unwrap_err()
                .message
                .contains("oversized text")
        );
        assert!(validate_project(&project(json!([{ "id": "s1", "sha256": SHA_A }]))).is_ok());
    }

    #[test]
    fn a_reference_climbing_out_of_the_project_folder_grants_nothing() {
        let dir = temp_dir();
        let registry = SourceRegistry::default();
        let trust = TrustStore::default();
        let value = json!({ "sources": [{ "id": "x", "sha256": SHA_A,
            "ref": { "relativePath": "../../../../Windows/win.ini", "fileName": "win.ini" } }] });
        let out = classify_sources(&dir, &value, &trust, &registry);
        assert_ne!(out[0].status, "authorized");
        assert!(out[0].source.is_none());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn exports_beyond_the_hard_pixel_limit_are_refused_from_the_header() {
        assert!(check_png(&png_header(16_384, 9_000)).is_ok());
        assert_eq!(
            check_png(&png_header(16_385, 10)).unwrap_err().code,
            "exportTooLarge"
        );
        assert_eq!(
            check_png(&png_header(10, 0)).unwrap_err().code,
            "exportTooLarge"
        );
        assert_eq!(
            check_png(&png_header(1, 1)[..20]).unwrap_err().code,
            "invalidImage"
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_file_held_open_elsewhere_is_reported_and_kept() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = temp_dir();
        let path = dir.join("busy.png");
        std::fs::write(&path, b"old").unwrap();
        // Another program holding the file without sharing it, as an image viewer may.
        let held = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&path)
            .unwrap();
        let e = write_png(&path, &png_header(1, 1)).unwrap_err();
        assert_eq!(e.code, "permissionDenied", "{e:?}");
        drop(held);
        assert_eq!(std::fs::read(&path).unwrap(), b"old");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn reopening_authorizes_only_what_the_trust_record_allows() {
        let dir = temp_dir();
        let write = |name: &str, bytes: &[u8]| {
            let p = dir.join(name);
            std::fs::write(&p, bytes).unwrap();
            (p.clone(), hash_file(&p, 1 << 20).unwrap().0)
        };
        let (same, same_sha) = write("same.pdf", b"%PDF-1.7 same");
        let (approved_new, approved_new_sha) = write("approved.pdf", b"%PDF-1.7 new content");
        let (edited, edited_sha) = write("edited.pdf", b"%PDF-1.7 before");
        let (_stranger, stranger_sha) = write("stranger.pdf", b"%PDF-1.7 stranger");
        let trust = TrustStore::default();
        trust.remember(&same, &same_sha, 1);
        trust.remember(&approved_new, &approved_new_sha, 1);
        trust.remember(&edited, &edited_sha, 1);
        // Edited on disk after it was approved.
        std::fs::write(&edited, b"%PDF-1.7 after").unwrap();
        let reference = |name: &str| json!({ "relativePath": name, "fileName": name });
        let text = project(json!([
            { "id": "a", "sha256": same_sha, "ref": reference("same.pdf") },
            { "id": "b", "sha256": SHA_A, "ref": reference("approved.pdf") },
            { "id": "c", "sha256": edited_sha, "ref": reference("edited.pdf") },
            { "id": "d", "sha256": stranger_sha, "ref": reference("stranger.pdf") },
            { "id": "e", "sha256": SHA_A, "ref": reference("gone.pdf") },
            { "id": "f", "sha256": SHA_A, "ref": { "relativePath": "C:/Windows/win.ini", "fileName": "win.ini" } }
        ]));
        let registry = SourceRegistry::default();
        let classified =
            classify_sources(&dir, &validate_project(&text).unwrap(), &trust, &registry);
        let got: Vec<_> = classified
            .iter()
            .map(|s| (s.id.as_str(), s.status, s.reason, s.source.is_some()))
            .collect();
        assert_eq!(
            got,
            vec![
                ("a", "authorized", None, true),
                ("b", "changed", None, true),
                ("c", "needsApproval", Some("contentChanged"), false),
                ("d", "needsApproval", Some("unfamiliar"), false),
                ("e", "missing", None, false),
                ("f", "missing", None, false),
            ]
        );
        let _ = approved_new_sha;
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn saved_projects_carry_relative_references() {
        let dir = temp_dir();
        std::fs::create_dir_all(dir.join("art")).unwrap();
        let pdf = dir.join("art").join("k1.pdf");
        std::fs::write(&pdf, b"%PDF").unwrap();
        let path = dir.join("p.maskora.json");
        let value = validate_project(&project(json!([{ "id": "s1", "sha256": SHA_A }]))).unwrap();
        assert!(
            !write_project(&path, value.clone(), &[("s1".into(), pdf.clone())], None)
                .unwrap()
                .overwritten
        );
        assert!(
            write_project(&path, value, &[("s1".into(), pdf)], None)
                .unwrap()
                .overwritten,
            "the second save reports an overwrite"
        );
        let saved: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(
            saved["sources"][0]["ref"],
            json!({ "relativePath": "art/k1.pdf", "fileName": "k1.pdf" })
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn saving_over_an_older_schema_keeps_the_original_once() {
        let dir = temp_dir();
        let path = dir.join("job.maskora.json");
        let v1 = json!({ "format": PROJECT_FORMAT, "schemaVersion": 1, "sources": [] }).to_string();
        std::fs::write(&path, &v1).unwrap();
        let value = validate_project(&project(json!([]))).unwrap();
        let written = write_project(&path, value.clone(), &[], None).unwrap();
        assert_eq!(
            written.backup.as_deref(),
            Some("job (schema 1 backup).maskora.json")
        );
        assert_eq!(
            std::fs::read_to_string(dir.join("job (schema 1 backup).maskora.json")).unwrap(),
            v1,
            "the backup is the original, byte for byte"
        );
        // The file is current now: saving again makes no second backup.
        assert!(
            write_project(&path, value, &[], None)
                .unwrap()
                .backup
                .is_none()
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn an_interrupted_write_leaves_nothing_behind_on_the_next() {
        let dir = temp_dir();
        let path = dir.join("p.maskora.json");
        let stale = dir.join(".p.maskora.json.0123abcd.tmp");
        std::fs::write(&stale, b"half a projec").unwrap();
        write_atomically(&path, b"whole").unwrap();
        assert!(!stale.exists());
        assert_eq!(std::fs::read(&path).unwrap(), b"whole");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn unresolved_references_are_rebased_when_saved_elsewhere() {
        let dir = temp_dir();
        let value = validate_project(&project(json!([{
            "id": "s1", "sha256": SHA_A,
            "ref": { "relativePath": "art/k1.pdf", "fileName": "k1.pdf" }
        }])))
        .unwrap();
        let elsewhere = dir.join("copies").join("p.maskora.json");
        std::fs::create_dir_all(elsewhere.parent().unwrap()).unwrap();
        write_project(&elsewhere, value.clone(), &[], Some(&dir)).unwrap();
        let saved: Value = serde_json::from_slice(&std::fs::read(&elsewhere).unwrap()).unwrap();
        assert_eq!(saved["sources"][0]["ref"]["relativePath"], "../art/k1.pdf");
        // Saved in place, the reference is unchanged.
        let here = dir.join("p.maskora.json");
        write_project(&here, value, &[], Some(&dir)).unwrap();
        let saved: Value = serde_json::from_slice(&std::fs::read(&here).unwrap()).unwrap();
        assert_eq!(saved["sources"][0]["ref"]["relativePath"], "art/k1.pdf");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
