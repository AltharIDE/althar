use std::error::Error;
use std::fs::{self, File, OpenOptions};
use std::future::Future;
use std::io::{self, Read, Write};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use prost::Message;
use rustix::fs::OFlags;
use tokio::{
    io::AsyncReadExt,
    process::Command,
    sync::{mpsc, watch},
    time::Instant,
};
use tokio_stream::{Stream, StreamExt, wrappers::ReceiverStream};

use crate::grpc::{WorkerEnrollment, control_client, endpoint};
use crate::project::{ProjectConfig, ProjectUnit};
use crate::relay::{WorkerRelay, relay_channel};
use crate::wire::{
    DiagnosticClaim, DiagnosticLease, DiagnosticLog, DiagnosticOffer, DiagnosticOutcome,
    DiagnosticRenew, DiagnosticResult, HomeFrame, WorkerFrame,
};
use crate::wire::{home_frame, worker_frame};
use crate::{HandshakeError, MAX_HELLO_BYTES, accept_home_frame, valid_id, worker_hello};

const LEASE_MS: u32 = 15_000;
const RENEWAL_MS: u32 = 2_000;
const RUNTIME_LIMIT: Duration = Duration::from_secs(3);
const OUTPUT_BYTES: usize = 1024;
const LOG_CHUNK_BYTES: usize = 256;
const LOG_CHUNKS_LIMIT: usize = 16;
type Failure = Box<dyn Error + Send + Sync>;

