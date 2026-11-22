use std::{
    ffi::OsString,
    fs, io,
    os::{
        fd::AsFd,
        unix::fs::{MetadataExt, PermissionsExt},
    },
    path::{Path, PathBuf},
    process::{ExitCode, Stdio},
    time::Duration,
};

use prost::Message;
use rustix::process::geteuid;
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, duplex},
    net::TcpListener,
    net::unix::pipe::Receiver,
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::{mpsc, watch},
    task::JoinSet,
    time::{Instant, MissedTickBehavior, interval, timeout, timeout_at},
};
use tokio_stream::wrappers::ReceiverStream;
use tonic::{Streaming, transport::Channel};

use crate::{
    PROTOCOL_VERSION,
    agent_managed::ManagedCommands,
    agent_setup::{
        DESCRIPTOR_BYTES, OUTPUT_BYTES, WorkspaceSetup, run_workspace_setup, worker_environment,
    },
    agent_tools::forward_tools,
    agent_workspace::{WorkspaceTransfer, workspace_patch},
    diagnostic::{DiagnosticJournal, read_credentials},
    grpc::{WorkerEnrollment, control_client, endpoint},
    project::{cgroup_empty, cgroup_path, monotonic_ms},
    relay::{WorkerRelay, relay_channel},
    valid_id,
    wire::{
        AgentHomeFrame, AgentRunBytes, AgentRunExit, AgentRunOutcome, AgentRunReady, AgentRunStart,
        AgentSnapshotRequest, AgentSnapshotResult, AgentWorkerCapability, AgentWorkerFrame,
        AgentWorkerHeartbeat, AgentWorkerHello, AgentWorkspaceSetup, AgentWorkspaceSetupResult,
        agent_home_frame::Payload as HomeMessage, agent_worker_frame::Payload as WorkerMessage,
    },
};

pub(crate) const CHUNK_BYTES: usize = 2048;
const MAX_CAPABILITIES: usize = 32;
const REPLY_TIMEOUT: Duration = Duration::from_secs(5);
pub(crate) const STOP_TIMEOUT: Duration = Duration::from_secs(4);
const HEARTBEAT_EVERY: Duration = Duration::from_secs(1);
const MAX_LEASE: Duration = Duration::from_secs(8);
const READY_MARKER: u8 = 1;
pub(crate) const LOST_LEASE: u8 = 243;
pub(crate) const COULD_NOT_START: u8 = 244;
const UNIT_LEASE: u8 = 0;
const UNIT_INPUT: u8 = 1;

pub(crate) type Failure = Box<dyn std::error::Error + Send + Sync>;
pub(crate) type Sender = mpsc::Sender<AgentWorkerFrame>;

