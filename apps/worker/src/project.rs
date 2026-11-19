use std::{
    cell::RefCell,
    ffi::OsString,
    fs, io,
    os::fd::AsFd,
    path::{Path, PathBuf},
    process::{ExitCode, Stdio},
    time::Duration,
};

use rustix::time::{ClockId, clock_gettime};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::unix::pipe::Receiver,
    process::Command,
    sync::{mpsc, watch},
    time::Instant,
};

use crate::{
    diagnostic::read_credentials,
    valid_id,
    wire::{
        DiagnosticLog, DiagnosticOffer, DiagnosticOutcome, ProjectCommand, WorkerFrame,
        worker_frame,
    },
};

const LOG_BYTES: usize = 64 * 1024;
const LOG_CHUNK_BYTES: usize = 256;
const MAX_LOG_CHUNKS: usize = 1024;
const UNIT_READY: u8 = 1;
const COMMAND_FAILED: u8 = 42;
const EXECUTION_LOST: u8 = 43;

fn invalid(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

/// One explicitly configured command in a checkout already on this machine.
pub struct ProjectConfig {
    project_id: String,
    name: String,
    checkout: PathBuf,
    executable: PathBuf,
    args: Vec<String>,
}

impl ProjectConfig {
    pub fn read(path: &Path) -> io::Result<Self> {
        let bytes = read_credentials(path, true)?;
        let text = std::str::from_utf8(&bytes)
            .map_err(|_| invalid("The project command file must be UTF-8"))?;
        let mut lines = text.split_terminator('\n');
        let project_id = lines.next().unwrap_or_default();
        let name = lines.next().unwrap_or_default();
        let checkout = Path::new(lines.next().unwrap_or_default());
        let executable = Path::new(lines.next().unwrap_or_default());
        if !valid_id(project_id, "proj_")
            || !name
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_alphanumeric)
            || name.len() > 64
            || !name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
            || !checkout.is_absolute()
            || !executable.is_absolute()
            || text.contains('\0')
        {
            return Err(invalid(
                "Expected a project ID, command name, absolute checkout and executable, then one argument per line",
            ));
        }
        let checkout = checkout.canonicalize()?;
        if !checkout.is_dir()
            || path.canonicalize()?.starts_with(&checkout)
            || !executable.is_file()
        {
            return Err(invalid(
                "Choose an existing checkout and executable and keep the private configuration outside the checkout",
            ));
        }
        Ok(Self {
            project_id: project_id.into(),
            name: name.into(),
            checkout,
            executable: executable.into(),
            args: lines.map(str::to_owned).collect(),
        })
    }

    pub(crate) fn matches(&self, command: &ProjectCommand) -> bool {
        self.project_id == command.project_id && self.name == command.command_name
    }
}

// Both processes use the same Linux monotonic clock. Sample it before reading
// the time left in the lease so time spent writing to the pipe consumes the grant.
fn monotonic_ms() -> u64 {
    let now = clock_gettime(ClockId::Monotonic);
    (now.tv_sec as u64) * 1000 + (now.tv_nsec as u64) / 1_000_000
}

pub async fn run_unit(executable: &Path, args: &[OsString]) -> io::Result<ExitCode> {
    let mut permit = Receiver::from_owned_fd(std::io::stdin().as_fd().try_clone_to_owned()?)?;
    let stdout = std::io::stdout();
    let mut control = stdout.lock();
    std::io::Write::write_all(&mut control, &[UNIT_READY])?;
    std::io::Write::flush(&mut control)?;
    drop(control);
    let until = permit.read_u64_le().await?;
    if monotonic_ms() >= until {
        return Ok(ExitCode::from(EXECUTION_LOST));
    }

    // Use the same output pipe for stdout and stderr. Only the guardian reads
    // stdin. The child cannot receive or accidentally inherit its lease stream.
    let stderr = Stdio::from(stdout.as_fd().try_clone_to_owned()?);
    let mut command = Command::new(executable);
    command
        .args(args)
        .env_clear()
        .env("PATH", "/usr/local/bin:/usr/bin:/bin")
        .stdin(Stdio::null())
        .stderr(stderr)
        .kill_on_drop(true);
    if let Some(home) = std::env::var_os("HOME") {
        command.env("HOME", home);
    }
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            println!(
                "Could not start the registered executable ({})",
                error.kind()
            );
            return Ok(ExitCode::from(COMMAND_FAILED));
        }
    };
    let mut deadline = until;
    let mut next = [0; 8];
    let mut offset = 0;
    loop {
        tokio::select! {
            biased;
            _ = tokio::time::sleep(Duration::from_millis(deadline.saturating_sub(monotonic_ms()))) => {
                return Ok(ExitCode::from(EXECUTION_LOST));
            }
            exit = child.wait() => {
                return Ok(if exit?.success() { ExitCode::SUCCESS } else { ExitCode::from(COMMAND_FAILED) });
            }
            count = permit.read(&mut next[offset..]) => {
                let count = count?;
                if count == 0 || monotonic_ms() >= deadline {
                    return Ok(ExitCode::from(EXECUTION_LOST));
                }
                offset += count;
                if offset == next.len() {
                    deadline = u64::from_le_bytes(next);
                    offset = 0;
                }
            }
        }
    }
}

pub(crate) struct ProjectUnit {
    name: String,
    cgroup: RefCell<Option<PathBuf>>,
}

