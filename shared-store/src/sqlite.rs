use base64::Engine;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

pub const SCHEMA_VERSION: i64 = 1;

static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(1);

const TABLES: [&str; 22] = [
    "projects",
    "projectFolders",
    "nodes",
    "edges",
    "channels",
    "tasks",
    "runRecords",
    "assets",
    "credentials",
    "presets",
    "customProtocols",
    "assetLibrary",
    "builtinSkills",
    "skills",
    "agentSessions",
    "fonts",
    "snapshots",
    "storyboards",
    "ecommerceTasks",
    "ecommerceResults",
    "ecommerceCanvasItems",
    "inspirationCache",
];

#[derive(Clone)]
pub struct SqliteStore {
    root: Arc<PathBuf>,
    db_path: Arc<PathBuf>,
}

#[derive(Clone)]
pub enum SqliteOp {
    Put {
        table: String,
        row: Value,
    },
    BulkPut {
        table: String,
        rows: Vec<Value>,
    },
    Delete {
        table: String,
        id: String,
    },
}

impl SqliteStore {
    pub fn open(root: &Path) -> Result<Self, String> {
        fs::create_dir_all(root).map_err(|err| format!("create sqlite root: {err}"))?;
        let db_path = root.join("manifest.sqlite");
        let store = Self {
            root: Arc::new(root.to_path_buf()),
            db_path: Arc::new(db_path),
        };
        let conn = store.connection()?;
        initialize_schema(&conn)?;
        Ok(store)
    }