fn invalid(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

fn provider_id(id: &str) -> bool {
    id.len() <= 48
        && id.as_bytes().first().is_some_and(u8::is_ascii_lowercase)
        && id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

struct Provider {
    capability: AgentWorkerCapability,
    executable: PathBuf,
    args: Vec<String>,
}

/// Agent executables, arguments and allowed projects are configured on the
/// worker. The home can select one of these entries, and never supplies argv.
pub struct AgentConfig {
    root: PathBuf,
    providers: Vec<Provider>,
}

impl AgentConfig {
    pub fn read(path: &Path) -> io::Result<Self> {
        let bytes = read_credentials(path, true)?;
        let text = std::str::from_utf8(&bytes)
            .map_err(|_| invalid("The agent worker configuration must be UTF-8"))?;
        if text.contains('\0') {
            return Err(invalid(
                "The agent worker configuration contains a NUL byte",
            ));
        }
        let mut lines = text.lines();
        let root = Path::new(lines.next().unwrap_or_default());
        if !root.is_absolute() {
            return Err(invalid("Choose an absolute worker workspace root"));
        }
        let root = root.canonicalize()?;
        let metadata = fs::metadata(&root)?;
        if !metadata.is_dir()
            || metadata.uid() != geteuid().as_raw()
            || metadata.permissions().mode() & 0o077 != 0
            || path.canonicalize()?.starts_with(&root)
        {
            return Err(invalid(
                "Use a private workspace directory owned by the worker user and keep the configuration outside it",
            ));
        }
        let mut providers: Vec<Provider> = Vec::new();
        for line in lines {
            let mut fields = line.split('\t');
            let project_id = fields.next().unwrap_or_default();
            let provider_id = fields.next().filter(|id| self::provider_id(id));
            let executable = Path::new(fields.next().unwrap_or_default());
            let Some(provider_id) = provider_id else {
                return Err(invalid("An agent entry needs a provider ID"));
            };
            if providers.len() == MAX_CAPABILITIES
                || !valid_id(project_id, "proj_")
                || !executable.is_absolute()
                || !executable.is_file()
                || providers.iter().any(|provider| {
                    provider.capability.project_id == project_id
                        && provider.capability.provider_id == provider_id
                })
            {
                return Err(invalid("Invalid or duplicate project and agent executable"));
            }
            let executable = executable.canonicalize()?;
            if executable.starts_with(&root) {
                return Err(invalid("Keep agent executables outside worker workspaces"));
            }
            providers.push(Provider {
                capability: AgentWorkerCapability {
                    project_id: project_id.into(),
                    provider_id: provider_id.into(),
                    workspace_setup: true,
                    managed_commands: true,
                    managed_preview: true,
                },
                executable,
                args: fields.map(str::to_owned).collect(),
            });
        }
        if providers.is_empty() {
            return Err(invalid(
                "Configure at least one project and agent executable",
            ));
        }
        Ok(Self { root, providers })
    }

    fn resolve(&self, run: &AgentRunStart) -> io::Result<(&Provider, PathBuf)> {
        if !valid_id(&run.run_id, "war_") || !valid_id(&run.workspace_id, "ws_") {
            return Err(invalid(
                "The home sent an invalid agent run or workspace ID",
            ));
        }
        let provider = self.providers.iter().find(|provider| {
            provider.capability.project_id == run.project_id
                && provider.capability.provider_id == run.provider_id
        });
        let Some(provider) = provider else {
            return Err(invalid("This agent was not configured for this project"));
        };
        // A new attempt never replaces a checkout that might contain
        // unsynchronized changes from an interrupted agent.
        let folder = if run.source.is_some() {
            format!("{}-{}", run.workspace_id, run.run_id)
        } else {
            run.workspace_id.clone()
        };
        Ok((provider, self.root.join(&run.project_id).join(folder)))
    }
}

async fn control_input(
    permit: &mut Receiver,
    stdin: &mut (impl AsyncWrite + Unpin),
    deadline: watch::Sender<u64>,
) -> io::Result<()> {
    let mut buffer = [0; CHUNK_BYTES];
    loop {
        match permit.read_u8().await? {
            UNIT_LEASE => {
                let until = permit.read_u64_le().await?;
                if monotonic_ms() >= *deadline.borrow() || until <= monotonic_ms() {
                    return Err(invalid("The agent execution lease expired"));
                }
                deadline.send_replace(until);
            }
            UNIT_INPUT => {
                let size = usize::from(permit.read_u16_le().await?);
                if size == 0 || size > buffer.len() {
                    return Err(invalid("Invalid agent input frame"));
                }
                permit.read_exact(&mut buffer[..size]).await?;
                stdin.write_all(&buffer[..size]).await?;
            }
            _ => return Err(invalid("Invalid agent unit control frame")),
        }
    }
}

async fn lease_expiry(mut deadline: watch::Receiver<u64>) {
    loop {
        let until = *deadline.borrow_and_update();
        let now = monotonic_ms();
        if now >= until {
            return;
        }
        if !matches!(
            timeout(Duration::from_millis(until - now), deadline.changed()).await,
            Ok(Ok(()))
        ) {
            return;
        }
    }
}

/// systemd supervises this guardian and the entire agent process tree. The
/// agent receives only its ACP input and cannot inherit the lease pipe.
pub async fn run_agent_unit(executable: &Path, args: &[OsString]) -> io::Result<ExitCode> {
    run_guardian(executable, args, None).await
}

pub async fn run_agent_unit_with_setup(
    executable: &Path,
    args: &[OsString],
    folder: &Path,
    commands: &[OsString],
) -> io::Result<ExitCode> {
    let root = std::env::current_dir()?.canonicalize()?;
    let relative = folder.strip_prefix(&root).map_err(io::Error::other)?;
    let setup = WorkspaceSetup::new(&root, relative, commands.to_vec())?;
    run_guardian(executable, args, Some(setup)).await
}

async fn run_guardian(
    executable: &Path,
    args: &[OsString],
    setup: Option<WorkspaceSetup>,
) -> io::Result<ExitCode> {
    let mut permit = Receiver::from_owned_fd(std::io::stdin().as_fd().try_clone_to_owned()?)?;
    {
        use std::io::Write as _;
        let mut stdout = std::io::stdout().lock();
        stdout.write_all(&[READY_MARKER])?;
        stdout.flush()?;
    }
    let until = timeout(MAX_LEASE, permit.read_u64_le()).await??;
    if monotonic_ms() >= until {
        return Ok(ExitCode::from(LOST_LEASE));
    }
    let (mut from_home, mut to_agent) = duplex(CHUNK_BYTES * 4);
    let (deadline, until) = watch::channel(until);
    tokio::select! {
        biased;
        _ = lease_expiry(until) => Ok(ExitCode::from(LOST_LEASE)),
        _ = control_input(&mut permit, &mut from_home, deadline) => Ok(ExitCode::from(LOST_LEASE)),
        exit = prepared_provider(executable, args, setup, &mut to_agent) => exit,
    }
}

async fn prepared_provider(
    executable: &Path,
    args: &[OsString],
    setup: Option<WorkspaceSetup>,
    input: &mut (impl AsyncRead + Unpin),
) -> io::Result<ExitCode> {
    if let Some(setup) = setup {
        use std::io::Write as _;
        let result = run_workspace_setup(&setup).await.encode_to_vec();
        let size = u16::try_from(result.len()).map_err(io::Error::other)?;
        let mut stdout = std::io::stdout().lock();
        stdout.write_all(&size.to_le_bytes())?;
        stdout.write_all(&result)?;
        stdout.flush()?;
    }
    let mut command = Command::new(executable);
    worker_environment(&mut command)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::inherit())
        .kill_on_drop(true);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            eprintln!("Could not start the configured agent ({})", error.kind());
            return Ok(ExitCode::from(COULD_NOT_START));
        }
    };
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| invalid("No agent input pipe"))?;
    let copy = async {
        tokio::io::copy(input, &mut stdin).await?;
        stdin.shutdown().await
    };
    tokio::select! {
        exit = child.wait() => {
            let code = exit?.code().filter(|code| *code != i32::from(LOST_LEASE) && *code != i32::from(COULD_NOT_START));
            Ok(ExitCode::from(code.and_then(|code| u8::try_from(code).ok()).unwrap_or(1)))
        },
        copied = copy => {
            copied?;
            Ok(ExitCode::from(LOST_LEASE))
        },
    }
}