fn invalid(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

fn private_file() -> OpenOptions {
    let mut options = OpenOptions::new();
    options
        .mode(0o600)
        .custom_flags(OFlags::NOFOLLOW.bits() as i32);
    options
}

fn verify_private(file: &File) -> io::Result<()> {
    let metadata = file.metadata()?;
    if !metadata.is_file()
        || metadata.nlink() != 1
        || metadata.mode() & 0o077 != 0
        || metadata.uid() != rustix::process::geteuid().as_raw()
    {
        return Err(invalid(
            "Expected a private regular file owned by the worker user",
        ));
    }
    Ok(())
}

pub fn read_credentials(path: &Path, private: bool) -> io::Result<Vec<u8>> {
    let file = private_file()
        .read(true)
        .custom_flags((OFlags::NOFOLLOW | OFlags::NONBLOCK).bits() as i32)
        .open(path)?;
    if private {
        verify_private(&file)?;
    } else if !file.metadata()?.is_file() {
        return Err(invalid("Expected a certificate file"));
    }
    let mut bytes = Vec::new();
    file.take(65537).read_to_end(&mut bytes)?;
    if bytes.is_empty() || bytes.len() > 65536 {
        return Err(invalid("Invalid certificate or key file size"));
    }
    Ok(bytes)
}

pub struct DiagnosticJournal {
    root: PathBuf,
    directory: File,
    _lock: File,
}

impl DiagnosticJournal {
    pub fn open(root: &Path, enrollment: &WorkerEnrollment<'_>) -> io::Result<Self> {
        if !valid_id(enrollment.home_id, "home_") || !valid_id(enrollment.worker_id, "wrk_") {
            return Err(invalid(
                "The journal needs a valid home and worker identity",
            ));
        }
        match fs::DirBuilder::new().mode(0o700).create(root) {
            Ok(()) => File::open(
                root.parent()
                    .filter(|p| !p.as_os_str().is_empty())
                    .unwrap_or(Path::new(".")),
            )?
            .sync_all()?,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
        let directory = OpenOptions::new()
            .read(true)
            .custom_flags((OFlags::DIRECTORY | OFlags::NOFOLLOW).bits() as i32)
            .open(root)?;
        let metadata = directory.metadata()?;
        if metadata.mode() & 0o077 != 0 || metadata.uid() != rustix::process::geteuid().as_raw() {
            return Err(invalid(
                "The worker journal directory must be private and owned by the worker user",
            ));
        }
        let root = root.canonicalize()?;
        let lock = private_file()
            .write(true)
            .read(true)
            .create(true)
            .open(root.join("worker.lock"))?;
        verify_private(&lock)?;
        lock.try_lock()?;
        let journal = Self {
            root,
            directory,
            _lock: lock,
        };
        let binding = format!("{}\n{}\n", enrollment.home_id, enrollment.worker_id);
        let path = journal.root.join("enrollment");
        match journal.read(&path, 128)? {
            Some(bytes) if bytes == binding.as_bytes() => {}
            Some(_) => return Err(invalid("This journal belongs to another enrollment")),
            None => journal.publish(&path, binding.as_bytes())?,
        }
        Ok(journal)
    }

    fn read(&self, path: &Path, limit: usize) -> io::Result<Option<Vec<u8>>> {
        let file = match private_file().read(true).open(path) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error),
        };
        verify_private(&file)?;
        let mut bytes = Vec::new();
        file.take((limit + 1) as u64).read_to_end(&mut bytes)?;
        if bytes.len() > limit {
            return Err(invalid("The journal record exceeds its size limit"));
        }
        Ok(Some(bytes))
    }

    fn publish(&self, path: &Path, bytes: &[u8]) -> io::Result<()> {
        let temporary = path.with_extension("tmp");
        // This process holds the journal lock. A staged file can only be left by a previous process.
        match fs::remove_file(&temporary) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        let mut file = private_file()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(temporary, path)?;
        self.directory.sync_all()
    }

    fn started(&self, offer: &DiagnosticOffer) -> io::Result<bool> {
        match self.read(
            &self.root.join(format!("{}.started", offer.attempt_id)),
            128,
        )? {
            None => Ok(false),
            Some(bytes) if bytes == offer.fence.as_bytes() => Ok(true),
            Some(_) => Err(invalid(
                "The attempt was already recorded under another fence",
            )),
        }
    }

    fn record_start(&self, offer: &DiagnosticOffer) -> io::Result<()> {
        self.publish(
            &self.root.join(format!("{}.started", offer.attempt_id)),
            offer.fence.as_bytes(),
        )
    }

    pub(crate) fn control_group(&self, offer: &DiagnosticOffer) -> io::Result<Option<Vec<u8>>> {
        self.read(
            &self.root.join(format!("{}.cgroup", offer.attempt_id)),
            4096,
        )
    }

    pub(crate) fn record_control_group(
        &self,
        offer: &DiagnosticOffer,
        group: &[u8],
    ) -> io::Result<()> {
        if group.len() > 4096 {
            return Err(invalid("The control group record exceeds its size limit"));
        }
        self.publish(
            &self.root.join(format!("{}.cgroup", offer.attempt_id)),
            group,
        )
    }

    fn result(&self, offer: &DiagnosticOffer) -> Result<Option<DiagnosticResult>, Failure> {
        let Some(bytes) = self.read(
            &self.root.join(format!("{}.result", offer.attempt_id)),
            MAX_HELLO_BYTES,
        )?
        else {
            return Ok(None);
        };
        let value = DiagnosticResult::decode(bytes.as_slice())?;
        if value.attempt_id != offer.attempt_id
            || value.fence != offer.fence
            || value.output.len() > OUTPUT_BYTES
        {
            return Err(invalid("The journal result does not match this attempt").into());
        }
        Ok(Some(value))
    }

    fn record_result(&self, result: &DiagnosticResult) -> io::Result<()> {
        self.publish(
            &self.root.join(format!("{}.result", result.attempt_id)),
            &result.encode_to_vec(),
        )
    }
}

fn report(
    offer: &DiagnosticOffer,
    outcome: DiagnosticOutcome,
    output: Vec<u8>,
) -> DiagnosticResult {
    DiagnosticResult {
        attempt_id: offer.attempt_id.clone(),
        fence: offer.fence.clone(),
        outcome: outcome.into(),
        output,
    }
}