    fn connection(&self) -> Result<Connection, String> {
        let conn = Connection::open(self.db_path.as_path())
            .map_err(|err| format!("open manifest.sqlite: {err}"))?;
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|err| format!("set sqlite busy timeout: {err}"))?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA foreign_keys=ON;",
        )
        .map_err(|err| format!("configure sqlite: {err}"))?;
        Ok(conn)
    }

    pub fn put(&self, table: &str, row: &Value) -> Result<(), String> {
        validate_table(table)?;
        let conn = self.connection()?;
        put_on(&conn, self.root.as_path(), table, row)
    }

    pub fn bulk_put(&self, table: &str, rows: &[Value]) -> Result<(), String> {
        validate_table(table)?;
        let mut conn = self.connection()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|err| format!("begin bulkPut: {err}"))?;
        for row in rows {
            put_on(&tx, self.root.as_path(), table, row)?;
        }
        tx.commit()
            .map_err(|err| format!("commit bulkPut: {err}"))
    }

    pub fn delete(&self, table: &str, id: &str) -> Result<(), String> {
        validate_table(table)?;
        let conn = self.connection()?;
        delete_on(&conn, table, id)
    }

    pub fn transaction(&self, ops: &[SqliteOp]) -> Result<(), String> {
        let mut conn = self.connection()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|err| format!("begin sqlite transaction: {err}"))?;
        for op in ops {
            match op {
                SqliteOp::Put { table, row } => {
                    put_on(&tx, self.root.as_path(), table, row)?;
                }
                SqliteOp::BulkPut { table, rows } => {
                    for row in rows {
                        put_on(&tx, self.root.as_path(), table, row)?;
                    }
                }
                SqliteOp::Delete { table, id } => delete_on(&tx, table, id)?,
            }
        }
        tx.commit()
            .map_err(|err| format!("commit sqlite transaction: {err}"))
    }

    pub fn query(
        &self,
        table: &str,
        filter: &Map<String, Value>,
        include_payload: bool,
        fields: Option<&str>,
    ) -> Result<Vec<Value>, String> {
        validate_table(table)?;
        let conn = self.connection()?;
        let rows = if table == "assets" {
            query_assets(&conn, self.root.as_path(), filter, include_payload, fields)?
        } else {
            query_rows(&conn, table, filter)?
        };
        Ok(rows
            .into_iter()
            .map(|row| project_fields(row, include_payload, fields))
            .collect())
    }

    pub fn scan_page(
        &self,
        table: &str,
        offset: usize,
        limit: usize,
        include_payload: bool,
    ) -> Result<(Vec<Value>, u64), String> {
        validate_table(table)?;
        let conn = self.connection()?;
        let total: i64 = conn
            .query_row("SELECT COUNT(*) FROM rows WHERE table_name = ?1", params![table], |row| {
                row.get(0)
            })
            .map_err(|err| format!("count rows: {err}"))?;
        let mut stmt = conn
            .prepare(
                "SELECT payload_json FROM rows
                 WHERE table_name = ?1
                 ORDER BY id
                 LIMIT ?2 OFFSET ?3",
            )
            .map_err(|err| format!("prepare row page: {err}"))?;
        let values = stmt
            .query_map(params![table, limit as i64, offset as i64], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|err| format!("query row page: {err}"))?
            .map(|value| {
                let raw = value.map_err(|err| format!("decode row page: {err}"))?;
                serde_json::from_str::<Value>(&raw)
                    .map_err(|err| format!("parse row page: {err}"))
            })
            .map(|value| value.map(|row| project_fields(row, include_payload, None)))
            .collect::<Result<Vec<_>, _>>()?;
        Ok((values, total.max(0) as u64))
    }

    pub fn usage(&self) -> u64 {
        dir_size(self.root.as_path())
    }

    pub fn kv_get(&self, key: &str) -> Result<Value, String> {
        let conn = self.connection()?;
        let raw = conn
            .query_row(
                "SELECT value_json FROM kv WHERE key = ?1",
                params![key],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|err| format!("get kv: {err}"))?;
        match raw {
            Some(raw) => serde_json::from_str(&raw).map_err(|err| format!("parse kv: {err}")),
            None => Ok(Value::Null),
        }
    }

    pub fn kv_put(&self, key: &str, value: &Value) -> Result<(), String> {
        let conn = self.connection()?;
        let raw = serde_json::to_string(value).map_err(|err| format!("encode kv: {err}"))?;
        conn.execute(
            "INSERT INTO kv (key, value_json) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
            params![key, raw],
        )
        .map_err(|err| format!("put kv: {err}"))?;
        Ok(())
    }

    pub fn kv_delete(&self, key: &str) -> Result<(), String> {
        let conn = self.connection()?;
        conn.execute("DELETE FROM kv WHERE key = ?1", params![key])
            .map_err(|err| format!("delete kv: {err}"))?;
        Ok(())
    }

    pub fn asset_bytes(&self, hash: &str) -> Result<(Vec<u8>, String), String> {
        let conn = self.connection()?;
        let found = conn
            .query_row(
                "SELECT mime, media_rel_path FROM assets WHERE hash = ?1",
                params![hash],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .optional()
            .map_err(|err| format!("query asset bytes: {err}"))?
            .ok_or_else(|| "asset not found".to_string())?;
        let path = found
            .1
            .ok_or_else(|| "asset has no local bytes".to_string())?;
        let bytes = fs::read(self.root.join(path))
            .map_err(|err| format!("read asset bytes: {err}"))?;
        Ok((bytes, found.0))
    }

    pub fn asset_thumb(&self, hash: &str) -> Result<Vec<u8>, String> {
        self.read_variant(hash, "thumb_rel_path")
    }

    pub fn asset_preview(&self, hash: &str) -> Result<Vec<u8>, String> {
        self.read_variant(hash, "preview_rel_path")
    }

    fn read_variant(&self, hash: &str, field: &str) -> Result<Vec<u8>, String> {
        let conn = self.connection()?;
        let sql = format!("SELECT {field} FROM assets WHERE hash = ?1");
        let rel = conn
            .query_row(&sql, params![hash], |row| row.get::<_, Option<String>>(0))
            .optional()
            .map_err(|err| format!("query asset variant: {err}"))?
            .flatten()
            .ok_or_else(|| "asset variant not found".to_string())?;
        fs::read(self.root.join(rel)).map_err(|err| format!("read asset variant: {err}"))
    }
}