pub(crate) async fn send(sender: &Sender, payload: WorkerMessage) -> io::Result<()> {
    sender
        .send(AgentWorkerFrame {
            payload: Some(payload),
        })
        .await
        .map_err(|_| io::Error::from(io::ErrorKind::BrokenPipe))
}

struct Slot {
    channel: Channel,
    incoming: Streaming<AgentHomeFrame>,
    outgoing: Sender,
    send_heartbeat: tokio::time::Interval,
    sequence: u32,
    awaiting: Option<Instant>,
    lease: Duration,
    until: Instant,
}

impl Slot {
    async fn heartbeat(&mut self) -> io::Result<()> {
        if self.awaiting.is_some() {
            return Ok(());
        }
        self.awaiting = Some(Instant::now());
        self.sequence = self
            .sequence
            .checked_add(1)
            .ok_or_else(|| invalid("Agent heartbeat overflow"))?;
        timeout_at(
            self.until,
            send(
                &self.outgoing,
                WorkerMessage::Heartbeat(AgentWorkerHeartbeat {
                    sequence: self.sequence,
                }),
            ),
        )
        .await?
    }

    fn acknowledge(&mut self, heartbeat: AgentWorkerHeartbeat) -> io::Result<()> {
        let Some(sent) = self.awaiting.take() else {
            return Err(invalid("The home sent an unsolicited agent heartbeat"));
        };
        let now = Instant::now();
        if heartbeat.sequence != self.sequence || now >= self.until || now >= sent + self.lease {
            return Err(invalid("The home sent an invalid agent heartbeat"));
        }
        self.until = sent + self.lease;
        Ok(())
    }

