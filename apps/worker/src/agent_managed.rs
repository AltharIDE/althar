use std::{
    collections::HashMap,
    ffi::OsString,
    io,
    path::{Path, PathBuf},
};

use prost::Message;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::{mpsc, watch},
    task::JoinSet,
    time::{Instant, timeout, timeout_at},
};
use tonic::transport::Channel;

use crate::{
    agent::{
        AgentUnit, CHUNK_BYTES, COULD_NOT_START, Failure, LOST_LEASE, Provider, STOP_TIMEOUT,
        Sender, local_deadline, send, stop_group, unit_write, update_unit_lease,
    },
    agent_preview::forward_preview,
    agent_setup::workspace_folder,
    agent_skills::{MAX_BYTES as MAX_SKILL_BYTES, SkillDirectory},
    agent_workspace::WorkspaceTransfer,
    valid_id,
    wire::{
        AgentHelperStart, AgentManagedExit, AgentManagedInput, AgentManagedOutput, AgentManagedRef,
        AgentManagedStart, AgentPreviewOpen, AgentRunOutcome, AgentSkillFiles,
        AgentWorkspaceSetupSource, AgentWorkspaceSource,
        agent_worker_frame::Payload as WorkerMessage,
    },
};

const MAX_COMMANDS: usize = 8;

pub(crate) struct ManagedCommands<'a> {
    run_id: &'a str,
    root: &'a Path,
    parent: &'a str,
    outgoing: Sender,
    lease: watch::Sender<Instant>,
    active: HashMap<String, ActiveCommand>,
    pending: Option<PendingHelper>,
    tasks: JoinSet<String>,
    previews: JoinSet<()>,
}

struct PendingHelper {
    managed: AgentManagedRef,
    directory: String,
    provider: Program,
    checkout: Option<CheckoutUpload>,
    skills: Option<SkillUpload>,
}

struct SkillUpload {
    descriptor: AgentWorkspaceSetupSource,
    bytes: Vec<u8>,
}

struct CheckoutUpload {
    destination: PathBuf,
    source: AgentWorkspaceSource,
    transfer: WorkspaceTransfer,
}

#[derive(Default)]
struct HelperFiles {
    checkout: Option<CheckoutUpload>,
    skills: Option<AgentSkillFiles>,
}

struct ActiveCommand {
    stop: watch::Sender<bool>,
    group: watch::Receiver<Option<PathBuf>>,
    input: Option<mpsc::Sender<Vec<u8>>>,
    checkout: Option<PathBuf>,
}

enum Program {
    Shell(String),
    Provider {
        executable: PathBuf,
        args: Vec<String>,
    },
}

impl<'a> ManagedCommands<'a> {
    pub(crate) fn new(
        run_id: &'a str,
        root: &'a Path,
        parent: &'a str,
        outgoing: Sender,
        until: Instant,
    ) -> Self {
        let (lease, _) = watch::channel(until);
        Self {
            run_id,
            root,
            parent,
            outgoing,
            lease,
            active: HashMap::new(),
            pending: None,
            tasks: JoinSet::new(),
            previews: JoinSet::new(),
        }
    }

    pub(crate) fn has_commands(&self) -> bool {
        !self.tasks.is_empty() || !self.previews.is_empty()
    }

    pub(crate) fn renew(&self, until: Instant) {
        self.lease.send_replace(until);
    }

    pub(crate) fn preview(&mut self, request: AgentPreviewOpen, channel: Channel) {
        let Some(managed) = request
            .managed
            .filter(|managed| managed.run_id == self.run_id)
        else {
            return;
        };
        let Ok(port) = u16::try_from(request.port) else {
            return;
        };
        if port == 0 || !valid_id(&request.tunnel_id, "prv_") || self.previews.len() >= 4 {
            return;
        }
        let Some(command) = self.active.get(&managed.command_id) else {
            return;
        };
        if command.input.is_some() {
            return;
        }
        let Some(group) = command.group.borrow().clone() else {
            return;
        };
        let mut stopped = command.stop.subscribe();
        let mut process = command.group.clone();
        if *stopped.borrow_and_update() || process.borrow_and_update().is_none() {
            return;
        }
        self.previews.spawn(async move {
            tokio::select! {
                _ = stopped.changed() => {},
                _ = process.changed() => {},
                _ = forward_preview(channel, request.tunnel_id, group, port) => {},
            }
        });
    }

    pub(crate) fn start(&mut self, request: AgentManagedStart) -> io::Result<()> {
        self.launch(
            request.managed,
            request.directory,
            Program::Shell(request.command),
            HelperFiles::default(),
        )
    }