fn initialize_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_meta (
           key TEXT PRIMARY KEY,
           value TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS rows (
           table_name TEXT NOT NULL,
           id TEXT NOT NULL,
           project_id TEXT,
           updated_at INTEGER,
           payload_json TEXT NOT NULL,
           PRIMARY KEY (table_name, id)
         );
         CREATE INDEX IF NOT EXISTS rows_project_idx
           ON rows(table_name, project_id);
         CREATE INDEX IF NOT EXISTS rows_updated_idx
           ON rows(table_name, updated_at DESC);
         CREATE TABLE IF NOT EXISTS assets (
           hash TEXT PRIMARY KEY,
           mime TEXT NOT NULL,
           metadata_json TEXT NOT NULL,
           media_rel_path TEXT,
           thumb_rel_path TEXT,
           preview_rel_path TEXT,
           remote_url TEXT,
           byte_size INTEGER NOT NULL DEFAULT 0,
           project_id TEXT,
           updated_at INTEGER
         );
         CREATE INDEX IF NOT EXISTS assets_project_idx ON assets(project_id);
         CREATE TABLE IF NOT EXISTS kv (
           key TEXT PRIMARY KEY,
           value_json TEXT NOT NULL
         );",
    )
    .map_err(|err| format!("initialize sqlite schema: {err}"))?;

    let existing = conn
        .query_row(
            "SELECT value FROM schema_meta WHERE key = 'schema_version'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|err| format!("read schema version: {err}"))?;
    if let Some(version) = existing {
        let parsed = version
            .parse::<i64>()
            .map_err(|err| format!("invalid schema version: {err}"))?;
        if parsed != SCHEMA_VERSION {
            return Err(format!(
                "unsupported sqlite schema version {parsed}, expected {SCHEMA_VERSION}"
            ));
        }
    } else {
        conn.execute(
            "INSERT INTO schema_meta (key, value) VALUES ('schema_version', ?1)",
            params![SCHEMA_VERSION.to_string()],
        )
        .map_err(|err| format!("write schema version: {err}"))?;
    }
    Ok(())
}

fn validate_table(table: &str) -> Result<(), String> {
    if TABLES.contains(&table) {
        Ok(())
    } else {
        Err(format!("unknown table: {table}"))
    }
}

fn row_id(row: &Value) -> Result<&str, String> {
    row.get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| "row.id must be a non-empty string".to_string())
}

fn put_on(conn: &Connection, root: &Path, table: &str, row: &Value) -> Result<(), String> {
    validate_table(table)?;
    if table == "assets" {
        return put_asset(conn, root, row);
    }
    if !row.is_object() {
        return Err("row must be a JSON object".into());
    }
    let id = row_id(row)?;
    let project_id = row.get("projectId").and_then(Value::as_str);
    let updated_at = row
        .get("updatedAt")
        .or_else(|| row.get("createdAt"))
        .and_then(Value::as_i64);
    let payload = serde_json::to_string(row).map_err(|err| format!("encode row: {err}"))?;
    conn.execute(
        "INSERT INTO rows (table_name, id, project_id, updated_at, payload_json)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(table_name, id) DO UPDATE SET
           project_id = excluded.project_id,
           updated_at = excluded.updated_at,
           payload_json = excluded.payload_json",
        params![table, id, project_id, updated_at, payload],
    )
    .map_err(|err| format!("put row: {err}"))?;
    Ok(())
}

fn delete_on(conn: &Connection, table: &str, id: &str) -> Result<(), String> {
    validate_table(table)?;
    if table == "assets" {
        conn.execute("DELETE FROM assets WHERE hash = ?1", params![id])
            .map_err(|err| format!("delete asset: {err}"))?;
    } else {
        conn.execute(
            "DELETE FROM rows WHERE table_name = ?1 AND id = ?2",
            params![table, id],
        )
        .map_err(|err| format!("delete row: {err}"))?;
    }
    Ok(())
}