    async fn message(&mut self) -> Result<HomeMessage, Failure> {
        loop {
            tokio::select! {
                biased;
                _ = tokio::time::sleep_until(self.until) => return Err(invalid("The home stopped renewing the agent lease").into()),
                _ = self.send_heartbeat.tick() => self.heartbeat().await?,
                incoming = self.incoming.message() => match incoming?.and_then(|message| message.payload) {
                    Some(HomeMessage::Heartbeat(heartbeat)) => self.acknowledge(heartbeat)?,
                    Some(other) => return Ok(other),
                    None => return Err(invalid("The home closed the agent worker stream").into()),
                }
            }
        }
    }
}

pub(crate) struct AgentUnit {
    pub(crate) name: String,
    pub(crate) child: Child,
    pub(crate) input: ChildStdin,
    pub(crate) output: ChildStdout,
    pub(crate) group: PathBuf,
}

impl AgentUnit {
    async fn start(
        run: &AgentRunStart,
        provider: &Provider,
        cwd: &Path,
        journal: &DiagnosticJournal,
        setup: Option<&WorkspaceSetup>,
    ) -> Result<Self, Failure> {
        let mut args = Vec::new();
        if let Some(setup) = setup {
            args.push("--agent-unit-with-setup".into());
            args.push(setup.folder.clone().into_os_string());
            args.push(setup.commands.len().to_string().into());
            args.extend(setup.commands.iter().cloned());
        } else {
            args.push("--agent-unit".into());
        }
        args.push(provider.executable.clone().into_os_string());
        args.extend(provider.args.iter().map(OsString::from));
        let unit = Self::open(unit_name(&run.run_id), cwd, &args, None).await?;
        let recorded = unit
            .group
            .strip_prefix("/sys/fs/cgroup")
            .map_err(io::Error::other)?;
        let mut group = vec![b'/'];
        group.extend(recorded.as_os_str().as_encoded_bytes());
        journal.record_agent_group(&run.run_id, &group)?;
        Ok(unit)
    }

    pub(crate) async fn open(
        name: String,
        cwd: &Path,
        args: &[OsString],
        parent: Option<&str>,
    ) -> Result<Self, Failure> {
        let mut command = Command::new("/usr/bin/systemd-run");
        command.args([
            "--user",
            "--quiet",
            "--wait",
            "--pipe",
            "--collect",
            "--expand-environment=no",
            "--unit",
            &name,
            "--property=Type=exec",
            "--property=KillMode=control-group",
            "--property=TimeoutStopSec=2s",
            "--property=Delegate=no",
            "--property=NoNewPrivileges=yes",
            "--property=UMask=0077",
        ]);
        if let Some(parent) = parent {
            command.arg(format!("--property=Requisite={parent}"));
            command.arg(format!("--property=PartOf={parent}"));
            command.arg(format!("--property=After={parent}"));
        }
        let mut child = command
            .arg("--working-directory")
            .arg(cwd)
            .arg("--")
            .arg(std::env::current_exe()?)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .kill_on_drop(true)
            .spawn()?;
        let input = child
            .stdin
            .take()
            .ok_or_else(|| invalid("No agent unit input pipe"))?;
        let mut output = child
            .stdout
            .take()
            .ok_or_else(|| invalid("No agent unit output pipe"))?;
        if timeout(REPLY_TIMEOUT, output.read_u8()).await?? != READY_MARKER {
            return Err(invalid("The agent unit did not become ready").into());
        }
        let result = timeout(
            REPLY_TIMEOUT,
            Command::new("/usr/bin/systemctl")
                .args([
                    "--user",
                    "show",
                    "--property=ControlGroup",
                    "--value",
                    &name,
                ])
                .stderr(Stdio::null())
                .kill_on_drop(true)
                .output(),
        )
        .await??;
        let group = cgroup_path(&name, &result.stdout)?;
        if !result.status.success() || !group.join("cgroup.events").is_file() {
            return Err(invalid("The agent worker needs systemd and cgroup v2").into());
        }
        Ok(Self {
            name,
            child,
            input,
            output,
            group,
        })
    }
}

fn unit_name(run_id: &str) -> String {
    format!("althar-agent-{run_id}.service")
}

pub(crate) async fn stop_group(name: &str, group: &Path) -> bool {
    if !cgroup_empty(group) {
        let _ = timeout(
            STOP_TIMEOUT,
            Command::new("/usr/bin/systemctl")
                .args(["--user", "stop", name])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .kill_on_drop(true)
                .status(),
        )
        .await;
    }
    cgroup_empty(group)
}

