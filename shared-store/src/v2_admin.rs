use crate::hash::sha1_hex;
use crate::sqlite::{SqliteStore, SCHEMA_VERSION, TABLE_NAMES};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const PENDING_V1_CLEANUP: &str = ".pending-v1-cleanup.json";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct V2Verification {
    pub ok: bool,
    pub root: String,
    pub table_rows: BTreeMap<String, u64>,
    pub assets_total: u64,
    pub assets_local: u64,
    pub assets_remote: u64,
    pub asset_bytes: u64,
    pub thumb_files: u64,
    pub preview_files: u64,
    pub asset_references: u64,
    pub source_dangling_references: u64,
    pub warnings: Vec<String>,
    pub failures: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct V2CopyReport {
    pub source_root: String,
    pub target_root: String,
    pub source: V2Verification,
    pub target: V2Verification,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingV1Cleanup {
    pub source_root: String,
    pub target_root: String,
    pub created_at: u64,
}

pub fn verify_v2_root(root: &Path) -> Result<V2Verification, String> {
    let canonical = root
        .canonicalize()
        .map_err(|error| format!("V2 root unavailable {}: {error}", root.display()))?;
    let manifest_path = canonical.join("manifest.json");
    let manifest = read_json(&manifest_path)?;
    if manifest.get("status").and_then(Value::as_str) != Some("complete") {
        return Err("manifest.json is not marked complete".into());
    }
    if manifest.get("formatVersion").and_then(Value::as_u64) != Some(2) {
        return Err("manifest.json formatVersion is not 2".into());
    }
    if manifest.get("schemaVersion").and_then(Value::as_u64) != Some(SCHEMA_VERSION as u64) {
        return Err(format!(
            "manifest.json schemaVersion does not match {SCHEMA_VERSION}"
        ));
    }
    if !canonical.join("manifest.sqlite").is_file() || !canonical.join("media").is_dir() {
        return Err("V2 root is missing manifest.sqlite or media".into());
    }

    let store = SqliteStore::open(&canonical)?;
    let mut report = V2Verification {
        ok: false,
        root: canonical.to_string_lossy().to_string(),
        table_rows: BTreeMap::new(),
        assets_total: 0,
        assets_local: 0,
        assets_remote: 0,
        asset_bytes: 0,
        thumb_files: 0,
        preview_files: 0,
        asset_references: 0,
        source_dangling_references: 0,
        warnings: Vec::new(),
        failures: Vec::new(),
    };
    let mut asset_ids = HashSet::new();
    let mut references = Vec::new();

    for table in TABLE_NAMES {
        let mut offset = 0usize;
        let mut total = 0u64;
        loop {
            let (rows, expected_total) = match store.scan_page(table, offset, 100, false) {
                Ok(page) => page,
                Err(error) => {
                    report
                        .failures
                        .push(format!("table {table}: scan failed: {error}"));
                    break;
                }
            };
            total = expected_total;
            if rows.is_empty() {
                break;
            }
            for row in &rows {
                let Some(id) = row.get("id").and_then(Value::as_str) else {
                    report
                        .failures
                        .push(format!("table {table}: row.id is missing"));
                    continue;
                };
                if table == "assets" {
                    asset_ids.insert(id.to_string());
                    verify_asset(&store, row, &mut report);
                } else {
                    collect_asset_references(table, id, row, &mut references);
                }
            }
            offset += rows.len();
            if offset as u64 >= expected_total {
                break;
            }
        }
        report.table_rows.insert(table.to_string(), total);
    }

    report.asset_references = references.len() as u64;
    for (path, hash) in references {
        if !asset_ids.contains(&hash) {
            report.source_dangling_references += 1;
            report
                .warnings
                .push(format!("{path}: asset reference {hash} does not resolve"));
        }
    }
    report.assets_total = asset_ids.len() as u64;
    report.ok = report.failures.is_empty();
    Ok(report)
}

pub fn copy_v2_root(source: &Path, target: &Path) -> Result<V2CopyReport, String> {
    let source = source
        .canonicalize()
        .map_err(|error| format!("source V2 root unavailable: {error}"))?;
    if !target.exists() {
        fs::create_dir_all(target)
            .map_err(|error| format!("create target {}: {error}", target.display()))?;
    }
    let target_canonical = target
        .canonicalize()
        .map_err(|error| format!("target root unavailable: {error}"))?;
    if source == target_canonical {
        return Err("source and target are the same directory".into());
    }
    if target_canonical.starts_with(&source) || source.starts_with(&target_canonical) {
        return Err("source and target directories must not contain each other".into());
    }
    if !target_canonical.is_dir() || !directory_is_empty(&target_canonical)? {
        return Err(format!(
            "target directory must be empty: {}",
            target_canonical.display()
        ));
    }
    let source_report = verify_v2_root(&source)?;
    if !source_report.ok {
        return Err("source V2 root failed verification".into());
    }
    SqliteStore::open(&source)?.checkpoint()?;
    copy_dir_contents(&source, target)?;
    let target_report = verify_v2_root(target)?;
    if !target_report.ok {
        return Err("copied V2 root failed verification".into());
    }
    Ok(V2CopyReport {
        source_root: source.to_string_lossy().to_string(),
        target_root: target.to_string_lossy().to_string(),
        source: source_report,
        target: target_report,
    })
}

pub fn write_pending_v1_cleanup(target: &Path, source: &Path) -> Result<(), String> {
    let payload = PendingV1Cleanup {
        source_root: source.to_string_lossy().to_string(),
        target_root: target.to_string_lossy().to_string(),
        created_at: now_ms(),
    };
    write_json_atomic(
        &target.join(PENDING_V1_CLEANUP),
        &serde_json::to_value(payload).map_err(|error| error.to_string())?,
    )
}

pub fn read_pending_v1_cleanup(target: &Path) -> Result<Option<PendingV1Cleanup>, String> {
    let path = target.join(PENDING_V1_CLEANUP);
    if !path.is_file() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("read pending cleanup {}: {error}", path.display()))?;
    serde_json::from_str(&raw)
        .map(Some)
        .map_err(|error| format!("parse pending cleanup {}: {error}", path.display()))
}

pub fn clear_pending_v1_cleanup(target: &Path) -> Result<(), String> {
    let path = target.join(PENDING_V1_CLEANUP);
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|error| format!("remove pending cleanup {}: {error}", path.display()))?;
    }
    Ok(())
}