async fn run_uname(
    deadline: Instant,
    offer: &DiagnosticOffer,
    log: Option<&mpsc::Sender<WorkerFrame>>,
) -> DiagnosticResult {
    let result = tokio::time::timeout_at(deadline, async {
        let mut child = Command::new("/usr/bin/uname")
            .arg("-s")
            .env_clear()
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()?;
        let mut output = child
            .stdout
            .take()
            .ok_or_else(|| invalid("The diagnostic has no output pipe"))?;
        let mut bytes = Vec::with_capacity(OUTPUT_BYTES);
        let mut buffer = [0; LOG_CHUNK_BYTES];
        let mut log_chunks = 0;
        loop {
            let count = output.read(&mut buffer).await?;
            if count == 0 {
                break;
            }
            let chunk = &buffer[..count.min(OUTPUT_BYTES - bytes.len())];
            // Keep draining the pipe after the retained prefix is full.
            if chunk.is_empty() {
                continue;
            }
            if let Some(send) = log.filter(|_| log_chunks < LOG_CHUNKS_LIMIT) {
                let offset = u32::try_from(bytes.len())
                    .map_err(|_| invalid("Invalid diagnostic log offset"))?;
                send.send(WorkerFrame {
                    payload: Some(worker_frame::Payload::DiagnosticLog(DiagnosticLog {
                        attempt_id: offer.attempt_id.clone(),
                        fence: offer.fence.clone(),
                        offset,
                        output: chunk.to_vec(),
                    })),
                })
                .await
                .map_err(|_| io::Error::from(io::ErrorKind::BrokenPipe))?;
                log_chunks += 1;
            }
            bytes.extend_from_slice(chunk);
        }
        let exit = child.wait().await?;
        Ok::<_, io::Error>((exit.success(), bytes))
    })
    .await;
    match result {
        Ok(Ok((true, bytes))) => report(offer, DiagnosticOutcome::Succeeded, bytes),
        Ok(Ok((false, bytes))) => report(offer, DiagnosticOutcome::Failed, bytes),
        Ok(Err(error)) if error.kind() == io::ErrorKind::BrokenPipe => {
            report(offer, DiagnosticOutcome::Unknown, Vec::new())
        }
        Ok(Err(_)) => report(offer, DiagnosticOutcome::Failed, Vec::new()),
        Err(_) => report(offer, DiagnosticOutcome::Unknown, Vec::new()),
    }
}

struct ExecutionLease {
    until: Instant,
    renew_at: Instant,
    sequence: u32,
    pending: Option<Instant>,
}

impl ExecutionLease {
    fn new(sent: Instant, run_for_ms: u32) -> Self {
        Self {
            until: sent + Duration::from_millis(u64::from(run_for_ms)),
            renew_at: sent + Duration::from_millis(u64::from((run_for_ms / 2).max(250))),
            sequence: 0,
            pending: None,
        }
    }

    fn renew(&mut self, at: Instant) -> u32 {
        self.sequence += 1;
        self.pending = Some(at);
        self.sequence
    }

    fn confirm(&mut self, at: Instant, sequence: u32, run_for_ms: u32) -> bool {
        let Some(sent) = self.pending else {
            return false;
        };
        if sequence != self.sequence
            || run_for_ms == 0
            || run_for_ms > RENEWAL_MS
            || at >= self.until
        {
            return false;
        }
        // Time in flight consumes the grant. A slow response cannot authorize
        // the worker to run beyond the deadline the home actually issued.
        let granted = Self::new(sent, run_for_ms);
        if granted.until <= at {
            return false;
        }
        self.until = granted.until;
        self.renew_at = granted.renew_at;
        self.pending = None;
        true
    }
}

fn matches_renewal(
    offer: &DiagnosticOffer,
    extension: &DiagnosticLease,
    sequence: Option<u32>,
) -> bool {
    let duration_is_valid = (1..=RENEWAL_MS).contains(&extension.run_for_ms)
        || (extension.run_for_ms == 0 && offer.project_command.is_some());
    sequence == Some(extension.sequence)
        && extension.attempt_id == offer.attempt_id
        && extension.fence == offer.fence
        && duration_is_valid
}