pub(crate) fn local_deadline(until: Instant) -> u64 {
    monotonic_ms() + until.saturating_duration_since(Instant::now()).as_millis() as u64
}

async fn unit_write(input: &mut (impl AsyncWrite + Unpin), data: &[u8]) -> io::Result<()> {
    let size = u16::try_from(data.len()).map_err(io::Error::other)?;
    input.write_u8(UNIT_INPUT).await?;
    input.write_u16_le(size).await?;
    input.write_all(data).await
}

async fn renew_unit(
    slot: &mut Slot,
    input: &mut ChildStdin,
    heartbeat: AgentWorkerHeartbeat,
) -> Result<(), Failure> {
    slot.acknowledge(heartbeat)?;
    update_unit_lease(input, slot.until).await
}

pub(crate) async fn update_unit_lease(
    input: &mut ChildStdin,
    until: Instant,
) -> Result<(), Failure> {
    timeout_at(until, async {
        input.write_u8(UNIT_LEASE).await?;
        input.write_u64_le(local_deadline(until)).await
    })
    .await??;
    Ok(())
}

async fn setup_result(output: &mut ChildStdout) -> Result<AgentWorkspaceSetupResult, Failure> {
    let size = usize::from(output.read_u16_le().await?);
    if size > OUTPUT_BYTES + 32 {
        return Err(invalid("The setup output exceeded its limit").into());
    }
    let mut result = vec![0; size];
    output.read_exact(&mut result).await?;
    Ok(AgentWorkspaceSetupResult::decode(result.as_slice())?)
}

async fn wait_for_setup(
    slot: &mut Slot,
    unit: &mut AgentUnit,
    run_id: &str,
) -> Result<Option<AgentWorkspaceSetupResult>, Failure> {
    let output = setup_result(&mut unit.output);
    tokio::pin!(output);
    loop {
        tokio::select! {
            biased;
            _ = tokio::time::sleep_until(slot.until) => return Err(invalid("The worker lost its lease during setup").into()),
            _ = slot.send_heartbeat.tick() => slot.heartbeat().await?,
            message = slot.incoming.message() => match message?.and_then(|frame| frame.payload) {
                Some(HomeMessage::Heartbeat(heartbeat)) => renew_unit(slot, &mut unit.input, heartbeat).await?,
                Some(HomeMessage::Stop(stop)) if stop.run_id == run_id => return Ok(None),
                _ => return Err(invalid("The home sent an unexpected message during setup").into()),
            },
            result = &mut output => return Ok(Some(result?)),
        }
    }
}

