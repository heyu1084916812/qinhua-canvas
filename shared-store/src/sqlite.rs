use crate::hash::sha1_hex;
use crate::strip_payload;
use base64::Engine;
use rusqlite::{
    params, params_from_iter,
    types::Value as SqlValue,
    Connection, OptionalExtension, TransactionBehavior,
};
use serde_json::{json, Map, Value};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

pub const SCHEMA_VERSION: i64 = 2;

static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(1);

pub const TABLE_NAMES: [&str; 23] = [
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
    "assetSaveQueue",
    "ecommerceCanvasItems",
    "inspirationCache",
];

#[derive(Clone)]
pub struct SqliteStore {
    root: Arc<PathBuf>,
    db_path: Arc<PathBuf>,
    maintenance: Arc<AtomicBool>,
}

#[derive(Clone)]
pub enum SqliteOp {
    Put { table: String, row: Value },
    BulkPut { table: String, rows: Vec<Value> },
    Delete { table: String, id: String },
}

impl SqliteStore {
    pub fn open(root: &Path) -> Result<Self, String> {
        fs::create_dir_all(root).map_err(|err| format!("create sqlite root: {err}"))?;
        let db_path = root.join("manifest.sqlite");
        let store = Self {
            root: Arc::new(root.to_path_buf()),
            db_path: Arc::new(db_path),
            maintenance: Arc::new(AtomicBool::new(false)),
        };
        let conn = store.connection()?;
        initialize_schema(&conn)?;
        Ok(store)
    }

    pub fn root_path(&self) -> &Path {
        self.root.as_path()
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
        self.ensure_write_allowed()?;
        validate_table(table)?;
        let conn = self.connection()?;
        put_on(&conn, self.root.as_path(), table, row)
    }

    pub fn put_legacy_asset(&self, row: &Value) -> Result<(), String> {
        self.ensure_write_allowed()?;
        let conn = self.connection()?;
        put_asset_inner(&conn, self.root.as_path(), row, true)
    }

