use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

pub const PORT: u16 = 18765;

static STARTED: OnceLock<()> = OnceLock::new();

#[derive(Clone)]
struct Store {
    root: Arc<PathBuf>,
    lock: Arc<Mutex<()>>,
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
    let allowed = [
        "projects",
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
        "inspirationCache",
    ];
    if !allowed.contains(&table) {
        return Err(format!("unknown table: {table}"));
    }
    Ok(root.join(table))
}

fn row_path(root: &Path, table: &str, id: &str) -> Result<PathBuf, String> {
    Ok(table_dir(root, table)?.join(format!("{}.json", hex_id(id))))
}

fn write_atomic(path: &Path, payload: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("create dir: {error}"))?;
    }
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, payload).map_err(|error| format!("write temp: {error}"))?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| format!("replace old file: {error}"))?;
    }
    fs::rename(&temporary, path).map_err(|error| format!("rename temp: {error}"))
}

fn read_json(path: &Path) -> Result<Value, String> {
    let raw = fs::read_to_string(path).map_err(|error| format!("read {}: {error}", path.display()))?;
    serde_json::from_str(&raw).map_err(|error| format!("parse {}: {error}", path.display()))
}

fn write_row(root: &Path, table: &str, row: &Value) -> Result<(), String> {
    let id = row
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "row.id must be a string".to_string())?;
    let payload = serde_json::to_vec(row).map_err(|error| format!("serialize row: {error}"))?;
    write_atomic(&row_path(root, table, id)?, &payload)
}

fn delete_row(root: &Path, table: &str, id: &str) -> Result<(), String> {
    let path = row_path(root, table, id)?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| format!("delete row: {error}"))?;
    }
    Ok(())
}

fn list_rows(root: &Path, table: &str) -> Result<Vec<Value>, String> {
    let dir = table_dir(root, table)?;
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut files = fs::read_dir(&dir)
        .map_err(|error| format!("read table dir: {error}"))?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "json"))
        .collect::<Vec<_>>();
    files.sort_by_key(|entry| entry.file_name());
    let mut rows = Vec::with_capacity(files.len());
    for file in files {
        rows.push(read_json(&file.path())?);
    }
    Ok(rows)
}