fn query_rows(
    conn: &Connection,
    table: &str,
    filter: &Map<String, Value>,
) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT payload_json FROM rows
             WHERE table_name = ?1
               AND (?2 IS NULL OR id = ?2)
               AND (?3 IS NULL OR project_id = ?3)
             ORDER BY id",
        )
        .map_err(|err| format!("prepare query: {err}"))?;
    let id = filter.get("id").and_then(Value::as_str);
    let project_id = filter.get("projectId").and_then(Value::as_str);
    let rows = stmt
        .query_map(params![table, id, project_id], |row| row.get::<_, String>(0))
        .map_err(|err| format!("query rows: {err}"))?
        .map(|value| {
            let raw = value.map_err(|err| format!("decode row: {err}"))?;
            serde_json::from_str::<Value>(&raw).map_err(|err| format!("parse row: {err}"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows
        .into_iter()
        .filter(|row| matches_filter(row, filter))
        .collect())
}

fn query_assets(
    conn: &Connection,
    root: &Path,
    filter: &Map<String, Value>,
    include_payload: bool,
    fields: Option<&str>,
) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT hash, mime, metadata_json, media_rel_path, thumb_rel_path,
                    preview_rel_path, remote_url, byte_size
             FROM assets
             WHERE (?1 IS NULL OR hash = ?1)
               AND (?2 IS NULL OR project_id = ?2)
             ORDER BY hash",
        )
        .map_err(|err| format!("prepare asset query: {err}"))?;
    let id = filter.get("id").and_then(Value::as_str);
    let project_id = filter.get("projectId").and_then(Value::as_str);
    let rows = stmt
        .query_map(params![id, project_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, i64>(7)?,
            ))
        })
        .map_err(|err| format!("query assets: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("decode assets: {err}"))?;

    let requested = fields.map(|raw| {
        raw.split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>()
    });
    let mut out = Vec::new();
    for (hash, mime, metadata, media, thumb, preview, remote, byte_size) in rows {
        let mut row: Value = serde_json::from_str(&metadata)
            .map_err(|err| format!("parse asset metadata: {err}"))?;
        let fields_wanted = |name: &str| {
            requested
                .as_ref()
                .is_none_or(|fields| fields.contains(&name))
        };
        if include_payload {
            if let Some(rel) = media {
                let bytes = fs::read(root.join(rel))
                    .map_err(|err| format!("read asset payload: {err}"))?;
                row["bytes"] = binary_marker(&bytes);
            }
            if let Some(rel) = thumb {
                let bytes = fs::read(root.join(rel))
                    .map_err(|err| format!("read asset thumb: {err}"))?;
                row["thumb"] = binary_marker(&bytes);
            }
            if let Some(rel) = preview {
                let bytes = fs::read(root.join(rel))
                    .map_err(|err| format!("read asset preview: {err}"))?;
                row["preview"] = binary_marker(&bytes);
            }
        } else {
            row["bytesLength"] = json!(byte_size);
            if let Some(rel) = thumb {
                row["thumbLength"] = json!(file_len(root, &rel));
            }
            if let Some(rel) = preview {
                row["previewLength"] = json!(file_len(root, &rel));
            }
        }
        if remote.is_some() && fields_wanted("url") {
            row["url"] = json!(remote);
        }
        if !matches_filter(&row, filter) {
            continue;
        }
        if row.get("id").and_then(Value::as_str) != Some(hash.as_str()) {
            row["id"] = json!(hash);
        }
        if row.get("mime").and_then(Value::as_str).is_none() {
            row["mime"] = json!(mime);
        }
        out.push(row);
    }
    Ok(out)
}

fn put_asset(conn: &Connection, root: &Path, row: &Value) -> Result<(), String> {
    let hash = row_id(row)?.to_string();
    safe_hash(&hash)?;
    let mime = row
        .get("mime")
        .and_then(Value::as_str)
        .unwrap_or("application/octet-stream")
        .to_string();
    let mut metadata = row.clone();
    let payload = binary_marker_bytes(row.get("bytes"));
    let thumb = binary_marker_bytes(row.get("thumb").or_else(|| row.get("thumbnail")));
    let preview = binary_marker_bytes(row.get("preview"));
    if let Value::Object(fields) = &mut metadata {
        fields.remove("bytes");
        fields.remove("thumb");
        fields.remove("thumbnail");
        fields.remove("preview");
    }
    let media_rel = payload.as_ref().map(|bytes| {
        write_media(root, &hash, &mime, bytes)
    }).transpose()?;
    let thumb_rel = thumb.as_ref().map(|bytes| {
        write_variant(root, "thumbs", &hash, bytes)
    }).transpose()?;
    let preview_rel = preview.as_ref().map(|bytes| {
        write_variant(root, "previews", &hash, bytes)
    }).transpose()?;
    let remote_url = row.get("url").and_then(Value::as_str);
    let project_id = row.get("projectId").and_then(Value::as_str);
    let updated_at = row
        .get("updatedAt")
        .or_else(|| row.get("createdAt"))
        .and_then(Value::as_i64);
    let byte_size = payload.as_ref().map(Vec::len).unwrap_or(0);
    let metadata_json =
        serde_json::to_string(&metadata).map_err(|err| format!("encode asset metadata: {err}"))?;
    conn.execute(
        "INSERT INTO assets (
           hash, mime, metadata_json, media_rel_path, thumb_rel_path,
           preview_rel_path, remote_url, byte_size, project_id, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(hash) DO UPDATE SET
           mime = excluded.mime,
           metadata_json = excluded.metadata_json,
           media_rel_path = COALESCE(excluded.media_rel_path, assets.media_rel_path),
           thumb_rel_path = COALESCE(excluded.thumb_rel_path, assets.thumb_rel_path),
           preview_rel_path = COALESCE(excluded.preview_rel_path, assets.preview_rel_path),
           remote_url = excluded.remote_url,
           byte_size = CASE WHEN excluded.byte_size > 0 THEN excluded.byte_size ELSE assets.byte_size END,
           project_id = excluded.project_id,
           updated_at = excluded.updated_at",
        params![
            hash,
            mime,
            metadata_json,
            media_rel,
            thumb_rel,
            preview_rel,
            remote_url,
            byte_size as i64,
            project_id,
            updated_at
        ],
    )
    .map_err(|err| format!("put asset: {err}"))?;
    Ok(())
}

fn matches_filter(row: &Value, filter: &Map<String, Value>) -> bool {
    filter
        .iter()
        .all(|(key, expected)| row.get(key).is_some_and(|value| value == expected))
}

fn project_fields(row: Value, include_payload: bool, fields: Option<&str>) -> Value {
    let mut row = row;
    if !include_payload {
        strip_binary_payload(&mut row);
    }
    let Some(fields) = fields else {
        return row;
    };
    let Some(object) = row.as_object() else {
        return row;
    };
    let mut projected = Map::new();
    for field in fields.split(',').map(str::trim).filter(|field| !field.is_empty()) {
        if let Some(value) = object.get(field) {
            projected.insert(field.to_string(), value.clone());
        }
    }
    Value::Object(projected)
}

fn strip_binary_payload(row: &mut Value) {
    let Some(fields) = row.as_object_mut() else {
        return;
    };
    for name in ["bytes", "thumb", "thumbnail", "preview", "data"] {
        let Some(value) = fields.get(name) else {
            continue;
        };
        if value.get("__qhType").and_then(Value::as_str) != Some("u8") {
            continue;
        }
        let length = value
            .get("base64")
            .and_then(Value::as_str)
            .map(|encoded| {
                let padding = if encoded.ends_with("==") {
                    2
                } else if encoded.ends_with('=') {
                    1
                } else {
                    0
                };
                (encoded.len().saturating_mul(3) / 4).saturating_sub(padding)
            })
            .unwrap_or(0);
        fields.insert(format!("{name}Length"), json!(length));
        fields.remove(name);
    }
}

fn binary_marker(bytes: &[u8]) -> Value {
    json!({
        "__qhType": "u8",
        "base64": base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}

fn binary_marker_bytes(value: Option<&Value>) -> Option<Vec<u8>> {
    let value = value?;
    if value.get("__qhType").and_then(Value::as_str) != Some("u8") {
        return None;
    }
    let encoded = value.get("base64").and_then(Value::as_str)?;
    base64::engine::general_purpose::STANDARD.decode(encoded).ok()
}

fn safe_hash(hash: &str) -> Result<(), String> {
    if hash.len() < 2
        || !hash
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err(format!("unsafe asset hash: {hash}"));
    }
    Ok(())
}

fn hash_prefix(hash: &str) -> &str {
    &hash[..2]
}

fn media_kind(mime: &str) -> &'static str {
    if mime.starts_with("video/") {
        "videos"
    } else if mime.starts_with("audio/") {
        "audio"
    } else {
        "images"
    }
}

fn extension_for_mime(mime: &str) -> &'static str {
    match mime.split(';').next().unwrap_or(mime).trim() {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        "video/quicktime" => "mov",
        "audio/mpeg" => "mp3",
        "audio/wav" => "wav",
        "audio/ogg" => "ogg",
        "audio/mp4" => "m4a",
        "audio/aac" => "aac",
        "audio/flac" => "flac",
        _ => "bin",
    }
}

