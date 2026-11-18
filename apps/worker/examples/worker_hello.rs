//! Local interoperability fixture for the TypeScript and Rust bindings.
use althar_worker::{MAX_HELLO_BYTES, accept_home_hello, worker_hello};
use prost::Message;
use std::{
    env,
    error::Error,
    io::{self, Read, Write},
};

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<_> = env::args().skip(1).collect();
    match args.as_slice() {
        [action, worker] if action == "offer" => {
            io::stdout().write_all(&worker_hello(worker)?.encode_to_vec())?;
        }
        [action, home, worker] if action == "accept" => {
            let mut bytes = Vec::new();
            io::stdin()
                .take(MAX_HELLO_BYTES as u64 + 1)
                .read_to_end(&mut bytes)?;
            let hello = accept_home_hello(&bytes, home, worker)?;
            println!("{}", hello.session_id);
        }
        _ => return Err("Expected offer <worker> or accept <home> <worker>".into()),
    }
    Ok(())
}