async fn run_with_lease(
    offer: &DiagnosticOffer,
    lease: &mut ExecutionLease,
    renewable: bool,
    send: &mpsc::Sender<WorkerFrame>,
    reply: &mut (impl Stream<Item = Result<HomeFrame, tonic::Status>> + Unpin),
    command: impl Future<Output = DiagnosticResult>,
    project_deadline: Option<&watch::Sender<Instant>>,
) -> Result<DiagnosticResult, Failure> {
    if Instant::now() >= lease.until {
        return Ok(report(offer, DiagnosticOutcome::Unknown, Vec::new()));
    }
    tokio::pin!(command);
    loop {
        tokio::select! {
            biased;
            _ = tokio::time::sleep_until(lease.until) => return Ok(report(offer, DiagnosticOutcome::Unknown, Vec::new())),
            result = &mut command => return Ok(result),
            disposition = reply.next() => {
                let Some(frame) = disposition.transpose()? else {
                    return Err(io::Error::new(io::ErrorKind::ConnectionAborted, "The home disconnected before the diagnostic finished").into());
                };
                let home_frame::Payload::DiagnosticLease(extension) = payload(Some(frame))? else {
                    return Err(HandshakeError::InvalidFrame.into());
                };
                if !renewable || !matches_renewal(offer, &extension, lease.pending.map(|_| lease.sequence)) {
                    return Err(HandshakeError::InvalidFrame.into());
                }
                if extension.run_for_ms == 0 && project_deadline.is_some() {
                    return Ok(report(offer, DiagnosticOutcome::Cancelled, Vec::new()));
                }
                if !lease.confirm(Instant::now(), extension.sequence, extension.run_for_ms) {
                    return Err(HandshakeError::InvalidFrame.into());
                }
                if let Some(deadline) = project_deadline {
                    deadline.send_replace(lease.until);
                }
            }
            permit = async {
                tokio::time::sleep_until(lease.renew_at).await;
                send.reserve().await
            }, if renewable && lease.pending.is_none() && lease.renew_at < lease.until => {
                let sequence = lease.renew(Instant::now());
                permit?.send(WorkerFrame { payload: Some(worker_frame::Payload::DiagnosticRenew(DiagnosticRenew {
                    attempt_id: offer.attempt_id.clone(), fence: offer.fence.clone(), sequence,
                })) });
            }
        }
    }
}

fn payload(frame: Option<HomeFrame>) -> Result<home_frame::Payload, HandshakeError> {
    frame
        .and_then(|value| value.payload)
        .ok_or(HandshakeError::InvalidFrame)
}

pub async fn run_diagnostic(
    address: &str,
    enrollment: WorkerEnrollment<'_>,
    journal: &DiagnosticJournal,
) -> Result<Option<DiagnosticResult>, Failure> {
    run_diagnostic_with_transport(address, enrollment, journal, None).await
}

pub async fn run_diagnostic_with_transport(
    address: &str,
    enrollment: WorkerEnrollment<'_>,
    journal: &DiagnosticJournal,
    relay: Option<&WorkerRelay<'_>>,
) -> Result<Option<DiagnosticResult>, Failure> {
    run_worker_once(address, enrollment, journal, relay, None).await
}

