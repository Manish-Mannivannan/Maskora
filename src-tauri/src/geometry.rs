//! Page geometry facts read from the page dictionaries (architecture §4.2,
//! §4.3, §7.2).
//!
//! PDF.js exposes only the effective CropBox, rotation and UserUnit, so the
//! five page boxes and their provenance are read here, read-only, from the
//! file's own dictionaries (ISO 32000-1 §7.7.3.4, §14.11.2):
//!
//! - MediaBox, CropBox and Rotate inherit through the Pages tree; BleedBox,
//!   TrimBox and ArtBox do not, so one placed on a Pages node is ignored.
//! - CropBox defaults to MediaBox; Bleed/Trim/ArtBox default to CropBox.
//! - Inverted corners are normalised; a box beyond the MediaBox is reduced to
//!   the intersection; an empty, non-numeric or wrong-length box is `invalid`
//!   and its effective value is the default it falls back to.
//! - Rotate must be a multiple of 90; anything else is `invalid`, never guessed.
//!
//! Every value keeps its raw form and origin, so a default is never presented
//! as something the file stated. Numbers pass through the parser as `f32`,
//! which bounds precision to about 0.001 pt at the largest page size.

use lopdf::{Dictionary, Document, LoadOptions, Object, ObjectId};
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Origin {
    Explicit,
    Inherited,
    Default,
    Invalid,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoxFact {
    /// The array as written, or `None` when the page (and, for inheritable
    /// boxes, its ancestors) has none.
    pub raw: Option<Vec<f64>>,
    pub effective: [f64; 4],
    pub origin: Origin,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub adjustments: Vec<&'static str>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RotateFact {
    pub raw: Option<f64>,
    pub effective: Option<u16>,
    pub origin: Origin,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageGeometry {
    pub index: usize,
    pub rotate: RotateFact,
    pub user_unit: f64,
    /// In the fixed order MediaBox, CropBox, BleedBox, TrimBox, ArtBox.
    pub boxes: Vec<(String, BoxFact)>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeometryError {
    pub code: &'static str,
    pub message: String,
}

fn error(code: &'static str, message: impl Into<String>) -> GeometryError {
    GeometryError {
        code,
        message: message.into(),
    }
}

/// Read the geometry of every page. `password` is used only for encrypted
/// files and never logged or stored.
pub fn inspect(bytes: &[u8], password: Option<&str>) -> Result<Vec<PageGeometry>, GeometryError> {
    let loaded = match password {
        Some(pw) => Document::load_mem_with_options(bytes, LoadOptions::with_password(pw)),
        None => Document::load_mem(bytes),
    };
    let doc = loaded.map_err(|e| {
        let text = e.to_string();
        if text.to_ascii_lowercase().contains("password")
            || text.to_ascii_lowercase().contains("decrypt")
        {
            error(
                "passwordRequired",
                "The document is encrypted and needs a password.",
            )
        } else {
            error("unreadablePdf", "The file could not be parsed as a PDF.")
        }
    })?;
    let pages = doc.get_pages();
    // Without the right password the parser does not fail: it returns the
    // still-encrypted objects, whose page tree reads as empty. Say so, rather
    // than reporting an empty document.
    if pages.is_empty() && doc.is_encrypted() {
        return Err(error(
            "passwordRequired",
            "The document is encrypted and needs a password.",
        ));
    }
    if pages.is_empty() {
        return Err(error("noPages", "The document has no pages."));
    }
    pages
        .values()
        .enumerate()
        .map(|(index, id)| page_geometry(&doc, index, *id))
        .collect()
}

/// A page dictionary and its ancestors, nearest first.
fn lineage(doc: &Document, id: ObjectId) -> Vec<&Dictionary> {
    let mut chain = Vec::new();
    let mut current = doc.get_dictionary(id).ok();
    // A malformed tree can loop; the depth bound keeps the walk finite.
    while let Some(dict) = current {
        if chain.len() > 64 {
            break;
        }
        chain.push(dict);
        current = dict
            .get(b"Parent")
            .ok()
            .and_then(|p| p.as_reference().ok())
            .and_then(|pid| doc.get_dictionary(pid).ok());
    }
    chain
}

/// The value for `key`: on the page itself, or (if `inheritable`) the nearest ancestor.
fn lookup<'a>(
    doc: &'a Document,
    chain: &[&'a Dictionary],
    key: &[u8],
    inheritable: bool,
) -> Option<(&'a Object, bool)> {
    let limit = if inheritable { chain.len() } else { 1 };
    chain
        .iter()
        .take(limit)
        .enumerate()
        .find_map(|(depth, dict)| {
            dict.get(key)
                .ok()
                .and_then(|o| doc.dereference(o).ok())
                .map(|(_, o)| (o, depth > 0))
        })
}

fn number(doc: &Document, object: &Object) -> Option<f64> {
    let object = doc.dereference(object).ok()?.1;
    match object {
        Object::Integer(i) => Some(*i as f64),
        Object::Real(r) => Some(f64::from(*r)),
        _ => None,
    }
}

/// The numbers in an array as written; `None` if it is not an array of numbers.
fn raw_numbers(doc: &Document, object: &Object) -> Option<Vec<f64>> {
    object
        .as_array()
        .ok()?
        .iter()
        .map(|o| number(doc, o))
        .collect()
}

fn round(v: f64) -> f64 {
    // Remove f32-to-f64 noise without hiding real values: 4 decimals, the precision fixtures state.
    (v * 10_000.0).round() / 10_000.0
}

fn normalize(r: &[f64]) -> ([f64; 4], bool) {
    let n = [
        r[0].min(r[2]),
        r[1].min(r[3]),
        r[0].max(r[2]),
        r[1].max(r[3]),
    ];
    let changed = n[0] != r[0] || n[1] != r[1];
    (n.map(round), changed)
}

fn intersect(a: [f64; 4], b: [f64; 4]) -> [f64; 4] {
    [
        a[0].max(b[0]),
        a[1].max(b[1]),
        a[2].min(b[2]),
        a[3].min(b[3]),
    ]
}

fn has_area(r: [f64; 4]) -> bool {
    r[2] > r[0] && r[3] > r[1]
}

/// One box: explicit/inherited, clipped to `media` (except MediaBox itself), else `fallback`.
fn resolve(
    doc: &Document,
    chain: &[&Dictionary],
    key: &str,
    inheritable: bool,
    media: Option<[f64; 4]>,
    fallback: [f64; 4],
) -> BoxFact {
    let Some((object, inherited)) = lookup(doc, chain, key.as_bytes(), inheritable) else {
        return BoxFact {
            raw: None,
            effective: fallback,
            origin: Origin::Default,
            adjustments: vec![],
        };
    };
    let raw = raw_numbers(doc, object);
    let invalid = |raw: Option<Vec<f64>>| BoxFact {
        raw: raw.map(|r| r.into_iter().map(round).collect()),
        effective: fallback,
        origin: Origin::Invalid,
        adjustments: vec![],
    };
    let Some(values) = raw.clone().filter(|r| r.len() == 4) else {
        return invalid(raw);
    };
    let (normalized, was_inverted) = normalize(&values);
    let mut adjustments = Vec::new();
    if was_inverted {
        adjustments.push("normalized");
    }
    let effective = match media {
        Some(m) => {
            let clipped = intersect(normalized, m);
            if clipped != normalized && has_area(clipped) {
                adjustments.push("clipped");
            }
            clipped
        }
        None => normalized,
    };
    if !has_area(effective) {
        return invalid(raw);
    }
    BoxFact {
        raw: Some(values.into_iter().map(round).collect()),
        effective,
        origin: if inherited {
            Origin::Inherited
        } else {
            Origin::Explicit
        },
        adjustments,
    }
}

fn page_geometry(
    doc: &Document,
    index: usize,
    id: ObjectId,
) -> Result<PageGeometry, GeometryError> {
    let chain = lineage(doc, id);
    let media = resolve(doc, &chain, "MediaBox", true, None, [0.0; 4]);
    if media.origin == Origin::Invalid || media.origin == Origin::Default {
        return Err(error(
            "invalidMediaBox",
            format!("Page {} has no usable MediaBox.", index + 1),
        ));
    }
    let m = media.effective;
    let crop = resolve(doc, &chain, "CropBox", true, Some(m), m);
    let c = crop.effective;
    let mut boxes = vec![
        ("MediaBox".to_string(), media),
        ("CropBox".to_string(), crop),
    ];
    for key in ["BleedBox", "TrimBox", "ArtBox"] {
        boxes.push((
            key.to_string(),
            resolve(doc, &chain, key, false, Some(m), c),
        ));
    }

    let rotate = match lookup(doc, &chain, b"Rotate", true) {
        None => RotateFact {
            raw: None,
            effective: Some(0),
            origin: Origin::Default,
        },
        Some((object, inherited)) => {
            let raw = number(doc, object);
            match raw.filter(|r| r.fract() == 0.0 && (*r as i64) % 90 == 0) {
                Some(r) => RotateFact {
                    raw: Some(r),
                    effective: Some((((r as i64) % 360 + 360) % 360) as u16),
                    origin: if inherited {
                        Origin::Inherited
                    } else {
                        Origin::Explicit
                    },
                },
                None => RotateFact {
                    raw,
                    effective: None,
                    origin: Origin::Invalid,
                },
            }
        }
    };

    let user_unit = chain
        .first()
        .and_then(|d| d.get(b"UserUnit").ok())
        .and_then(|o| number(doc, o))
        .filter(|u| *u > 0.0)
        .map(round)
        .unwrap_or(1.0);

    Ok(PageGeometry {
        index,
        rotate,
        user_unit,
        boxes,
    })
}

/// Page geometry of an authorized source. Runs off the UI thread; the password,
/// if any, is used for this call only and never stored or logged.
#[tauri::command]
pub async fn inspect_geometry(
    handle: String,
    password: Option<String>,
    registry: tauri::State<'_, crate::sources::SourceRegistry>,
) -> Result<Vec<PageGeometry>, GeometryError> {
    let bytes = registry.read(&handle).map_err(|e| GeometryError {
        code: e.code,
        message: e.message,
    })?;
    tauri::async_runtime::spawn_blocking(move || inspect(&bytes, password.as_deref()))
        .await
        .map_err(|_| {
            error(
                "inspectionFailed",
                "Geometry inspection stopped unexpectedly.",
            )
        })?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::path::PathBuf;

    fn fixture(id: &str) -> (Vec<u8>, Value) {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/pdf");
        let pdf = std::fs::read(dir.join(format!("{id}.pdf"))).unwrap();
        let expected = std::fs::read_to_string(dir.join(format!("{id}.expected.json"))).unwrap();
        (pdf, serde_json::from_str(&expected).unwrap())
    }

    /// Equal within 0.001 pt: the f32 storage bound stated in the module doc.
    fn close(a: &Value, b: &Value) -> bool {
        match (a, b) {
            (Value::Number(x), Value::Number(y)) => {
                (x.as_f64().unwrap() - y.as_f64().unwrap()).abs() <= 1e-3
            }
            (Value::Array(x), Value::Array(y)) => {
                x.len() == y.len() && x.iter().zip(y).all(|(p, q)| close(p, q))
            }
            (Value::Object(x), Value::Object(y)) => {
                x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| close(v, w)))
            }
            _ => a == b,
        }
    }

    fn check(id: &str) {
        let (pdf, expected) = fixture(id);
        let pages = inspect(&pdf, None).unwrap_or_else(|e| panic!("{id}: {e:?}"));
        let want = expected["pages"].as_array().unwrap();
        assert_eq!(pages.len(), want.len(), "{id}: page count");
        for (got, want) in pages.iter().zip(want) {
            let page = format!("{id} page {}", got.index);
            let got_json = serde_json::to_value(got).unwrap();
            assert!(
                close(&got_json["rotate"], &want["rotate"]),
                "{page} rotate: {} vs {}",
                got_json["rotate"],
                want["rotate"]
            );
            assert!(
                close(&got_json["userUnit"], &want["userUnit"]),
                "{page} userUnit"
            );
            for (name, fact) in &got.boxes {
                let got_box = serde_json::to_value(fact).unwrap();
                assert!(
                    close(&got_box, &want["boxes"][name]),
                    "{page} {name}: got {got_box}, want {}",
                    want["boxes"][name]
                );
            }
        }
    }

    #[test]
    fn g1_all_five_boxes_explicit() {
        check("G1");
    }

    #[test]
    fn g2_media_only_every_other_box_defaults() {
        check("G2");
    }

    #[test]
    fn g3_inheritance_and_the_illegal_pages_node_trimbox() {
        check("G3");
    }

    #[test]
    fn g4_nonzero_and_negative_origins() {
        check("G4");
    }

    #[test]
    fn g5_rotation_normalised_and_45_diagnosed() {
        check("G5");
    }

    #[test]
    fn g6_user_unit() {
        check("G6");
        let (pdf, expected) = fixture("G6");
        let page = &inspect(&pdf, None).unwrap()[0];
        let media = page.boxes[0].1.effective;
        let mm = |pt: f64| pt * page.user_unit * 25.4 / 72.0;
        let want = expected["pages"][0]["mediaSizeMm"].as_array().unwrap();
        assert!((mm(media[2] - media[0]) - want[0].as_f64().unwrap()).abs() < 1e-3);
        assert!((mm(media[3] - media[1]) - want[1].as_f64().unwrap()).abs() < 1e-3);
    }

    #[test]
    fn g7_mixed_sizes() {
        check("G7");
    }

    #[test]
    fn g8_invalid_rectangles() {
        check("G8");
    }

    #[test]
    fn coverage_fixtures_report_their_explicit_boxes() {
        for id in ["R1", "R2"] {
            let (pdf, expected) = fixture(id);
            for (got, want) in inspect(&pdf, None)
                .unwrap()
                .iter()
                .zip(expected["pages"].as_array().unwrap())
            {
                for (name, fact) in got.boxes.iter().take(4) {
                    assert_eq!(fact.origin, Origin::Explicit, "{id} {name}");
                    assert!(
                        close(
                            &serde_json::to_value(fact.effective).unwrap(),
                            &want["boxes"][name]
                        ),
                        "{id} {name}"
                    );
                }
            }
        }
    }

    #[test]
    fn malformed_files_fail_by_name() {
        for id in ["X1a", "X1c"] {
            let (pdf, _) = fixture(id);
            let err = inspect(&pdf, None).unwrap_err();
            assert_eq!(err.code, "unreadablePdf", "{id}");
        }
    }

    #[test]
    fn encrypted_files() {
        let (owner_only, _) = fixture("E1a");
        assert_eq!(
            inspect(&owner_only, None).unwrap().len(),
            1,
            "owner-password-only opens without a password"
        );
        let (user, _) = fixture("E1b");
        assert_eq!(inspect(&user, None).unwrap_err().code, "passwordRequired");
        assert_eq!(
            inspect(&user, Some("wrong")).unwrap_err().code,
            "passwordRequired"
        );
        assert_eq!(inspect(&user, Some("maskora")).unwrap().len(), 1);
    }
}