async fn serve_agent(
    slot: &mut Slot,
    unit: &mut AgentUnit,
    run: &AgentRunStart,
    cwd: &Path,
    tools_port: u16,
) -> Result<(AgentRunOutcome, Option<u32>), Failure> {
    let workspace_path = cwd
        .to_str()
        .ok_or_else(|| invalid("The workspace path must be UTF-8"))?;
    timeout_at(
        slot.until,
        unit.input.write_u64_le(local_deadline(slot.until)),
    )
    .await??;
    let setup = if run.setup.is_some() {
        match wait_for_setup(slot, unit, &run.run_id).await? {
            Some(result) => Some(result),
            None => return Ok((AgentRunOutcome::Stopped, None)),
        }
    } else {
        None
    };
    timeout_at(
        slot.until,
        send(
            &slot.outgoing,
            WorkerMessage::Ready(AgentRunReady {
                run_id: run.run_id.clone(),
                workspace_path: workspace_path.into(),
                tools_port: u32::from(tools_port),
                setup,
            }),
        ),
    )
    .await??;
    let mut buffer = [0; CHUNK_BYTES];
    let mut checkpoints = JoinSet::new();
    let mut managed = ManagedCommands::new(
        &run.run_id,
        cwd,
        &unit.name,
        slot.outgoing.clone(),
        slot.until,
    );
    loop {
        tokio::select! {
            biased;
            _ = tokio::time::sleep_until(slot.until) => return Ok((AgentRunOutcome::Unconfirmed, None)),
            _ = slot.send_heartbeat.tick() => slot.heartbeat().await?,
            result = checkpoints.join_next(), if !checkpoints.is_empty() => {
                if let Some(result) = result {
                    result??;
                }
            }
            result = managed.finished(), if managed.has_commands() => result?,
            message = slot.incoming.message() => match message?.and_then(|frame| frame.payload) {
                Some(HomeMessage::Heartbeat(heartbeat)) => {
                    renew_unit(slot, &mut unit.input, heartbeat).await?;
                    managed.renew(slot.until);
                }
                Some(HomeMessage::Input(input)) if input.run_id == run.run_id && !input.data.is_empty() && input.data.len() <= CHUNK_BYTES => {
                    timeout_at(slot.until, unit_write(&mut unit.input, &input.data)).await??;
                }
                Some(HomeMessage::Stop(stop)) if stop.run_id == run.run_id => return Ok((AgentRunOutcome::Stopped, None)),
                Some(HomeMessage::Snapshot(request)) if request.run_id == run.run_id && checkpoints.is_empty() => {
                    checkpoints.spawn(send_snapshot(slot.outgoing.clone(), cwd.to_owned(), request));
                }
                Some(HomeMessage::ManagedStart(request)) => managed.start(request)?,
                Some(HomeMessage::ManagedStop(request)) => managed.stop(request)?,
                Some(HomeMessage::PreviewOpen(request)) => managed.preview(request, slot.channel.clone()),
                _ => return Err(invalid("The home sent an invalid agent run message").into()),
            },
            count = unit.output.read(&mut buffer) => {
                let count = count?;
                if count == 0 {
                    let result = timeout(STOP_TIMEOUT, unit.child.wait()).await??;
                    return Ok(match result.code().and_then(|code| u32::try_from(code).ok()).filter(|code| *code <= 255) {
                        Some(code) if code == u32::from(COULD_NOT_START) => (AgentRunOutcome::StartFailed, None),
                        Some(code) if code != u32::from(LOST_LEASE) => (AgentRunOutcome::Exited, Some(code)),
                        _ => (AgentRunOutcome::Unconfirmed, None),
                    });
                }
                timeout_at(slot.until, send(&slot.outgoing, WorkerMessage::Output(AgentRunBytes {
                    run_id: run.run_id.clone(),
                    data: buffer[..count].to_vec(),
                }))).await??;
            }
        }
    }
}

async fn send_snapshot(
    outgoing: Sender,
    cwd: PathBuf,
    request: AgentSnapshotRequest,
) -> io::Result<()> {
    let run_id = request.run_id;
    let checkpoint =
        match workspace_patch(&cwd, &run_id, &request.base_tree, &request.base_head).await {
            Ok(checkpoint) => checkpoint,
            Err(error) => {
                eprintln!("Could not checkpoint agent files: {error}");
                return send(
                    &outgoing,
                    WorkerMessage::Snapshot(AgentSnapshotResult {
                        run_id,
                        unavailable: true,
                        ..Default::default()
                    }),
                )
                .await;
            }
        };
    let sha256 = |bytes: &[u8]| {
        ring::digest::digest(&ring::digest::SHA256, bytes)
            .as_ref()
            .to_vec()
    };
    send(
        &outgoing,
        WorkerMessage::Snapshot(AgentSnapshotResult {
            run_id: run_id.clone(),
            tree: checkpoint.tree,
            size: checkpoint.patch.len() as u32,
            sha256: sha256(&checkpoint.patch),
            head: checkpoint.head,
            commits_size: checkpoint.commits.len() as u32,
            commits_sha256: sha256(&checkpoint.commits),
            unavailable: false,
        }),
    )
    .await?;
    for chunk in checkpoint.patch.chunks(CHUNK_BYTES) {
        send(
            &outgoing,
            WorkerMessage::Patch(AgentRunBytes {
                run_id: run_id.clone(),
                data: chunk.to_vec(),
            }),
        )
        .await?;
    }
    for chunk in checkpoint.commits.chunks(CHUNK_BYTES) {
        send(
            &outgoing,
            WorkerMessage::Commits(AgentRunBytes {
                run_id: run_id.clone(),
                data: chunk.to_vec(),
            }),
        )
        .await?;
    }
    Ok(())
}