    pub fn bulk_put(&self, table: &str, rows: &[Value]) -> Result<(), String> {
        self.ensure_write_allowed()?;
        validate_table(table)?;
        let mut conn = self.connection()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|err| format!("begin bulkPut: {err}"))?;
        for row in rows {
            put_on(&tx, self.root.as_path(), table, row)?;
        }
        tx.commit().map_err(|err| format!("commit bulkPut: {err}"))
    }

    pub fn delete(&self, table: &str, id: &str) -> Result<(), String> {
        self.ensure_write_allowed()?;
        validate_table(table)?;
        let conn = self.connection()?;
        delete_on(&conn, table, id)
    }

    pub fn transaction(&self, ops: &[SqliteOp]) -> Result<(), String> {
        self.ensure_write_allowed()?;
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

    pub fn query_page(
        &self,
        table: &str,
        filter: &Map<String, Value>,
        page: &crate::PageQuery,
    ) -> Result<(Vec<Value>, u64), String> {
        validate_table(table)?;
        if table == "assets" {
            return Err("queryPage does not support assets; use query or scan".into());
        }
        let conn = self.connection()?;
        let (where_sql, params) = page_where_sql(table, filter, page)?;
        let total_sql = format!("SELECT COUNT(*) FROM rows WHERE {where_sql}");
        let total: i64 = conn
            .query_row(&total_sql, params_from_iter(params.iter()), |row| {
                row.get(0)
            })
            .map_err(|err| format!("count page rows: {err}"))?;

        let order_sql = page_order_sql(page)?;
        let limit = page.limit.min(1000);
        let page_sql = format!(
            "SELECT payload_json FROM rows
             WHERE {where_sql}
             ORDER BY {order_sql}
             LIMIT ? OFFSET ?"
        );
        let mut paged_params = params;
        paged_params.push(SqlValue::Integer(limit as i64));
        paged_params.push(SqlValue::Integer(page.offset as i64));
        let mut stmt = conn
            .prepare(&page_sql)
            .map_err(|err| format!("prepare page rows: {err}"))?;
        let rows = stmt
            .query_map(params_from_iter(paged_params.iter()), |row| {
                row.get::<_, String>(0)
            })
            .map_err(|err| format!("query page rows: {err}"))?
            .map(|value| {
                let raw = value.map_err(|err| format!("decode page row: {err}"))?;
                serde_json::from_str::<Value>(&raw)
                    .map_err(|err| format!("parse page row: {err}"))
            })
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .map(|mut row| {
                if !page.include_payload {
                    strip_payload(&mut row);
                }
                project_fields(row, page.include_payload, page.fields.as_deref())
            })
            .collect();
        Ok((rows, total.max(0) as u64))
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
        if table == "assets" {
            return scan_asset_page(&conn, self.root.as_path(), offset, limit, include_payload);
        }
        let total: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM rows WHERE table_name = ?1",
                params![table],
                |row| row.get(0),
            )
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
                serde_json::from_str::<Value>(&raw).map_err(|err| format!("parse row page: {err}"))
            })
            .map(|value| value.map(|row| project_fields(row, include_payload, None)))
            .collect::<Result<Vec<_>, _>>()?;
        Ok((values, total.max(0) as u64))
    }

    pub fn usage(&self) -> u64 {
        let mut total = ["", "-wal", "-shm"]
            .into_iter()
            .filter_map(|suffix| {
                let path = if suffix.is_empty() {
                    self.db_path.as_path().to_path_buf()
                } else {
                    PathBuf::from(format!("{}{}", self.db_path.display(), suffix))
                };
                fs::metadata(path).ok().map(|meta| meta.len())
            })
            .sum::<u64>();
        let Ok(conn) = self.connection() else {
            return total;
        };
        let Ok(mut stmt) =
            conn.prepare("SELECT byte_size, thumb_rel_path, preview_rel_path FROM assets")
        else {
            return total;
        };
        let Ok(rows) = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        }) else {
            return total;
        };
        for row in rows.flatten() {
            total = total.saturating_add(row.0.max(0) as u64);
            if let Some(path) = row.1 {
                total = total.saturating_add(file_len(self.root.as_path(), &path));
            }
            if let Some(path) = row.2 {
                total = total.saturating_add(file_len(self.root.as_path(), &path));
            }
        }
        total
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
        self.ensure_write_allowed()?;
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
        self.ensure_write_allowed()?;
        let conn = self.connection()?;
        conn.execute("DELETE FROM kv WHERE key = ?1", params![key])
            .map_err(|err| format!("delete kv: {err}"))?;
        Ok(())
    }

    pub fn checkpoint(&self) -> Result<(), String> {
        self.connection()?
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(|err| format!("checkpoint manifest.sqlite: {err}"))
    }

    pub fn set_maintenance(&self, enabled: bool) {
        self.maintenance.store(enabled, Ordering::SeqCst);
    }

    pub fn in_maintenance(&self) -> bool {
        self.maintenance.load(Ordering::SeqCst)
    }

    fn ensure_write_allowed(&self) -> Result<(), String> {
        if self.in_maintenance() {
            Err("storage is in maintenance mode".into())
        } else {
            Ok(())
        }
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
        let path = resolve_media_path(self.root.as_path(), &path)?;
        let bytes = fs::read(path).map_err(|err| format!("read asset bytes: {err}"))?;
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
        let path = resolve_media_path(self.root.as_path(), &rel)?;
        fs::read(path).map_err(|err| format!("read asset variant: {err}"))
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
           workbench TEXT,
           run_status TEXT,
           action TEXT,
           subject_id TEXT,
           scope_id TEXT,
           operation_id TEXT,
           parent_run_id TEXT,
           scope_version INTEGER,
           payload_json TEXT NOT NULL,
           PRIMARY KEY (table_name, id)
         );
         CREATE INDEX IF NOT EXISTS rows_project_idx
           ON rows(table_name, project_id);
         CREATE INDEX IF NOT EXISTS rows_updated_idx
           ON rows(table_name, updated_at DESC);
         CREATE TABLE IF NOT EXISTS assets (
           hash TEXT PRIMARY KEY,
           content_sha1 TEXT,
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
    ensure_column(conn, "assets", "content_sha1", "TEXT")?;
    for (column, declaration) in [
        ("workbench", "TEXT"),
        ("run_status", "TEXT"),
        ("action", "TEXT"),
        ("subject_id", "TEXT"),
        ("scope_id", "TEXT"),
        ("operation_id", "TEXT"),
        ("parent_run_id", "TEXT"),
        ("scope_version", "INTEGER"),
    ] {
        ensure_column(conn, "rows", column, declaration)?;
    }
    for (column, path) in [
        ("workbench", "$.workbench"),
        ("run_status", "$.status"),
        ("action", "$.action"),
        ("subject_id", "$.subjectId"),
        ("scope_id", "$.scopeId"),
        ("operation_id", "$.operationId"),
        ("parent_run_id", "$.parentRunId"),
        ("scope_version", "$.scopeVersion"),
    ] {
        let sql = format!(
            "UPDATE rows
             SET {column} = json_extract(payload_json, '{path}')
             WHERE table_name = 'runRecords'
               AND {column} IS NULL
               AND json_extract(payload_json, '{path}') IS NOT NULL"
        );
        conn.execute(&sql, [])
            .map_err(|err| format!("backfill rows.{column}: {err}"))?;
    }
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS rows_run_project_updated_idx
           ON rows(table_name, project_id, updated_at DESC)
           WHERE table_name = 'runRecords';
         CREATE INDEX IF NOT EXISTS rows_run_workbench_updated_idx
           ON rows(table_name, project_id, workbench, updated_at DESC)
           WHERE table_name = 'runRecords';
         CREATE INDEX IF NOT EXISTS rows_run_action_idx
           ON rows(table_name, project_id, action, updated_at DESC)
           WHERE table_name = 'runRecords';
         CREATE INDEX IF NOT EXISTS rows_run_scope_idx
           ON rows(table_name, project_id, scope_id, subject_id, operation_id)
           WHERE table_name = 'runRecords';",
    )
    .map_err(|err| format!("initialize run record indexes: {err}"))?;

    let existing = conn
        .query_row(
            "SELECT value FROM schema_meta WHERE key = 'schema_version'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|err| format!("read schema version: {err}"))?;
    let version = if let Some(version) = existing {
        version
            .parse::<i64>()
            .map_err(|err| format!("invalid schema version: {err}"))?
    } else {
        0
    };

    if version == 0 {
        conn.execute(
            "INSERT INTO schema_meta (key, value) VALUES ('schema_version', ?1)",
            params![SCHEMA_VERSION.to_string()],
        )
        .map_err(|err| format!("write schema version: {err}"))?;
    } else if version == 1 && SCHEMA_VERSION == 2 {
        conn.execute(
            "UPDATE schema_meta SET value = ?1 WHERE key = 'schema_version'",
            params![SCHEMA_VERSION.to_string()],
        )
        .map_err(|err| format!("upgrade schema version: {err}"))?;
    } else if version != SCHEMA_VERSION {
        return Err(format!(
            "unsupported sqlite schema version {version}, expected {SCHEMA_VERSION}"
        ));
    }
    Ok(())
}