    pub(crate) fn helper(
        &mut self,
        request: AgentHelperStart,
        provider: &Provider,
    ) -> io::Result<()> {
        let program = Program::Provider {
            executable: provider.executable.clone(),
            args: provider.args.clone(),
        };
        if request.checkout.is_none() && request.skills.is_none() {
            return self.launch(
                request.managed,
                request.directory,
                program,
                HelperFiles::default(),
            );
        }
        let managed = self.validate(request.managed)?;
        if self.pending.is_some() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Another helper upload is pending",
            ));
        }
        let checkout = request
            .checkout
            .map(|source| {
                let scope = format!("{}-{}", managed.run_id, managed.command_id);
                let site = self
                    .root
                    .parent()
                    .ok_or_else(|| io::Error::other("No helper workspace root"))?;
                let destination = site.join(&scope);
                let transfer = WorkspaceTransfer::create(destination.clone(), &scope, &source)?;
                Ok::<_, io::Error>(CheckoutUpload {
                    destination,
                    source,
                    transfer,
                })
            })
            .transpose()?;
        let skills = request
            .skills
            .map(|descriptor| {
                let size = descriptor.size as usize;
                if size == 0 || size > MAX_SKILL_BYTES || descriptor.sha256.len() != 32 {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "Invalid worker helper skill upload",
                    ));
                }
                Ok(SkillUpload {
                    descriptor,
                    bytes: Vec::with_capacity(size),
                })
            })
            .transpose()?;
        self.pending = Some(PendingHelper {
            managed,
            directory: request.directory,
            provider: program,
            checkout,
            skills,
        });
        Ok(())
    }

    pub(crate) async fn receive_upload(
        &mut self,
        frame: AgentManagedInput,
        skill: bool,
    ) -> io::Result<()> {
        let bad_frame = || {
            io::Error::new(
                io::ErrorKind::InvalidData,
                "Invalid worker helper upload frame",
            )
        };
        let pending = self.pending.as_mut().ok_or_else(bad_frame)?;
        if frame.managed.as_ref() != Some(&pending.managed)
            || frame.data.is_empty()
            || frame.data.len() > CHUNK_BYTES
        {
            return Err(bad_frame());
        }
        if skill {
            if pending
                .checkout
                .as_ref()
                .is_some_and(|upload| !upload.transfer.complete())
            {
                return Err(bad_frame());
            }
            let upload = pending.skills.as_mut().ok_or_else(bad_frame)?;
            let size = upload.descriptor.size as usize;
            if upload.bytes.len() + frame.data.len() > size {
                return Err(bad_frame());
            }
            upload.bytes.extend_from_slice(&frame.data);
            if upload.bytes.len() != size {
                return Ok(());
            }
        } else {
            let upload = pending.checkout.as_mut().ok_or_else(bad_frame)?;
            upload.transfer.put(&frame.data)?;
            if !upload.transfer.complete() || pending.skills.is_some() {
                return Ok(());
            }
        }
        let pending = self
            .pending
            .take()
            .expect("the helper has a completed upload");
        let chosen = pending
            .skills
            .map(|upload| {
                let digest = ring::digest::digest(&ring::digest::SHA256, &upload.bytes);
                if digest.as_ref() != upload.descriptor.sha256 {
                    return Err(bad_frame());
                }
                AgentSkillFiles::decode(upload.bytes.as_slice()).map_err(io::Error::other)
            })
            .transpose();
        match chosen {
            Ok(skills) if self.can_launch(&pending.managed) => self.launch(
                Some(pending.managed),
                pending.directory,
                pending.provider,
                HelperFiles {
                    checkout: pending.checkout,
                    skills,
                },
            ),
            _ => {
                self.finish_pending(pending.managed, AgentRunOutcome::StartFailed)
                    .await
            }
        }
    }

    pub(crate) fn checkout(&self, id: &str) -> Option<&Path> {
        let command = self.active.get(id)?;
        if *command.stop.borrow() || command.group.borrow().is_none() {
            return None;
        }
        command.checkout.as_deref()
    }

    async fn finish_pending(
        &self,
        managed: AgentManagedRef,
        outcome: AgentRunOutcome,
    ) -> io::Result<()> {
        send(
            &self.outgoing,
            WorkerMessage::ManagedExit(AgentManagedExit {
                managed: Some(managed),
                outcome: outcome.into(),
                exit_code: None,
            }),
        )
        .await
    }

    pub(crate) fn input(&self, request: AgentManagedInput) -> io::Result<()> {
        let Some(managed) = request
            .managed
            .filter(|id| id.run_id == self.run_id && valid_id(&id.command_id, "proc_"))
        else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Invalid worker helper identity",
            ));
        };
        if request.data.is_empty() || request.data.len() > CHUNK_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Invalid worker helper input",
            ));
        }
        if let Some(command) = self.active.get(&managed.command_id)
            && let Some(input) = &command.input
            && input.try_send(request.data).is_err()
        {
            command.stop.send_replace(true);
        }
        Ok(())
    }

    fn can_launch(&self, managed: &AgentManagedRef) -> bool {
        self.active.len() + usize::from(self.pending.is_some()) < MAX_COMMANDS
            && !self.active.contains_key(&managed.command_id)
            && self
                .pending
                .as_ref()
                .is_none_or(|pending| pending.managed.command_id != managed.command_id)
    }

    fn validate(&self, managed: Option<AgentManagedRef>) -> io::Result<AgentManagedRef> {
        let Some(managed) =
            managed.filter(|id| id.run_id == self.run_id && valid_id(&id.command_id, "proc_"))
        else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Invalid managed command identity",
            ));
        };
        if !self.can_launch(&managed) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Too many or duplicate managed commands",
            ));
        }
        Ok(managed)
    }

    fn launch(
        &mut self,
        managed: Option<AgentManagedRef>,
        directory: String,
        program: Program,
        files: HelperFiles,
    ) -> io::Result<()> {
        let managed = self.validate(managed)?;
        let (stop, stopped) = watch::channel(false);
        let (process, group) = watch::channel(None);
        let (input, incoming) = if matches!(program, Program::Provider { .. }) {
            let (send, receive) = mpsc::channel(48);
            (Some(send), Some(receive))
        } else {
            (None, None)
        };
        self.active.insert(
            managed.command_id.clone(),
            ActiveCommand {
                stop,
                group,
                input,
                checkout: files
                    .checkout
                    .as_ref()
                    .map(|upload| upload.destination.clone()),
            },
        );
        let root = self.root.to_owned();
        let parent = self.parent.to_owned();
        let outgoing = self.outgoing.clone();
        let lease = self.lease.subscribe();
        self.tasks.spawn(async move {
            let requested = Command {
                managed,
                root,
                parent,
                outgoing,
                directory,
                program,
            };
            let (outcome, exit_code) = requested
                .run(lease, stopped, process, incoming, files)
                .await;
            let id = requested.managed.command_id.clone();
            let _ = send(
                &requested.outgoing,
                WorkerMessage::ManagedExit(AgentManagedExit {
                    managed: Some(requested.managed),
                    outcome: outcome.into(),
                    exit_code,
                }),
            )
            .await;
            id
        });
        Ok(())
    }

    pub(crate) async fn stop(&mut self, request: AgentManagedRef) -> io::Result<()> {
        if request.run_id != self.run_id || !valid_id(&request.command_id, "proc_") {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Invalid managed command stop",
            ));
        }
        if self
            .pending
            .as_ref()
            .is_some_and(|pending| pending.managed == request)
        {
            self.pending = None;
            return self.finish_pending(request, AgentRunOutcome::Stopped).await;
        }
        if let Some(command) = self.active.get(&request.command_id) {
            command.stop.send_replace(true);
        }
        Ok(())
    }

    pub(crate) async fn finished(&mut self) -> Result<(), Failure> {
        tokio::select! {
            result = self.tasks.join_next(), if !self.tasks.is_empty() => {
                if let Some(result) = result { self.active.remove(&result?); }
            }
            _ = self.previews.join_next(), if !self.previews.is_empty() => {}
        }
        Ok(())
    }
}

