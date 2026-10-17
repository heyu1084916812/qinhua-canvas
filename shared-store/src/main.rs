fn main() {
    let data_dir = qinghua_shared_store::default_data_dir();
    match qinghua_shared_store::start(&data_dir, 18765) {
        Ok(()) => {
            println!("qinghua shared store: http://127.0.0.1:18765");
            println!("data: {}", data_dir.display());
            qinghua_shared_store::block_forever();
        }
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
