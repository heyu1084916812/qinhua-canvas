use crate::hash::sha1_hex;
use crate::sqlite::{SqliteStore, SCHEMA_VERSION, TABLE_NAMES};
use base64::Engine;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationReport {
    pub dry_run: bool,
    pub status: String,
    pub source_root: String,
    pub target_root: String,
    pub started_at: u64,
    pub finished_at: u64,
    pub table_rows: BTreeMap<String, u64>,
    pub assets_total: u64,
    pub assets_local: u64,
    pub assets_remote: u64,
    pub legacy_assets: u64,
    pub asset_bytes: u64,
    pub thumb_files: u64,
    pub preview_files: u64,
    pub kv_records: u64,
    pub asset_references: u64,
    pub source_dangling_references: u64,
    pub warnings: Vec<String>,
    pub failures: Vec<String>,
    pub manifest_written: bool,
}

#[derive(Debug, Clone)]
struct AssetExpectation {
    content_sha1: Option<String>,
    mime: String,
    byte_size: u64,
    local: bool,
    legacy_identity: bool,
    has_thumb: bool,
    has_preview: bool,
}

pub fn migrate_v1_to_v2(
    source: &Path,
    target: &Path,
    dry_run: bool,
) -> Result<MigrationReport, String> {
    let source = source
        .canonicalize()
        .map_err(|error| format!("source root unavailable {}: {error}", source.display()))?;
    if !source.is_dir() {
        return Err(format!(
            "source root is not a directory: {}",
            source.display()
        ));
    }
    let started_at = now_ms();
    if !dry_run {
        prepare_target(&source, target)?;
    }

    let mut report = MigrationReport {
        dry_run,
        status: "running".into(),
        source_root: source.to_string_lossy().to_string(),
        target_root: target.to_string_lossy().to_string(),
        started_at,
        finished_at: 0,
        table_rows: BTreeMap::new(),
        assets_total: 0,
        assets_local: 0,
        assets_remote: 0,
        legacy_assets: 0,
        asset_bytes: 0,
        thumb_files: 0,
        preview_files: 0,
        kv_records: 0,
        asset_references: 0,
        source_dangling_references: 0,
        warnings: Vec::new(),
        failures: Vec::new(),
        manifest_written: false,
    };

    let store = if dry_run {
        None
    } else {
        Some(SqliteStore::open(target)?)
    };
    let mut source_ids: BTreeMap<String, HashSet<String>> = BTreeMap::new();
    let mut expectations = HashMap::new();
    let mut references = Vec::new();

    for table in TABLE_NAMES {
        let rows = table_row_files(&source, table)?;
        let mut ids = HashSet::new();
        for path in rows {
            let mut row = match read_json(&path) {
                Ok(row) => row,
                Err(error) => {
                    report.failures.push(error);
                    continue;
                }
            };
            let id = match row.get("id").and_then(Value::as_str) {
                Some(id) if !id.is_empty() => id.to_string(),
                _ => {
                    report
                        .failures
                        .push(format!("{}: row.id is missing", path.display()));
                    continue;
                }
            };
            if !ids.insert(id.clone()) {
                report
                    .failures
                    .push(format!("table {table}: duplicate id {id}"));
                continue;
            }
            let mut legacy_identity = false;
            if table == "assets" {
                match inspect_asset(&source, &mut row, &id) {
                    Ok(expectation) => {
                        legacy_identity = expectation.legacy_identity;
                        report.assets_total += 1;
                        report.asset_bytes += expectation.byte_size;
                        if expectation.local {
                            report.assets_local += 1;
                        } else {
                            report.assets_remote += 1;
                        }
                        if legacy_identity {
                            report.legacy_assets += 1;
                        }
                        expectations.insert(id.clone(), expectation);
                    }
                    Err(error) => report.failures.push(error),
                }
            } else {
                collect_asset_references(table, &id, &row, &mut references);
            }
            if let Some(store) = store.as_ref() {
                let result = if table == "assets" && legacy_identity {
                    store.put_legacy_asset(&row)
                } else {
                    store.put(table, &row)
                };
                if let Err(error) = result {
                    report
                        .failures
                        .push(format!("{}: put {table}/{id}: {error}", path.display()));
                }
            }
        }
        report
            .table_rows
            .insert(table.to_string(), ids.len() as u64);
        source_ids.insert(table.to_string(), ids);
    }

    let asset_ids = source_ids.get("assets").cloned().unwrap_or_default();
    validate_references(&references, &asset_ids, &mut report);
    report.asset_references = references.len() as u64;
    if dry_run {
        report.thumb_files = expectations
            .values()
            .filter(|asset| asset.has_thumb)
            .count() as u64;
        report.preview_files = expectations
            .values()
            .filter(|asset| asset.has_preview)
            .count() as u64;
    }

    if !dry_run {
        let store = store.as_ref().expect("actual migration opens target store");
        import_kv(&source, store, &mut report);
        copy_support_files(&source, target, &mut report)?;
        verify_target(&store, &source_ids, &expectations, &mut report)?;
    }

    report.finished_at = now_ms();
    if report.failures.is_empty() {
        report.status = "complete".into();
    } else {
        report.status = "failed".into();
        report.failures.truncate(100);
    }

    if !dry_run {
        let report_path = target.join("migration-report.json");
        write_json_atomic(&report_path, &serde_json::to_value(&report).unwrap())?;
        if !report.failures.is_empty() {
            return Err(format!(
                "migration failed with {} issue(s); see {}",
                report.failures.len(),
                report_path.display()
            ));
        }
        let manifest = json!({
            "formatVersion": 2,
            "schemaVersion": SCHEMA_VERSION,
            "status": "complete",
            "createdAt": now_ms(),
            "sourceRoot": report.source_root,
            "tableRows": report.table_rows,
            "assets": {
                "total": report.assets_total,
                "local": report.assets_local,
                "remote": report.assets_remote,
                "legacy": report.legacy_assets,
                "bytes": report.asset_bytes,
                "thumbs": report.thumb_files,
                "previews": report.preview_files
            },
            "assetReferences": report.asset_references,
            "sourceDanglingReferences": report.source_dangling_references,
            "warnings": report.warnings
        });
        write_json_atomic(&target.join("manifest.json"), &manifest)?;
        report.manifest_written = true;
        write_json_atomic(
            &target.join(".migration-state.json"),
            &json!({
                "status":"complete",
                "sourceRoot":report.source_root,
                "finishedAt":report.finished_at,
                "schemaVersion":SCHEMA_VERSION
            }),
        )?;
        write_json_atomic(&report_path, &serde_json::to_value(&report).unwrap())?;
    }

    Ok(report)
}