pub async fn watch_agent_slot(
    address: &str,
    enrollment: &WorkerEnrollment<'_>,
    relay: Option<&WorkerRelay<'_>>,
    config: &AgentConfig,
    journal: &DiagnosticJournal,
) -> Result<(), Failure> {
    let journal_id = journal.agent_identity()?;
    let mut slot = timeout(REPLY_TIMEOUT, async {
        let endpoint = endpoint(address, enrollment)?;
        let channel = match relay {
            Some(relay) => relay_channel(endpoint, relay).await?,
            None => endpoint.connect().await?,
        };
        let (outgoing, receiver) = mpsc::channel(4);
        send(
            &outgoing,
            WorkerMessage::Hello(AgentWorkerHello {
                worker_id: enrollment.worker_id.into(),
                version: PROTOCOL_VERSION,
                journal_id,
                capabilities: config
                    .providers
                    .iter()
                    .map(|provider| provider.capability.clone())
                    .collect(),
            }),
        )
        .await?;
        let mut incoming = control_client(channel.clone())
            .run_agent(ReceiverStream::new(receiver))
            .await?
            .into_inner();
        let Some(HomeMessage::Hello(hello)) =
            incoming.message().await?.and_then(|frame| frame.payload)
        else {
            return Err(invalid("The home did not accept the agent worker").into());
        };
        let lease = Duration::from_millis(hello.lease_ms.into());
        if hello.home_id != enrollment.home_id
            || hello.worker_id != enrollment.worker_id
            || hello.version != PROTOCOL_VERSION
            || lease <= HEARTBEAT_EVERY
            || lease > MAX_LEASE
        {
            return Err(invalid("The home returned an invalid agent worker lease").into());
        }
        let mut send_heartbeat = interval(HEARTBEAT_EVERY);
        send_heartbeat.set_missed_tick_behavior(MissedTickBehavior::Delay);
        Ok::<_, Failure>(Slot {
            channel,
            incoming,
            outgoing,
            send_heartbeat,
            sequence: 0,
            awaiting: None,
            lease,
            until: Instant::now() + lease,
        })
    })
    .await??;

    let reply = match slot.message().await? {
        HomeMessage::Start(run) => {
            let (outcome, exit_code) = execute(&mut slot, config, journal, &run).await?;
            AgentRunExit {
                run_id: run.run_id,
                outcome: outcome.into(),
                exit_code,
            }
        }
        HomeMessage::Reconcile(run) => {
            if !valid_id(&run.workspace_id, "ws_") {
                return Err(invalid("The home sent an invalid workspace to reconcile").into());
            }
            let stopped = match journal.agent_group(&run.run_id)? {
                Some(group) => {
                    let name = unit_name(&run.run_id);
                    stop_group(&name, &cgroup_path(&name, &group)?).await
                }
                // The guardian only grants a launch after its group was recorded.
                None => true,
            };
            AgentRunExit {
                run_id: run.run_id,
                outcome: if stopped {
                    AgentRunOutcome::Stopped
                } else {
                    AgentRunOutcome::Unconfirmed
                }
                .into(),
                exit_code: None,
            }
        }
        _ => return Err(invalid("Expected an agent run or reconciliation from the home").into()),
    };
    let run_id = reply.run_id.clone();
    let confirmed = reply.outcome() != AgentRunOutcome::Unconfirmed;
    timeout(
        REPLY_TIMEOUT,
        send(&slot.outgoing, WorkerMessage::Exit(reply)),
    )
    .await??;
    // A successful end follows the home recording the outcome.
    timeout(REPLY_TIMEOUT, async {
        while let Some(frame) = slot.incoming.message().await? {
            if !matches!(frame.payload, Some(HomeMessage::Heartbeat(_))) {
                return Err(
                    invalid("The home sent an unexpected frame after the agent outcome").into(),
                );
            }
        }
        Ok::<(), Failure>(())
    })
    .await??;
    if confirmed {
        journal.forget_agent_group(&run_id)?;
    }
    Ok(())
}

