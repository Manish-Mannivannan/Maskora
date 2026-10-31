//! Recovery snapshots of unsaved work (architecture §9.2, §12).
//!
//! While a project has unsaved changes the frontend sends its current
//! contents here every few seconds. The snapshot lives in the app's local data
//! directory, never beside the project, with each loaded source's absolute
//! path. After a crash or a forced close, the next start can offer it back.
//!
//! Recovering grants nothing the trust record does not: each source path is
//! classified exactly as a reopened project's would be (`classify_one`), so a
//! file that changed since is held or needs approval like any other. One
//! snapshot is kept: the app holds one project at a time.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::project::{
    ProjectError, ProjectFiles, SourceOnOpen, classify_one, validate_project, write_atomically,
};
use crate::sources::SourceRegistry;
use crate::trust::TrustStore;

/// Largest frontend-supplied note kept with a snapshot (name, saved-content key).
const MAX_META_BYTES: usize = 1024 * 1024;

pub struct RecoveryStore {
    file: PathBuf,
}

impl RecoveryStore {
    pub fn new(file: PathBuf) -> Self {
        Self { file }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourcePath {
    id: String,
    file_name: String,
    sha256: String,
    path: PathBuf,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    saved_unix: u64,
    json: String,
    meta: String,
    sources: Vec<SourcePath>,
    project_path: Option<PathBuf>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryRequest {
    json: String,
    /// Opaque to native code: what the frontend needs to judge the recovered state.
    meta: String,
    sources: Vec<RecoverySource>,
    token: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverySource {
    id: String,
    handle: String,
    sha256: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pending {
    saved_unix: u64,
    meta: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recovered {
    /// The project file the work belonged to, if it had one and it still exists.
    token: Option<String>,
    name: Option<String>,
    json: String,
    meta: String,
    sources: Vec<SourceOnOpen>,
}

fn err(code: &'static str, message: &str) -> ProjectError {
    ProjectError {
        code,
        message: message.to_owned(),
    }
}

fn read(store: &RecoveryStore) -> Option<Snapshot> {
    let bytes = std::fs::read(&store.file).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Keep a snapshot of the unsaved project. Every source must be authorized in this session.
#[tauri::command]
pub fn save_recovery(
    request: RecoveryRequest,
    store: tauri::State<'_, RecoveryStore>,
    registry: tauri::State<'_, SourceRegistry>,
    projects: tauri::State<'_, ProjectFiles>,
) -> Result<(), ProjectError> {
    write_snapshot(&store, request, &registry, &projects)
}

fn write_snapshot(
    store: &RecoveryStore,
    request: RecoveryRequest,
    registry: &SourceRegistry,
    projects: &ProjectFiles,
) -> Result<(), ProjectError> {
    validate_project(&request.json)?;
    if request.meta.len() > MAX_META_BYTES {
        return Err(err("invalidProject", "The recovery note is too large."));
    }
    let mut sources = Vec::new();
    for s in request.sources {
        let path = registry.path_of(&s.handle).ok_or_else(|| {
            err(
                "unauthorizedSource",
                "A source is not authorized in this session.",
            )
        })?;
        if !(s.sha256.len() == 64 && s.sha256.bytes().all(|b| b.is_ascii_hexdigit())) {
            return Err(err("invalidProject", "A source digest is not a SHA-256."));
        }
        let file_name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        sources.push(SourcePath {
            id: s.id,
            file_name,
            sha256: s.sha256,
            path,
        });
    }
    let snapshot = Snapshot {
        saved_unix: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
        json: request.json,
        meta: request.meta,
        sources,
        project_path: request.token.as_deref().and_then(|t| projects.path(t)),
    };
    let bytes = serde_json::to_vec(&snapshot)
        .map_err(|_| err("invalidProject", "The snapshot could not be encoded."))?;
    if let Some(dir) = store.file.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    write_atomically(&store.file, &bytes).map_err(|_| {
        err(
            "recoveryFailed",
            "Unsaved work could not be kept for recovery.",
        )
    })
}

/// Whether a snapshot is waiting, and its note; a malformed snapshot counts as none.
#[tauri::command]
pub fn peek_recovery(store: tauri::State<'_, RecoveryStore>) -> Option<Pending> {
    read(&store).map(|s| Pending {
        saved_unix: s.saved_unix,
        meta: s.meta,
    })
}

/// Forget the snapshot: the work was saved, discarded, or recovered and is now live.
#[tauri::command]
pub fn discard_recovery(store: tauri::State<'_, RecoveryStore>) {
    let _ = std::fs::remove_file(&store.file);
}

/// Bring the snapshot back: its sources classified against the trust record like a reopened project's.
#[tauri::command]
pub fn recover_project(
    store: tauri::State<'_, RecoveryStore>,
    trust: tauri::State<'_, TrustStore>,
    registry: tauri::State<'_, SourceRegistry>,
    projects: tauri::State<'_, ProjectFiles>,
) -> Result<Option<Recovered>, ProjectError> {
    Ok(recover(&store, &trust, &registry, &projects))
}

fn recover(
    store: &RecoveryStore,
    trust: &TrustStore,
    registry: &SourceRegistry,
    projects: &ProjectFiles,
) -> Option<Recovered> {
    let snapshot = read(store)?;
    validate_project(&snapshot.json).ok()?;
    let sources = snapshot
        .sources
        .iter()
        .map(|s| {
            classify_one(
                &s.id,
                &s.file_name,
                &s.sha256,
                Some(s.path.clone()),
                trust,
                registry,
            )
        })
        .collect();
    let project = snapshot.project_path.filter(|p| p.is_file());
    let name = project
        .as_ref()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().into_owned());
    Some(Recovered {
        token: project.map(|p| projects.register(p)),
        name,
        json: snapshot.json,
        meta: snapshot.meta,
        sources,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("maskora-recovery-{}", crate::sources::random_hex()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn project_json() -> String {
        serde_json::json!({ "format": "maskora-project", "schemaVersion": 2, "sources": [] })
            .to_string()
    }

    #[test]
    fn a_snapshot_round_trips_and_its_sources_are_judged_by_the_trust_record() {
        let dir = temp_dir();
        let pdf = dir.join("a.pdf");
        std::fs::write(&pdf, b"%PDF-1.7 one").unwrap();
        let (sha, size) = crate::trust::hash_file(&pdf, 1 << 20).unwrap();
        let registry = SourceRegistry::default();
        let trust = TrustStore::default();
        let projects = ProjectFiles::default();
        let handle = registry.authorize(&pdf).unwrap().handle;
        trust.remember(&pdf, &sha, size);
        let store = RecoveryStore::new(dir.join("recovery.json"));
        let request = |handle: &str| RecoveryRequest {
            json: project_json(),
            meta: "note".into(),
            sources: vec![RecoverySource {
                id: "s1".into(),
                handle: handle.into(),
                sha256: sha.clone(),
            }],
            token: None,
        };
        // A handle this session never issued is refused.
        assert_eq!(
            write_snapshot(&store, request("src-guess"), &registry, &projects)
                .unwrap_err()
                .code,
            "unauthorizedSource"
        );
        write_snapshot(&store, request(&handle), &registry, &projects).unwrap();
        let back = recover(&store, &trust, &registry, &projects).unwrap();
        assert_eq!(back.meta, "note");
        assert_eq!(back.sources[0].status, "authorized");
        // Edited since: the trust record no longer vouches for it.
        std::fs::write(&pdf, b"%PDF-1.7 two").unwrap();
        let back = recover(&store, &trust, &registry, &projects).unwrap();
        assert_eq!(back.sources[0].status, "needsApproval");
        assert!(back.sources[0].source.is_none());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_corrupt_snapshot_offers_nothing() {
        let dir = temp_dir();
        let store = RecoveryStore::new(dir.join("recovery.json"));
        std::fs::write(&store.file, b"{ not json").unwrap();
        assert!(read(&store).is_none());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
