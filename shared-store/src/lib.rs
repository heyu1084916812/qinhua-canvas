use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::thread;
use std::time::{Duration, Instant};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

mod hash;
pub mod migration;
pub mod sqlite;
pub mod v2_admin;

pub const PORT: u16 = 18765;

static STARTED: OnceLock<()> = OnceLock::new();
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(1);
static ACTIVE_BACKEND: OnceLock<Arc<RwLock<Arc<dyn StoreBackend>>>> = OnceLock::new();

#[derive(Clone)]
struct Store {
    root: Arc<PathBuf>,
    lock: Arc<Mutex<()>>,
    maintenance: Arc<AtomicBool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Usage {
    used: u64,
    quota: u64,
}

fn hex_id(value: &str) -> String {
    value
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn table_dir(root: &Path, table: &str) -> Result<PathBuf, String> {
    if !sqlite::TABLE_NAMES.contains(&table) {
        return Err(format!("unknown table: {table}"));
    }
    Ok(root.join(table))
}

fn row_path(root: &Path, table: &str, id: &str) -> Result<PathBuf, String> {
    Ok(table_dir(root, table)?.join(format!("{}.json", hex_id(id))))
}

fn meta_path(root: &Path, table: &str, id: &str) -> Result<PathBuf, String> {
    Ok(table_dir(root, table)?.join(format!("{}.meta.json", hex_id(id))))
}

fn is_row_file(path: &Path) -> bool {
    path.extension().is_some_and(|ext| ext == "json")
        && !path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.ends_with(".meta.json"))
}

fn thumb_path(root: &Path, id: &str) -> PathBuf {
    root.join("_thumbs").join(format!("{}.webp", hex_id(id)))
}

fn preview_path(root: &Path, id: &str) -> PathBuf {
    root.join("_previews").join(format!("{}.webp", hex_id(id)))
}

fn write_atomic(path: &Path, payload: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("create dir: {error}"))?;
    }
    let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let temporary = path.with_file_name(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("row"),
        sequence
    ));
    fs::write(&temporary, payload).map_err(|error| format!("write temp: {error}"))?;
    let deadline = Instant::now() + Duration::from_millis(750);
    loop {
        if path.exists() {
            match fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::PermissionDenied | std::io::ErrorKind::WouldBlock
                    ) && Instant::now() < deadline =>
                {
                    thread::sleep(Duration::from_millis(10));
                    continue;
                }
                Err(error) => {
                    let _ = fs::remove_file(&temporary);
                    return Err(format!("replace old file: {error}"));
                }
            }
        }
        match fs::rename(&temporary, path) {
            Ok(()) => return Ok(()),
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::PermissionDenied
                        | std::io::ErrorKind::AlreadyExists
                        | std::io::ErrorKind::WouldBlock
                ) && Instant::now() < deadline =>
            {
                thread::sleep(Duration::from_millis(10));
            }
            Err(error) => {
                let _ = fs::remove_file(&temporary);
                return Err(format!("rename temp: {error}"));
            }
        }
    }
}

fn read_json(path: &Path) -> Result<Value, String> {
    let deadline = Instant::now() + Duration::from_millis(500);
    loop {
        match fs::read_to_string(path) {
            Ok(raw) => match serde_json::from_str(&raw) {
                Ok(value) => return Ok(value),
                Err(_error) if Instant::now() < deadline => {
                    thread::sleep(Duration::from_millis(10));
                }
                Err(error) => {
                    return Err(format!("parse {}: {error}", path.display()));
                }
            },
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::NotFound | std::io::ErrorKind::PermissionDenied
                ) && Instant::now() < deadline =>
            {
                /*
                 * Windows 不能原子覆盖已存在文件，`write_atomic` 会先删旧文件再
                 * rename 新文件。读线程可能正好落在这两个动作之间；短暂重试
                 * 等写完，而不是把一次正常写入暴露成页面未捕获异常。
                 */
                thread::sleep(Duration::from_millis(10));
            }
            Err(error) => return Err(format!("read {}: {error}", path.display())),
        }
    }
}

fn write_row(root: &Path, table: &str, row: &Value) -> Result<(), String> {
    let id = row
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "row.id must be a string".to_string())?;
    let payload = serde_json::to_vec(row).map_err(|error| format!("serialize row: {error}"))?;
    write_atomic(&row_path(root, table, id)?, &payload)?;
    write_sidecars(root, table, row)
}

fn delete_row(root: &Path, table: &str, id: &str) -> Result<(), String> {
    let path = row_path(root, table, id)?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| format!("delete row: {error}"))?;
    }
    remove_sidecars(root, table, id)
}

fn list_rows(root: &Path, table: &str) -> Result<Vec<Value>, String> {
    let dir = table_dir(root, table)?;
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut files = fs::read_dir(&dir)
        .map_err(|error| format!("read table dir: {error}"))?
        .filter_map(Result::ok)
        .filter(|entry| is_row_file(&entry.path()))
        .collect::<Vec<_>>();
    files.sort_by_key(|entry| entry.file_name());
    let mut rows = Vec::with_capacity(files.len());
    for file in files {
        rows.push(read_json(&file.path())?);
    }
    Ok(rows)
}

fn row_files(root: &Path, table: &str) -> Result<Vec<PathBuf>, String> {
    let dir = table_dir(root, table)?;
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut files = fs::read_dir(&dir)
        .map_err(|error| format!("read table dir: {error}"))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| is_row_file(path))
        .collect::<Vec<_>>();
    files.sort();
    Ok(files)
}