fn row_matches(row: &Value, filter: &Map<String, Value>) -> bool {
    filter
        .iter()
        .all(|(key, expected)| row.get(key).is_some_and(|actual| actual == expected))
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

fn respond_json(request: Request, status: StatusCode, value: Value, origin: Option<&str>) -> Result<(), String> {
    let body = serde_json::to_string(&value).map_err(|error| format!("serialize response: {error}"))?;
    let mut response = Response::from_string(body)
        .with_status_code(status)
        .with_header(header("content-type", "application/json; charset=utf-8"))
        .with_header(header("cache-control", "no-store"))
        .with_header(header("access-control-allow-methods", "GET,POST,OPTIONS"))
        .with_header(header("access-control-allow-headers", "content-type"));
    if let Some(origin) = origin.filter(|origin| origin_allowed(origin)) {
        response = response.with_header(header("access-control-allow-origin", origin));
    }
    request.respond(response).map_err(|error| format!("respond: {error}"))
}

fn body_json<T: for<'de> Deserialize<'de>>(request: &mut Request) -> Result<T, String> {
    let mut raw = Vec::new();
    request
        .as_reader()
        .read_to_end(&mut raw)
        .map_err(|error| format!("read body: {error}"))?;
    serde_json::from_slice(&raw).map_err(|error| format!("parse body: {error}"))
}

fn handle(store: &Store, mut request: Request) {
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
                    origin.as_deref().filter(|value| origin_allowed(value)).unwrap_or("null"),
                )),
        );
        return;
    }

    let _guard = store.lock.lock().expect("store lock poisoned");
    let root = store.root.as_path();
    let result = (|| -> Result<Value, String> {
        if request.method() == &Method::Get && path == "/health" {
            return Ok(json!({
                "ok": true,
                "service": "qinghua-shared-store",
                "version": 1,
                "dataDir": root.to_string_lossy(),
            }));
        }
        if request.method() == &Method::Post && path == "/put" {
            let body: PutRequest = body_json(&mut request)?;
            write_row(root, &body.table, &body.row)?;
            return Ok(json!({ "ok": true }));
        }
        if request.method() == &Method::Post && path == "/bulkPut" {
            let body: BulkPutRequest = body_json(&mut request)?;
            for row in &body.rows {
                write_row(root, &body.table, row)?;
            }
            return Ok(json!({ "ok": true, "count": body.rows.len() }));
        }
        if request.method() == &Method::Post && path == "/delete" {
            let body: DeleteRequest = body_json(&mut request)?;
            delete_row(root, &body.table, &body.id)?;
            return Ok(json!({ "ok": true }));
        }
        if request.method() == &Method::Post && path == "/query" {
            let body: QueryRequest = body_json(&mut request)?;
            return Ok(json!({ "rows": query_rows(root, &body.table, &body.filter)? }));
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
            let rows = list_rows(root, &table)?;
            let total = rows.len();
            let page = rows.into_iter().skip(offset).take(limit).collect::<Vec<_>>();
            return Ok(json!({ "rows": page, "total": total }));
        }
        if request.method() == &Method::Post && path == "/tx" {
            let body: TxRequest = body_json(&mut request)?;
            apply_tx(root, body)?;
            return Ok(json!({ "ok": true }));
        }
        if request.method() == &Method::Get && path == "/usage" {
            return Ok(serde_json::to_value(usage(root)).map_err(|error| error.to_string())?);
        }
        if request.method() == &Method::Post && path == "/kv/put" {
            let body: Map<String, Value> = body_json(&mut request)?;
            let key = body.get("key").and_then(Value::as_str).ok_or("key missing")?;
            let value = body.get("value").cloned().unwrap_or(Value::Null);
            let path = root.join("_kv").join(format!("{}.json", hex_id(key)));
            write_atomic(&path, serde_json::to_vec(&value).map_err(|error| error.to_string())?.as_slice())?;
            return Ok(json!({ "ok": true }));
        }
        if request.method() == &Method::Post && path == "/kv/get" {
            let body: Map<String, Value> = body_json(&mut request)?;
            let key = body.get("key").and_then(Value::as_str).ok_or("key missing")?;
            let path = root.join("_kv").join(format!("{}.json", hex_id(key)));
            let value = if path.exists() { read_json(&path)? } else { Value::Null };
            return Ok(json!({ "value": value }));
        }
        if request.method() == &Method::Post && path == "/kv/delete" {
            let body: Map<String, Value> = body_json(&mut request)?;
            let key = body.get("key").and_then(Value::as_str).ok_or("key missing")?;
            let path = root.join("_kv").join(format!("{}.json", hex_id(key)));
            if path.exists() {
                fs::remove_file(path).map_err(|error| error.to_string())?;
            }
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
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        return PathBuf::from(local)
            .join("com.qinghua.canvas")
            .join("shared-store-v1");
    }
    PathBuf::from("qinghua-shared-store-v1")
}

pub fn start(data_dir: &Path, port: u16) -> Result<(), String> {
    fs::create_dir_all(data_dir).map_err(|error| format!("create data dir: {error}"))?;
    let server = Server::http(("127.0.0.1", port))
        .map_err(|error| format!("start shared store on {port}: {error}"))?;
    let store = Store {
        root: Arc::new(data_dir.to_path_buf()),
        lock: Arc::new(Mutex::new(())),
    };
    thread::spawn(move || {
        for request in server.incoming_requests() {
            handle(&store, request);
        }
    });
    Ok(())
}

pub fn start_in_background() {
    let _ = STARTED.get_or_init(|| {
        let data_dir = default_data_dir();
        match start(&data_dir, PORT) {
            Ok(()) => eprintln!("[shared-store] http://127.0.0.1:{PORT} {}", data_dir.display()),
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

    #[test]
    fn put_query_delete_roundtrip() {
        let root = temp_root("roundtrip");
        let row = json!({ "id": "p1", "name": "项目一", "updatedAt": 1 });
        write_row(&root, "projects", &row).unwrap();
        assert_eq!(
            query_rows(&root, "projects", &Map::from_iter([(
                "id".to_string(),
                Value::String("p1".to_string())
            )]))
            .unwrap(),
            vec![row.clone()]
        );
        delete_row(&root, "projects", "p1").unwrap();
        assert!(query_rows(&root, "projects", &Map::new()).unwrap().is_empty());
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
}