pub async fn run_worker_once(
    address: &str,
    enrollment: WorkerEnrollment<'_>,
    journal: &DiagnosticJournal,
    relay: Option<&WorkerRelay<'_>>,
    project: Option<&ProjectConfig>,
) -> Result<Option<DiagnosticResult>, Failure> {
    let mut hello = worker_hello(enrollment.worker_id)?;
    if let Some(worker_frame::Payload::Hello(hello)) = &mut hello.payload {
        hello.accepts_diagnostics = true;
        hello.renews_diagnostic_lease = true;
        hello.streams_diagnostic_logs = true;
        hello.accepts_project_commands = project.is_some();
    }
    tokio::time::timeout(
        Duration::from_secs(if project.is_some() { 90 } else { 25 }),
        async {
            let endpoint = endpoint(address, &enrollment)?;
            let channel = match relay {
                Some(relay) => relay_channel(endpoint, relay).await?,
                None => endpoint.connect().await?,
            };
            let mut client = control_client(channel);
            let (send, receive) = mpsc::channel(2);
            send.send(hello).await?;
            let mut reply = client
                .connect(ReceiverStream::new(receive))
                .await?
                .into_inner();
            let hello = accept_home_frame(
                reply.message().await?.ok_or(HandshakeError::InvalidFrame)?,
                enrollment.home_id,
                enrollment.worker_id,
            )?;
            if !hello.supports_diagnostics {
                return Err(HandshakeError::IncompatibleVersion.into());
            }
            let Some(frame) = reply.message().await? else {
                return Ok(None);
            };
            let home_frame::Payload::DiagnosticOffer(offer) = payload(Some(frame))? else {
                return Err(HandshakeError::InvalidFrame.into());
            };
            let prefix = if offer.project_command.is_some() {
                if project.is_none()
                    || !hello.supports_project_commands
                    || !hello.supports_diagnostic_logs
                    || !hello.supports_diagnostic_lease_renewal
                {
                    return Err(HandshakeError::InvalidFrame.into());
                }
                "wpr_"
            } else {
                "watt_"
            };
            if !valid_id(&offer.attempt_id, prefix)
                || !valid_id(&offer.fence, "wfn_")
                || offer.claimable_for_ms > LEASE_MS
            {
                return Err(HandshakeError::InvalidFrame.into());
            }
            let mut pending_acknowledgment = None;
            let result = if let Some(result) = journal.result(&offer)? {
                result
            } else if journal.started(&offer)? || offer.claimable_for_ms == 0 {
                if offer.project_command.is_some() {
                    ProjectUnit::new(&offer).stop(journal, &offer).await?;
                }
                report(&offer, DiagnosticOutcome::Unknown, Vec::new())
            } else {
                let claim_sent = Instant::now();
                send.send(WorkerFrame {
                    payload: Some(worker_frame::Payload::DiagnosticClaim(DiagnosticClaim {
                        attempt_id: offer.attempt_id.clone(),
                        fence: offer.fence.clone(),
                    })),
                })
                .await?;
                let home_frame::Payload::DiagnosticStart(start) = payload(reply.message().await?)?
                else {
                    return Err(HandshakeError::InvalidFrame.into());
                };
                let renewable = hello.supports_diagnostic_lease_renewal;
                let maximum = if renewable { RENEWAL_MS } else { LEASE_MS };
                if start.attempt_id != offer.attempt_id
                    || start.fence != offer.fence
                    || start.run_for_ms == 0
                    || start.run_for_ms > maximum
                {
                    return Err(HandshakeError::InvalidFrame.into());
                }
                let mut lease = ExecutionLease::new(claim_sent, start.run_for_ms);
                journal.record_start(&offer)?;
                let result = if let Some(request) = &offer.project_command {
                    if let Some(config) = project.filter(|config| config.matches(request)) {
                        let unit = ProjectUnit::new(&offer);
                        let (deadline, updates) = watch::channel(lease.until);
                        let execution = run_with_lease(
                            &offer,
                            &mut lease,
                            true,
                            &send,
                            &mut reply,
                            async {
                                let outcome =
                                    match unit.run(config, &offer, &send, updates, journal).await {
                                        Ok(outcome) => outcome,
                                        Err(error) => {
                                            eprintln!(
                                                "Could not supervise the project command: {error}"
                                            );
                                            DiagnosticOutcome::Unknown
                                        }
                                    };
                                report(&offer, outcome, Vec::new())
                            },
                            Some(&deadline),
                        )
                        .await;
                        unit.stop(journal, &offer).await?;
                        match execution {
                            Ok(result) => result,
                            Err(error) => {
                                journal.record_result(&report(
                                    &offer,
                                    DiagnosticOutcome::Unknown,
                                    Vec::new(),
                                ))?;
                                return Err(error);
                            }
                        }
                    } else {
                        report(
                            &offer,
                            DiagnosticOutcome::Failed,
                            b"No matching command is configured on this worker".to_vec(),
                        )
                    }
                } else {
                    run_with_lease(
                        &offer,
                        &mut lease,
                        renewable,
                        &send,
                        &mut reply,
                        run_uname(
                            Instant::now() + RUNTIME_LIMIT,
                            &offer,
                            (renewable && hello.supports_diagnostic_logs).then_some(&send),
                        ),
                        None,
                    )
                    .await?
                };
                pending_acknowledgment = lease.pending.map(|_| lease.sequence);
                journal.record_result(&result)?;
                result
            };
            send.send(WorkerFrame {
                payload: Some(worker_frame::Payload::DiagnosticResult(result.clone())),
            })
            .await?;
            if let Some(frame) = reply.message().await? {
                // A result can race with a renewal already sent on this stream.
                // Drain that one in-flight acknowledgment without granting any more work.
                let home_frame::Payload::DiagnosticLease(extension) = payload(Some(frame))? else {
                    return Err(HandshakeError::InvalidFrame.into());
                };
                if !matches_renewal(&offer, &extension, pending_acknowledgment)
                    || reply.message().await?.is_some()
                {
                    return Err(HandshakeError::InvalidFrame.into());
                }
            }
            Ok(Some(result))
        },
    )
    .await?
}

