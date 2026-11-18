#[cfg(target_os = "linux")]
#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use althar_worker::{
        diagnostic::{DiagnosticJournal, read_credentials, run_diagnostic_with_transport},
        grpc::WorkerEnrollment,
        relay::WorkerRelay,
    };
    use std::{env, io, path::Path};

    const USAGE: &str = "Usage: althar-worker <https-home:port> <home-id> <worker-id> <home-ca.pem> <worker-cert.pem> <worker-key.pem> <journal-dir> [--relay <wss-url> <relay-token-file> <relay-ca.pem>]";
    let args = env::args().skip(1).collect::<Vec<_>>();
    if args == ["--help"] {
        println!("{USAGE}");
        return Ok(());
    }
    let Some([address, home_id, worker_id, ca, certificate, key, journal]) = args.get(..7) else {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, USAGE).into());
    };
    let relay_files = match &args[7..] {
        [] => None,
        [flag, url, token, ca] if flag == "--relay" => Some((
            url,
            read_credentials(Path::new(token), true)?,
            read_credentials(Path::new(ca), false)?,
        )),
        _ => return Err(io::Error::new(io::ErrorKind::InvalidInput, USAGE).into()),
    };
    let relay = relay_files
        .as_ref()
        .map(|(url, token, ca)| {
            Ok::<_, std::str::Utf8Error>(WorkerRelay {
                url,
                token: std::str::from_utf8(token)?.trim(),
                ca_pem: ca,
            })
        })
        .transpose()?;
    let enrollment = WorkerEnrollment {
        home_id,
        worker_id,
        home_ca_pem: &read_credentials(Path::new(ca), false)?,
        worker_certificate_pem: &read_credentials(Path::new(certificate), false)?,
        worker_private_key_pem: &read_credentials(Path::new(key), true)?,
    };
    let journal = DiagnosticJournal::open(Path::new(journal), &enrollment)?;
    if let Some(result) =
        run_diagnostic_with_transport(address, enrollment, &journal, relay.as_ref()).await?
    {
        println!("{} {}", result.attempt_id, result.outcome().as_str_name());
    } else {
        println!("No queued diagnostic");
    }
    Ok(())
}

#[cfg(not(target_os = "linux"))]
fn main() -> std::process::ExitCode {
    eprintln!("The native diagnostic worker requires Linux");
    std::process::ExitCode::FAILURE
}