fn write_media(root: &Path, hash: &str, mime: &str, bytes: &[u8]) -> Result<String, String> {
    let rel = format!(
        "media/{}/{}/{}.{}",
        media_kind(mime),
        hash_prefix(hash),
        hash,
        extension_for_mime(mime)
    );
    write_content_addressed(root, &rel, bytes)?;
    Ok(rel)
}

fn write_variant(root: &Path, kind: &str, hash: &str, bytes: &[u8]) -> Result<String, String> {
    let rel = format!("media/{}/{}/{}.webp", kind, hash_prefix(hash), hash);
    write_content_addressed(root, &rel, bytes)?;
    Ok(rel)
}

fn write_content_addressed(root: &Path, rel: &str, bytes: &[u8]) -> Result<(), String> {
    let path = root.join(rel);
    if path.is_file() {
        let existing = fs::read(&path)
            .map_err(|err| format!("read existing media {}: {err}", path.display()))?;
        if existing == bytes {
            return Ok(());
        }
    }
    let parent = path
        .parent()
        .ok_or_else(|| "media path has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(|err| format!("create media dir: {err}"))?;
    let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let temporary = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("media"),
        sequence
    ));
    fs::write(&temporary, bytes).map_err(|err| format!("write media temp: {err}"))?;
    if path.exists() {
        fs::remove_file(&path).map_err(|err| format!("replace media: {err}"))?;
    }
    fs::rename(&temporary, &path).map_err(|err| format!("rename media: {err}"))?;
    Ok(())
}

