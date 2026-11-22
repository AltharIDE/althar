use std::{
    collections::HashMap,
    ffi::OsString,
    io,
    path::{Path, PathBuf},
};

use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::watch,
    task::JoinSet,
    time::{Instant, timeout, timeout_at},
};
use tonic::transport::Channel;

use crate::{
    agent::{
        AgentUnit, CHUNK_BYTES, COULD_NOT_START, Failure, LOST_LEASE, STOP_TIMEOUT, Sender,
        local_deadline, send, stop_group, update_unit_lease,
    },
    agent_preview::forward_preview,
    agent_setup::workspace_folder,
    valid_id,
    wire::{
        AgentManagedExit, AgentManagedOutput, AgentManagedRef, AgentManagedStart, AgentPreviewOpen,
        AgentRunOutcome, agent_worker_frame::Payload as WorkerMessage,
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
    tasks: JoinSet<String>,
    previews: JoinSet<()>,
}

struct ActiveCommand {
    stop: watch::Sender<bool>,
    group: watch::Receiver<Option<PathBuf>>,
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
        let Some(managed) = request
            .managed
            .filter(|id| id.run_id == self.run_id && valid_id(&id.command_id, "proc_"))
        else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Invalid managed command identity",
            ));
        };
        if self.active.len() >= MAX_COMMANDS || self.active.contains_key(&managed.command_id) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Too many or duplicate managed commands",
            ));
        }
        let (stop, stopped) = watch::channel(false);
        let (process, group) = watch::channel(None);
        self.active
            .insert(managed.command_id.clone(), ActiveCommand { stop, group });
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
                directory: request.directory,
                text: request.command,
            };
            let (outcome, exit_code) = requested.run(lease, stopped, process).await;
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

    pub(crate) fn stop(&self, request: AgentManagedRef) -> io::Result<()> {
        if request.run_id != self.run_id || !valid_id(&request.command_id, "proc_") {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Invalid managed command stop",
            ));
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
    text: String,
}

impl Command {
    async fn run(
        &self,
        mut lease: watch::Receiver<Instant>,
        stopped: watch::Receiver<bool>,
        process: watch::Sender<Option<PathBuf>>,
    ) -> (AgentRunOutcome, Option<u32>) {
        if *stopped.borrow() {
            return (AgentRunOutcome::Stopped, None);
        }
        let initial = *lease.borrow_and_update();
        let Ok(Ok(mut unit)) = timeout_at(initial, self.open()).await else {
            return (AgentRunOutcome::StartFailed, None);
        };
        process.send_replace(Some(unit.group.clone()));
        let result = self.serve(&mut unit, &mut lease, stopped).await;
        process.send_replace(None);
        if !stop_group(&unit.name, &unit.group).await {
            return (AgentRunOutcome::Unconfirmed, None);
        }
        result.unwrap_or((AgentRunOutcome::Unconfirmed, None))
    }

    async fn open(&self) -> Result<AgentUnit, Failure> {
        if self.text.len() > CHUNK_BYTES || self.text.contains('\0') || self.text.trim().is_empty()
        {
            return Err(
                io::Error::new(io::ErrorKind::InvalidInput, "Invalid managed command").into(),
            );
        }
        let cwd = workspace_folder(&self.root, Path::new(&self.directory))?;
        let name = format!(
            "althar-managed-{}-{}.service",
            self.managed.run_id, self.managed.command_id
        );
        let script = format!("exec 2>&1\n{}", self.text);
        let args = [
            "--agent-unit".into(),
            "/bin/sh".into(),
            "-c".into(),
            OsString::from(script),
        ];
        AgentUnit::open(name, &cwd, &args, Some(&self.parent)).await
    }

    async fn serve(
        &self,
        unit: &mut AgentUnit,
        lease: &mut watch::Receiver<Instant>,
        mut stopped: watch::Receiver<bool>,
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