fn inspect_asset(source: &Path, row: &mut Value, id: &str) -> Result<AssetExpectation, String> {
    let legacy_id = id.len() != 16 || !id.chars().all(|ch| ch.is_ascii_hexdigit());
    if legacy_id
        && (id.len() < 2
            || id.len() > 128
            || !id
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_'))
    {
        return Err(format!("asset {id}: unsafe legacy id"));
    }
    if let Some(hash) = row.get("hash").and_then(Value::as_str) {
        if hash != id {
            return Err(format!("asset {id}: row.hash is {hash}"));
        }
    }
    let mime = row
        .get("mime")
        .and_then(Value::as_str)
        .filter(|mime| !mime.trim().is_empty())
        .ok_or_else(|| format!("asset {id}: mime is missing"))?
        .to_string();
    attach_variant_if_missing(source, row, id, "thumb", "_thumbs");
    attach_variant_if_missing(source, row, id, "preview", "_previews");
    let payload = decode_binary(row.get("bytes"), &format!("asset {id}.bytes"))?;
    let url = row.get("url").and_then(Value::as_str);
    if payload.is_none() && url.is_none() {
        return Err(format!("asset {id}: neither local bytes nor remote url"));
    }
    let content = payload.as_deref().map(sha1_hex);
    let hash_mismatch = content
        .as_deref()
        .is_some_and(|content| !content.starts_with(id));
    Ok(AssetExpectation {
        content_sha1: content,
        mime,
        byte_size: payload.as_ref().map_or(0, |bytes| bytes.len() as u64),
        local: payload.is_some(),
        legacy_identity: legacy_id || hash_mismatch,
        has_thumb: row.get("thumb").or_else(|| row.get("thumbnail")).is_some(),
        has_preview: row.get("preview").is_some(),
    })
}

fn attach_variant_if_missing(source: &Path, row: &mut Value, id: &str, key: &str, dir: &str) {
    let present = row.get(key).is_some() || (key == "thumb" && row.get("thumbnail").is_some());
    if present {
        return;
    }
    let path = source.join(dir).join(format!("{}.webp", hex_id(id)));
    let Ok(bytes) = fs::read(path) else {
        return;
    };
    if let Some(object) = row.as_object_mut() {
        object.insert(
            key.to_string(),
            json!({
                "__qhType":"u8",
                "base64":base64::engine::general_purpose::STANDARD.encode(bytes)
            }),
        );
    }
}

fn table_row_files(root: &Path, table: &str) -> Result<Vec<PathBuf>, String> {
    let dir = root.join(table);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut files = fs::read_dir(&dir)
        .map_err(|error| format!("read {}: {error}", dir.display()))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension().is_some_and(|ext| ext == "json")
                && !path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.ends_with(".meta.json"))
        })
        .collect::<Vec<_>>();
    files.sort();
    Ok(files)
}