fn ensure_column(
    conn: &Connection,
    table: &str,
    column: &str,
    declaration: &str,
) -> Result<(), String> {
    let sql = format!("PRAGMA table_info({table})");
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|err| format!("prepare table info for {table}: {err}"))?;
    let names = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|err| format!("read table info for {table}: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("decode table info for {table}: {err}"))?;
    if names.iter().any(|name| name == column) {
        return Ok(());
    }
    conn.execute(
        &format!("ALTER TABLE {table} ADD COLUMN {column} {declaration}"),
        [],
    )
    .map_err(|err| format!("add {table}.{column}: {err}"))?;
    Ok(())
}

fn validate_table(table: &str) -> Result<(), String> {
    if TABLE_NAMES.contains(&table) {
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
        return put_asset_inner(conn, root, row, false);
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
    let workbench = row.get("workbench").and_then(Value::as_str);
    let run_status = row.get("status").and_then(Value::as_str);
    let action = row.get("action").and_then(Value::as_str);
    let subject_id = row.get("subjectId").and_then(Value::as_str);
    let scope_id = row.get("scopeId").and_then(Value::as_str);
    let operation_id = row.get("operationId").and_then(Value::as_str);
    let parent_run_id = row.get("parentRunId").and_then(Value::as_str);
    let scope_version = row.get("scopeVersion").and_then(Value::as_i64);
    let payload = serde_json::to_string(row).map_err(|err| format!("encode row: {err}"))?;
    conn.execute(
        "INSERT INTO rows (
           table_name, id, project_id, updated_at,
           workbench, run_status, action, subject_id, scope_id, operation_id,
           parent_run_id, scope_version, payload_json
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
         ON CONFLICT(table_name, id) DO UPDATE SET
           project_id = excluded.project_id,
           updated_at = excluded.updated_at,
           workbench = excluded.workbench,
           run_status = excluded.run_status,
           action = excluded.action,
           subject_id = excluded.subject_id,
           scope_id = excluded.scope_id,
           operation_id = excluded.operation_id,
           parent_run_id = excluded.parent_run_id,
           scope_version = excluded.scope_version,
           payload_json = excluded.payload_json",
        params![
            table,
            id,
            project_id,
            updated_at,
            workbench,
            run_status,
            action,
            subject_id,
            scope_id,
            operation_id,
            parent_run_id,
            scope_version,
            payload
        ],
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
        .query_map(params![table, id, project_id], |row| {
            row.get::<_, String>(0)
        })
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

fn page_field_expression(field: &str) -> Result<String, String> {
    if field.is_empty()
        || !field
            .chars()
            .enumerate()
            .all(|(index, ch)| ch == '_' || ch.is_ascii_alphanumeric() && (index > 0 || ch.is_ascii_alphabetic()))
    {
        return Err(format!("invalid page field: {field}"));
    }
    Ok(match field {
        "id" => "id".into(),
        "projectId" => "project_id".into(),
        "createdAt" => "updated_at".into(),
        "workbench" => "workbench".into(),
        "status" => "run_status".into(),
        "action" => "action".into(),
        "subjectId" => "subject_id".into(),
        "scopeId" => "scope_id".into(),
        "operationId" => "operation_id".into(),
        "parentRunId" => "parent_run_id".into(),
        "scopeVersion" => "scope_version".into(),
        _ => format!("json_extract(payload_json, '$.{field}')"),
    })
}

fn page_value(value: &Value) -> Result<SqlValue, String> {
    Ok(match value {
        Value::String(value) => SqlValue::Text(value.clone()),
        Value::Number(value) => {
            if let Some(value) = value.as_i64() {
                SqlValue::Integer(value)
            } else {
                SqlValue::Real(
                    value
                        .as_f64()
                        .ok_or_else(|| "page filter number is not finite".to_string())?,
                )
            }
        }
        Value::Bool(value) => SqlValue::Integer(i64::from(*value)),
        Value::Null => SqlValue::Null,
        _ => return Err("page filters only accept scalar values".into()),
    })
}

fn page_where_sql(
    table: &str,
    filter: &Map<String, Value>,
    page: &crate::PageQuery,
) -> Result<(String, Vec<SqlValue>), String> {
    let mut conditions = vec!["table_name = ?".to_string()];
    let mut values = vec![SqlValue::Text(table.to_string())];
    for (field, expected) in filter {
        let expression = page_field_expression(field)?;
        if expected.is_null() {
            conditions.push(format!("{expression} IS NULL"));
        } else {
            conditions.push(format!("{expression} = ?"));
            values.push(page_value(expected)?);
        }
    }
    if !page.ids.is_empty() {
        let placeholders = vec!["?"; page.ids.len()].join(", ");
        conditions.push(format!("id IN ({placeholders})"));
        values.extend(page.ids.iter().cloned().map(SqlValue::Text));
    }
    for field in &page.missing_fields {
        let expression = page_field_expression(field)?;
        conditions.push(format!("{expression} IS NULL"));
    }
    for range in &page.ranges {
        let expression = page_field_expression(&range.field)?;
        if let Some(from) = range.from {
            conditions.push(format!("{expression} >= ?"));
            values.push(SqlValue::Integer(from));
        }
        if let Some(to) = range.to {
            conditions.push(format!("{expression} <= ?"));
            values.push(SqlValue::Integer(to));
        }
    }
    Ok((conditions.join(" AND "), values))
}

fn page_order_sql(page: &crate::PageQuery) -> Result<String, String> {
    let Some(order) = &page.order_by else {
        return Ok("updated_at DESC, id ASC".into());
    };
    let expression = page_field_expression(&order.field)?;
    let direction = if order.direction.as_deref() == Some("desc") {
        "DESC"
    } else {
        "ASC"
    };
    Ok(format!("{expression} {direction}, id ASC"))
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
            "SELECT hash, content_sha1, mime, metadata_json, media_rel_path,
                    thumb_rel_path, preview_rel_path, remote_url, byte_size
             FROM assets
             WHERE (?1 IS NULL OR hash = ?1)
               AND (?2 IS NULL OR project_id = ?2)
             ORDER BY hash",
        )
        .map_err(|err| format!("prepare asset query: {err}"))?;
    let id = filter.get("id").and_then(Value::as_str);
    let project_id = filter.get("projectId").and_then(Value::as_str);
    let rows = stmt
        .query_map(params![id, project_id], read_asset_columns)
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
    for stored in rows {
        let mut row = asset_value(root, stored, include_payload)?;
        let fields_wanted = |name: &str| {
            requested
                .as_ref()
                .is_none_or(|fields| fields.contains(&name))
        };
        if !matches_filter(&row, filter) {
            continue;
        }
        if !fields_wanted("url") {
            if let Value::Object(fields) = &mut row {
                fields.remove("url");
            }
        }
        out.push(row);
    }
    Ok(out)
}

type AssetColumns = (
    String,
    Option<String>,
    String,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    i64,
);

fn read_asset_columns(row: &rusqlite::Row<'_>) -> rusqlite::Result<AssetColumns> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
        row.get(6)?,
        row.get(7)?,
        row.get(8)?,
    ))
}