fn strip_payload(row: &mut Value) {
    let Value::Object(fields) = row else {
        return;
    };
    for name in ["bytes", "thumb", "thumbnail", "preview", "data"] {
        let Some(value) = fields.get(name) else {
            continue;
        };
        /*
         * `data` 在 nodes / storyboards 等表里是正常业务对象，只有 assets 的
         * bytes/thumb 这类字段才是 `{ "__qhType": "u8", base64 }` 二进制标记。
         * 不能按字段名盲删，否则节点 data 会在列表投影里整体消失。
         */
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

fn binary_marker_bytes(value: &Value) -> Option<Vec<u8>> {
    if value.get("__qhType").and_then(Value::as_str) != Some("u8") {
        return None;
    }
    base64::engine::general_purpose::STANDARD
        .decode(value.get("base64").and_then(Value::as_str)?)
        .ok()
}

fn write_sidecars(root: &Path, table: &str, row: &Value) -> Result<(), String> {
    if table != "assets" {
        return Ok(());
    }
    let id = row
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "asset row id missing".to_string())?;
    let mut metadata = row.clone();
    strip_payload(&mut metadata);
    write_atomic(
        &meta_path(root, table, id)?,
        &serde_json::to_vec(&metadata).map_err(|error| error.to_string())?,
    )?;
    if let Some(thumb) = row
        .get("thumb")
        .or_else(|| row.get("thumbnail"))
        .and_then(binary_marker_bytes)
    {
        write_atomic(&thumb_path(root, id), &thumb)?;
    }
    if let Some(preview) = row.get("preview").and_then(binary_marker_bytes) {
        write_atomic(&preview_path(root, id), &preview)?;
    }
    Ok(())
}

fn remove_sidecars(root: &Path, table: &str, id: &str) -> Result<(), String> {
    if table == "assets" {
        for path in [
            meta_path(root, table, id)?,
            thumb_path(root, id),
            preview_path(root, id),
        ] {
            if path.exists() {
                fs::remove_file(path).map_err(|error| format!("remove sidecar: {error}"))?;
            }
        }
    }
    Ok(())
}

fn project_fields(row: &mut Value, fields: Option<&str>) {
    let Some(fields) = fields else {
        return;
    };
    let keep = fields
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect::<std::collections::HashSet<_>>();
    if let Value::Object(values) = row {
        values.retain(|key, _| keep.contains(key.as_str()));
    }
}

fn row_matches(row: &Value, filter: &Map<String, Value>) -> bool {
    filter
        .iter()
        .all(|(key, expected)| row.get(key).is_some_and(|actual| actual == expected))
}

fn page_row_matches(row: &Value, filter: &Map<String, Value>, page: &PageQuery) -> bool {
    if !row_matches(row, filter) {
        return false;
    }
    if !page.ids.is_empty()
        && !row
            .get("id")
            .and_then(Value::as_str)
            .is_some_and(|id| page.ids.iter().any(|candidate| candidate == id))
    {
        return false;
    }
    if page
        .missing_fields
        .iter()
        .any(|field| row.get(field).is_some())
    {
        return false;
    }
    page.ranges.iter().all(|range| {
        row.get(&range.field)
            .and_then(Value::as_i64)
            .is_some_and(|value| {
                range.from.is_none_or(|from| value >= from)
                    && range.to.is_none_or(|to| value <= to)
            })
    })
}

fn compare_page_values(left: Option<&Value>, right: Option<&Value>) -> std::cmp::Ordering {
    match (left.and_then(Value::as_i64), right.and_then(Value::as_i64)) {
        (Some(a), Some(b)) => a.cmp(&b),
        _ => left
            .map(Value::to_string)
            .unwrap_or_default()
            .cmp(&right.map(Value::to_string).unwrap_or_default()),
    }
}

fn query_rows(root: &Path, table: &str, filter: &Map<String, Value>) -> Result<Vec<Value>, String> {
    if let Some(Value::String(id)) = filter.get("id") {
        if filter.len() == 1 {
            let path = row_path(root, table, id)?;
            if path.exists() {
                return Ok(vec![read_json(&path)?]);
            }
            return Ok(Vec::new());
        }
    }
    Ok(list_rows(root, table)?
        .into_iter()
        .filter(|row| row_matches(row, filter))
        .collect())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PutRequest {
    table: String,
    row: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BulkPutRequest {
    table: String,
    rows: Vec<Value>,
}

#[derive(Deserialize)]
struct DeleteRequest {
    table: String,
    id: String,
}

#[derive(Deserialize)]
struct QueryRequest {
    table: String,
    filter: Map<String, Value>,
    #[serde(default = "default_true", rename = "includePayload")]
    include_payload: bool,
    fields: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageRange {
    pub field: String,
    pub from: Option<i64>,
    pub to: Option<i64>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageOrder {
    pub field: String,
    pub direction: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageQuery {
    #[serde(default)]
    pub ids: Vec<String>,
    #[serde(default)]
    pub missing_fields: Vec<String>,
    #[serde(default)]
    pub ranges: Vec<PageRange>,
    pub order_by: Option<PageOrder>,
    #[serde(default)]
    pub offset: usize,
    #[serde(default = "default_page_limit")]
    pub limit: usize,
    #[serde(default = "default_true")]
    pub include_payload: bool,
    pub fields: Option<String>,
}

fn default_page_limit() -> usize {
    200
}

#[derive(Deserialize)]
struct QueryPageRequest {
    table: String,
    filter: Map<String, Value>,
    #[serde(flatten)]
    page: PageQuery,
}

fn default_true() -> bool {
    true
}

#[derive(Deserialize)]
struct TxRequest {
    ops: Vec<TxOp>,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum TxOp {
    Put { table: String, row: Value },
    BulkPut { table: String, rows: Vec<Value> },
    Delete { table: String, id: String },
}

fn apply_tx(root: &Path, request: TxRequest) -> Result<(), String> {
    let mut snapshots: Vec<(PathBuf, Option<Vec<u8>>)> = Vec::new();
    let mut touched: Vec<PathBuf> = Vec::new();

    let mut add_snapshot = |path: PathBuf| -> Result<(), String> {
        if touched.contains(&path) {
            return Ok(());
        }
        let old = if path.exists() {
            Some(fs::read(&path).map_err(|error| format!("snapshot row: {error}"))?)
        } else {
            None
        };
        snapshots.push((path.clone(), old));
        touched.push(path);
        Ok(())
    };

    let result = (|| -> Result<(), String> {
        for op in request.ops {
            match op {
                TxOp::Put { table, row } => {
                    let id = row
                        .get("id")
                        .and_then(Value::as_str)
                        .ok_or_else(|| "row.id missing".to_string())?;
                    add_snapshot(row_path(root, &table, id)?)?;
                    write_row(root, &table, &row)?;
                }
                TxOp::BulkPut { table, rows } => {
                    for row in rows {
                        let id = row
                            .get("id")
                            .and_then(Value::as_str)
                            .ok_or_else(|| "row.id missing".to_string())?;
                        add_snapshot(row_path(root, &table, id)?)?;
                        write_row(root, &table, &row)?;
                    }
                }
                TxOp::Delete { table, id } => {
                    add_snapshot(row_path(root, &table, &id)?)?;
                    delete_row(root, &table, &id)?;
                }
            }
        }
        Ok(())
    })();

    if let Err(error) = result {
        for (path, old) in snapshots.into_iter().rev() {
            if let Some(bytes) = old {
                let _ = write_atomic(&path, &bytes);
            } else if path.exists() {
                let _ = fs::remove_file(path);
            }
        }
        return Err(error);
    }
    Ok(())
}

fn usage(root: &Path) -> Usage {
    fn sum(path: &Path) -> u64 {
        let Ok(entries) = fs::read_dir(path) else {
            return 0;
        };
        entries
            .filter_map(Result::ok)
            .map(|entry| {
                let path = entry.path();
                if path.is_dir() {
                    sum(&path)
                } else {
                    entry.metadata().map(|meta| meta.len()).unwrap_or(0)
                }
            })
            .sum()
    }
    Usage {
        used: sum(root),
        quota: 0,
    }
}

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("valid header")
}

fn origin_allowed(origin: &str) -> bool {
    matches!(
        origin,
        "http://127.0.0.1:1420"
            | "http://localhost:1420"
            | "http://tauri.localhost"
            | "https://tauri.localhost"
    )
}

fn respond_json(
    request: Request,
    status: StatusCode,
    value: Value,
    origin: Option<&str>,
) -> Result<(), String> {
    let body =
        serde_json::to_string(&value).map_err(|error| format!("serialize response: {error}"))?;
    let mut response = Response::from_string(body)
        .with_status_code(status)
        .with_header(header("content-type", "application/json; charset=utf-8"))
        .with_header(header("cache-control", "no-store"))
        .with_header(header("access-control-allow-methods", "GET,POST,OPTIONS"))
        .with_header(header("access-control-allow-headers", "content-type"));
    if let Some(origin) = origin.filter(|origin| origin_allowed(origin)) {
        response = response.with_header(header("access-control-allow-origin", origin));
    }
    request
        .respond(response)
        .map_err(|error| format!("respond: {error}"))
}

fn respond_bytes(
    request: Request,
    status: StatusCode,
    body: Vec<u8>,
    content_type: &str,
    origin: Option<&str>,
) -> Result<(), String> {
    let mut response = Response::from_data(body)
        .with_status_code(status)
        .with_header(header("content-type", content_type))
        .with_header(header(
            "cache-control",
            "public, max-age=31536000, immutable",
        ));
    if let Some(origin) = origin.filter(|origin| origin_allowed(origin)) {
        response = response.with_header(header("access-control-allow-origin", origin));
    }
    request
        .respond(response)
        .map_err(|error| format!("respond: {error}"))
}

fn load_thumb(root: &Path, id: &str) -> Result<Vec<u8>, String> {
    let sidecar = thumb_path(root, id);
    if sidecar.exists() {
        return fs::read(sidecar).map_err(|error| format!("read thumb: {error}"));
    }
    let row = read_json(&row_path(root, "assets", id)?)?;
    let bytes = row
        .get("thumb")
        .or_else(|| row.get("thumbnail"))
        .and_then(binary_marker_bytes)
        .ok_or_else(|| "asset has no thumb".to_string())?;
    write_atomic(&sidecar, &bytes)?;
    Ok(bytes)
}

fn load_preview(root: &Path, id: &str) -> Result<Vec<u8>, String> {
    let sidecar = preview_path(root, id);
    if sidecar.exists() {
        return fs::read(sidecar).map_err(|error| format!("read preview: {error}"));
    }
    let row = read_json(&row_path(root, "assets", id)?)?;
    let bytes = row
        .get("preview")
        .and_then(binary_marker_bytes)
        .ok_or_else(|| "asset has no preview".to_string())?;
    write_atomic(&sidecar, &bytes)?;
    Ok(bytes)
}

fn load_asset(root: &Path, id: &str) -> Result<(Vec<u8>, String), String> {
    let row = read_json(&row_path(root, "assets", id)?)?;
    let mime = row
        .get("mime")
        .and_then(Value::as_str)
        .unwrap_or("application/octet-stream")
        .to_string();
    let bytes = row
        .get("bytes")
        .and_then(binary_marker_bytes)
        .ok_or_else(|| "asset has no local bytes".to_string())?;
    Ok((bytes, mime))
}

trait StoreBackend: Send + Sync {
    fn kind(&self) -> &'static str;
    fn root(&self) -> &Path;
    fn put(&self, table: &str, row: &Value) -> Result<(), String>;
    fn bulk_put(&self, table: &str, rows: &[Value]) -> Result<(), String>;
    fn delete(&self, table: &str, id: &str) -> Result<(), String>;
    fn transaction(&self, ops: Vec<TxOp>) -> Result<(), String>;
    fn query(
        &self,
        table: &str,
        filter: &Map<String, Value>,
        include_payload: bool,
        fields: Option<&str>,
    ) -> Result<Vec<Value>, String>;
    fn query_page(
        &self,
        table: &str,
        filter: &Map<String, Value>,
        page: &PageQuery,
    ) -> Result<(Vec<Value>, u64), String>;
    fn scan_page(
        &self,
        table: &str,
        offset: usize,
        limit: usize,
        include_payload: bool,
    ) -> Result<(Vec<Value>, u64), String>;
    fn usage(&self) -> u64;
    fn kv_get(&self, key: &str) -> Result<Value, String>;
    fn kv_put(&self, key: &str, value: &Value) -> Result<(), String>;
    fn kv_delete(&self, key: &str) -> Result<(), String>;
    fn asset_bytes(&self, id: &str) -> Result<(Vec<u8>, String), String>;
    fn asset_thumb(&self, id: &str) -> Result<Vec<u8>, String>;
    fn asset_preview(&self, id: &str) -> Result<Vec<u8>, String>;
    fn set_maintenance(&self, enabled: bool);
    fn in_maintenance(&self) -> bool;
}

impl Store {
    fn ensure_writes_allowed(&self) -> Result<(), String> {
        if self.maintenance.load(Ordering::SeqCst) {
            Err("storage is in maintenance mode".into())
        } else {
            Ok(())
        }
    }
}

impl StoreBackend for Store {
    fn kind(&self) -> &'static str {
        "json-v1"
    }

    fn root(&self) -> &Path {
        self.root.as_path()
    }

    fn put(&self, table: &str, row: &Value) -> Result<(), String> {
        let _guard = self.lock.lock().expect("store lock poisoned");
        self.ensure_writes_allowed()?;
        write_row(self.root.as_path(), table, row)
    }

    fn bulk_put(&self, table: &str, rows: &[Value]) -> Result<(), String> {
        let _guard = self.lock.lock().expect("store lock poisoned");
        self.ensure_writes_allowed()?;
        for row in rows {
            write_row(self.root.as_path(), table, row)?;
        }
        Ok(())
    }

    fn delete(&self, table: &str, id: &str) -> Result<(), String> {
        let _guard = self.lock.lock().expect("store lock poisoned");
        self.ensure_writes_allowed()?;
        delete_row(self.root.as_path(), table, id)
    }

    fn transaction(&self, ops: Vec<TxOp>) -> Result<(), String> {
        let _guard = self.lock.lock().expect("store lock poisoned");
        self.ensure_writes_allowed()?;
        apply_tx(self.root.as_path(), TxRequest { ops })
    }

    fn query(
        &self,
        table: &str,
        filter: &Map<String, Value>,
        include_payload: bool,
        fields: Option<&str>,
    ) -> Result<Vec<Value>, String> {
        let root = self.root.as_path();
        let _guard = self.lock.lock().expect("store lock poisoned");
        let mut rows = if !include_payload
            && table == "assets"
            && filter.len() == 1
            && filter.get("id").and_then(Value::as_str).is_some()
        {
            let id = filter.get("id").and_then(Value::as_str).unwrap();
            let metadata_file = meta_path(root, table, id)?;
            if metadata_file.exists() {
                vec![read_json(&metadata_file)?]
            } else {
                let full = read_json(&row_path(root, table, id)?)?;
                write_sidecars(root, table, &full)?;
                let mut metadata = full;
                strip_payload(&mut metadata);
                vec![metadata]
            }
        } else {
            query_rows(root, table, filter)?
        };
        for row in &mut rows {
            if !include_payload {
                strip_payload(row);
            }
            project_fields(row, fields);
        }
        Ok(rows)
    }

    fn query_page(
        &self,
        table: &str,
        filter: &Map<String, Value>,
        page: &PageQuery,
    ) -> Result<(Vec<Value>, u64), String> {
        let root = self.root.as_path();
        let _guard = self.lock.lock().expect("store lock poisoned");
        let mut rows = list_rows(root, table)?
            .into_iter()
            .filter(|row| page_row_matches(row, filter, page))
            .collect::<Vec<_>>();
        if let Some(order) = &page.order_by {
            rows.sort_by(|left, right| {
                let mut compared = compare_page_values(
                    left.get(&order.field),
                    right.get(&order.field),
                );
                if order.direction.as_deref() == Some("desc") {
                    compared = compared.reverse();
                }
                compared.then_with(|| {
                    left.get("id")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .cmp(
                            right
                                .get("id")
                                .and_then(Value::as_str)
                                .unwrap_or_default(),
                        )
                })
            });
        }
        let total = rows.len() as u64;
        let mut paged = rows
            .into_iter()
            .skip(page.offset)
            .take(page.limit)
            .collect::<Vec<_>>();
        for row in &mut paged {
            if !page.include_payload {
                strip_payload(row);
            }
            project_fields(row, page.fields.as_deref());
        }
        Ok((paged, total))
    }

    fn scan_page(
        &self,
        table: &str,
        offset: usize,
        limit: usize,
        include_payload: bool,
    ) -> Result<(Vec<Value>, u64), String> {
        let root = self.root.as_path();
        let _guard = self.lock.lock().expect("store lock poisoned");
        let files = row_files(root, table)?;
        let total = files.len() as u64;
        let page = files
            .into_iter()
            .skip(offset)
            .take(limit)
            .map(|file| {
                if include_payload {
                    return read_json(&file);
                }
                let metadata_file = file.with_extension("meta.json");
                if metadata_file.exists() {
                    return read_json(&metadata_file);
                }
                let row = read_json(&file)?;
                write_sidecars(root, table, &row)?;
                let mut metadata = row;
                strip_payload(&mut metadata);
                Ok(metadata)
            })
            .collect::<Result<Vec<_>, String>>()?;
        Ok((page, total))
    }

    fn usage(&self) -> u64 {
        let _guard = self.lock.lock().expect("store lock poisoned");
        usage(self.root.as_path()).used
    }

    fn kv_get(&self, key: &str) -> Result<Value, String> {
        let path = self.root.join("_kv").join(format!("{}.json", hex_id(key)));
        if path.exists() {
            read_json(&path)
        } else {
            Ok(Value::Null)
        }
    }

    fn kv_put(&self, key: &str, value: &Value) -> Result<(), String> {
        let _guard = self.lock.lock().expect("store lock poisoned");
        self.ensure_writes_allowed()?;
        let path = self.root.join("_kv").join(format!("{}.json", hex_id(key)));
        let payload = serde_json::to_vec(value).map_err(|error| format!("encode kv: {error}"))?;
        write_atomic(&path, &payload)
    }

    fn kv_delete(&self, key: &str) -> Result<(), String> {
        let _guard = self.lock.lock().expect("store lock poisoned");
        self.ensure_writes_allowed()?;
        let path = self.root.join("_kv").join(format!("{}.json", hex_id(key)));
        if path.exists() {
            fs::remove_file(path).map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    fn asset_bytes(&self, id: &str) -> Result<(Vec<u8>, String), String> {
        let _guard = self.lock.lock().expect("store lock poisoned");
        load_asset(self.root.as_path(), id)
    }

    fn asset_thumb(&self, id: &str) -> Result<Vec<u8>, String> {
        let _guard = self.lock.lock().expect("store lock poisoned");
        load_thumb(self.root.as_path(), id)
    }

    fn asset_preview(&self, id: &str) -> Result<Vec<u8>, String> {
        let _guard = self.lock.lock().expect("store lock poisoned");
        load_preview(self.root.as_path(), id)
    }

    fn set_maintenance(&self, enabled: bool) {
        let _guard = self.lock.lock().expect("store lock poisoned");
        self.maintenance.store(enabled, Ordering::SeqCst);
    }

    fn in_maintenance(&self) -> bool {
        self.maintenance.load(Ordering::SeqCst)
    }
}

impl StoreBackend for sqlite::SqliteStore {
    fn kind(&self) -> &'static str {
        "sqlite-v2"
    }

    fn root(&self) -> &Path {
        self.root_path()
    }

    fn put(&self, table: &str, row: &Value) -> Result<(), String> {
        sqlite::SqliteStore::put(self, table, row)
    }

    fn bulk_put(&self, table: &str, rows: &[Value]) -> Result<(), String> {
        sqlite::SqliteStore::bulk_put(self, table, rows)
    }

    fn delete(&self, table: &str, id: &str) -> Result<(), String> {
        sqlite::SqliteStore::delete(self, table, id)
    }

    fn transaction(&self, ops: Vec<TxOp>) -> Result<(), String> {
        let ops = ops
            .into_iter()
            .map(|op| match op {
                TxOp::Put { table, row } => sqlite::SqliteOp::Put { table, row },
                TxOp::BulkPut { table, rows } => sqlite::SqliteOp::BulkPut { table, rows },
                TxOp::Delete { table, id } => sqlite::SqliteOp::Delete { table, id },
            })
            .collect::<Vec<_>>();
        sqlite::SqliteStore::transaction(self, &ops)
    }

    fn query(
        &self,
        table: &str,
        filter: &Map<String, Value>,
        include_payload: bool,
        fields: Option<&str>,
    ) -> Result<Vec<Value>, String> {
        sqlite::SqliteStore::query(self, table, filter, include_payload, fields)
    }

    fn query_page(
        &self,
        table: &str,
        filter: &Map<String, Value>,
        page: &PageQuery,
    ) -> Result<(Vec<Value>, u64), String> {
        sqlite::SqliteStore::query_page(self, table, filter, page)
    }

    fn scan_page(
        &self,
        table: &str,
        offset: usize,
        limit: usize,
        include_payload: bool,
    ) -> Result<(Vec<Value>, u64), String> {
        sqlite::SqliteStore::scan_page(self, table, offset, limit, include_payload)
    }

    fn usage(&self) -> u64 {
        sqlite::SqliteStore::usage(self)
    }

    fn kv_get(&self, key: &str) -> Result<Value, String> {
        sqlite::SqliteStore::kv_get(self, key)
    }

    fn kv_put(&self, key: &str, value: &Value) -> Result<(), String> {
        sqlite::SqliteStore::kv_put(self, key, value)
    }

    fn kv_delete(&self, key: &str) -> Result<(), String> {
        sqlite::SqliteStore::kv_delete(self, key)
    }

    fn asset_bytes(&self, id: &str) -> Result<(Vec<u8>, String), String> {
        sqlite::SqliteStore::asset_bytes(self, id)
    }

    fn asset_thumb(&self, id: &str) -> Result<Vec<u8>, String> {
        sqlite::SqliteStore::asset_thumb(self, id)
    }

    fn asset_preview(&self, id: &str) -> Result<Vec<u8>, String> {
        sqlite::SqliteStore::asset_preview(self, id)
    }

    fn set_maintenance(&self, enabled: bool) {
        sqlite::SqliteStore::set_maintenance(self, enabled);
    }

    fn in_maintenance(&self) -> bool {
        sqlite::SqliteStore::in_maintenance(self)
    }
}

fn select_backend(data_dir: &Path) -> Result<Arc<dyn StoreBackend>, String> {
    let requested = std::env::var("QINGHUA_STORE_BACKEND")
        .unwrap_or_else(|_| "json-v1".to_string())
        .trim()
        .to_ascii_lowercase();
    match requested.as_str() {
        "" | "json" | "json-v1" | "v1" => Ok(Arc::new(Store {
            root: Arc::new(data_dir.to_path_buf()),
            lock: Arc::new(Mutex::new(())),
            maintenance: Arc::new(AtomicBool::new(false)),
        })),
        "sqlite" | "sqlite-v2" | "v2" => Ok(Arc::new(sqlite::SqliteStore::open(data_dir)?)),
        other => Err(format!(
            "unsupported QINGHUA_STORE_BACKEND={other}; expected v1 or v2"
        )),
    }
}

fn open_backend(data_dir: &Path, requested: &str) -> Result<Arc<dyn StoreBackend>, String> {
    match requested.trim().to_ascii_lowercase().as_str() {
        "json" | "json-v1" | "v1" => Ok(Arc::new(Store {
            root: Arc::new(data_dir.to_path_buf()),
            lock: Arc::new(Mutex::new(())),
            maintenance: Arc::new(AtomicBool::new(false)),
        })),
        "sqlite" | "sqlite-v2" | "v2" => Ok(Arc::new(sqlite::SqliteStore::open(data_dir)?)),
        other => Err(format!("unsupported storage backend: {other}")),
    }
}

pub fn switch_backend(data_dir: &Path, backend: &str) -> Result<(), String> {
    let next = open_backend(data_dir, backend)?;
    let active = ACTIVE_BACKEND
        .get()
        .ok_or_else(|| "shared-store has not started".to_string())?;
    let mut guard = active
        .write()
        .map_err(|_| "shared-store backend lock poisoned".to_string())?;
    *guard = next;
    Ok(())
}

fn body_json<T: for<'de> Deserialize<'de>>(request: &mut Request) -> Result<T, String> {
    let mut raw = Vec::new();
    request
        .as_reader()
        .read_to_end(&mut raw)
        .map_err(|error| format!("read body: {error}"))?;
    serde_json::from_slice(&raw).map_err(|error| format!("parse body: {error}"))
}

fn handle(backends: Arc<RwLock<Arc<dyn StoreBackend>>>, mut request: Request) {
    let origin = request
        .headers()
        .iter()
        .find(|item| item.field.equiv("origin"))
        .map(|item| item.value.as_str().to_string());
    let path = request.url().to_string();
    if request.method() == &Method::Options {
        let _ = request.respond(
            Response::empty(StatusCode(204))
                .with_header(header("access-control-allow-methods", "GET,POST,OPTIONS"))
                .with_header(header("access-control-allow-headers", "content-type"))
                .with_header(header(
                    "access-control-allow-origin",
                    origin
                        .as_deref()
                        .filter(|value| origin_allowed(value))
                        .unwrap_or("null"),
                )),
        );
        return;
    }
    let store = backends
        .read()
        .expect("shared-store backend lock poisoned")
        .clone();

    if request.method() == &Method::Get && path.starts_with("/asset/") {
        let id = path.trim_start_matches("/asset/");
        match store.asset_bytes(id) {
            Ok((bytes, mime)) => {
                let _ = respond_bytes(request, StatusCode(200), bytes, &mime, origin.as_deref());
            }
            Err(error) => {
                let _ = respond_json(
                    request,
                    StatusCode(404),
                    json!({ "ok": false, "error": error }),
                    origin.as_deref(),
                );
            }
        }
        return;
    }
    if request.method() == &Method::Get && path.starts_with("/thumb/") {
        let id = path.trim_start_matches("/thumb/");
        match store.asset_thumb(id) {
            Ok(bytes) => {
                let _ = respond_bytes(
                    request,
                    StatusCode(200),
                    bytes,
                    "image/webp",
                    origin.as_deref(),
                );
            }
            Err(error) => {
                let _ = respond_json(
                    request,
                    StatusCode(404),
                    json!({ "ok": false, "error": error }),
                    origin.as_deref(),
                );
            }
        }
        return;
    }
    if request.method() == &Method::Get && path.starts_with("/preview/") {
        let id = path.trim_start_matches("/preview/");
        match store.asset_preview(id) {
            Ok(bytes) => {
                let _ = respond_bytes(
                    request,
                    StatusCode(200),
                    bytes,
                    "image/webp",
                    origin.as_deref(),
                );
            }
            Err(error) => {
                let _ = respond_json(
                    request,
                    StatusCode(404),
                    json!({ "ok": false, "error": error }),
                    origin.as_deref(),
                );
            }
        }
        return;
    }
    let result = (|| -> Result<Value, String> {
        if request.method() == &Method::Get && path == "/health" {
            return Ok(json!({
                "ok": true,
                "service": "qinghua-shared-store",
                "version": 6,
                "backend": store.kind(),
                "maintenance": store.in_maintenance(),
                "dataDir": store.root().to_string_lossy(),
            }));
        }
        if request.method() == &Method::Post
            && matches!(path.as_str(), "/maintenance/begin" | "/maintenance/end")
        {
            let enabled = path == "/maintenance/begin";
            store.set_maintenance(enabled);
            return Ok(json!({ "ok": true, "maintenance": enabled }));
        }
        if request.method() == &Method::Post && path == "/put" {
            let body: PutRequest = body_json(&mut request)?;
            store.put(&body.table, &body.row)?;
            return Ok(json!({ "ok": true }));
        }
        if request.method() == &Method::Post && path == "/bulkPut" {
            let body: BulkPutRequest = body_json(&mut request)?;
            store.bulk_put(&body.table, &body.rows)?;
            return Ok(json!({ "ok": true, "count": body.rows.len() }));
        }
        if request.method() == &Method::Post && path == "/delete" {
            let body: DeleteRequest = body_json(&mut request)?;
            store.delete(&body.table, &body.id)?;
            return Ok(json!({ "ok": true }));
        }
        if request.method() == &Method::Post && path == "/query" {
            let body: QueryRequest = body_json(&mut request)?;
            let rows = store.query(
                &body.table,
                &body.filter,
                body.include_payload,
                body.fields.as_deref(),
            )?;
            return Ok(json!({ "rows": rows }));
        }
        if request.method() == &Method::Post && path == "/queryPage" {
            let body: QueryPageRequest = body_json(&mut request)?;
            let (rows, total) =
                store.query_page(&body.table, &body.filter, &body.page)?;
            return Ok(json!({ "rows": rows, "total": total }));
        }
        if request.method() == &Method::Get && path.starts_with("/rows") {
            let url = url::Url::parse(&format!("http://127.0.0.1{path}"))
                .map_err(|error| format!("parse url: {error}"))?;
            let table = url
                .query_pairs()
                .find(|(key, _)| key == "table")
                .map(|(_, value)| value.to_string())
                .ok_or_else(|| "table query is required".to_string())?;
            let offset = url
                .query_pairs()
                .find(|(key, _)| key == "offset")
                .and_then(|(_, value)| value.parse::<usize>().ok())
                .unwrap_or(0);
            let limit = url
                .query_pairs()
                .find(|(key, _)| key == "limit")
                .and_then(|(_, value)| value.parse::<usize>().ok())
                .unwrap_or(100)
                .min(1000);
            let include_payload = url
                .query_pairs()
                .find(|(key, _)| key == "includePayload")
                .map(|(_, value)| value == "1")
                .unwrap_or(true);
            let (page, total) = store.scan_page(&table, offset, limit, include_payload)?;
            return Ok(json!({ "rows": page, "total": total }));
        }
        if request.method() == &Method::Post && path == "/tx" {
            let body: TxRequest = body_json(&mut request)?;
            store.transaction(body.ops)?;
            return Ok(json!({ "ok": true }));
        }
        if request.method() == &Method::Get && path == "/usage" {
            return Ok(json!({ "used": store.usage(), "quota": 0 }));
        }
        if request.method() == &Method::Post && path == "/kv/put" {
            let body: Map<String, Value> = body_json(&mut request)?;
            let key = body
                .get("key")
                .and_then(Value::as_str)
                .ok_or("key missing")?;
            let value = body.get("value").cloned().unwrap_or(Value::Null);
            store.kv_put(key, &value)?;
            return Ok(json!({ "ok": true }));
        }
        if request.method() == &Method::Post && path == "/kv/get" {
            let body: Map<String, Value> = body_json(&mut request)?;
            let key = body
                .get("key")
                .and_then(Value::as_str)
                .ok_or("key missing")?;
            let value = store.kv_get(key)?;
            return Ok(json!({ "value": value }));
        }
        if request.method() == &Method::Post && path == "/kv/delete" {
            let body: Map<String, Value> = body_json(&mut request)?;
            let key = body
                .get("key")
                .and_then(Value::as_str)
                .ok_or("key missing")?;
            store.kv_delete(key)?;
            return Ok(json!({ "ok": true }));
        }
        Err(format!("unknown route: {} {path}", request.method()))
    })();

    match result {
        Ok(value) => {
            let _ = respond_json(request, StatusCode(200), value, origin.as_deref());
        }
        Err(error) => {
            let _ = respond_json(
                request,
                StatusCode(400),
                json!({ "ok": false, "error": error }),
                origin.as_deref(),
            );
        }
    }
}

pub fn default_data_dir() -> PathBuf {
    if let Ok(custom) = std::env::var("QINGHUA_DATA_DIR") {
        let custom = custom.trim();
        if !custom.is_empty() {
            return PathBuf::from(custom);
        }
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        return PathBuf::from(local)
            .join("com.qinghua.canvas")
            .join("shared-store-v1");
    }
    PathBuf::from("qinghua-shared-store-v1")
}

pub fn start(data_dir: &Path, port: u16) -> Result<(), String> {
    fs::create_dir_all(data_dir).map_err(|error| format!("create data dir: {error}"))?;
    let server = Arc::new(
        Server::http(("127.0.0.1", port))
            .map_err(|error| format!("start shared store on {port}: {error}"))?,
    );
    let backend = select_backend(data_dir)?;
    eprintln!(
        "[shared-store] backend={} data={}",
        backend.kind(),
        backend.root().display()
    );
    let store = Arc::new(RwLock::new(backend));
    ACTIVE_BACKEND
        .set(Arc::clone(&store))
        .map_err(|_| "shared-store already started".to_string())?;
    for _ in 0..4 {
        let server = Arc::clone(&server);
        let store = Arc::clone(&store);
        thread::spawn(move || {
            while let Ok(request) = server.recv() {
                handle(store.clone(), request);
            }
        });
    }
    Ok(())
}

pub fn start_in_background() {
    let _ = STARTED.get_or_init(|| {
        let data_dir = default_data_dir();
        match start(&data_dir, PORT) {
            Ok(()) => eprintln!(
                "[shared-store] http://127.0.0.1:{PORT} {}",
                data_dir.display()
            ),
            Err(error) => eprintln!("[shared-store] {error}"),
        }
    });
}

pub fn block_forever() {
    loop {
        thread::sleep(Duration::from_secs(3600));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "qinghua-shared-store-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn exercise_backend_contract(backend: Arc<dyn StoreBackend>) {
        backend
            .put("projects", &json!({"id":"p1","name":"first","updatedAt":1}))
            .unwrap();
        backend
            .bulk_put(
                "nodes",
                &[
                    json!({"id":"n1","projectId":"p1","title":"one"}),
                    json!({"id":"n2","projectId":"p1","title":"two"}),
                ],
            )
            .unwrap();
        backend
            .bulk_put(
                "runRecords",
                &[
                    json!({"id":"r1","projectId":"p1","createdAt":3,"workbench":"storyboard","action":"shot-image"}),
                    json!({"id":"r2","projectId":"p1","createdAt":2,"workbench":"storyboard","action":"shot-image"}),
                    json!({"id":"r3","projectId":"p1","createdAt":1,"workbench":"storyboard","action":"speech"}),
                ],
            )
            .unwrap();

        let projects = backend
            .query(
                "projects",
                &Map::from_iter([("id".into(), json!("p1"))]),
                false,
                Some("id,name"),
            )
            .unwrap();
        assert_eq!(projects, vec![json!({"id":"p1","name":"first"})]);
        let (nodes, total) = backend.scan_page("nodes", 0, 1, false).unwrap();
        assert_eq!(total, 2);
        assert_eq!(nodes.len(), 1);
        let (records, total) = backend
            .query_page(
                "runRecords",
                &Map::from_iter([
                    ("projectId".into(), json!("p1")),
                    ("workbench".into(), json!("storyboard")),
                    ("action".into(), json!("shot-image")),
                ]),
                &PageQuery {
                    ids: Vec::new(),
                    missing_fields: Vec::new(),
                    ranges: Vec::new(),
                    order_by: Some(PageOrder {
                        field: "createdAt".into(),
                        direction: Some("desc".into()),
                    }),
                    offset: 1,
                    limit: 1,
                    include_payload: true,
                    fields: None,
                },
            )
            .unwrap();
        assert_eq!(total, 2);
        assert_eq!(records.len(), 1);
        assert_eq!(records[0]["id"], json!("r2"));

        backend.kv_put("theme", &json!({"mode":"dark"})).unwrap();
        assert_eq!(backend.kv_get("theme").unwrap(), json!({"mode":"dark"}));
        backend.kv_delete("theme").unwrap();
        assert_eq!(backend.kv_get("theme").unwrap(), Value::Null);

        backend
            .transaction(vec![
                TxOp::Put {
                    table: "projects".into(),
                    row: json!({"id":"p1","name":"updated"}),
                },
                TxOp::Put {
                    table: "nodes".into(),
                    row: json!({"id":"n3","projectId":"p1","title":"three"}),
                },
            ])
            .unwrap();
        assert_eq!(
            backend
                .query(
                    "projects",
                    &Map::from_iter([("id".into(), json!("p1"))]),
                    false,
                    None,
                )
                .unwrap()[0]["name"],
            json!("updated")
        );

        let bytes = b"backend parity asset";
        let hash = crate::hash::sha1_hex(bytes)[..16].to_string();
        backend
            .put(
                "assets",
                &json!({
                    "id":hash,
                    "mime":"image/png",
                    "bytes":{
                        "__qhType":"u8",
                        "base64":base64::engine::general_purpose::STANDARD.encode(bytes)
                    }
                }),
            )
            .unwrap();
        assert_eq!(backend.asset_bytes(&hash).unwrap().0, bytes);
    }

    #[test]
    fn json_and_sqlite_backends_share_the_storage_contract() {
        let json_root = temp_root("contract-json");
        exercise_backend_contract(Arc::new(Store {
            root: Arc::new(json_root.clone()),
            lock: Arc::new(Mutex::new(())),
            maintenance: Arc::new(AtomicBool::new(false)),
        }));
        let _ = fs::remove_dir_all(json_root);

        let sqlite_root = temp_root("contract-sqlite");
        exercise_backend_contract(Arc::new(sqlite::SqliteStore::open(&sqlite_root).unwrap()));
        let _ = fs::remove_dir_all(sqlite_root);
    }

    #[test]
    fn maintenance_mode_blocks_new_writes_until_released() {
        let root = temp_root("maintenance");
        let store = Store {
            root: Arc::new(root.clone()),
            lock: Arc::new(Mutex::new(())),
            maintenance: Arc::new(AtomicBool::new(false)),
        };
        store
            .put("projects", &json!({"id":"p1","name":"before"}))
            .unwrap();
        store.set_maintenance(true);
        assert!(store.in_maintenance());
        assert!(store
            .put("projects", &json!({"id":"p2","name":"blocked"}))
            .unwrap_err()
            .contains("maintenance"));
        assert_eq!(
            store
                .query(
                    "projects",
                    &Map::from_iter([("id".into(), json!("p2"))]),
                    false,
                    None,
                )
                .unwrap()
                .len(),
            0
        );
        store.set_maintenance(false);
        store
            .put("projects", &json!({"id":"p3","name":"after"}))
            .unwrap();
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn put_query_delete_roundtrip() {
        let root = temp_root("roundtrip");
        let row = json!({ "id": "p1", "name": "项目一", "updatedAt": 1 });
        write_row(&root, "projects", &row).unwrap();
        assert_eq!(
            query_rows(
                &root,
                "projects",
                &Map::from_iter([("id".to_string(), Value::String("p1".to_string()))])
            )
            .unwrap(),
            vec![row.clone()]
        );
        delete_row(&root, "projects", "p1").unwrap();
        assert!(query_rows(&root, "projects", &Map::new())
            .unwrap()
            .is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn project_folders_table_is_available() {
        let root = temp_root("project-folders");
        let row = json!({ "id": "f1", "name": "客户项目", "updatedAt": 1 });
        write_row(&root, "projectFolders", &row).unwrap();
        assert_eq!(
            query_rows(
                &root,
                "projectFolders",
                &Map::from_iter([("id".to_string(), Value::String("f1".to_string()))])
            )
            .unwrap(),
            vec![row]
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn asset_save_queue_table_is_available() {
        let root = temp_root("asset-save-queue");
        let row = json!({
            "id": "result-1",
            "projectId": "p1",
            "resultId": "result-1",
            "assets": [{
                "hash": "hash-1",
                "mime": "image/png",
                "bytes": { "__qhType": "u8", "base64": "AQID" }
            }],
            "createdAt": 1
        });
        write_row(&root, "assetSaveQueue", &row).unwrap();
        assert_eq!(
            query_rows(
                &root,
                "assetSaveQueue",
                &Map::from_iter([(
                    "resultId".to_string(),
                    Value::String("result-1".to_string())
                )])
            )
            .unwrap(),
            vec![row]
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn transaction_rolls_back_partial_write() {
        let root = temp_root("rollback");
        let original = json!({ "id": "p1", "name": "原值" });
        write_row(&root, "projects", &original).unwrap();
        let error = apply_tx(
            &root,
            TxRequest {
                ops: vec![
                    TxOp::Put {
                        table: "projects".to_string(),
                        row: json!({ "id": "p1", "name": "新值" }),
                    },
                    TxOp::Put {
                        table: "projects".to_string(),
                        row: json!({ "name": "缺 id" }),
                    },
                ],
            },
        )
        .unwrap_err();
        assert!(error.contains("id"));
        let rows = list_rows(&root, "projects").unwrap();
        assert_eq!(rows, vec![original]);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn metadata_projection_removes_binary_but_keeps_length() {
        let mut row = json!({
            "id": "a1",
            "mime": "image/png",
            "bytes": {
                "__qhType": "u8",
                "base64": "AQIDBA=="
            },
            "thumb": {
                "__qhType": "u8",
                "base64": "AQID"
            },
            "preview": {
                "__qhType": "u8",
                "base64": "AQIDBA=="
            }
        });
        strip_payload(&mut row);
        assert!(row.get("bytes").is_none());
        assert!(row.get("thumb").is_none());
        assert!(row.get("preview").is_none());
        assert_eq!(row.get("bytesLength").and_then(Value::as_u64), Some(4));
        assert_eq!(row.get("previewLength").and_then(Value::as_u64), Some(4));
        project_fields(&mut row, Some("id,mime,bytesLength"));
        assert_eq!(
            row,
            json!({ "id": "a1", "mime": "image/png", "bytesLength": 4 })
        );
    }

    #[test]
    fn metadata_projection_keeps_business_data_objects() {
        let mut row = json!({
            "id": "n1",
            "type": "generation",
            "data": {
                "channelId": "ch-1",
                "model": "image-model"
            }
        });
        strip_payload(&mut row);
        assert_eq!(
            row.get("data"),
            Some(&json!({
                "channelId": "ch-1",
                "model": "image-model"
            }))
        );
    }

    #[test]
    fn row_page_lists_only_the_requested_file_slice() {
        let root = temp_root("page");
        for id in ["a", "b", "c"] {
            write_row(&root, "projects", &json!({ "id": id })).unwrap();
        }
        let files = row_files(&root, "projects").unwrap();
        assert_eq!(files.len(), 3);
        let page = files
            .into_iter()
            .skip(1)
            .take(1)
            .map(|file| read_json(&file).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(page, vec![json!({ "id": "b" })]);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn asset_metadata_sidecars_are_not_listed_as_rows() {
        let root = temp_root("asset-sidecar");
        let row = json!({
            "id": "a1",
            "mime": "image/png",
            "bytes": {
                "__qhType": "u8",
                "base64": "AQIDBA=="
            }
        });
        write_row(&root, "assets", &row).unwrap();

        let files = row_files(&root, "assets").unwrap();
        assert_eq!(files, vec![row_path(&root, "assets", "a1").unwrap()]);
        assert_eq!(list_rows(&root, "assets").unwrap(), vec![row]);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn local_asset_endpoint_payload_returns_raw_bytes_and_mime() {
        let root = temp_root("asset-bytes");
        let row = json!({
            "id": "a1",
            "mime": "image/png",
            "bytes": {
                "__qhType": "u8",
                "base64": "AQIDBA=="
            }
        });
        write_row(&root, "assets", &row).unwrap();
        let (bytes, mime) = load_asset(&root, "a1").unwrap();
        assert_eq!(bytes, vec![1, 2, 3, 4]);
        assert_eq!(mime, "image/png");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn read_retries_across_atomic_replace_window() {
        let root = temp_root("replace-window");
        fs::create_dir_all(&root).unwrap();
        let path = root.join("row.json");
        let writer_path = path.clone();
        let writer = thread::spawn(move || {
            thread::sleep(Duration::from_millis(30));
            fs::write(writer_path, br#"{"id":"a1"}"#).unwrap();
        });

        assert_eq!(read_json(&path).unwrap(), json!({ "id": "a1" }));
        writer.join().unwrap();
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn concurrent_atomic_writes_leave_a_valid_row() {
        let root = temp_root("concurrent-write");
        fs::create_dir_all(&root).unwrap();
        let path = root.join("row.json");
        let mut handles = Vec::new();
        for writer in 0..8 {
            let path = path.clone();
            handles.push(thread::spawn(move || {
                for sequence in 0..10 {
                    let payload = format!(r#"{{"id":"{writer}-{sequence}"}}"#);
                    write_atomic(&path, payload.as_bytes()).unwrap();
                }
            }));
        }
        for handle in handles {
            handle.join().unwrap();
        }
        assert!(read_json(&path).unwrap().get("id").is_some());
        assert!(fs::read_dir(&root)
            .unwrap()
            .flatten()
            .all(|entry| !entry.file_name().to_string_lossy().ends_with(".tmp")));
        let _ = fs::remove_dir_all(root);
    }
}