fn read_json(path: &Path) -> Result<Value, String> {
    let raw =
        fs::read_to_string(path).map_err(|error| format!("read {}: {error}", path.display()))?;
    serde_json::from_str(&raw).map_err(|error| format!("parse {}: {error}", path.display()))
}

fn decode_binary(value: Option<&Value>, field: &str) -> Result<Option<Vec<u8>>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    if value.get("__qhType").and_then(Value::as_str) != Some("u8") {
        return Err(format!("{field}: binary marker is invalid"));
    }
    let encoded = value
        .get("base64")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{field}: base64 is missing"))?;
    base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map(Some)
        .map_err(|error| format!("{field}: decode base64: {error}"))
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

fn validate_references(
    references: &[(String, String)],
    asset_ids: &HashSet<String>,
    report: &mut MigrationReport,
) {
    for (path, hash) in references {
        if !asset_ids.contains(hash) {
            report.source_dangling_references += 1;
            report.warnings.push(format!(
                "{path}: pre-existing asset reference {hash} does not resolve"
            ));
        }
    }
}

fn verify_target(
    store: &SqliteStore,
    source_ids: &BTreeMap<String, HashSet<String>>,
    expectations: &HashMap<String, AssetExpectation>,
    report: &mut MigrationReport,
) -> Result<(), String> {
    for table in TABLE_NAMES {
        let expected = source_ids.get(table).cloned().unwrap_or_default();
        let mut actual = HashSet::new();
        let mut offset = 0usize;
        loop {
            let (page, total) = store.scan_page(table, offset, 500, false)?;
            if page.is_empty() {
                break;
            }
            for row in &page {
                if let Some(id) = row.get("id").and_then(Value::as_str) {
                    actual.insert(id.to_string());
                }
            }
            offset += page.len();
            if offset as u64 >= total {
                break;
            }
        }
        if actual != expected {
            report.failures.push(format!(
                "table {table}: target id set differs (source {}, target {})",
                expected.len(),
                actual.len()
            ));
        }
    }

    for (id, expected) in expectations {
        let rows = store.query(
            "assets",
            &serde_json::Map::from_iter([("id".into(), json!(id))]),
            false,
            Some("id,mime,contentSha1,bytesLength"),
        )?;
        let Some(row) = rows.first() else {
            report
                .failures
                .push(format!("asset {id}: missing from target"));
            continue;
        };
        if row.get("mime").and_then(Value::as_str) != Some(expected.mime.as_str()) {
            report
                .failures
                .push(format!("asset {id}: target mime differs"));
        }
        if expected.content_sha1.as_deref() != row.get("contentSha1").and_then(Value::as_str) {
            report
                .failures
                .push(format!("asset {id}: target content SHA-1 differs"));
        }
        if row.get("bytesLength").and_then(Value::as_u64) != Some(expected.byte_size) {
            report
                .failures
                .push(format!("asset {id}: target byte size differs"));
        }
        if expected.local {
            match store.asset_bytes(id) {
                Ok((bytes, _)) => {
                    let actual = sha1_hex(&bytes);
                    if expected.content_sha1.as_deref() != Some(actual.as_str()) {
                        report
                            .failures
                            .push(format!("asset {id}: target file hash differs"));
                    }
                }
                Err(error) => report
                    .failures
                    .push(format!("asset {id}: target file unavailable: {error}")),
            }
        }
        if store.asset_thumb(id).is_ok() {
            report.thumb_files += 1;
        }
        if store.asset_preview(id).is_ok() {
            report.preview_files += 1;
        }
    }
    Ok(())
}