pub fn finalize_v1_cleanup(target: &Path) -> Result<V2Verification, String> {
    let canonical_target = target
        .canonicalize()
        .map_err(|error| format!("target V2 root unavailable: {error}"))?;
    let pending = read_pending_v1_cleanup(&canonical_target)?
        .ok_or_else(|| "no pending V1 cleanup marker".to_string())?;
    if !same_path(&pending.target_root, &canonical_target) {
        return Err("pending cleanup target does not match active V2 root".into());
    }
    let verification = verify_v2_root(&canonical_target)?;
    if !verification.ok {
        return Err(format!(
            "V2 verification still has {} blocking issue(s)",
            verification.failures.len()
        ));
    }
    let source = PathBuf::from(&pending.source_root);
    if source.exists() {
        remove_checked_v1_root(&source)?;
    }
    clear_pending_v1_cleanup(&canonical_target)?;
    Ok(verification)
}

pub fn adopt_manually_moved_v2(target: &Path) -> Result<V2Verification, String> {
    let report = verify_v2_root(target)?;
    if report.ok {
        Ok(report)
    } else {
        Err(format!(
            "target V2 root has {} blocking issue(s)",
            report.failures.len()
        ))
    }
}

pub fn remove_checked_v1_root(root: &Path) -> Result<(), String> {
    let canonical = root
        .canonicalize()
        .map_err(|error| format!("V1 root unavailable: {error}"))?;
    if !canonical.is_dir() || canonical.parent().is_none() {
        return Err(format!(
            "refusing to delete unsafe V1 root: {}",
            root.display()
        ));
    }
    let has_v1_table = TABLE_NAMES
        .iter()
        .filter(|table| **table != "assets")
        .any(|table| canonical.join(table).is_dir());
    if !has_v1_table || canonical.join("manifest.json").exists() {
        return Err(format!(
            "refusing to delete unrecognized V1 root: {}",
            canonical.display()
        ));
    }
    fs::remove_dir_all(&canonical)
        .map_err(|error| format!("delete V1 root {}: {error}", canonical.display()))
}

pub fn remove_checked_v2_root(root: &Path) -> Result<(), String> {
    let canonical = root
        .canonicalize()
        .map_err(|error| format!("V2 root unavailable: {error}"))?;
    if !canonical.is_dir() || canonical.parent().is_none() {
        return Err(format!(
            "refusing to delete unsafe V2 root: {}",
            root.display()
        ));
    }
    let manifest = read_json(&canonical.join("manifest.json"))?;
    if manifest.get("status").and_then(Value::as_str) != Some("complete")
        || !canonical.join("manifest.sqlite").is_file()
        || !canonical.join("media").is_dir()
    {
        return Err(format!(
            "refusing to delete unrecognized V2 root: {}",
            canonical.display()
        ));
    }
    fs::remove_dir_all(&canonical)
        .map_err(|error| format!("delete V2 root {}: {error}", canonical.display()))
}