fn asset_value(root: &Path, stored: AssetColumns, include_payload: bool) -> Result<Value, String> {
    let (hash, sha1, mime, metadata, media, thumb, preview, remote, byte_size) = stored;
    let mut row: Value =
        serde_json::from_str(&metadata).map_err(|err| format!("parse asset metadata: {err}"))?;
    if include_payload {
        if let Some(rel) = media {
            let bytes = fs::read(resolve_media_path(root, &rel)?)
                .map_err(|err| format!("read asset payload: {err}"))?;
            row["bytes"] = binary_marker(&bytes);
        }
        if let Some(rel) = thumb {
            let bytes = fs::read(resolve_media_path(root, &rel)?)
                .map_err(|err| format!("read asset thumb: {err}"))?;
            row["thumb"] = binary_marker(&bytes);
        }
        if let Some(rel) = preview {
            let bytes = fs::read(resolve_media_path(root, &rel)?)
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
    if let Some(remote) = remote {
        row["url"] = json!(remote);
    }
    row["id"] = json!(hash);
    if row.get("mime").and_then(Value::as_str).is_none() {
        row["mime"] = json!(mime);
    }
    if let Some(sha1) = sha1 {
        row["contentSha1"] = json!(sha1);
    }
    Ok(row)
}

fn scan_asset_page(
    conn: &Connection,
    root: &Path,
    offset: usize,
    limit: usize,
    include_payload: bool,
) -> Result<(Vec<Value>, u64), String> {
    let total: i64 = conn
        .query_row("SELECT COUNT(*) FROM assets", [], |row| row.get(0))
        .map_err(|err| format!("count assets: {err}"))?;
    let mut stmt = conn
        .prepare(
            "SELECT hash, content_sha1, mime, metadata_json, media_rel_path,
                    thumb_rel_path, preview_rel_path, remote_url, byte_size
             FROM assets
             ORDER BY hash
             LIMIT ?1 OFFSET ?2",
        )
        .map_err(|err| format!("prepare asset page: {err}"))?;
    let stored = stmt
        .query_map(params![limit as i64, offset as i64], read_asset_columns)
        .map_err(|err| format!("query asset page: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("decode asset page: {err}"))?;
    let rows = stored
        .into_iter()
        .map(|asset| asset_value(root, asset, include_payload))
        .collect::<Result<Vec<_>, _>>()?;
    Ok((rows, total.max(0) as u64))
}

fn put_asset_inner(
    conn: &Connection,
    root: &Path,
    row: &Value,
    allow_legacy_identity: bool,
) -> Result<(), String> {
    let hash = row_id(row)?.to_string();
    if allow_legacy_identity {
        safe_legacy_asset_id(&hash)?;
    } else {
        safe_hash(&hash)?;
    }
    let mime = row
        .get("mime")
        .and_then(Value::as_str)
        .unwrap_or("application/octet-stream")
        .to_string();
    let mut metadata = row.clone();
    let payload = binary_marker_bytes_checked(row.get("bytes"), "assets.bytes")?;
    let thumb = binary_marker_bytes_checked(
        row.get("thumb").or_else(|| row.get("thumbnail")),
        "assets.thumb",
    )?;
    let preview = binary_marker_bytes_checked(row.get("preview"), "assets.preview")?;
    let full_sha1 = payload.as_deref().map(content_sha1);
    let hash_mismatch = full_sha1
        .as_deref()
        .is_some_and(|sha1| !sha1.starts_with(&hash));
    if !allow_legacy_identity {
        if let Some(sha1) = full_sha1.as_deref() {
            if hash_mismatch {
                return Err(format!(
                    "asset hash {hash} does not match content SHA-1 {sha1}"
                ));
            }
        }
    } else if hash_mismatch {
        if let Value::Object(fields) = &mut metadata {
            fields.insert("legacyHashMismatch".into(), Value::Bool(true));
        }
    }
    let existing = conn
        .query_row(
            "SELECT content_sha1 FROM assets WHERE hash = ?1",
            params![hash],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|err| format!("query existing asset: {err}"))?
        .flatten();
    if let (Some(existing), Some(next)) = (existing.as_deref(), full_sha1.as_deref()) {
        if existing != next {
            return Err(format!(
                "asset hash collision for {hash}: existing {existing}, incoming {next}"
            ));
        }
    }
    if let Value::Object(fields) = &mut metadata {
        fields.remove("bytes");
        fields.remove("thumb");
        fields.remove("thumbnail");
        fields.remove("preview");
        fields.remove("contentSha1");
        fields.remove("content_sha1");
    }
    let media_rel = payload
        .as_ref()
        .map(|bytes| write_media(root, &hash, &mime, bytes))
        .transpose()?;
    let thumb_rel = thumb
        .as_ref()
        .map(|bytes| write_variant(root, "thumbs", &hash, bytes))
        .transpose()?;
    let preview_rel = preview
        .as_ref()
        .map(|bytes| write_variant(root, "previews", &hash, bytes))
        .transpose()?;
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
           hash, content_sha1, mime, metadata_json, media_rel_path, thumb_rel_path,
           preview_rel_path, remote_url, byte_size, project_id, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(hash) DO UPDATE SET
           content_sha1 = COALESCE(excluded.content_sha1, assets.content_sha1),
           mime = excluded.mime,
           metadata_json = excluded.metadata_json,
           media_rel_path = COALESCE(excluded.media_rel_path, assets.media_rel_path),
           thumb_rel_path = COALESCE(excluded.thumb_rel_path, assets.thumb_rel_path),
           preview_rel_path = COALESCE(excluded.preview_rel_path, assets.preview_rel_path),
           remote_url = COALESCE(excluded.remote_url, assets.remote_url),
           byte_size = CASE WHEN excluded.byte_size > 0 THEN excluded.byte_size ELSE assets.byte_size END,
           project_id = COALESCE(excluded.project_id, assets.project_id),
           updated_at = COALESCE(excluded.updated_at, assets.updated_at)",
        params![
            hash,
            full_sha1,
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
    for field in fields
        .split(',')
        .map(str::trim)
        .filter(|field| !field.is_empty())
    {
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

#[cfg(test)]
fn binary_marker_bytes(value: Option<&Value>) -> Option<Vec<u8>> {
    let value = value?;
    if value.get("__qhType").and_then(Value::as_str) != Some("u8") {
        return None;
    }
    let encoded = value.get("base64").and_then(Value::as_str)?;
    base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .ok()
}

fn binary_marker_bytes_checked(
    value: Option<&Value>,
    field: &str,
) -> Result<Option<Vec<u8>>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    if value.get("__qhType").and_then(Value::as_str) != Some("u8") {
        return Err(format!("{field} must be a binary marker"));
    }
    let encoded = value
        .get("base64")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{field}.base64 must be a string"))?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|err| format!("decode {field}: {err}"))?;
    Ok(Some(bytes))
}

fn safe_hash(hash: &str) -> Result<(), String> {
    if hash.len() != 16 || !hash.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return Err(format!("unsafe asset hash: {hash}"));
    }
    Ok(())
}

fn safe_legacy_asset_id(id: &str) -> Result<(), String> {
    if id.len() < 2
        || id.len() > 128
        || !id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err(format!("unsafe legacy asset id: {id}"));
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
    let path = resolve_media_path(root, rel)?;
    if path.is_file() {
        let existing = fs::read(&path)
            .map_err(|err| format!("read existing media {}: {err}", path.display()))?;
        if existing == bytes {
            return Ok(());
        }
        return Err(format!(
            "content-addressed media collision: {}",
            path.display()
        ));
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
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|err| format!("create media temp: {err}"))?;
    file.write_all(bytes)
        .map_err(|err| format!("write media temp: {err}"))?;
    file.sync_all()
        .map_err(|err| format!("sync media temp: {err}"))?;
    drop(file);
    if let Err(error) = fs::rename(&temporary, &path) {
        let existing = fs::read(&path).ok();
        let _ = fs::remove_file(&temporary);
        if existing.as_deref() != Some(bytes) {
            return Err(format!("rename media: {error}"));
        }
    }
    Ok(())
}

fn file_len(root: &Path, rel: &str) -> u64 {
    resolve_media_path(root, rel)
        .ok()
        .and_then(|path| fs::metadata(path).ok())
        .map(|meta| meta.len())
        .unwrap_or(0)
}

fn resolve_media_path(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let relative = Path::new(rel);
    if relative.is_absolute() {
        return Err(format!("absolute media path rejected: {rel}"));
    }
    let mut safe = PathBuf::new();
    for component in relative.components() {
        match component {
            std::path::Component::Normal(value) => safe.push(value),
            std::path::Component::CurDir => {}
            _ => return Err(format!("unsafe media path rejected: {rel}")),
        }
    }
    if safe.components().next().and_then(|part| match part {
        std::path::Component::Normal(value) => value.to_str(),
        _ => None,
    }) != Some("media")
    {
        return Err(format!("media path must stay under media/: {rel}"));
    }
    Ok(root.join(safe))
}

fn content_sha1(bytes: &[u8]) -> String {
    sha1_hex(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{PageOrder, PageQuery, PageRange};

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

    fn hash_for(bytes: &[u8]) -> String {
        content_sha1(bytes)[..16].to_string()
    }

    fn binary(bytes: &[u8]) -> Value {
        json!({
            "__qhType": "u8",
            "base64": base64::engine::general_purpose::STANDARD.encode(bytes)
        })
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
            .query(
                "nodes",
                &Map::from_iter([("projectId".into(), json!("p1"))]),
                true,
                None,
            )
            .unwrap();
        assert_eq!(
            rows,
            vec![json!({"id":"n1","projectId":"p1","title":"A","x":1})]
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn query_page_filters_orders_and_has_stable_198_201_boundary() {
        let root = temp_root("page");
        let store = SqliteStore::open(&root).unwrap();
        for index in 1..=450 {
            store
                .put(
                    "runRecords",
                    &json!({
                        "id": format!("r{index:04}"),
                        "projectId": "p1",
                        "createdAt": index,
                        "scopeVersion": 1,
                        "workbench": "storyboard",
                        "status": "succeeded",
                        "action": "shot-image",
                        "subjectId": format!("shot-{}", index % 3),
                        "scopeId": "episode:1",
                        "operationId": format!("op-{index}")
                    }),
                )
                .unwrap();
        }
        let filter = Map::from_iter([
            ("projectId".into(), json!("p1")),
            ("workbench".into(), json!("storyboard")),
            ("action".into(), json!("shot-image")),
        ]);
        let page = PageQuery {
            ids: Vec::new(),
            missing_fields: Vec::new(),
            ranges: vec![PageRange {
                field: "createdAt".into(),
                from: Some(1),
                to: Some(450),
            }],
            order_by: Some(PageOrder {
                field: "createdAt".into(),
                direction: Some("desc".into()),
            }),
            offset: 198,
            limit: 3,
            include_payload: true,
            fields: None,
        };
        let (rows, total) = store.query_page("runRecords", &filter, &page).unwrap();
        assert_eq!(total, 450);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0]["createdAt"], json!(252));
        assert_eq!(rows[1]["createdAt"], json!(251));
        assert_eq!(rows[2]["createdAt"], json!(250));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn query_page_backfills_columns_from_old_v2_rows() {
        let root = temp_root("old-v2-page");
        fs::create_dir_all(&root).unwrap();
        {
            let conn = Connection::open(root.join("manifest.sqlite")).unwrap();
            conn.execute_batch(
                "CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                 INSERT INTO schema_meta (key, value) VALUES ('schema_version', '2');
                 CREATE TABLE rows (
                   table_name TEXT NOT NULL,
                   id TEXT NOT NULL,
                   project_id TEXT,
                   updated_at INTEGER,
                   payload_json TEXT NOT NULL,
                   PRIMARY KEY (table_name, id)
                 );
                 INSERT INTO rows (table_name, id, project_id, updated_at, payload_json)
                 VALUES (
                   'runRecords',
                   'old-1',
                   'p1',
                   10,
                   '{\"id\":\"old-1\",\"projectId\":\"p1\",\"createdAt\":10,\"scopeVersion\":1,\"workbench\":\"storyboard\",\"status\":\"succeeded\",\"action\":\"shot-image\",\"subjectId\":\"shot-1\",\"scopeId\":\"episode:1\",\"operationId\":\"op-1\"}'
                 );",
            )
            .unwrap();
        }
        let store = SqliteStore::open(&root).unwrap();
        let filter = Map::from_iter([
            ("projectId".into(), json!("p1")),
            ("workbench".into(), json!("storyboard")),
            ("action".into(), json!("shot-image")),
        ]);
        let page = PageQuery {
            ids: Vec::new(),
            missing_fields: Vec::new(),
            ranges: Vec::new(),
            order_by: Some(PageOrder {
                field: "createdAt".into(),
                direction: Some("desc".into()),
            }),
            offset: 0,
            limit: 200,
            include_payload: true,
            fields: None,
        };
        let (rows, total) = store.query_page("runRecords", &filter, &page).unwrap();
        assert_eq!(total, 1);
        assert_eq!(rows[0]["id"], json!("old-1"));
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
        let hash = hash_for(image);
        store
            .put(
                "assets",
                &json!({
                    "id":hash,
                    "projectId":"p1",
                    "mime":"image/png",
                    "width":10,
                    "height":20,
                    "bytes": binary(image)
                }),
            )
            .unwrap();
        assert_eq!(store.asset_bytes(&hash).unwrap().0, image);
        let projected = store
            .query(
                "assets",
                &Map::from_iter([("id".into(), json!(hash))]),
                false,
                None,
            )
            .unwrap();
        assert_eq!(projected[0].get("bytes"), None);
        assert_eq!(projected[0]["bytesLength"], json!(image.len()));
        let with_payload = store
            .query(
                "assets",
                &Map::from_iter([("id".into(), json!(hash))]),
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

    #[test]
    fn asset_hash_must_match_content_sha1_prefix() {
        let root = temp_root("asset-mismatch");
        let store = SqliteStore::open(&root).unwrap();
        let result = store.put(
            "assets",
            &json!({
                "id":"0000000000000000",
                "mime":"image/png",
                "bytes":binary(b"not that hash")
            }),
        );
        assert!(result.unwrap_err().contains("does not match content SHA-1"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn same_hash_cannot_replace_different_bytes() {
        let root = temp_root("asset-collision");
        let store = SqliteStore::open(&root).unwrap();
        let original = b"first payload";
        let hash = hash_for(original);
        store
            .put(
                "assets",
                &json!({"id":hash,"mime":"image/png","bytes":binary(original)}),
            )
            .unwrap();
        let result = store.put(
            "assets",
            &json!({"id":hash,"mime":"image/png","bytes":binary(b"second payload")}),
        );
        assert!(result.is_err());
        assert_eq!(store.asset_bytes(&hash).unwrap().0, original);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn asset_scan_page_uses_assets_table_and_preserves_total() {
        let root = temp_root("asset-page");
        let store = SqliteStore::open(&root).unwrap();
        let first = b"first";
        let second = b"second";
        for bytes in [first.as_slice(), second.as_slice()] {
            store
                .put(
                    "assets",
                    &json!({
                        "id":hash_for(bytes),
                        "mime":"image/png",
                        "bytes":binary(bytes)
                    }),
                )
                .unwrap();
        }
        let (page, total) = store.scan_page("assets", 0, 1, false).unwrap();
        assert_eq!(total, 2);
        assert_eq!(page.len(), 1);
        assert!(page[0].get("bytes").is_none());
        let (second_page, total) = store.scan_page("assets", 1, 1, true).unwrap();
        assert_eq!(total, 2);
        assert_eq!(second_page.len(), 1);
        assert!(binary_marker_bytes(second_page[0].get("bytes")).is_some());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn media_paths_cannot_escape_the_media_directory() {
        let root = temp_root("asset-path");
        let store = SqliteStore::open(&root).unwrap();
        let image = b"safe image";
        let hash = hash_for(image);
        store
            .put(
                "assets",
                &json!({"id":hash,"mime":"image/png","bytes":binary(image)}),
            )
            .unwrap();
        store
            .connection()
            .unwrap()
            .execute(
                "UPDATE assets SET preview_rel_path = ?1 WHERE hash = ?2",
                params!["../outside.webp", hash],
            )
            .unwrap();
        assert!(store.asset_preview(&hash).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn schema_v1_upgrade_adds_content_sha1_column() {
        let root = temp_root("schema-upgrade");
        fs::create_dir_all(&root).unwrap();
        let db = root.join("manifest.sqlite");
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch(
            "CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             INSERT INTO schema_meta (key, value) VALUES ('schema_version', '1');
             CREATE TABLE assets (
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
             );",
        )
        .unwrap();
        drop(conn);

        let store = SqliteStore::open(&root).unwrap();
        let version: String = store
            .connection()
            .unwrap()
            .query_row(
                "SELECT value FROM schema_meta WHERE key = 'schema_version'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION.to_string());
        let _ = fs::remove_dir_all(root);
    }
}
