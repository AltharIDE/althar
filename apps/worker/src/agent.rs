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

use rustix::process::geteuid;
use tokio::{
    io::{AsyncReadExt, AsyncWrite, AsyncWriteExt},
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
        AgentWorkerHeartbeat, AgentWorkerHello, agent_home_frame::Payload as HomeMessage,
        agent_worker_frame::Payload as WorkerMessage,
    },
};

const CHUNK_BYTES: usize = 2048;
const MAX_CAPABILITIES: usize = 32;
const REPLY_TIMEOUT: Duration = Duration::from_secs(5);
const STOP_TIMEOUT: Duration = Duration::from_secs(4);
const HEARTBEAT_EVERY: Duration = Duration::from_secs(1);
const MAX_LEASE: Duration = Duration::from_secs(8);
const READY_MARKER: u8 = 1;
const LOST_LEASE: u8 = 243;
const COULD_NOT_START: u8 = 244;
const UNIT_LEASE: u8 = 0;
const UNIT_INPUT: u8 = 1;

type Failure = Box<dyn std::error::Error + Send + Sync>;
type Sender = mpsc::Sender<AgentWorkerFrame>;

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
    stdin: &mut ChildStdin,
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
    let mut command = Command::new(executable);
    command
        .args(args)
        .env_clear()
        .env("PATH", "/usr/local/bin:/usr/bin:/bin")
        .stdin(Stdio::piped())
        .stdout(Stdio::inherit())
        .kill_on_drop(true);
    for name in [
        "HOME",
        "LANG",
        "XDG_CONFIG_HOME",
        "XDG_DATA_HOME",
        "XDG_CACHE_HOME",
    ] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
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
    let (deadline, until) = watch::channel(until);
    tokio::select! {
        biased;
        _ = lease_expiry(until) => Ok(ExitCode::from(LOST_LEASE)),
        exit = child.wait() => {
            let code = exit?.code().filter(|code| *code != i32::from(LOST_LEASE) && *code != i32::from(COULD_NOT_START));
            Ok(ExitCode::from(code.and_then(|code| u8::try_from(code).ok()).unwrap_or(1)))
        },
        _ = control_input(&mut permit, &mut stdin, deadline) => Ok(ExitCode::from(LOST_LEASE)),
    }
}

async fn send(sender: &Sender, payload: WorkerMessage) -> io::Result<()> {
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

struct AgentUnit {
    name: String,
    child: Child,
    input: ChildStdin,
    output: ChildStdout,
    group: PathBuf,
}

impl AgentUnit {
    async fn start(
        run: &AgentRunStart,
        provider: &Provider,
        cwd: &Path,
        journal: &DiagnosticJournal,
    ) -> Result<Self, Failure> {
        let name = unit_name(&run.run_id);
        let mut child = Command::new("/usr/bin/systemd-run")
            .args([
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
            ])
            .arg("--working-directory")
            .arg(cwd)
            .arg("--")
            .arg(std::env::current_exe()?)
            .arg("--agent-unit")
            .arg(&provider.executable)
            .args(&provider.args)
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
        journal.record_agent_group(&run.run_id, &result.stdout)?;
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

async fn stop_group(name: &str, group: &Path) -> bool {
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

fn local_deadline(until: Instant) -> u64 {
    monotonic_ms() + until.saturating_duration_since(Instant::now()).as_millis() as u64
}

async fn unit_write(input: &mut (impl AsyncWrite + Unpin), data: &[u8]) -> io::Result<()> {
    let size = u16::try_from(data.len()).map_err(io::Error::other)?;
    input.write_u8(UNIT_INPUT).await?;
    input.write_u16_le(size).await?;
    input.write_all(data).await
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
    timeout_at(
        slot.until,
        send(
            &slot.outgoing,
            WorkerMessage::Ready(AgentRunReady {
                run_id: run.run_id.clone(),
                workspace_path: workspace_path.into(),
                tools_port: u32::from(tools_port),
            }),
        ),
    )
    .await??;
    let mut buffer = [0; CHUNK_BYTES];
    let mut checkpoints = JoinSet::new();
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
            message = slot.incoming.message() => match message?.and_then(|frame| frame.payload) {
                Some(HomeMessage::Heartbeat(heartbeat)) => {
                    slot.acknowledge(heartbeat)?;
                    timeout_at(slot.until, async {
                        unit.input.write_u8(UNIT_LEASE).await?;
                        unit.input.write_u64_le(local_deadline(slot.until)).await
                    }).await??;
                }
                Some(HomeMessage::Input(input)) if input.run_id == run.run_id && !input.data.is_empty() && input.data.len() <= CHUNK_BYTES => {
                    timeout_at(slot.until, unit_write(&mut unit.input, &input.data)).await??;
                }
                Some(HomeMessage::Stop(stop)) if stop.run_id == run.run_id => return Ok((AgentRunOutcome::Stopped, None)),
                Some(HomeMessage::Snapshot(request)) if request.run_id == run.run_id && checkpoints.is_empty() => {
                    checkpoints.spawn(send_snapshot(slot.outgoing.clone(), cwd.to_owned(), request));
                }
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
    let cwd = match stage_workspace(slot, run, path).await {
        Ok(Some(path)) => path,
        Ok(None) => return Ok((AgentRunOutcome::Stopped, None)),
        Err(error) => {
            eprintln!("Could not stage the agent checkout: {error}");
            return Ok((AgentRunOutcome::StartFailed, None));
        }
    };
    let mut unit = match AgentUnit::start(run, provider, &cwd, journal).await {
        Ok(unit) => unit,
        Err(error) => {
            eprintln!("Could not prepare the agent unit: {error}");
            return Ok((AgentRunOutcome::StartFailed, None));
        }
    };
    let result = match run.tools {
        true => {
            // Only the agent on this worker can reach the local listener. The
            // home still checks the run and MCP session token.
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