fn verify_asset(store: &SqliteStore, row: &Value, report: &mut V2Verification) {
    let Some(id) = row.get("id").and_then(Value::as_str) else {
        return;
    };
    let mime = row
        .get("mime")
        .and_then(Value::as_str)
        .unwrap_or("application/octet-stream");
    let expected_sha1 = row.get("contentSha1").and_then(Value::as_str);
    let expected_bytes = row.get("bytesLength").and_then(Value::as_u64).unwrap_or(0);
    let has_remote = row.get("url").and_then(Value::as_str).is_some();
    if expected_bytes > 0 {
        match store.asset_bytes(id) {
            Ok((bytes, actual_mime)) => {
                report.assets_local += 1;
                report.asset_bytes += bytes.len() as u64;
                if actual_mime != mime {
                    report.failures.push(format!("asset {id}: MIME mismatch"));
                }
                if bytes.len() as u64 != expected_bytes {
                    report
                        .failures
                        .push(format!("asset {id}: byte size mismatch"));
                }
                let actual = sha1_hex(&bytes);
                if expected_sha1 != Some(actual.as_str()) {
                    report.failures.push(format!("asset {id}: SHA-1 mismatch"));
                }
            }
            Err(error) => report.failures.push(format!("asset {id}: {error}")),
        }
    } else if has_remote {
        report.assets_remote += 1;
    } else {
        report
            .failures
            .push(format!("asset {id}: neither local bytes nor remote url"));
    }
    if store.asset_thumb(id).is_ok() {
        report.thumb_files += 1;
    }
    if store.asset_preview(id).is_ok() {
        report.preview_files += 1;
    }
}

fn collect_asset_references(
    table: &str,
    row_id: &str,
    row: &Value,
    refs: &mut Vec<(String, String)>,
) {
    fn walk(path: &str, value: &Value, refs: &mut Vec<(String, String)>) {
        match value {
            Value::Object(object) => {
                for (key, child) in object {
                    if key == "assetHash" {
                        if let Some(hash) = child.as_str() {
                            refs.push((path.to_string(), hash.to_string()));
                        }
                    } else if matches!(key.as_str(), "assetHashes" | "outputHashes" | "thumbOrder")
                    {
                        if let Some(items) = child.as_array() {
                            for item in items {
                                if let Some(hash) = item.as_str() {
                                    refs.push((path.to_string(), hash.to_string()));
                                }
                            }
                        }
                    }
                    walk(&format!("{path}.{key}"), child, refs);
                }
            }
            Value::Array(items) => {
                for (index, child) in items.iter().enumerate() {
                    walk(&format!("{path}[{index}]"), child, refs);
                }
            }
            _ => {}
        }
    }
    let prefix = format!("{table}/{row_id}");
    if table == "assetLibrary" {
        if let Some(hash) = row.get("hash").and_then(Value::as_str) {
            refs.push((format!("{prefix}.hash"), hash.to_string()));
        }
    }
    walk(&prefix, row, refs);
}

fn copy_dir_contents(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target)
        .map_err(|error| format!("create target {}: {error}", target.display()))?;
    for entry in fs::read_dir(source)
        .map_err(|error| format!("read source {}: {error}", source.display()))?
    {
        let entry = entry.map_err(|error| error.to_string())?;
        let from = entry.path();
        let to = target.join(entry.file_name());
        if from.is_dir() {
            copy_dir_contents(&from, &to)?;
        } else {
            fs::copy(&from, &to).map_err(|error| format!("copy {}: {error}", from.display()))?;
        }
    }
    Ok(())
}

fn directory_is_empty(path: &Path) -> Result<bool, String> {
    Ok(fs::read_dir(path)
        .map_err(|error| format!("read target {}: {error}", path.display()))?
        .next()
        .is_none())
}

fn same_path(raw: &str, path: &Path) -> bool {
    Path::new(raw)
        .canonicalize()
        .ok()
        .is_some_and(|candidate| candidate == path)
}

fn read_json(path: &Path) -> Result<Value, String> {
    let raw =
        fs::read_to_string(path).map_err(|error| format!("read {}: {error}", path.display()))?;
    serde_json::from_str(&raw).map_err(|error| format!("parse {}: {error}", path.display()))
}

