use std::{
    collections::HashMap,
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
    MAX_HELLO_BYTES, PROTOCOL_VERSION,
    agent_capacity::worker_capacity,
    agent_files::send_file,
    agent_history,
    agent_managed::ManagedCommands,
    agent_readiness::readiness_from,
    agent_reservation::{agent_service, reserve},
    agent_setup::{
        DESCRIPTOR_BYTES, OUTPUT_BYTES, SetupPlan, TOOLS_VARIABLE, WorkspaceSetup, tools_of,
        worker_environment,
    },
    agent_skills::{MAX_BYTES as MAX_SKILL_BYTES, SkillDirectory},
    agent_tools::forward_tools,
    agent_workspace::{WorkspaceTransfer, workspace_patch},
    agent_workspace_set::{AgentWorkspace, WorkspaceSet},
    cleanup::forget_run,
    diagnostic::{DiagnosticJournal, read_credentials},
    grpc::{WorkerEnrollment, control_client, endpoint},
    project::{cgroup_empty, cgroup_path, monotonic_ms},
    relay::{WorkerRelay, relay_channel},
    update, valid_id,
    wire::{
        AgentHomeFrame, AgentRunAccepted, AgentRunBytes, AgentRunExit, AgentRunOutcome,
        AgentRunReady, AgentRunStart, AgentSkillFiles, AgentSnapshotIndex, AgentSnapshotRequest,
        AgentSnapshotResult, AgentWorkerCapability, AgentWorkerFrame, AgentWorkerHeartbeat,
        AgentWorkerHello, AgentWorkerMcpCommand, AgentWorkerReadiness, AgentWorkerUpdateOutcome,
        AgentWorkerUpdateState, AgentWorkspaceSetup, AgentWorkspaceSetupResult,
        AgentWorkspaceSetupSource, agent_home_frame::Payload as HomeMessage,
        agent_worker_frame::Payload as WorkerMessage,
    },
};

pub(crate) const CHUNK_BYTES: usize = 2048;
const MAX_CAPABILITIES: usize = 32;
const MAX_MCP_COMMANDS: usize = 16;
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

pub(crate) struct Provider {
    capability: AgentWorkerCapability,
    pub(crate) executable: PathBuf,
    pub(crate) args: Vec<String>,
}

/// Agent executables, arguments and allowed projects are configured on the
/// worker. The home can select one of these entries, and never supplies argv.
pub struct AgentConfig {
    root: PathBuf,
    providers: Vec<Provider>,
    mcp: HashMap<String, Vec<AgentWorkerMcpCommand>>,
    /// Where a worker its home set up keeps which of its agents are signed in, read again at each hello.
    signed_in: Option<PathBuf>,
    /// The Althar release it runs, where it was installed from one.
    release: String,
}

/// The agents of `providers` that the setup's file says are signed in, once each, in order; none where it can't be read.
fn signed_in_from(path: &Path, providers: &[String]) -> Vec<String> {
    let text = fs::read_to_string(path).unwrap_or_default();
    let mut found: Vec<String> = text
        .lines()
        .map(str::trim)
        .filter(|id| providers.iter().any(|provider| provider == id))
        .map(str::to_owned)
        .collect();
    found.sort();
    found.dedup();
    found
}

/// An agent entry for any project its home grants it: a worker its home set up offers its agents so.
pub const ANY_PROJECT: &str = "*";

