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
    let hello = probe_home(
        address,
        WorkerEnrollment {
            home_id,
            worker_id,
            home_ca_pem: &fs::read(ca)?,
            worker_certificate_pem: &fs::read(certificate)?,
            worker_private_key_pem: &fs::read(key)?,
        },
    )
    .await?;
    println!("{}", hello.session_id);
    Ok(())
}