fn file_len(root: &Path, rel: &str) -> u64 {
    fs::metadata(root.join(rel))
        .map(|meta| meta.len())
        .unwrap_or(0)
}

fn dir_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    let mut total = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            total += dir_size(&path);
        } else {
            total += entry.metadata().map(|meta| meta.len()).unwrap_or(0);
        }
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "qinghua-sqlite-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn row_roundtrip_and_project_filter() {
        let root = temp_root("rows");
        let store = SqliteStore::open(&root).unwrap();
        store
            .put(
                "nodes",
                &json!({"id":"n1","projectId":"p1","title":"A","x":1}),
            )
            .unwrap();
        store
            .put(
                "nodes",
                &json!({"id":"n2","projectId":"p2","title":"B","x":2}),
            )
            .unwrap();
        let rows = store
            .query("nodes", &Map::from_iter([("projectId".into(), json!("p1"))]), true, None)
            .unwrap();
        assert_eq!(rows, vec![json!({"id":"n1","projectId":"p1","title":"A","x":1})]);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn transaction_rolls_back_all_ops() {
        let root = temp_root("tx");
        let store = SqliteStore::open(&root).unwrap();
        let result = store.transaction(&[
            SqliteOp::Put {
                table: "projects".into(),
                row: json!({"id":"p1","name":"one"}),
            },
            SqliteOp::Put {
                table: "projects".into(),
                row: json!({"name":"missing id"}),
            },
        ]);
        assert!(result.is_err());
        assert!(store
            .query("projects", &Map::new(), true, None)
            .unwrap()
            .is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn assets_write_media_files_and_hide_base64_from_metadata() {
        let root = temp_root("assets");
        let store = SqliteStore::open(&root).unwrap();
        let image = b"fake png bytes";
        store
            .put(
                "assets",
                &json!({
                    "id":"a1b2c3",
                    "projectId":"p1",
                    "mime":"image/png",
                    "width":10,
                    "height":20,
                    "bytes": {
                        "__qhType":"u8",
                        "base64": base64::engine::general_purpose::STANDARD.encode(image)
                    }
                }),
            )
            .unwrap();
        assert_eq!(store.asset_bytes("a1b2c3").unwrap().0, image);
        let projected = store
            .query(
                "assets",
                &Map::from_iter([("id".into(), json!("a1b2c3"))]),
                false,
                None,
            )
            .unwrap();
        assert_eq!(projected[0].get("bytes"), None);
        assert_eq!(projected[0]["bytesLength"], json!(image.len()));
        let with_payload = store
            .query(
                "assets",
                &Map::from_iter([("id".into(), json!("a1b2c3"))]),
                true,
                Some("id,mime,bytes"),
            )
            .unwrap();
        assert_eq!(
            binary_marker_bytes(with_payload[0].get("bytes")),
            Some(image.to_vec())
        );
        let _ = fs::remove_dir_all(root);
    }
}
