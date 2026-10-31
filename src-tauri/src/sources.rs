//! Authorized local sources (architecture §7.1, §11.2).
//!
//! The frontend never names a file. A source becomes readable only when the
//! user picks it in the native dialog, which this side opens itself; the
//! frontend then receives an opaque, unguessable handle and the file's display
//! name. Every read names a handle, and an unknown handle is refused whatever
//! it looks like — including a path. Handles live for the session only;
//! reopening a project re-authorizes its sources through the same dialog.

use std::collections::HashMap;
use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;

/// Largest source read in one piece. Bounds memory until Phase 0.4 measures
/// real limits; a larger file is refused with `sourceTooLarge`, never truncated.
pub const MAX_SOURCE_BYTES: u64 = 1024 * 1024 * 1024;

/// A refusal the frontend can act on: a stable code and a safe message that
/// never contains a full path or document content.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceError {
    pub code: &'static str,
    pub message: String,
}

impl SourceError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

/// What the frontend learns about a selected source.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo {
    pub handle: String,
    pub name: String,
    pub size: u64,
}

#[derive(Default)]
pub struct SourceRegistry {
    paths: Mutex<HashMap<String, PathBuf>>,
}

/// 128 random bits from the standard library's per-process hasher keys.
pub fn random_hex() -> String {
    let mut parts = [0u64; 2];
    for part in &mut parts {
        let mut hasher = RandomState::new().build_hasher();
        hasher.write_u64(0x6d61_736b_6f72_6121);
        *part = hasher.finish();
    }
    format!("{:016x}{:016x}", parts[0], parts[1])
}

fn new_handle() -> String {
    format!("src-{}", random_hex())
}

impl SourceRegistry {
    /// Authorize a path the user selected and return its handle.
    pub fn authorize(&self, path: &Path) -> Result<SourceInfo, SourceError> {
        let meta = std::fs::metadata(path).map_err(|_| {
            SourceError::new("sourceUnreadable", "The selected file cannot be read.")
        })?;
        if !meta.is_file() {
            return Err(SourceError::new(
                "sourceNotAFile",
                "The selection is not a file.",
            ));
        }
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let handle = new_handle();
        self.paths
            .lock()
            .expect("source registry lock poisoned")
            .insert(handle.clone(), path.to_path_buf());
        Ok(SourceInfo {
            handle,
            name,
            size: meta.len(),
        })
    }

    /// The path behind a handle, for native use only (project references); never sent to the frontend.
    pub fn path_of(&self, handle: &str) -> Option<PathBuf> {
        self.paths
            .lock()
            .expect("source registry lock poisoned")
            .get(handle)
            .cloned()
    }

    /// Read a source by handle. Unknown handles are refused.
    pub fn read(&self, handle: &str) -> Result<Vec<u8>, SourceError> {
        let path = self
            .paths
            .lock()
            .expect("source registry lock poisoned")
            .get(handle)
            .cloned()
            .ok_or_else(|| {
                SourceError::new(
                    "unauthorizedSource",
                    "This source has not been selected in this session.",
                )
            })?;
        let size = std::fs::metadata(&path)
            .map_err(|_| {
                SourceError::new("sourceMissing", "The selected file is no longer available.")
            })?
            .len();
        if size > MAX_SOURCE_BYTES {
            return Err(SourceError::new(
                "sourceTooLarge",
                format!("The file is larger than the {MAX_SOURCE_BYTES}-byte limit."),
            ));
        }
        std::fs::read(&path)
            .map_err(|_| SourceError::new("sourceUnreadable", "The selected file cannot be read."))
    }
}