impl ProjectUnit {
    pub(crate) fn new(offer: &DiagnosticOffer) -> Self {
        Self {
            name: format!("althar-{}.service", offer.attempt_id),
            cgroup: RefCell::new(None),
        }
    }

    pub(crate) async fn stop(&self) -> bool {
        // No permit was sent if the cgroup never reached the worker. The
        // pending service can only encounter EOF and exit.
        let path = self.cgroup.borrow().clone();
        let Some(path) = path else {
            return true;
        };
        if Self::empty(&path) {
            return true;
        }
        let _ = tokio::time::timeout(
            Duration::from_secs(4),
            Command::new("/usr/bin/systemctl")
                .args(["--user", "stop", &self.name])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .kill_on_drop(true)
                .status(),
        )
        .await;
        Self::empty(&path)
    }

    fn empty(path: &Path) -> bool {
        match fs::read_to_string(path.join("cgroup.events")) {
            Ok(events) => events.lines().any(|line| line == "populated 0"),
            Err(error) => error.kind() == io::ErrorKind::NotFound && !path.exists(),
        }
    }

    pub(crate) async fn run(
        &self,
        config: &ProjectConfig,
        offer: &DiagnosticOffer,
        send: &mpsc::Sender<WorkerFrame>,
        mut lease: watch::Receiver<Instant>,
    ) -> io::Result<DiagnosticOutcome> {
        let mut supervisor = Command::new("/usr/bin/systemd-run")
            .args([
                "--user",
                "--quiet",
                "--wait",
                "--pipe",
                "--collect",
                "--expand-environment=no",
                "--unit",
                &self.name,
            ])
            .args([
                "--property=Type=exec",
                "--property=KillMode=control-group",
                "--property=TimeoutStopSec=2s",
                "--property=RuntimeMaxSec=65s",
                "--property=Delegate=no",
            ])
            .arg("--working-directory")
            .arg(&config.checkout)
            .arg("--")
            .arg(std::env::current_exe()?)
            .arg("--project-unit")
            .arg(&config.executable)
            .args(&config.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .kill_on_drop(true)
            .spawn()?;
        let mut output = supervisor
            .stdout
            .take()
            .ok_or_else(|| invalid("No unit output pipe"))?;
        let mut permit = supervisor
            .stdin
            .take()
            .ok_or_else(|| invalid("No unit permit pipe"))?;
        if output.read_u8().await? != UNIT_READY {
            return Err(invalid("Invalid unit readiness marker"));
        }
        let group = Command::new("/usr/bin/systemctl")
            .args([
                "--user",
                "show",
                "--property=ControlGroup",
                "--value",
                &self.name,
            ])
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .output()
            .await?;
        let group = std::str::from_utf8(&group.stdout)
            .map_err(|_| invalid("Invalid control group"))?
            .trim();
        let Some(relative) = group.strip_prefix('/') else {
            return Err(invalid("The project command needs systemd and cgroup v2"));
        };
        let relative = Path::new(relative);
        if relative.file_name().and_then(|name| name.to_str()) != Some(self.name.as_str())
            || !relative
                .components()
                .all(|part| matches!(part, std::path::Component::Normal(_)))
        {
            return Err(invalid("Unexpected project control group"));
        }
        let path = Path::new("/sys/fs/cgroup").join(relative);
        if !path.join("cgroup.events").is_file() {
            return Err(invalid("The project command needs systemd and cgroup v2"));
        }
        *self.cgroup.borrow_mut() = Some(path);
        let mut publish_lease = true;
        let mut bytes = 0;
        let mut chunks = 0;
        let mut buffer = [0; LOG_CHUNK_BYTES];
        loop {
            if publish_lease {
                let now = monotonic_ms();
                let until = *lease.borrow_and_update();
                let milliseconds =
                    until.saturating_duration_since(Instant::now()).as_millis() as u64;
                if milliseconds == 0 {
                    return Ok(DiagnosticOutcome::Unknown);
                }
                permit.write_u64_le(now + milliseconds).await?;
                publish_lease = false;
            }
            tokio::select! {
                biased;
                update = lease.changed() => {
                    update.map_err(|_| io::Error::from(io::ErrorKind::BrokenPipe))?;
                    publish_lease = true;
                }
                count = output.read(&mut buffer) => {
                    let count = count?;
                    if count == 0 {
                        break;
                    }
                    let count = count.min(LOG_BYTES - bytes);
                    if count == 0 || chunks >= MAX_LOG_CHUNKS {
                        continue;
                    }
                    send.send(WorkerFrame {
                        payload: Some(worker_frame::Payload::DiagnosticLog(DiagnosticLog {
                            attempt_id: offer.attempt_id.clone(),
                            fence: offer.fence.clone(),
                            offset: bytes as u32,
                            output: buffer[..count].to_vec(),
                        })),
                    }).await.map_err(|_| io::Error::from(io::ErrorKind::BrokenPipe))?;
                    bytes += count;
                    chunks += 1;
                }
            }
        }
        let exit = supervisor.wait().await?;
        Ok(if exit.success() {
            DiagnosticOutcome::Succeeded
        } else if exit.code() == Some(i32::from(COMMAND_FAILED)) {
            DiagnosticOutcome::Failed
        } else {
            DiagnosticOutcome::Unknown
        })
    }
}