struct Command {
    managed: AgentManagedRef,
    root: PathBuf,
    parent: String,
    outgoing: Sender,
    directory: String,
    program: Program,
}

impl Command {
    async fn run(
        &self,
        mut lease: watch::Receiver<Instant>,
        mut stopped: watch::Receiver<bool>,
        process: watch::Sender<Option<PathBuf>>,
        incoming: Option<mpsc::Receiver<Vec<u8>>>,
        files: HelperFiles,
    ) -> (AgentRunOutcome, Option<u32>) {
        if *stopped.borrow() {
            return (AgentRunOutcome::Stopped, None);
        }
        let checkout = if let Some(upload) = files.checkout {
            let installation = upload.transfer.install(&upload.source);
            tokio::pin!(installation);
            loop {
                let until = *lease.borrow_and_update();
                tokio::select! {
                    biased;
                    _ = stopped.changed() => return (AgentRunOutcome::Stopped, None),
                    _ = tokio::time::sleep_until(until) => return (AgentRunOutcome::Unconfirmed, None),
                    Ok(()) = lease.changed() => {},
                    installed = &mut installation => match installed {
                        Ok(checkout) => break Some(checkout),
                        Err(error) => {
                            eprintln!("Could not install a helper checkout: {error}");
                            return (AgentRunOutcome::StartFailed, None);
                        }
                    },
                }
            }
        } else {
            None
        };
        let _skill_directory = if let Some(skills) = files.skills {
            let root = self.root.clone();
            let scope = format!("{}-{}", self.managed.run_id, self.managed.command_id);
            match tokio::task::spawn_blocking(move || SkillDirectory::write(&root, &scope, skills))
                .await
            {
                Ok(Ok(directory)) => Some(directory),
                _ => return (AgentRunOutcome::StartFailed, None),
            }
        } else {
            None
        };
        if *stopped.borrow() {
            return (AgentRunOutcome::Stopped, None);
        }
        let initial = *lease.borrow_and_update();
        let Ok(Ok(mut unit)) = timeout_at(
            initial,
            self.open(checkout.as_deref().unwrap_or(&self.root)),
        )
        .await
        else {
            return (AgentRunOutcome::StartFailed, None);
        };
        process.send_replace(Some(unit.group.clone()));
        let result = self.serve(&mut unit, &mut lease, stopped, incoming).await;
        process.send_replace(None);
        if !stop_group(&unit.name, &unit.group).await {
            return (AgentRunOutcome::Unconfirmed, None);
        }
        result.unwrap_or((AgentRunOutcome::Unconfirmed, None))
    }