async fn execute(
    slot: &mut Slot,
    config: &AgentConfig,
    journal: &DiagnosticJournal,
    run: &AgentRunStart,
) -> Result<(AgentRunOutcome, Option<u32>), Failure> {
    let (provider, path) = match config.resolve(run) {
        Ok(placement) => placement,
        Err(error) => {
            eprintln!("Could not prepare the worker workspace: {error}");
            return Ok((AgentRunOutcome::StartFailed, None));
        }
    };
    let descriptor = if run.setup.is_some() {
        match receive_setup(slot, run).await {
            Ok(Some(setup)) => Some(setup),
            Ok(None) => return Ok((AgentRunOutcome::Stopped, None)),
            Err(error) => {
                eprintln!("Could not receive the worker setup: {error}");
                return Ok((AgentRunOutcome::StartFailed, None));
            }
        }
    } else {
        None
    };
    let cwd = match stage_workspace(slot, run, path).await {
        Ok(Some(path)) => path,
        Ok(None) => return Ok((AgentRunOutcome::Stopped, None)),
        Err(error) => {
            eprintln!("Could not stage the agent checkout: {error}");
            return Ok((AgentRunOutcome::StartFailed, None));
        }
    };
    let setup = match descriptor
        .as_ref()
        .map(|given| WorkspaceSetup::from_wire(&cwd, given))
        .transpose()
    {
        Ok(setup) => setup,
        Err(error) => {
            eprintln!("Could not prepare the worker setup: {error}");
            return Ok((AgentRunOutcome::StartFailed, None));
        }
    };
    let mut unit = match AgentUnit::start(run, provider, &cwd, journal, setup.as_ref()).await {
        Ok(unit) => unit,
        Err(error) => {
            eprintln!("Could not prepare the agent unit: {error}");
            return Ok((AgentRunOutcome::StartFailed, None));
        }
    };
    let result = match run.tools {
        true => {
            // The listener stays on worker loopback. The home checks both
            // the current run and the MCP session token.
            let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
            let tools_port = listener.local_addr()?.port();
            let channel = slot.channel.clone();
            tokio::select! {
                result = serve_agent(slot, &mut unit, run, &cwd, tools_port) => result,
                bridge = forward_tools(listener, channel, &run.run_id) => {
                    bridge?;
                    Err(invalid("The worker tool bridge stopped").into())
                }
            }
        }
        false => serve_agent(slot, &mut unit, run, &cwd, 0).await,
    };
    if !stop_group(&unit.name, &unit.group).await {
        return Ok((AgentRunOutcome::Unconfirmed, None));
    }
    result
}

async fn receive_setup(
    slot: &mut Slot,
    run: &AgentRunStart,
) -> Result<Option<AgentWorkspaceSetup>, Failure> {
    let source = run
        .setup
        .as_ref()
        .ok_or_else(|| invalid("The home did not describe its setup"))?;
    let size = source.size as usize;
    if size == 0 || size > DESCRIPTOR_BYTES || source.sha256.len() != 32 {
        return Err(invalid("The home described an invalid worker setup").into());
    }
    let mut bytes = Vec::with_capacity(size);
    while bytes.len() < size {
        match slot.message().await? {
            HomeMessage::SetupChunk(chunk)
                if chunk.run_id == run.run_id
                    && !chunk.data.is_empty()
                    && chunk.data.len() <= CHUNK_BYTES
                    && bytes.len() + chunk.data.len() <= size =>
            {
                bytes.extend_from_slice(&chunk.data)
            }
            HomeMessage::Stop(stop) if stop.run_id == run.run_id => return Ok(None),
            _ => return Err(invalid("The home sent an invalid worker setup frame").into()),
        }
    }
    if ring::digest::digest(&ring::digest::SHA256, &bytes).as_ref() != source.sha256.as_slice() {
        return Err(invalid("The worker setup digest changed").into());
    }
    Ok(Some(AgentWorkspaceSetup::decode(bytes.as_slice())?))
}

async fn stage_workspace(
    slot: &mut Slot,
    run: &AgentRunStart,
    path: PathBuf,
) -> Result<Option<PathBuf>, Failure> {
    let Some(source) = &run.source else {
        if path.canonicalize()? != path || !path.is_dir() {
            return Err(invalid("The assigned worker workspace is unavailable").into());
        }
        return Ok(Some(path));
    };
    let mut transfer = WorkspaceTransfer::create(path, &run.run_id, source)?;
    while !transfer.complete() {
        match slot.message().await? {
            HomeMessage::Checkout(frame)
                if frame.run_id == run.run_id && frame.data.len() <= CHUNK_BYTES =>
            {
                transfer.put(&frame.data)?;
            }
            HomeMessage::Stop(stop) if stop.run_id == run.run_id => return Ok(None),
            _ => return Err(invalid("The home sent an invalid workspace transfer frame").into()),
        }
    }
    tokio::select! {
        result = transfer.install(source) => Ok(Some(result?)),
        message = slot.message() => match message? {
            HomeMessage::Stop(stop) if stop.run_id == run.run_id => Ok(None),
            _ => Err(invalid("The home sent an unexpected frame during checkout").into()),
        }
    }
}
