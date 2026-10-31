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
//! project file, and is never exported. An unreadable, malformed or oversized
//! record fails closed: it trusts nothing. Its integrity rests on the user's
//! account, like any application data: a program that can write there can
//! already read the files themselves.
//!
//! The user can review the record (file names and approval times, never
//! paths: the frontend holds no path) and forget one approval or all of them.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Entries kept; the oldest approvals are forgotten first.
const MAX_ENTRIES: usize = 2000;
/// A record larger than this is not a record this app wrote: it trusts nothing.
const MAX_RECORD_BYTES: u64 = 4 * 1024 * 1024;

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
        let small = std::fs::metadata(&file).is_ok_and(|m| m.len() <= MAX_RECORD_BYTES);
        let entries = small
            .then(|| std::fs::read(&file).ok())
            .flatten()
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
        self.persist(&entries);
    }

    fn persist(&self, entries: &[TrustEntry]) {
        if let Some(file) = &self.file
            && let Ok(json) = serde_json::to_vec(entries)
        {
            if let Some(dir) = file.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            // A record that cannot be saved only means the user is asked again next time.
            let _ = crate::project::write_atomically(file, &json);
        }
    }

    /// Every approval, newest first, by an opaque id, file name and time; never the path.
    pub fn list(&self) -> Vec<Approval> {
        let entries = self.entries.lock().expect("trust record lock poisoned");
        let mut out: Vec<Approval> = entries
            .iter()
            .map(|e| Approval {
                id: approval_id(&e.path),
                file_name: Path::new(&e.path)
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                size: e.size,
                approved_unix: e.approved_unix,
            })
            .collect();
        out.sort_by_key(|a| std::cmp::Reverse(a.approved_unix));
        out
    }

    /// Forget one approval by its id; reports whether there was one.
    pub fn forget(&self, id: &str) -> bool {
        let mut entries = self.entries.lock().expect("trust record lock poisoned");
        let before = entries.len();
        entries.retain(|e| approval_id(&e.path) != id);
        let removed = entries.len() != before;
        if removed {
            self.persist(&entries);
        }
        removed
    }

    pub fn forget_all(&self) {
        let mut entries = self.entries.lock().expect("trust record lock poisoned");
        entries.clear();
        self.persist(&entries);
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

/// One approval as the frontend sees it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Approval {
    id: String,
    file_name: String,
    /// Size in bytes: with the time, tells apart files that share a name, without showing where they are.
    size: u64,
    approved_unix: u64,
}

/// An opaque id for a recorded path: stable, and it reveals nothing about where the file is.
fn approval_id(path: &str) -> String {
    let digest = Sha256::digest(path.as_bytes());
    digest[..12].iter().map(|b| format!("{b:02x}")).collect()
}

#[tauri::command]
pub fn list_approvals(trust: tauri::State<'_, TrustStore>) -> Vec<Approval> {
    trust.list()
}

/// Forget one approval; the file then needs approving again before it is reopened.
#[tauri::command]
pub fn forget_approval(id: String, trust: tauri::State<'_, TrustStore>) -> bool {
    id.len() == 24 && id.bytes().all(|b| b.is_ascii_hexdigit()) && trust.forget(&id)
}

#[tauri::command]
pub fn forget_all_approvals(trust: tauri::State<'_, TrustStore>) {
    trust.forget_all();
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
    fn approvals_are_listed_without_paths_and_can_be_forgotten() {
        let dir = temp_dir();
        let a = dir.join("a.pdf");
        let b = dir.join("b.pdf");
        std::fs::write(&a, b"%PDF a").unwrap();
        std::fs::write(&b, b"%PDF b").unwrap();
        let record = dir.join("record.json");
        let store = TrustStore::load(record.clone());
        store.remember(&a, "sa", 6);
        store.remember(&b, "sb", 6);
        let list = store.list();
        assert_eq!(list.len(), 2);
        let text = serde_json::to_string(&list).unwrap();
        assert!(
            !text.contains(&*dir.to_string_lossy()) && !text.contains('\\'),
            "a path leaked: {text}"
        );
        let a_id = list
            .iter()
            .find(|x| x.file_name == "a.pdf")
            .unwrap()
            .id
            .clone();
        assert!(store.forget(&a_id));
        assert!(!store.forget(&a_id), "forgotten once");
        assert!(!store.trusts(&a, "sa") && store.trusts(&b, "sb"));
        // Persisted: a fresh load agrees.
        assert!(!TrustStore::load(record.clone()).knows(&a));
        store.forget_all();
        assert!(!TrustStore::load(record).knows(&b));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn crafted_and_oversized_records_trust_nothing_they_should_not() {
        let dir = temp_dir();
        let pdf = dir.join("a.pdf");
        std::fs::write(&pdf, b"%PDF").unwrap();
        let record = dir.join("record.json");
        // Crafted: entries for other spellings and other places do not cover this file.
        let crafted = serde_json::json!([
            { "path": "a.pdf", "sha256": "x", "size": 4, "approved_unix": 1 },
            { "path": format!("{}\\..\\a.pdf", dir.display()), "sha256": "x", "size": 4, "approved_unix": 1 },
            { "path": "\\\\server\\share\\a.pdf", "sha256": "x", "size": 4, "approved_unix": 1 }
        ]);
        std::fs::write(&record, crafted.to_string()).unwrap();
        assert!(!TrustStore::load(record.clone()).trusts(&pdf, "x"));
        // Oversized: refused whole, even if it holds a valid entry.
        let key = std::fs::canonicalize(&pdf)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let mut big =
            vec![serde_json::json!({ "path": key, "sha256": "x", "size": 4, "approved_unix": 1 })];
        big.extend((0..100_000).map(|i| serde_json::json!({ "path": format!("C:/pad/{i}.pdf"), "sha256": "x", "size": 0, "approved_unix": 0 })));
        std::fs::write(&record, serde_json::to_vec(&big).unwrap()).unwrap();
        assert!(std::fs::metadata(&record).unwrap().len() > MAX_RECORD_BYTES);
        assert!(!TrustStore::load(record).trusts(&pdf, "x"));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn two_writers_never_leave_a_broken_record() {
        let dir = temp_dir();
        let record = dir.join("record.json");
        let files: Vec<PathBuf> = (0..40)
            .map(|i| {
                let p = dir.join(format!("{i}.pdf"));
                std::fs::write(&p, format!("%PDF {i}")).unwrap();
                p
            })
            .collect();
        // Two app instances, each with its own copy of the record, writing at once.
        let one = TrustStore::load(record.clone());
        let two = TrustStore::load(record.clone());
        std::thread::scope(|s| {
            s.spawn(|| files[..20].iter().for_each(|p| one.remember(p, "s", 1)));
            s.spawn(|| files[20..].iter().for_each(|p| two.remember(p, "s", 1)));
        });
        // The last writer wins (an approval may need repeating), but the record always parses.
        let reloaded = TrustStore::load(record.clone());
        let count = files.iter().filter(|p| reloaded.knows(p)).count();
        assert!(count >= 20, "the record lost a whole writer: {count}");
        assert!(
            serde_json::from_slice::<Vec<TrustEntry>>(&std::fs::read(&record).unwrap()).is_ok()
        );
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
