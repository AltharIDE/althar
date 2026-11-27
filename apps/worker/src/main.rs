#[cfg(target_os = "linux")]
#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<std::process::ExitCode, Box<dyn std::error::Error + Send + Sync>> {
    use althar_worker::{
        agent::{
            AgentConfig, SlotEnd, run_agent_unit, run_agent_unit_with_repository_setup,
            run_agent_unit_with_setup, watch_agent_slot,
        },
        cleanup::sweep,
        diagnostic::{DiagnosticJournal, read_credentials, run_worker_once},
        grpc::WorkerEnrollment,
        project::{ProjectConfig, run_unit},
        relay::WorkerRelay,
    };
    use std::{env, io, path::Path, process::ExitCode, time::Duration};

    const USAGE: &str = "Usage: althar-worker serve <worker-folder>\n       althar-worker uninstall [<worker-folder>]\n       althar-worker <https-home:port> <home-id> <worker-id> <home-ca.pem> <worker-cert.pem> <worker-key.pem> <journal-dir> [--relay <wss-url> <relay-token-file> <relay-ca.pem>] [--project-config <private-file> | --agent-config <private-file>] [--watch]";
    let raw = env::args_os().skip(1).collect::<Vec<_>>();
    if let [flag, executable, args @ ..] = raw.as_slice()
        && flag == "--project-unit"
    {
        return Ok(run_unit(Path::new(executable), args).await?);
    }
    if let [flag, executable, args @ ..] = raw.as_slice()
        && flag == "--agent-unit"
    {
        return Ok(run_agent_unit(Path::new(executable), args).await?);
    }
    if let [flag, args @ ..] = raw.as_slice()
        && flag == "--agent-unit-with-repository-setup"
    {
        return Ok(run_agent_unit_with_repository_setup(args).await?);
    }
    if let [flag, folder, count, tail @ ..] = raw.as_slice()
        && flag == "--agent-unit-with-setup"
    {
        let count = count
            .to_str()
            .and_then(|count| count.parse::<usize>().ok())
            .filter(|count| *count < tail.len())
            .ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "Invalid workspace setup arguments",
                )
            })?;
        let (commands, launch) = tail.split_at(count);
        let (executable, args) = launch.split_first().ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "Missing agent executable")
        })?;
        return Ok(run_agent_unit_with_setup(
            Path::new(executable),
            args,
            Path::new(folder),
            commands,
        )
        .await?);
    }
    if let [command, folder] = raw.as_slice()
        && command == "serve"
    {
        return serve(Path::new(folder)).await;
    }
    if let [command, folder @ ..] = raw.as_slice()
        && command == "uninstall"
        && folder.len() <= 1
    {
        let folder = match folder.first() {
            Some(folder) => Path::new(folder).to_path_buf(),
            None => althar_worker::uninstall::default_folder()?,
        };
        return Ok(match althar_worker::uninstall::uninstall(&folder).await {
            Ok(()) => ExitCode::SUCCESS,
            Err(error) => {
                eprintln!("{error}");
                ExitCode::FAILURE
            }
        });
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
    let mut agents = None;
    let mut watch = false;
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
            [flag, path, rest @ ..] if flag == "--agent-config" && agents.is_none() => {
                agents = Some(AgentConfig::read(Path::new(path))?);
                rest
            }
            [flag, rest @ ..] if flag == "--watch" && !watch => {
                watch = true;
                rest
            }
            _ => return Err(io::Error::new(io::ErrorKind::InvalidInput, USAGE).into()),
        };
    }
    if agents.is_some() && (!watch || project.is_some()) {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, USAGE).into());
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
        server_name: None,
    };
    let journal = DiagnosticJournal::open(Path::new(journal), &enrollment)?;
    if let Some(config) = &agents {
        sweep(config.workspaces(), &journal);
    }
    let run = || {
        run_worker_once(
            address,
            &enrollment,
            &journal,
            relay.as_ref(),
            project.as_ref(),
        )
    };
    let print_result = |result: althar_worker::wire::DiagnosticResult| {
        println!("{} {}", result.attempt_id, result.outcome().as_str_name());
    };
    if !watch {
        if let Some(result) = run().await? {
            print_result(result);
        } else if project.is_some() {
            println!("No queued worker run");
        } else {
            println!("No queued diagnostic");
        }
        return Ok(ExitCode::SUCCESS);
    }

    // One journal and one exchange at a time. Dropping an in-flight exchange
    // closes its unit's grant pipe, so service shutdown also stops the command.
    use tokio::signal::unix::{SignalKind, signal};
    let mut stop = signal(SignalKind::terminate())?;
    let mut interrupt = signal(SignalKind::interrupt())?;
    let work = async {
        let mut failures = 0u32;
        loop {
            let result = match &agents {
                Some(config) => {
                    match watch_agent_slot(address, &enrollment, relay.as_ref(), config, &journal)
                        .await
                    {
                        // Set up by hand, it is its operator's to take away: it only stops.
                        Ok(SlotEnd::Removed) => {
                            eprintln!("The home removed this worker. It stops.");
                            return;
                        }
                        Ok(SlotEnd::Served) => Ok(None),
                        Err(error) => Err(error),
                    }
                }
                None => run().await,
            };
            let delay = match result {
                Ok(Some(result)) => {
                    failures = 0;
                    print_result(result);
                    Duration::ZERO
                }
                Ok(None) => {
                    failures = 0;
                    if agents.is_some() {
                        Duration::ZERO
                    } else {
                        Duration::from_secs(1)
                    }
                }
                Err(error) => {
                    let seconds = 2u64.pow(failures.min(5)).min(30);
                    if failures == 0 {
                        eprintln!("Worker connection failed: {error}. Retrying.");
                    }
                    failures = failures.saturating_add(1);
                    Duration::from_secs(seconds)
                }
            };
            tokio::time::sleep(delay).await;
        }
    };
    tokio::select! {
        biased;
        _ = stop.recv() => {},
        _ = interrupt.recv() => {},
        _ = work => {},
    }
    Ok(ExitCode::SUCCESS)
}

