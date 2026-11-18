use std::error::Error;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use prost::Message;
use rustix::fs::OFlags;
use tokio::{io::AsyncReadExt, process::Command, sync::mpsc, time::Instant};
use tokio_stream::wrappers::ReceiverStream;

use crate::grpc::{WorkerEnrollment, client};
use crate::wire::{
    DiagnosticClaim, DiagnosticOffer, DiagnosticOutcome, DiagnosticResult, HomeFrame, WorkerFrame,
};
use crate::wire::{home_frame, worker_frame};
use crate::{HandshakeError, MAX_HELLO_BYTES, accept_home_frame, valid_id, worker_hello};

const LEASE_MS: u32 = 15_000;
const OUTPUT_BYTES: usize = 1024;
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

async fn run_uname(deadline: Instant, offer: &DiagnosticOffer) -> DiagnosticResult {
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
            .ok_or_else(|| invalid("The diagnostic has no output pipe"))?
            .take((OUTPUT_BYTES + 1) as u64);
        let mut bytes = Vec::new();
        output.read_to_end(&mut bytes).await?;
        let exit = child.wait().await?;
        bytes.truncate(OUTPUT_BYTES);
        Ok::<_, io::Error>((exit.success(), bytes))
    })
    .await;
    match result {
        Ok(Ok((true, bytes))) => report(offer, DiagnosticOutcome::Succeeded, bytes),
        Ok(Ok((false, bytes))) => report(offer, DiagnosticOutcome::Failed, bytes),
        Ok(Err(_)) => report(offer, DiagnosticOutcome::Failed, Vec::new()),
        Err(_) => report(offer, DiagnosticOutcome::Unknown, Vec::new()),
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
    let mut hello = worker_hello(enrollment.worker_id)?;
    if let Some(worker_frame::Payload::Hello(hello)) = &mut hello.payload {
        hello.accepts_diagnostics = true;
    }
    tokio::time::timeout(Duration::from_secs(25), async {
        let mut client = client(address, &enrollment).await?;
        let (send, receive) = mpsc::channel(2);
        send.send(hello).await?;
        let mut reply = client.connect(ReceiverStream::new(receive)).await?.into_inner();
        let hello = accept_home_frame(reply.message().await?.ok_or(HandshakeError::InvalidFrame)?, enrollment.home_id, enrollment.worker_id)?;
        if !hello.supports_diagnostics {
            return Err(HandshakeError::IncompatibleVersion.into());
        }
        let Some(frame) = reply.message().await? else { return Ok(None); };
        let home_frame::Payload::DiagnosticOffer(offer) = payload(Some(frame))? else {
            return Err(HandshakeError::InvalidFrame.into());
        };
        if !valid_id(&offer.attempt_id, "watt_") || !valid_id(&offer.fence, "wfn_") || offer.claimable_for_ms > LEASE_MS {
            return Err(HandshakeError::InvalidFrame.into());
        }
        let result = if let Some(result) = journal.result(&offer)? {
            result
        } else if journal.started(&offer)? || offer.claimable_for_ms == 0 {
            report(&offer, DiagnosticOutcome::Unknown, Vec::new())
        } else {
            send.send(WorkerFrame { payload: Some(worker_frame::Payload::DiagnosticClaim(DiagnosticClaim {
                attempt_id: offer.attempt_id.clone(), fence: offer.fence.clone(),
            })) }).await?;
            let home_frame::Payload::DiagnosticStart(start) = payload(reply.message().await?)? else {
                return Err(HandshakeError::InvalidFrame.into());
            };
            if start.attempt_id != offer.attempt_id || start.fence != offer.fence || start.run_for_ms == 0 || start.run_for_ms > LEASE_MS {
                return Err(HandshakeError::InvalidFrame.into());
            }
            let deadline = Instant::now() + Duration::from_millis(u64::from(start.run_for_ms.min(3000)));
            journal.record_start(&offer)?;
            let result = tokio::select! {
                biased;
                result = run_uname(deadline, &offer) => result,
                disconnected = reply.message() => {
                    disconnected?;
                    return Err(io::Error::new(io::ErrorKind::ConnectionAborted, "The home disconnected before the diagnostic finished").into());
                }
            };
            journal.record_result(&result)?;
            result
        };
        send.send(WorkerFrame { payload: Some(worker_frame::Payload::DiagnosticResult(result.clone())) }).await?;
        if reply.message().await?.is_some() {
            return Err(HandshakeError::InvalidFrame.into());
        }
        Ok(Some(result))
    }).await?
}