/// Open the native file dialog for a PDF and authorize what the user picks.
/// `Ok(None)` is a cancelled dialog, distinct from a failure.
#[tauri::command]
pub async fn select_source(
    app: tauri::AppHandle,
    registry: tauri::State<'_, SourceRegistry>,
    trust: tauri::State<'_, crate::trust::TrustStore>,
) -> Result<Option<SourceInfo>, SourceError> {
    use tauri_plugin_dialog::DialogExt;
    let _turn = crate::dialog_turn::take()
        .ok_or_else(|| SourceError::new("dialogBusy", crate::dialog_turn::BUSY))?;
    let picked = app
        .dialog()
        .file()
        .set_title("Open PDF")
        .add_filter("PDF documents", &["pdf"])
        .blocking_pick_file();
    let Some(file) = picked else {
        return Ok(None);
    };
    let path = file
        .into_path()
        .map_err(|_| SourceError::new("sourceUnreadable", "The selection is not a local file."))?;
    authorize_and_remember(&path, &registry, &trust).map(|(info, _)| Some(info))
}

/// Authorize a path the user just selected, and record the selection with its
/// content digest so a later reopen of the same, unchanged file needs no new dialog.
/// Returns the source and that digest.
pub fn authorize_and_remember(
    path: &Path,
    registry: &SourceRegistry,
    trust: &crate::trust::TrustStore,
) -> Result<(SourceInfo, String), SourceError> {
    let info = registry.authorize(path)?;
    let (sha, size) = crate::trust::hash_file(path, MAX_SOURCE_BYTES)
        .map_err(|_| SourceError::new("sourceUnreadable", "The selected file cannot be read."))?;
    trust.remember(path, &sha, size);
    Ok((info, sha))
}

/// The bytes of an authorized source, sent as a raw binary response.
#[tauri::command]
pub fn read_source(
    handle: String,
    registry: tauri::State<'_, SourceRegistry>,
) -> Result<tauri::ipc::Response, SourceError> {
    registry.read(&handle).map(tauri::ipc::Response::new)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp_file(bytes: &[u8]) -> PathBuf {
        let path = std::env::temp_dir().join(format!("maskora-test-{}.pdf", new_handle()));
        std::fs::File::create(&path)
            .unwrap()
            .write_all(bytes)
            .unwrap();
        path
    }

    #[test]
    fn an_authorized_handle_reads_the_selected_bytes() {
        let registry = SourceRegistry::default();
        let path = temp_file(b"%PDF-1.7 test");
        let info = registry.authorize(&path).unwrap();
        assert_eq!(info.size, 13);
        assert!(info.name.ends_with(".pdf"));
        assert_eq!(registry.read(&info.handle).unwrap(), b"%PDF-1.7 test");
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn an_unknown_handle_is_refused() {
        let registry = SourceRegistry::default();
        let err = registry
            .read("src-00000000000000000000000000000000")
            .unwrap_err();
        assert_eq!(err.code, "unauthorizedSource");
    }

    #[test]
    fn a_path_is_not_a_handle() {
        let registry = SourceRegistry::default();
        let path = temp_file(b"secret");
        // A real, readable file named directly is still refused: only handles grant access.
        let err = registry.read(path.to_str().unwrap()).unwrap_err();
        assert_eq!(err.code, "unauthorizedSource");
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn handles_are_unguessable_and_distinct() {
        let registry = SourceRegistry::default();
        let path = temp_file(b"x");
        let a = registry.authorize(&path).unwrap().handle;
        let b = registry.authorize(&path).unwrap().handle;
        assert_ne!(a, b);
        assert_eq!(a.len(), "src-".len() + 32);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn a_deleted_source_reports_missing_not_unauthorized() {
        let registry = SourceRegistry::default();
        let path = temp_file(b"x");
        let info = registry.authorize(&path).unwrap();
        std::fs::remove_file(&path).unwrap();
        assert_eq!(
            registry.read(&info.handle).unwrap_err().code,
            "sourceMissing"
        );
    }

    #[test]
    fn errors_never_contain_the_path() {
        let registry = SourceRegistry::default();
        let path = temp_file(b"x");
        let info = registry.authorize(&path).unwrap();
        std::fs::remove_file(&path).unwrap();
        let err = registry.read(&info.handle).unwrap_err();
        assert!(!err.message.contains(path.to_str().unwrap()));
    }
}