fn import_kv(source: &Path, store: &SqliteStore, report: &mut MigrationReport) {
    let dir = source.join("_kv");
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_none_or(|ext| ext != "json") {
            continue;
        }
        let Some(encoded) = path.file_stem().and_then(|name| name.to_str()) else {
            report
                .failures
                .push(format!("{}: invalid kv filename", path.display()));
            continue;
        };
        let Some(key) = hex_decode(encoded) else {
            report
                .failures
                .push(format!("{}: invalid kv key", path.display()));
            continue;
        };
        match read_json(&path).and_then(|value| store.kv_put(&key, &value)) {
            Ok(()) => report.kv_records += 1,
            Err(error) => report.failures.push(error),
        }
    }
}

fn copy_support_files(
    source: &Path,
    target: &Path,
    report: &mut MigrationReport,
) -> Result<(), String> {
    let window = source.join("window.json");
    if window.is_file() {
        fs::copy(&window, target.join("window.json"))
            .map_err(|error| format!("copy {}: {error}", window.display()))?;
    }
    let cli_out = source.join("cli-out");
    if cli_out.is_dir() {
        if let Err(error) = copy_dir_all(&cli_out, &target.join("cli-out")) {
            report.failures.push(error);
        }
    }
    for dir in ["logs", "outputs"] {
        fs::create_dir_all(target.join(dir))
            .map_err(|error| format!("create target {dir}: {error}"))?;
    }
    Ok(())
}

fn copy_dir_all(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|error| format!("create {}: {error}", target.display()))?;
    for entry in
        fs::read_dir(source).map_err(|error| format!("read {}: {error}", source.display()))?
    {
        let entry = entry.map_err(|error| error.to_string())?;
        let from = entry.path();
        let to = target.join(entry.file_name());
        if from.is_dir() {
            copy_dir_all(&from, &to)?;
        } else {
            fs::copy(&from, &to).map_err(|error| format!("copy {}: {error}", from.display()))?;
        }
    }
    Ok(())
}

fn prepare_target(source: &Path, target: &Path) -> Result<(), String> {
    if target.exists() {
        let canonical_target = target
            .canonicalize()
            .map_err(|error| format!("target root unavailable: {error}"))?;
        if canonical_target == source {
            return Err("source and target must be different directories".into());
        }
        let allowed = [
            ".migration-state.json",
            "migration-report.json",
            "manifest.sqlite",
            "manifest.sqlite-wal",
            "manifest.sqlite-shm",
            "manifest.json",
            "media",
            "cli-out",
            "logs",
            "outputs",
            "window.json",
        ];
        for entry in fs::read_dir(target)
            .map_err(|error| format!("read target {}: {error}", target.display()))?
        {
            let entry = entry.map_err(|error| error.to_string())?;
            let name = entry.file_name();
            if !allowed.iter().any(|allowed| name == *allowed) {
                return Err(format!(
                    "target is not empty and contains {}",
                    entry.path().display()
                ));
            }
        }
    } else {
        fs::create_dir_all(target)
            .map_err(|error| format!("create target {}: {error}", target.display()))?;
    }
    write_json_atomic(
        &target.join(".migration-state.json"),
        &json!({
            "status":"running",
            "sourceRoot":source.to_string_lossy(),
            "startedAt":now_ms(),
            "schemaVersion":SCHEMA_VERSION
        }),
    )
}

fn write_json_atomic(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("create {}: {error}", parent.display()))?;
    }
    let temporary = path.with_extension("json.tmp");
    let payload =
        serde_json::to_vec_pretty(value).map_err(|error| format!("serialize json: {error}"))?;
    fs::write(&temporary, payload)
        .map_err(|error| format!("write {}: {error}", temporary.display()))?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| format!("replace {}: {error}", path.display()))?;
    }
    fs::rename(&temporary, path).map_err(|error| format!("rename {}: {error}", temporary.display()))
}

