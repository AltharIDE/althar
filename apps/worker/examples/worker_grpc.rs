use std::{env, error::Error, fs, io};

use althar_worker::grpc::{WorkerEnrollment, probe_home};

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn Error + Send + Sync>> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    let [address, home_id, worker_id, ca, certificate, key] = args.as_slice() else {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Expected address, home ID, worker ID, CA, certificate and key",
        )
        .into());
    };
    let home_ca = fs::read(ca)?;
    let certificate = fs::read(certificate)?;
    let key = fs::read(key)?;
    let enrollment = || WorkerEnrollment {
        home_id,
        worker_id,
        home_ca_pem: &home_ca,
        worker_certificate_pem: &certificate,
        worker_private_key_pem: &key,
    };
    let first = probe_home(address, enrollment()).await?;
    let second = probe_home(address, enrollment()).await?;
    if first.session_id == second.session_id {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "The home reused a worker session",
        )
        .into());
    }
    println!("Authenticated");
    Ok(())
}