#[cfg(test)]
mod execution_lease_tests {
    use super::*;

    #[test]
    fn a_reply_counts_from_the_request_and_cannot_revive_an_expired_lease() {
        let start = Instant::now();
        let mut lease = ExecutionLease::new(start, 2000);
        assert!(!lease.confirm(start, 0, 2000));
        let sent = start + Duration::from_millis(1000);
        assert_eq!(lease.renew(sent), 1);
        assert!(!lease.confirm(sent, 2, 2000));
        assert!(!lease.confirm(sent, 1, 2001));
        assert!(lease.confirm(sent + Duration::from_millis(300), 1, 2000));
        assert_eq!(lease.until, start + Duration::from_secs(3));
        assert!(!lease.confirm(sent, 1, 2000));
        assert_eq!(lease.renew(start + Duration::from_millis(2400)), 2);
        assert!(!lease.confirm(start + Duration::from_secs(3), 2, 2000));
    }

    #[tokio::test]
    async fn an_expired_grant_does_not_start_the_command() {
        let (send, _commands) = mpsc::channel(1);
        let mut disconnected = tokio_stream::empty();
        let offer = DiagnosticOffer {
            attempt_id: "attempt".into(),
            fence: "fence".into(),
            claimable_for_ms: 0,
            project_command: None,
        };
        let mut expired = ExecutionLease::new(Instant::now(), 0);
        let result = run_with_lease(
            &offer,
            &mut expired,
            true,
            &send,
            &mut disconnected,
            async {
                panic!("The command ran after its lease expired");
            },
            None,
        )
        .await
        .unwrap();
        assert_eq!(result.outcome(), DiagnosticOutcome::Unknown);
    }

    #[tokio::test]
    async fn a_silent_connection_cannot_keep_running_work_alive() {
        let (send, _requests) = mpsc::channel(1);
        let mut silent = tokio_stream::pending();
        let offer = DiagnosticOffer {
            attempt_id: "attempt".into(),
            fence: "fence".into(),
            claimable_for_ms: 0,
            project_command: None,
        };
        let mut lease = ExecutionLease::new(Instant::now(), 100);
        lease.renew_at = Instant::now();
        let result = tokio::time::timeout(
            RUNTIME_LIMIT,
            run_with_lease(
                &offer,
                &mut lease,
                true,
                &send,
                &mut silent,
                std::future::pending(),
                None,
            ),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(result.outcome(), DiagnosticOutcome::Unknown);
    }

    #[tokio::test]
    async fn disconnect_drops_running_work_after_a_renewal_request() {
        struct Running<'a>(&'a std::cell::Cell<bool>);
        impl Drop for Running<'_> {
            fn drop(&mut self) {
                self.0.set(true);
            }
        }

        let (send, mut requests) = mpsc::channel::<WorkerFrame>(1);
        let (home, replies) = mpsc::channel(1);
        let mut replies = ReceiverStream::new(replies);
        let offer = DiagnosticOffer {
            attempt_id: "attempt".into(),
            fence: "fence".into(),
            claimable_for_ms: 0,
            project_command: None,
        };
        let mut lease = ExecutionLease::new(Instant::now(), RENEWAL_MS);
        lease.renew_at = Instant::now();
        let stopped = std::cell::Cell::new(false);
        let command = async {
            let _guard = Running(&stopped);
            std::future::pending().await
        };
        let disconnect = async {
            let request = tokio::time::timeout(RUNTIME_LIMIT, requests.recv())
                .await
                .unwrap()
                .unwrap();
            let Some(worker_frame::Payload::DiagnosticRenew(request)) = request.payload else {
                panic!("expected a renewal");
            };
            assert_eq!(request.sequence, 1);
            drop(home);
        };
        let (result, ()) = tokio::join!(
            run_with_lease(&offer, &mut lease, true, &send, &mut replies, command, None),
            disconnect
        );
        assert!(result.unwrap_err().to_string().contains("disconnected"));
        assert!(stopped.get());
    }
}