fn hex_id(value: &str) -> String {
    value
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn hex_decode(value: &str) -> Option<String> {
    if value.len() % 2 != 0 {
        return None;
    }
    let bytes = (0..value.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&value[index..index + 2], 16).ok())
        .collect::<Option<Vec<_>>>()?;
    String::from_utf8(bytes).ok()
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
    use crate::sqlite::SqliteStore;
    use base64::Engine;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(1);

    fn temp_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "qinghua-migrate-{name}-{}-{}-{}",
            std::process::id(),
            now_ms(),
            TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ))
    }

    fn write_json(path: &Path, value: Value) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, serde_json::to_vec(&value).unwrap()).unwrap();
    }

    fn fixture() -> (PathBuf, String) {
        let source = temp_root("source");
        let bytes = b"migration image bytes";
        let hash = sha1_hex(bytes)[..16].to_string();
        write_json(
            &source
                .join("assets")
                .join(format!("{}.json", hex_id(&hash))),
            json!({
                "id":hash,
                "hash":hash,
                "mime":"image/png",
                "width":10,
                "height":20,
                "projectId":"p1",
                "bytes":{
                    "__qhType":"u8",
                    "base64":base64::engine::general_purpose::STANDARD.encode(bytes)
                }
            }),
        );
        write_json(
            &source.join("projects").join("p1.json"),
            json!({"id":"p1","name":"项目"}),
        );
        write_json(
            &source.join("nodes").join("n1.json"),
            json!({"id":"n1","projectId":"p1","data":{"assetHash":hash}}),
        );
        write_json(
            &source.join("assetLibrary").join("l1.json"),
            json!({"id":"l1","hash":hash}),
        );
        (source, hash)
    }

    #[test]
    fn dry_run_validates_without_writing_target() {
        let (source, hash) = fixture();
        let target = temp_root("dry-target");
        let report = migrate_v1_to_v2(&source, &target, true).unwrap();
        assert!(report.dry_run);
        assert_eq!(report.assets_total, 1);
        assert_eq!(report.asset_references, 2);
        assert!(!target.exists());
        assert_eq!(report.table_rows["assets"], 1);
        assert_eq!(hash.len(), 16);
        let _ = fs::remove_dir_all(source);
    }

    #[test]
    fn actual_migration_writes_files_rows_and_complete_manifest() {
        let (source, hash) = fixture();
        let target = temp_root("actual-target");
        let report = migrate_v1_to_v2(&source, &target, false).unwrap();
        assert!(report.manifest_written);
        assert_eq!(report.assets_local, 1);
        assert!(target.join("manifest.json").is_file());
        assert!(target.join("migration-report.json").is_file());
        assert!(std::fs::read_to_string(target.join(".migration-state.json"))
            .unwrap()
            .contains("\"complete\""));
        let store = SqliteStore::open(&target).unwrap();
        assert_eq!(
            store.asset_bytes(&hash).unwrap().0,
            b"migration image bytes"
        );
        assert_eq!(
            store
                .query("nodes", &Default::default(), false, None)
                .unwrap()
                .len(),
            1
        );
        let _ = fs::remove_dir_all(source);
        let _ = fs::remove_dir_all(target);
    }

    #[test]
    fn pre_existing_dangling_reference_is_reported_without_blocking_migration() {
        let (source, _) = fixture();
        write_json(
            &source.join("nodes").join("n2.json"),
            json!({"id":"n2","projectId":"p1","data":{"assetHash":"0000000000000000"}}),
        );
        let target = temp_root("broken-target");
        let report = migrate_v1_to_v2(&source, &target, false).unwrap();
        assert_eq!(report.source_dangling_references, 1);
        assert_eq!(report.warnings.len(), 1);
        assert!(target.join("manifest.json").is_file());
        assert!(target.join("migration-report.json").is_file());
        let _ = fs::remove_dir_all(source);
        let _ = fs::remove_dir_all(target);
    }

    #[test]
    fn legacy_and_mismatched_assets_are_preserved_with_audit_metadata() {
        let source = temp_root("legacy-source");
        let bytes = b"legacy mock payload";
        write_json(
            &source.join("assets").join("g138-hash-a.json"),
            json!({
                "id":"g138-hash-a",
                "mime":"image/png",
                "bytes":{
                    "__qhType":"u8",
                    "base64":base64::engine::general_purpose::STANDARD.encode(bytes)
                }
            }),
        );
        let target = temp_root("legacy-target");
        let report = migrate_v1_to_v2(&source, &target, false).unwrap();
        assert_eq!(report.legacy_assets, 1);
        let store = SqliteStore::open(&target).unwrap();
        assert_eq!(store.asset_bytes("g138-hash-a").unwrap().0, bytes);
        let row = store
            .query(
                "assets",
                &serde_json::Map::from_iter([("id".into(), json!("g138-hash-a"))]),
                false,
                None,
            )
            .unwrap();
        assert_eq!(row[0]["legacyHashMismatch"], json!(true));
        let _ = fs::remove_dir_all(source);
        let _ = fs::remove_dir_all(target);
    }
}