fn write_json_atomic(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("create {}: {error}", parent.display()))?;
    }
    let temporary = path.with_extension("json.tmp");
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("write {}: {error}", temporary.display()))?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| format!("replace {}: {error}", path.display()))?;
    }
    fs::rename(&temporary, path).map_err(|error| format!("rename {}: {error}", temporary.display()))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migration::migrate_v1_to_v2;
    use base64::Engine;
    use serde_json::json;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(1);

    fn temp_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "qinghua-v2-admin-{name}-{}-{}-{}",
            std::process::id(),
            now_ms(),
            TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ))
    }

    fn write_json(path: &Path, value: Value) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, serde_json::to_vec(&value).unwrap()).unwrap();
    }

    fn migrated_fixture() -> (PathBuf, PathBuf, String) {
        let v1 = temp_root("v1");
        let v2 = temp_root("v2");
        let bytes = b"v2 admin fixture";
        let hash = sha1_hex(bytes)[..16].to_string();
        write_json(
            &v1.join("assets").join(format!("{hash}.json")),
            json!({
                "id":hash,
                "hash":hash,
                "mime":"image/png",
                "projectId":"p1",
                "bytes":{
                    "__qhType":"u8",
                    "base64":base64::engine::general_purpose::STANDARD.encode(bytes)
                }
            }),
        );
        write_json(
            &v1.join("projects").join("p1.json"),
            json!({"id":"p1","name":"fixture"}),
        );
        write_json(
            &v1.join("nodes").join("n1.json"),
            json!({"id":"n1","projectId":"p1","data":{"assetHash":hash}}),
        );
        migrate_v1_to_v2(&v1, &v2, false).unwrap();
        (v1, v2, hash)
    }

    #[test]
    fn verifies_v2_root_and_detects_missing_media() {
        let (v1, v2, hash) = migrated_fixture();
        let report = verify_v2_root(&v2).unwrap();
        assert!(report.ok);
        assert_eq!(report.assets_total, 1);
        assert_eq!(report.assets_local, 1);
        let media = v2
            .join("media/images")
            .join(&hash[..2])
            .join(format!("{hash}.png"));
        fs::remove_file(&media).unwrap();
        let broken = verify_v2_root(&v2).unwrap();
        assert!(!broken.ok);
        assert!(broken
            .failures
            .iter()
            .any(|failure| failure.contains("asset")));
        let _ = fs::remove_dir_all(v1);
        let _ = fs::remove_dir_all(v2);
    }

    #[test]
    fn copies_complete_v2_and_leaves_source_intact() {
        let (v1, source, hash) = migrated_fixture();
        let target = temp_root("copy");
        let report = copy_v2_root(&source, &target).unwrap();
        assert!(report.target.ok);
        assert!(source.exists());
        assert!(target.exists());
        assert_eq!(
            SqliteStore::open(&target)
                .unwrap()
                .asset_bytes(&hash)
                .unwrap()
                .0,
            b"v2 admin fixture"
        );
        let _ = fs::remove_dir_all(v1);
        let _ = fs::remove_dir_all(source);
        let _ = fs::remove_dir_all(target);
    }

    #[test]
    fn rejects_copy_targets_nested_inside_the_source_root() {
        let (v1, source, _) = migrated_fixture();
        let nested = source.join("nested-target");
        fs::create_dir_all(&nested).unwrap();
        let error = copy_v2_root(&source, &nested).unwrap_err();
        assert!(error.contains("must not contain each other"));
        assert!(source.join("manifest.sqlite").is_file());
        let _ = fs::remove_dir_all(v1);
        let _ = fs::remove_dir_all(source);
    }

    #[test]
    fn pending_cleanup_deletes_v1_only_after_v2_verification() {
        let (v1, v2, _) = migrated_fixture();
        write_pending_v1_cleanup(&v2, &v1).unwrap();
        assert!(v1.exists());
        let report = finalize_v1_cleanup(&v2).unwrap();
        assert!(report.ok);
        assert!(!v1.exists());
        assert!(!v2.join(PENDING_V1_CLEANUP).exists());
        let _ = fs::remove_dir_all(v2);
    }

    #[test]
    fn failed_v2_verification_keeps_v1_and_the_cleanup_marker() {
        let (v1, v2, hash) = migrated_fixture();
        write_pending_v1_cleanup(&v2, &v1).unwrap();
        let media = v2
            .join("media/images")
            .join(&hash[..2])
            .join(format!("{hash}.png"));
        fs::remove_file(media).unwrap();
        let error = finalize_v1_cleanup(&v2).unwrap_err();
        assert!(error.contains("blocking"));
        assert!(v1.exists());
        assert!(v2.join(PENDING_V1_CLEANUP).is_file());
        let _ = fs::remove_dir_all(v1);
        let _ = fs::remove_dir_all(v2);
    }

    #[test]
    fn cleanup_refuses_to_delete_a_directory_that_is_not_a_complete_v1_root() {
        let root = temp_root("not-v1");
        fs::create_dir_all(root.join("projects")).unwrap();
        fs::write(root.join("manifest.json"), b"{}").unwrap();
        let error = remove_checked_v1_root(&root).unwrap_err();
        assert!(error.contains("unrecognized V1 root"));
        assert!(root.exists());
        let _ = fs::remove_dir_all(root);
    }
}