fn project_or_any(id: &str) -> bool {
    id == ANY_PROJECT || valid_id(id, "proj_")
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
        let mut mcp = HashMap::new();
        for line in lines {
            let mut fields = line.split('\t');
            let project_id = fields.next().unwrap_or_default();
            if project_id == "mcp" {
                Self::register_mcp(&root, &mut mcp, fields)?;
                continue;
            }
            let provider_id = fields.next().filter(|id| self::provider_id(id));
            let executable = Path::new(fields.next().unwrap_or_default());
            let Some(provider_id) = provider_id else {
                return Err(invalid("An agent entry needs a provider ID"));
            };
            if providers.len() == MAX_CAPABILITIES
                || !project_or_any(project_id)
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
                    workspace_sets: true,
                    helper_agents: true,
                    skill_files: true,
                    helper_skill_files: true,
                    helper_checkouts: true,
                    file_reads: true,
                    workspace_index: true,
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
        if mcp.keys().any(|project| {
            !providers
                .iter()
                .any(|provider| &provider.capability.project_id == project)
        }) {
            return Err(invalid(
                "Register MCP commands only for projects with an agent executable",
            ));
        }
        Ok(Self {
            root,
            providers,
            mcp,
            signed_in: None,
            release: String::new(),
        })
    }

    /// Says, in each hello, which agents are signed in (one provider ID a line, in `signed_in`) and the release it runs.
    pub fn with_status(mut self, signed_in: PathBuf, release: String) -> Self {
        self.signed_in = Some(signed_in);
        self.release = release.chars().take(64).collect();
        self
    }

    fn any_project(&self) -> bool {
        self.providers
            .iter()
            .any(|provider| provider.capability.project_id == ANY_PROJECT)
    }

    /// What the worker's own check found, kept beside `signed-in`; none where it hasn't checked.
    fn readiness(&self) -> Option<AgentWorkerReadiness> {
        let path = self.signed_in.as_ref()?.with_file_name("readiness");
        let providers: Vec<String> = self
            .providers
            .iter()
            .map(|provider| provider.capability.provider_id.clone())
            .collect();
        readiness_from(&path, &providers)
    }

    /// The configured agents signed in now, as the file the setup keeps says; none where it can't be read.
    fn signed_in(&self) -> Vec<String> {
        let Some(path) = &self.signed_in else {
            return Vec::new();
        };
        let providers: Vec<String> = self
            .providers
            .iter()
            .map(|provider| provider.capability.provider_id.clone())
            .collect();
        signed_in_from(path, &providers)
    }

    fn mcp_for(&self, project: &str) -> Vec<AgentWorkerMcpCommand> {
        self.mcp
            .get(project)
            .or_else(|| self.mcp.get(ANY_PROJECT))
            .cloned()
            .unwrap_or_default()
    }

    fn register_mcp<'a>(
        root: &Path,
        mcp: &mut HashMap<String, Vec<AgentWorkerMcpCommand>>,
        mut fields: impl Iterator<Item = &'a str>,
    ) -> io::Result<()> {
        let project = fields.next().unwrap_or_default();
        let name = fields.next().unwrap_or_default();
        let executable = Path::new(fields.next().unwrap_or_default());
        if !project_or_any(project)
            || name.is_empty()
            || name.len() > 64
            || !name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"_.-".contains(&byte))
            || !executable.is_absolute()
            || !executable.is_file()
            || executable.metadata()?.permissions().mode() & 0o111 == 0
            || fields.next().is_some()
        {
            return Err(invalid(
                "An MCP entry needs a project ID, a server name and an absolute executable",
            ));
        }
        let executable = executable.canonicalize()?;
        let path = executable
            .to_str()
            .ok_or_else(|| invalid("The MCP executable path must be UTF-8"))?;
        if executable.starts_with(root) || path.len() > 1024 || path.chars().any(char::is_control) {
            return Err(invalid("Keep MCP executables outside worker workspaces"));
        }
        let commands = mcp.entry(project.into()).or_default();
        if commands.len() >= MAX_MCP_COMMANDS || commands.iter().any(|one| one.name == name) {
            return Err(invalid(
                "Too many or duplicate MCP commands for this project",
            ));
        }
        commands.push(AgentWorkerMcpCommand {
            name: name.into(),
            executable: path.into(),
        });
        Ok(())
    }

    /// Where its runs' checkouts go, a folder for each project.
    pub fn workspaces(&self) -> &Path {
        &self.root
    }

    fn provider(&self, project: &str, provider: &str) -> io::Result<&Provider> {
        self.providers
            .iter()
            .find(|one| {
                one.capability.provider_id == provider
                    && (one.capability.project_id == project
                        || (one.capability.project_id == ANY_PROJECT && valid_id(project, "proj_")))
            })
            .ok_or_else(|| invalid("This agent was not configured for this project"))
    }

    fn resolve(&self, run: &AgentRunStart) -> io::Result<(&Provider, PathBuf)> {
        if !valid_id(&run.run_id, "war_") || !valid_id(&run.workspace_id, "ws_") {
            return Err(invalid(
                "The home sent an invalid agent run or workspace ID",
            ));
        }
        let provider = self.provider(&run.project_id, &run.provider_id)?;
        // A new attempt never replaces a checkout that might contain
        // unsynchronized changes from an interrupted agent.
        let folder = if run.source.is_some() || !run.repositories.is_empty() {
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
    run_guardian(executable, args, Some(SetupPlan::Single(setup))).await
}

pub async fn run_agent_unit_with_repository_setup(args: &[OsString]) -> io::Result<ExitCode> {
    let root = std::env::current_dir()?.canonicalize()?;
    let (plan, executable, args) = SetupPlan::repository_args(&root, args)?;
    run_guardian(Path::new(executable), args, Some(plan)).await
}

async fn run_guardian(
    executable: &Path,
    args: &[OsString],
    setup: Option<SetupPlan>,
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
    setup: Option<SetupPlan>,
    input: &mut (impl AsyncRead + Unpin),
) -> io::Result<ExitCode> {
    if let Some(setup) = setup {
        use std::io::Write as _;
        let result = setup.run().await.encode_to_vec();
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
    workspace_root: PathBuf,
    reserve_before_transfer: bool,
    /// Where it keeps which agents are signed in, and the agents it has: said again with its capacity.
    sign_ins: Option<(PathBuf, Vec<String>)>,
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
                    capacity: (self.sequence.is_multiple_of(4))
                        .then(|| worker_capacity(&self.workspace_root))
                        .flatten(),
                    reports_sign_in: self.sign_ins.is_some() && self.sequence.is_multiple_of(4),
                    signed_in: match &self.sign_ins {
                        Some((path, providers)) if self.sequence.is_multiple_of(4) => {
                            signed_in_from(path, providers)
                        }
                        _ => Vec::new(),
                    },
                    readiness: match &self.sign_ins {
                        Some((path, providers)) if self.sequence.is_multiple_of(4) => {
                            readiness_from(&path.with_file_name("readiness"), providers)
                        }
                        _ => None,
                    },
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

    /// Waits for `work`, its heartbeats going meanwhile: the home sends nothing else while it waits for the worker.
    async fn alongside<T>(&mut self, work: impl Future<Output = T>) -> Result<T, Failure> {
        tokio::pin!(work);
        loop {
            tokio::select! {
                biased;
                _ = tokio::time::sleep_until(self.until) => return Err(invalid("The home stopped renewing the agent lease").into()),
                _ = self.send_heartbeat.tick() => self.heartbeat().await?,
                incoming = self.incoming.message() => match incoming?.and_then(|message| message.payload) {
                    Some(HomeMessage::Heartbeat(heartbeat)) => self.acknowledge(heartbeat)?,
                    Some(_) => return Err(invalid("The home sent work while the worker updates").into()),
                    None => return Err(invalid("The home closed the agent worker stream").into()),
                },
                value = &mut work => return Ok(value),
            }
        }
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
        setup: Option<&SetupPlan>,
        tools: &[String],
    ) -> Result<Self, Failure> {
        let mut args = setup.map_or_else(|| vec!["--agent-unit".into()], SetupPlan::guardian_args);
        args.push(provider.executable.clone().into_os_string());
        args.extend(provider.args.iter().map(OsString::from));
        let unit = Self::open_with(agent_service(&run.run_id), cwd, &args, None, tools).await?;
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
        Self::open_with(name, cwd, args, parent, &[]).await
    }

    /// A unit whose guardian installs `tools` (`name@version`) before its setup runs.
    async fn open_with(
        name: String,
        cwd: &Path,
        args: &[OsString],
        parent: Option<&str>,
        tools: &[String],
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
        if !tools.is_empty() {
            command.arg(format!("--setenv={TOOLS_VARIABLE}={}", tools.join(" ")));
        }
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

pub(crate) async fn unit_write(
    input: &mut (impl AsyncWrite + Unpin),
    data: &[u8],
) -> io::Result<()> {
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
    config: &AgentConfig,
    workspace: &AgentWorkspace,
    tools_port: u16,
    skills_path: &str,
) -> Result<(AgentRunOutcome, Option<u32>), Failure> {
    let workspace_path = workspace
        .root
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
                skills_path: skills_path.into(),
                mcp_commands: config.mcp_for(&run.project_id),
            }),
        ),
    )
    .await??;
    let mut buffer = [0; CHUNK_BYTES];
    let mut checkpoints = JoinSet::new();
    let mut files = JoinSet::new();
    let mut managed = ManagedCommands::new(
        &run.run_id,
        &workspace.root,
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
            result = files.join_next(), if !files.is_empty() => {
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
                    let path = workspace.checkout(&request.workspace_id)
                        .or_else(|| managed.checkout(&request.workspace_id)).map(Path::to_owned);
                    checkpoints.spawn(send_snapshot(slot.outgoing.clone(), path, request));
                }
                Some(HomeMessage::FileRequest(request)) if files.len() < 2 => {
                    let file = request.file.as_ref().ok_or_else(|| invalid("No worker file identity"))?;
                    if file.run_id != run.run_id || !valid_id(&file.file_id, "wfl_") {
                        return Err(invalid("This run does not own the requested file").into());
                    }
                    let root = workspace.checkout(&request.workspace_id).map(Path::to_owned);
                    files.spawn(send_file(slot.outgoing.clone(), root, request));
                }
                Some(HomeMessage::ManagedStart(request)) => managed.start(request)?,
                Some(HomeMessage::HelperStart(request)) => {
                    let provider = config.provider(&run.project_id, &request.provider_id)?;
                    managed.helper(request, provider)?;
                }
                Some(HomeMessage::HelperInput(request)) => managed.input(request)?,
                Some(HomeMessage::HelperSkillsChunk(frame)) => managed.receive_upload(frame, true).await?,
                Some(HomeMessage::HelperCheckoutChunk(frame)) => managed.receive_upload(frame, false).await?,
                Some(HomeMessage::ManagedStop(request)) => managed.stop(request).await?,
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
    cwd: Option<PathBuf>,
    request: AgentSnapshotRequest,
) -> io::Result<()> {
    let run_id = request.run_id;
    let workspace_id = request.workspace_id;
    let result = match cwd {
        Some(cwd) => {
            workspace_patch(
                &cwd,
                &run_id,
                &request.base_tree,
                &request.base_head,
                request.capture_index,
            )
            .await
        }
        None => Err(invalid(
            "The requested repository is outside this worker workspace",
        )),
    };
    let checkpoint = match result {
        Ok(checkpoint) => checkpoint,
        Err(error) => {
            eprintln!("Could not checkpoint agent files: {error}");
            return send(
                &outgoing,
                WorkerMessage::Snapshot(AgentSnapshotResult {
                    run_id,
                    workspace_id,
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
            workspace_id,
            tree: checkpoint.tree,
            size: checkpoint.patch.len() as u32,
            sha256: sha256(&checkpoint.patch),
            head: checkpoint.head,
            commits_size: checkpoint.commits.len() as u32,
            commits_sha256: sha256(&checkpoint.commits),
            index: checkpoint
                .index
                .as_ref()
                .map(|(tree, bytes)| AgentSnapshotIndex {
                    tree: tree.clone(),
                    size: bytes.len() as u32,
                    sha256: sha256(bytes),
                }),
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
    for chunk in checkpoint
        .index
        .iter()
        .flat_map(|(_, bytes)| bytes.chunks(CHUNK_BYTES))
    {
        send(
            &outgoing,
            WorkerMessage::IndexPatch(AgentRunBytes {
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

/// Asked by its home between runs: its updater, as its timer would run it, its heartbeats going meanwhile; then how it
/// went. On success the updater restarts it into its new release, and this never returns.
async fn update_now(slot: &mut Slot) -> Result<(), Failure> {
    let said = |outcome: AgentWorkerUpdateOutcome, version: String, message: String| {
        WorkerMessage::UpdateState(AgentWorkerUpdateState {
            outcome: outcome.into(),
            version: version.chars().take(64).collect(),
            message,
        })
    };
    timeout(
        REPLY_TIMEOUT,
        send(
            &slot.outgoing,
            said(
                AgentWorkerUpdateOutcome::Started,
                String::new(),
                String::new(),
            ),
        ),
    )
    .await??;
    let tools = update::Tools::default();
    let reply = match slot.alongside(update::run(&tools)).await? {
        update::Outcome::Current { version } => {
            said(AgentWorkerUpdateOutcome::Current, version, String::new())
        }
        update::Outcome::Waiting { version } => {
            said(AgentWorkerUpdateOutcome::Waiting, version, String::new())
        }
        update::Outcome::Failed { message } => {
            said(AgentWorkerUpdateOutcome::Failed, String::new(), message)
        }
    };
    timeout(REPLY_TIMEOUT, send(&slot.outgoing, reply)).await??;
    Ok(())
}

/// How an exchange with the home ended.
#[derive(Debug, Eq, PartialEq)]
pub enum SlotEnd {
    /// It ran or reconciled what the home sent, or the home had nothing for it.
    Served,
    /// The person removed this worker from its home: it should take itself off this computer.
    Removed,
}

pub async fn watch_agent_slot(
    address: &str,
    enrollment: &WorkerEnrollment<'_>,
    relay: Option<&WorkerRelay<'_>>,
    config: &AgentConfig,
    journal: &DiagnosticJournal,
) -> Result<SlotEnd, Failure> {
    let journal_id = journal.agent_identity()?;
    let Some(mut slot) = timeout(REPLY_TIMEOUT, async {
        let endpoint = endpoint(address, enrollment)?;
        let channel = match relay {
            Some(relay) => relay_channel(endpoint, relay).await?,
            None => endpoint.connect().await?,
        };
        let (outgoing, receiver) = mpsc::channel(4);
        let mut hello = AgentWorkerHello {
            worker_id: enrollment.worker_id.into(),
            version: PROTOCOL_VERSION,
            journal_id,
            capacity: worker_capacity(&config.root),
            reserve_before_transfer: true,
            capabilities: config
                .providers
                .iter()
                .map(|provider| provider.capability.clone())
                .collect(),
            any_project: config.any_project(),
            reports_sign_in: config.signed_in.is_some(),
            signed_in: config.signed_in(),
            release: config.release.clone(),
            readiness: config.readiness(),
            updates_on_request: update::available(),
            // It keeps each project's history, so the home sends only what that copy lacks.
            keeps_history: true,
            histories: Vec::new(),
        };
        // What it holds, as much as its hello has room for once framed.
        agent_history::tell(
            &mut hello,
            &agent_history::known(&config.root).await,
            MAX_HELLO_BYTES - 256,
        );
        send(&outgoing, WorkerMessage::Hello(hello)).await?;
        let mut incoming = control_client(channel.clone())
            .run_agent(ReceiverStream::new(receiver))
            .await?
            .into_inner();
        let hello = match incoming.message().await?.and_then(|frame| frame.payload) {
            Some(HomeMessage::Hello(hello)) => hello,
            // Removed while it was away: the home says so in place of its hello.
            Some(HomeMessage::Removed(_)) => return Ok(None),
            _ => return Err(invalid("The home did not accept the agent worker").into()),
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
        Ok::<_, Failure>(Some(Slot {
            channel,
            incoming,
            outgoing,
            send_heartbeat,
            sequence: 0,
            awaiting: None,
            lease,
            until: Instant::now() + lease,
            workspace_root: config.root.clone(),
            sign_ins: config.signed_in.as_ref().map(|path| {
                (
                    path.clone(),
                    config
                        .providers
                        .iter()
                        .map(|provider| provider.capability.provider_id.clone())
                        .collect(),
                )
            }),
            reserve_before_transfer: hello.reserve_before_transfer,
        }))
    })
    .await??
    else {
        return Ok(SlotEnd::Removed);
    };

    let reply = loop {
        break match slot.message().await? {
            // Only ever sent between runs, to a worker whose hello says it can: then the next instruction, on this stream.
            HomeMessage::Update(_) => {
                update_now(&mut slot).await?;
                continue;
            }
            HomeMessage::Start(run) => {
                let (outcome, exit_code, worker_busy) =
                    match execute(&mut slot, config, journal, &run).await {
                        Ok((outcome, exit_code)) => (outcome, exit_code, false),
                        Err(error) if error.downcast_ref::<WorkerBusy>().is_some() => {
                            (AgentRunOutcome::StartFailed, None, true)
                        }
                        Err(error) => return Err(error),
                    };
                AgentRunExit {
                    run_id: run.run_id,
                    outcome: outcome.into(),
                    exit_code,
                    worker_busy,
                }
            }
            HomeMessage::Reconcile(run) => {
                if !valid_id(&run.workspace_id, "ws_") {
                    return Err(invalid("The home sent an invalid workspace to reconcile").into());
                }
                let stopped = match journal.agent_group(&run.run_id)? {
                    Some(group) => {
                        let name = agent_service(&run.run_id);
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
                    worker_busy: false,
                }
            }
            // Only ever sent between runs: the home refuses to remove a worker at work.
            HomeMessage::Removed(_) => return Ok(SlotEnd::Removed),
            _ => {
                return Err(
                    invalid("Expected an agent run or reconciliation from the home").into(),
                );
            }
        };
    };
    let run_id = reply.run_id.clone();
    let start_failed = reply.outcome() == AgentRunOutcome::StartFailed;
    let confirmed = reply.outcome() != AgentRunOutcome::Unconfirmed;
    timeout(
        REPLY_TIMEOUT,
        send(&slot.outgoing, WorkerMessage::Exit(reply)),
    )
    .await??;
    // A successful end follows the home recording the outcome.
    timeout(REPLY_TIMEOUT, async {
        while let Some(frame) = slot.incoming.message().await? {
            match frame.payload {
                Some(HomeMessage::Heartbeat(_)) => {}
                Some(HomeMessage::Stop(stop)) if stop.run_id == run_id => {}
                // Older homes can have already sent workspace bytes when a start fails.
                Some(
                    HomeMessage::Checkout(data)
                    | HomeMessage::SetupChunk(data)
                    | HomeMessage::SkillsChunk(data),
                ) if start_failed && data.run_id == run_id && data.data.len() <= CHUNK_BYTES => {}
                _ => {
                    return Err(invalid(
                        "The home sent an unexpected frame after the agent outcome",
                    )
                    .into());
                }
            }
        }
        Ok::<(), Failure>(())
    })
    .await??;
    if confirmed {
        journal.forget_agent_group(&run_id)?;
        // Recorded and confirmed: nothing will ask for the run again, so what it made goes (cleanup.rs).
        if let Err(error) = forget_run(&config.root, &run_id) {
            eprintln!("Couldn't clean up after agent run {run_id}: {error}");
        }
    }
    Ok(SlotEnd::Served)
}

#[derive(Debug)]
struct WorkerBusy;

impl std::fmt::Display for WorkerBusy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("The worker account already has an active task")
    }
}

impl std::error::Error for WorkerBusy {}

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
    let _reservation = match reserve(&run.run_id).await {
        Ok(reserved) => reserved,
        Err(error) => {
            eprintln!("Could not reserve this worker: {error}");
            if error.kind() == io::ErrorKind::ResourceBusy {
                return Err(Box::new(WorkerBusy));
            }
            return Ok((AgentRunOutcome::StartFailed, None));
        }
    };
    if slot.reserve_before_transfer {
        timeout(
            REPLY_TIMEOUT,
            send(
                &slot.outgoing,
                WorkerMessage::Accepted(AgentRunAccepted {
                    run_id: run.run_id.clone(),
                }),
            ),
        )
        .await??;
    }
    let descriptor: Option<AgentWorkspaceSetup> = if let Some(source) = &run.setup {
        match receive_descriptor(slot, &run.run_id, source, DESCRIPTOR_BYTES, |message| {
            match message {
                HomeMessage::SetupChunk(frame) => Some(frame),
                _ => None,
            }
        })
        .await
        {
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
    let skills: Option<AgentSkillFiles> =
        if let Some(source) = &run.skills {
            match receive_descriptor(slot, &run.run_id, source, MAX_SKILL_BYTES, |message| {
                match message {
                    HomeMessage::SkillsChunk(frame) => Some(frame),
                    _ => None,
                }
            })
            .await
            {
                Ok(Some(files)) => Some(files),
                Ok(None) => return Ok((AgentRunOutcome::Stopped, None)),
                Err(error) => {
                    eprintln!("Could not receive the selected worker skills: {error}");
                    return Ok((AgentRunOutcome::StartFailed, None));
                }
            }
        } else {
            None
        };
    let workspace = match stage_workspace(slot, run, path).await {
        Ok(Some(path)) => path,
        Ok(None) => return Ok((AgentRunOutcome::Stopped, None)),
        Err(error) => {
            eprintln!("Could not stage the agent checkout: {error}");
            return Ok((AgentRunOutcome::StartFailed, None));
        }
    };
    let setup = match descriptor
        .as_ref()
        .map(|given| SetupPlan::from_wire(&workspace, given))
        .transpose()
    {
        Ok(setup) => setup,
        Err(error) => {
            eprintln!("Could not prepare the worker setup: {error}");
            return Ok((AgentRunOutcome::StartFailed, None));
        }
    };
    let skill_directory = match skills
        .map(|files| SkillDirectory::write(&workspace.root, &run.run_id, files))
        .transpose()
    {
        Ok(directory) => directory,
        Err(error) => {
            eprintln!("Could not prepare the selected worker skills: {error}");
            return Ok((AgentRunOutcome::StartFailed, None));
        }
    };
    let skills_path = skill_directory
        .as_ref()
        .map(SkillDirectory::as_str)
        .transpose()?
        .unwrap_or_default();
    // Checked with the plan above: a setup asking for a tool it doesn't install never got here.
    let tools = descriptor
        .as_ref()
        .map(tools_of)
        .transpose()
        .unwrap_or_default()
        .unwrap_or_default();
    let mut unit = match AgentUnit::start(
        run,
        provider,
        &workspace.root,
        journal,
        setup.as_ref(),
        &tools,
    )
    .await
    {
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
                result = serve_agent(slot, &mut unit, run, config, &workspace, tools_port, skills_path) => result,
                bridge = forward_tools(listener, channel, &run.run_id) => {
                    bridge?;
                    Err(invalid("The worker tool bridge stopped").into())
                }
            }
        }
        false => serve_agent(slot, &mut unit, run, config, &workspace, 0, skills_path).await,
    };
    if !stop_group(&unit.name, &unit.group).await {
        return Ok((AgentRunOutcome::Unconfirmed, None));
    }
    result
}

async fn receive_descriptor<T: Message + Default>(
    slot: &mut Slot,
    run_id: &str,
    source: &AgentWorkspaceSetupSource,
    maximum: usize,
    select: impl Fn(HomeMessage) -> Option<AgentRunBytes>,
) -> Result<Option<T>, Failure> {
    let size = source.size as usize;
    if size == 0 || size > maximum || source.sha256.len() != 32 {
        return Err(invalid("The worker data exceeded its bounds").into());
    }
    let mut bytes = Vec::with_capacity(size);
    while bytes.len() < size {
        let message = slot.message().await?;
        if matches!(&message, HomeMessage::Stop(stop) if stop.run_id == run_id) {
            return Ok(None);
        }
        let chunk = select(message)
            .filter(|chunk| {
                chunk.run_id == run_id
                    && !chunk.data.is_empty()
                    && chunk.data.len() <= CHUNK_BYTES
                    && bytes.len() + chunk.data.len() <= size
            })
            .ok_or_else(|| invalid("The home sent an invalid worker data frame"))?;
        bytes.extend_from_slice(&chunk.data);
    }
    if ring::digest::digest(&ring::digest::SHA256, &bytes).as_ref() != source.sha256.as_slice() {
        return Err(invalid("The worker data digest changed").into());
    }
    Ok(Some(T::decode(bytes.as_slice())?))
}

async fn stage_workspace(
    slot: &mut Slot,
    run: &AgentRunStart,
    path: PathBuf,
) -> Result<Option<AgentWorkspace>, Failure> {
    if !run.repositories.is_empty() {
        if run.source.is_some() {
            return Err(invalid("Choose a single source or a repository set").into());
        }
        return stage_workspace_set(slot, run, path).await;
    }
    let Some(source) = &run.source else {
        if path.canonicalize()? != path || !path.is_dir() {
            return Err(invalid("The assigned worker workspace is unavailable").into());
        }
        return Ok(Some(AgentWorkspace::single(path)));
    };
    let project = path
        .parent()
        .ok_or_else(|| invalid("The assigned worker workspace is unavailable"))?
        .to_owned();
    let mut transfer = WorkspaceTransfer::create(path, &run.run_id, source, &project)?;
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
        result = transfer.install(source) => Ok(Some(AgentWorkspace::single(result?))),
        message = slot.message() => match message? {
            HomeMessage::Stop(stop) if stop.run_id == run.run_id => Ok(None),
            _ => Err(invalid("The home sent an unexpected frame during checkout").into()),
        }
    }
}

async fn stage_workspace_set(
    slot: &mut Slot,
    run: &AgentRunStart,
    path: PathBuf,
) -> Result<Option<AgentWorkspace>, Failure> {
    let group = WorkspaceSet::new(path, &run.run_id, &run.workspace_id, &run.repositories)?;
    let mut uploads = group.uploads(&run.repositories)?;
    for (transfer, _) in &mut uploads {
        while !transfer.complete() {
            match slot.message().await? {
                HomeMessage::Checkout(frame)
                    if frame.run_id == run.run_id && frame.data.len() <= CHUNK_BYTES =>
                {
                    transfer.put(&frame.data)?
                }
                HomeMessage::Stop(stop) if stop.run_id == run.run_id => return Ok(None),
                _ => return Err(invalid("The home sent an invalid repository bundle frame").into()),
            }
        }
    }
    let install = async {
        for (transfer, source) in uploads {
            transfer.install(source).await?;
        }
        group.publish()
    };
    tokio::select! {
        result = install => Ok(Some(result?)),
        message = slot.message() => match message? {
            HomeMessage::Stop(stop) if stop.run_id == run.run_id => Ok(None),
            _ => Err(invalid("The home sent a frame while installing a repository set").into()),
        }
    }
}

#[cfg(test)]
mod config_tests {
    use super::*;

    #[test]
    fn local_mcp_registration_is_project_scoped_and_never_uses_checkout_files() -> io::Result<()> {
        let temp = tempfile::tempdir()?;
        let root = temp.path().join("workspaces");
        crate::agent_workspace::private_directory(&root)?;
        let local = temp.path().join("server");
        let project = format!("proj_{}", "1".repeat(32));
        let unknown = format!("proj_{}", "2".repeat(32));
        let binary = std::env::current_exe()?.canonicalize()?;
        std::os::unix::fs::symlink(&binary, &local)?;
        let config = temp.path().join("agents.conf");
        let base = format!(
            "{}\n{project}\tcodex\t{}\n",
            root.display(),
            binary.display()
        );
        let set_config = |extra| -> io::Result<()> {
            fs::write(&config, format!("{base}{extra}"))?;
            fs::set_permissions(&config, fs::Permissions::from_mode(0o600))
        };
        let entry = format!("mcp\t{project}\tprojectTools\t{}\n", local.display());
        set_config(entry.clone())?;
        let loaded = AgentConfig::read(&config)?;
        let tools = loaded.mcp.get(&project).expect("registered project");
        assert_eq!(tools[0].executable, binary.to_str().unwrap());
        assert!(!loaded.mcp.contains_key(&unknown));
        set_config(entry.repeat(2))?;
        assert!(AgentConfig::read(&config).is_err());
        set_config(entry.replace(&project, &unknown))?;
        assert!(AgentConfig::read(&config).is_err());
        let checked_out = root.join("tool");
        fs::write(&checked_out, b"script")?;
        fs::set_permissions(&checked_out, fs::Permissions::from_mode(0o700))?;
        fs::remove_file(&local)?;
        std::os::unix::fs::symlink(&checked_out, &local)?;
        set_config(entry)?;
        assert!(AgentConfig::read(&config).is_err());
        Ok(())
    }

    #[test]
    fn an_agent_for_any_project_runs_for_each_the_home_sends_and_says_who_is_signed_in()
    -> io::Result<()> {
        let temp = tempfile::tempdir()?;
        let root = temp.path().join("workspaces");
        crate::agent_workspace::private_directory(&root)?;
        let binary = std::env::current_exe()?.canonicalize()?;
        let config = temp.path().join("agents.conf");
        fs::write(
            &config,
            format!(
                "{}\n*\tcodex\t{}\n*\tclaude\t{}\n",
                root.display(),
                binary.display(),
                binary.display()
            ),
        )?;
        fs::set_permissions(&config, fs::Permissions::from_mode(0o600))?;
        let signed_in = temp.path().join("signed-in");
        let loaded = AgentConfig::read(&config)?.with_status(signed_in.clone(), "0.11.0".into());
        assert!(loaded.any_project());
        let project = format!("proj_{}", "1".repeat(32));
        assert!(loaded.provider(&project, "codex").is_ok());
        assert!(loaded.provider(&project, "opencode").is_err());
        assert!(loaded.provider("not-a-project", "codex").is_err());
        // Nothing said yet: none signed in. Then only the agents it has, once each.
        assert!(loaded.signed_in().is_empty());
        fs::write(&signed_in, "codex\nunknown\ncodex\n")?;
        assert_eq!(loaded.signed_in(), vec!["codex".to_owned()]);
        assert_eq!(loaded.release, "0.11.0");
        Ok(())
    }
}
