use qinghua_shared_store::migration::migrate_v1_to_v2;
use qinghua_shared_store::{default_data_dir, PORT};
use std::path::PathBuf;

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.first().is_some_and(|arg| arg == "migrate-v1-to-v2") {
        return run_migration(&args[1..]);
    }
    run_server(&args)
}

fn run_migration(args: &[String]) -> Result<(), String> {
    let mut source = None;
    let mut target = None;
    let mut dry_run = false;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--source" => {
                source = Some(PathBuf::from(option_value(args, &mut index, "--source")?));
            }
            "--target" => {
                target = Some(PathBuf::from(option_value(args, &mut index, "--target")?));
            }
            "--dry-run" => {
                dry_run = true;
                index += 1;
            }
            "--help" | "-h" => {
                print_migration_help();
                return Ok(());
            }
            other => return Err(format!("unknown migration option: {other}")),
        }
    }
    let source = source.ok_or_else(|| "--source is required".to_string())?;
    let target = target.ok_or_else(|| "--target is required".to_string())?;
    let report = migrate_v1_to_v2(&source, &target, dry_run)?;
    println!(
        "{}",
        serde_json::to_string_pretty(&report)
            .map_err(|error| format!("serialize migration report: {error}"))?
    );
    Ok(())
}

fn run_server(args: &[String]) -> Result<(), String> {
    let mut data_dir = None;
    let mut port = PORT;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--data-dir" => {
                data_dir = Some(PathBuf::from(option_value(args, &mut index, "--data-dir")?));
            }
            "--port" => {
                port = option_value(args, &mut index, "--port")?
                    .parse::<u16>()
                    .map_err(|error| format!("invalid --port: {error}"))?;
            }
            "--backend" => {
                let backend = option_value(args, &mut index, "--backend")?;
                std::env::set_var("QINGHUA_STORE_BACKEND", backend);
            }
            "--help" | "-h" => {
                print_server_help();
                return Ok(());
            }
            other => return Err(format!("unknown server option: {other}")),
        }
    }
    let data_dir = data_dir.unwrap_or_else(default_data_dir);
    qinghua_shared_store::start(&data_dir, port)?;
    println!("qinghua shared store: http://127.0.0.1:{port}");
    println!("data: {}", data_dir.display());
    qinghua_shared_store::block_forever();
    Ok(())
}

fn option_value(args: &[String], index: &mut usize, name: &str) -> Result<String, String> {
    let value = args
        .get(*index + 1)
        .ok_or_else(|| format!("{name} requires a value"))?
        .clone();
    *index += 2;
    Ok(value)
}

fn print_server_help() {
    println!(
        "qinghua-store [--data-dir PATH] [--backend v1|v2] [--port PORT]\n\
         qinghua-store migrate-v1-to-v2 --source V1 --target V2 [--dry-run]"
    );
}

fn print_migration_help() {
    println!(
        "qinghua-store migrate-v1-to-v2 --source V1 --target V2 [--dry-run]\n\
         --dry-run validates source data without writing the target."
    );
}
