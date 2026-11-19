#[cfg(target_os = "linux")]
#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<std::process::ExitCode, Box<dyn std::error::Error + Send + Sync>> {
    use althar_worker::{
        diagnostic::{DiagnosticJournal, read_credentials, run_worker_once},
        grpc::WorkerEnrollment,
        project::{ProjectConfig, run_unit},
        relay::WorkerRelay,
    };
    use std::{env, io, path::Path, process::ExitCode};

    const USAGE: &str = "Usage: althar-worker <https-home:port> <home-id> <worker-id> <home-ca.pem> <worker-cert.pem> <worker-key.pem> <journal-dir> [--relay <wss-url> <relay-token-file> <relay-ca.pem>] [--project-config <private-file>]";
    let raw = env::args_os().skip(1).collect::<Vec<_>>();
    if let [flag, executable, args @ ..] = raw.as_slice()
        && flag == "--project-unit"
    {
        return Ok(run_unit(Path::new(executable), args).await?);
    }
    let args = raw
        .into_iter()
        .map(|arg| {
            arg.into_string()
                .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, USAGE))
        })
        .collect::<Result<Vec<_>, _>>()?;
    if args == ["--help"] {
        println!("{USAGE}");
        return Ok(ExitCode::SUCCESS);
    }
    let Some([address, home_id, worker_id, ca, certificate, key, journal]) = args.get(..7) else {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, USAGE).into());
    };
    let mut relay_files = None;
    let mut project = None;
    let mut options = &args[7..];
    loop {
        options = match options {
            [] => break,
            [flag, url, token, ca, rest @ ..] if flag == "--relay" && relay_files.is_none() => {
                relay_files = Some((
                    url,
                    read_credentials(Path::new(token), true)?,
                    read_credentials(Path::new(ca), false)?,
                ));
                rest
            }
            [flag, path, rest @ ..] if flag == "--project-config" && project.is_none() => {
                project = Some(ProjectConfig::read(Path::new(path))?);
                rest
            }
            _ => return Err(io::Error::new(io::ErrorKind::InvalidInput, USAGE).into()),
        };
    }
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
    if let Some(result) = run_worker_once(
        address,
        enrollment,
        &journal,
        relay.as_ref(),
        project.as_ref(),
    )
    .await?
    {
        println!("{} {}", result.attempt_id, result.outcome().as_str_name());
    } else {
        println!(
            "{}",
            if project.is_some() {
                "No queued worker run"
            } else {
                "No queued diagnostic"
            }
        );
    }
    Ok(ExitCode::SUCCESS)
}

#[cfg(not(target_os = "linux"))]
fn main() -> std::process::ExitCode {
    eprintln!("The native diagnostic worker requires Linux");
    std::process::ExitCode::FAILURE
}