    async fn open(&self, root: &Path) -> Result<AgentUnit, Failure> {
        let cwd = workspace_folder(root, Path::new(&self.directory))?;
        let name = format!(
            "althar-managed-{}-{}.service",
            self.managed.run_id, self.managed.command_id
        );
        let mut args = vec!["--agent-unit".into()];
        match &self.program {
            Program::Shell(text) => {
                if text.len() > CHUNK_BYTES || text.contains('\0') || text.trim().is_empty() {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "Invalid managed command",
                    )
                    .into());
                }
                args.extend([
                    "/bin/sh".into(),
                    "-c".into(),
                    OsString::from(format!("exec 2>&1\n{text}")),
                ]);
            }
            Program::Provider {
                executable,
                args: fixed,
            } => {
                args.push(executable.clone().into_os_string());
                args.extend(fixed.iter().map(OsString::from));
            }
        }
        AgentUnit::open(name, &cwd, &args, Some(&self.parent)).await
    }

    async fn serve(
        &self,
        unit: &mut AgentUnit,
        lease: &mut watch::Receiver<Instant>,
        mut stopped: watch::Receiver<bool>,
        mut incoming: Option<mpsc::Receiver<Vec<u8>>>,
    ) -> Result<(AgentRunOutcome, Option<u32>), Failure> {
        if *stopped.borrow_and_update() {
            return Ok((AgentRunOutcome::Stopped, None));
        }
        let mut until = *lease.borrow_and_update();
        timeout_at(until, unit.input.write_u64_le(local_deadline(until))).await??;
        timeout_at(
            until,
            send(
                &self.outgoing,
                WorkerMessage::ManagedReady(self.managed.clone()),
            ),
        )
        .await??;
        let mut data = [0; CHUNK_BYTES];
        loop {
            tokio::select! {
                biased;
                _ = tokio::time::sleep_until(until) => return Ok((AgentRunOutcome::Unconfirmed, None)),
                _ = stopped.changed() => return Ok((AgentRunOutcome::Stopped, None)),
                changed = lease.changed() => {
                    changed?;
                    until = *lease.borrow_and_update();
                    update_unit_lease(&mut unit.input, until).await?;
                }
                input = async { match &mut incoming { Some(source) => source.recv().await, None => std::future::pending().await } } => {
                    let Some(input) = input else { return Ok((AgentRunOutcome::Stopped, None)); };
                    timeout_at(until, unit_write(&mut unit.input, &input)).await??;
                }
                read = unit.output.read(&mut data) => {
                    let size = read?;
                    if size == 0 {
                        let result = timeout(STOP_TIMEOUT, unit.child.wait()).await??;
                        return Ok(match result.code().and_then(|code| u8::try_from(code).ok()) {
                            Some(COULD_NOT_START) => (AgentRunOutcome::StartFailed, None),
                            None | Some(LOST_LEASE) => (AgentRunOutcome::Unconfirmed, None),
                            Some(code) => (AgentRunOutcome::Exited, Some(u32::from(code))),
                        });
                    }
                    timeout_at(until, send(&self.outgoing, WorkerMessage::ManagedOutput(AgentManagedOutput { managed: Some(self.managed.clone()), data: data[..size].to_vec() }))).await??;
                }
            }
        }
    }
}
