//! Remembered source authorizations (architecture §7.1, §11.2).
//!
//! When the user selects a PDF in a native dialog, this installation records
//! the file's canonical path and the SHA-256 of its content at that moment.
//! Reopening a project may then authorize a source without asking again, but
//! only if this record says the user chose that same file and its content
//! still matches. A project file's own paths and digests grant nothing: an
//! imported project, an unrecorded path, or changed content needs the user to
//! locate or approve the file, and that approval is recorded in turn.
//!
//! The record lives in the app's local data directory, separate from any
//! project file, and is never exported. An unreadable or malformed record
//! fails closed: it trusts nothing.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Entries kept; the oldest approvals are forgotten first.
const MAX_ENTRIES: usize = 2000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct TrustEntry {
    path: String,
    sha256: String,
    size: u64,
    approved_unix: u64,
}

#[derive(Default)]
pub struct TrustStore {
    /// Where the record is saved; `None` keeps it in memory (tests).
    file: Option<PathBuf>,
    entries: Mutex<Vec<TrustEntry>>,
}

/// SHA-256 and size of a file, refusing files over `max_bytes` without reading them whole.
pub fn hash_file(path: &Path, max_bytes: u64) -> std::io::Result<(String, u64)> {
    let size = std::fs::metadata(path)?.len();
    if size > max_bytes {
        return Err(std::io::Error::other("file too large to hash"));
    }
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let hex = hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    Ok((hex, size))
}

/// The key a path is recorded under: canonical when the file exists, so different spellings match.
fn key(path: &Path) -> String {
    std::fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .into_owned()
}

impl TrustStore {
    /// Load the record from `file`; a missing or unreadable record starts empty.
    pub fn load(file: PathBuf) -> Self {
        let entries = std::fs::read(&file)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Vec<TrustEntry>>(&bytes).ok())
            .unwrap_or_default();
        Self {
            file: Some(file),
            entries: Mutex::new(entries),
        }
    }

    /// Record that the user selected `path` with this content.
    pub fn remember(&self, path: &Path, sha256: &str, size: u64) {
        let k = key(path);
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let mut entries = self.entries.lock().expect("trust record lock poisoned");
        entries.retain(|e| e.path != k);
        entries.push(TrustEntry {
            path: k,
            sha256: sha256.to_owned(),
            size,
            approved_unix: now,
        });
        if entries.len() > MAX_ENTRIES {
            let excess = entries.len() - MAX_ENTRIES;
            entries.drain(..excess);
        }
        if let Some(file) = &self.file
            && let Ok(json) = serde_json::to_vec(&*entries)
        {
            if let Some(dir) = file.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            // A record that cannot be saved only means the user is asked again next time.
            let _ = crate::project::write_atomically(file, &json);
        }
    }

    /// Whether the user selected `path` and it then had exactly this content.
    pub fn trusts(&self, path: &Path, sha256: &str) -> bool {
        let k = key(path);
        self.entries
            .lock()
            .expect("trust record lock poisoned")
            .iter()
            .any(|e| e.path == k && e.sha256 == sha256)
    }

    /// Whether this path was ever selected, whatever its content then.
    pub fn knows(&self, path: &Path) -> bool {
        let k = key(path);
        self.entries
            .lock()
            .expect("trust record lock poisoned")
            .iter()
            .any(|e| e.path == k)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "maskora-trust-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn trusts_only_the_recorded_path_with_the_recorded_content() {
        let dir = temp_dir();
        let pdf = dir.join("a.pdf");
        std::fs::write(&pdf, b"%PDF-1.7 one").unwrap();
        let (sha, size) = hash_file(&pdf, 1 << 20).unwrap();
        let store = TrustStore::default();
        assert!(!store.knows(&pdf));
        store.remember(&pdf, &sha, size);
        assert!(store.trusts(&pdf, &sha));
        assert!(!store.trusts(&pdf, "0".repeat(64).as_str()));
        // The same content elsewhere is not trusted: the record is of a selection, not of a digest.
        let copy = dir.join("b.pdf");
        std::fs::write(&copy, b"%PDF-1.7 one").unwrap();
        assert!(!store.trusts(&copy, &sha));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn persists_and_fails_closed_on_a_corrupt_record() {
        let dir = temp_dir();
        let pdf = dir.join("a.pdf");
        std::fs::write(&pdf, b"%PDF-1.7").unwrap();
        let record = dir.join("record.json");
        TrustStore::load(record.clone()).remember(&pdf, "abc", 8);
        assert!(TrustStore::load(record.clone()).trusts(&pdf, "abc"));
        std::fs::write(&record, b"{ not json").unwrap();
        assert!(!TrustStore::load(record).knows(&pdf));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn hashing_refuses_oversized_files() {
        let dir = temp_dir();
        let pdf = dir.join("a.pdf");
        std::fs::write(&pdf, vec![0u8; 100]).unwrap();
        assert!(hash_file(&pdf, 99).is_err());
        assert_eq!(hash_file(&pdf, 100).unwrap().1, 100);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