/// A worker its home set up, as its service runs it: all it needs is in its folder, as setting it up left it.
///
/// - `enrollment`: the home's ID, this worker's ID, the name the home's certificate carries, then each address the
///   home may be reached at (`host:port`), best first, a line each;
/// - `home-ca.pem`, the home's own authority; `worker.pem` and `worker.key`, its certificate and its own key;
/// - `agents.conf`, its agents for any project (`*`), and `signed-in`, those signed in, a provider ID a line;
/// - `release`, the Althar release it runs; `journal`, where it keeps what it did.
///
/// It tries each address in turn, and keeps to the one that answered until it stops answering; `reached` keeps it for
/// the next start.
#[cfg(target_os = "linux")]
async fn serve(
    folder: &std::path::Path,
) -> Result<std::process::ExitCode, Box<dyn std::error::Error + Send + Sync>> {
    use althar_worker::{
        agent::{AgentConfig, SlotEnd, watch_agent_slot},
        cleanup::sweep,
        diagnostic::{DiagnosticJournal, read_credentials},
        grpc::WorkerEnrollment,
        uninstall,
    };
    use std::{fs, io, process::ExitCode, time::Duration};
    use tokio::signal::unix::{SignalKind, signal};

    let bad = |what: &str| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!(
                "The worker folder's {what} can't be read. Set the worker up again from Althar."
            ),
        )
    };
    let enrollment_text = String::from_utf8(read_credentials(&folder.join("enrollment"), true)?)
        .map_err(|_| bad("enrollment"))?;
    let mut lines = enrollment_text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty());
    let (Some(home_id), Some(worker_id), Some(server_name)) =
        (lines.next(), lines.next(), lines.next())
    else {
        return Err(bad("enrollment").into());
    };
    let addresses: Vec<String> = lines
        .filter(|address| address.len() <= 270 && !address.contains('/'))
        .map(|address| format!("https://{address}"))
        .take(16)
        .collect();
    if addresses.is_empty() {
        return Err(bad("enrollment").into());
    }
    let ca = read_credentials(&folder.join("home-ca.pem"), false)?;
    let certificate = read_credentials(&folder.join("worker.pem"), false)?;
    let key = read_credentials(&folder.join("worker.key"), true)?;
    let enrollment = WorkerEnrollment {
        home_id,
        worker_id,
        home_ca_pem: &ca,
        worker_certificate_pem: &certificate,
        worker_private_key_pem: &key,
        server_name: Some(server_name),
    };
    let release = fs::read_to_string(folder.join("release")).unwrap_or_default();
    let config = AgentConfig::read(&folder.join("agents.conf"))?
        .with_status(folder.join("signed-in"), release.trim().to_owned());
    let journal = DiagnosticJournal::open(&folder.join("journal"), &enrollment)?;
    // What a crash left of runs its home is done with (cleanup.rs).
    sweep(config.workspaces(), &journal);
    let mut stop = signal(SignalKind::terminate())?;
    let mut interrupt = signal(SignalKind::interrupt())?;
    // The address that answered last time first: a restart doesn't wait on one that never answers.
    let reached = folder.join("reached");
    let mut at = fs::read_to_string(&reached)
        .ok()
        .and_then(|last| addresses.iter().position(|address| *address == last.trim()))
        .unwrap_or(0);
    let work = async {
        let mut failures = 0u32;
        let mut kept = at;
        loop {
            let address = &addresses[at % addresses.len()];
            match watch_agent_slot(address, &enrollment, None, &config, &journal).await {
                Ok(SlotEnd::Removed) => {
                    // Its uninstall stops this service; until it does, nothing more to do. Where it couldn't start,
                    // the home says so again at the next connection.
                    match uninstall::begin(folder).await {
                        Ok(()) => std::future::pending::<()>().await,
                        Err(error) => {
                            eprintln!(
                                "The home removed this worker, but it couldn't uninstall itself: {error}"
                            );
                            tokio::time::sleep(Duration::from_secs(60)).await;
                        }
                    }
                }
                Ok(SlotEnd::Served) => {
                    failures = 0;
                    if kept != at % addresses.len() {
                        kept = at % addresses.len();
                        let _ = fs::write(&reached, address);
                    }
                }
                Err(error) => {
                    if failures == 0 {
                        eprintln!("Couldn't reach the home at {address}: {error}. Trying again.");
                    }
                    failures = failures.saturating_add(1);
                    at = at.wrapping_add(1);
                    // Each address once in a row; then wait, a little longer each round, up to 30 seconds.
                    if at.is_multiple_of(addresses.len()) {
                        let round = failures / addresses.len() as u32;
                        tokio::time::sleep(Duration::from_secs(2u64.pow(round.min(5)).min(30)))
                            .await;
                    }
                }
            }
        }
    };
    tokio::select! {
        biased;
        _ = stop.recv() => {},
        _ = interrupt.recv() => {},
        _ = work => {},
    }
    Ok(ExitCode::SUCCESS)
}

#[cfg(not(target_os = "linux"))]
fn main() -> std::process::ExitCode {
    eprintln!("The native Althar worker requires Linux");
    std::process::ExitCode::FAILURE
}
