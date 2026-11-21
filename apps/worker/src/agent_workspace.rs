use std::{
    fs::{self, DirBuilder, File, OpenOptions},
    io::{self, BufWriter, Write},
    os::unix::fs::{DirBuilderExt, OpenOptionsExt},
    path::{Path, PathBuf},
    process::Stdio,
};

use ring::digest::{Context, SHA256};
use rustix::fs::{CWD, RenameFlags, renameat_with};
use tokio::process::Command;

use crate::wire::AgentWorkspaceSource;

const MAX_BUNDLE_BYTES: u32 = 128 * 1024 * 1024;
const SNAPSHOT_REF: &str = "refs/althar/worker-snapshot";

fn invalid(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

pub(crate) struct WorkspaceTransfer {
    staging: PathBuf,
    destination: PathBuf,
    archive: BufWriter<File>,
    digest: Context,
    remaining: u32,
}

fn private_directory(path: &Path) -> io::Result<()> {
    DirBuilder::new().mode(0o700).create(path)
}

impl WorkspaceTransfer {
    pub(crate) fn create(
        destination: PathBuf,
        run_id: &str,
        source: &AgentWorkspaceSource,
    ) -> io::Result<Self> {
        if source.size == 0
            || source.size > MAX_BUNDLE_BYTES
            || source.sha256.len() != 32
            || !matches!(source.head.len(), 40 | 64)
            || !source
                .head
                .bytes()
                .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
        {
            return Err(invalid("The home sent invalid Git workspace metadata"));
        }
        let project = destination
            .parent()
            .ok_or_else(|| invalid("No project directory"))?;
        match private_directory(project) {
            Ok(()) => (),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => (),
            Err(error) => return Err(error),
        }
        if project.canonicalize()? != project || !project.is_dir() {
            return Err(invalid("The worker project directory is unavailable"));
        }
        if fs::symlink_metadata(&destination).is_ok() {
            return Err(invalid(
                "A worker workspace already exists; keep it for recovery",
            ));
        }
        let staging = project.join(format!(".{run_id}.import"));
        private_directory(&staging)?;
        let archive = match OpenOptions::new()
            .mode(0o600)
            .create_new(true)
            .write(true)
            .open(staging.join("source.bundle"))
        {
            Ok(file) => file,
            Err(error) => {
                let _ = fs::remove_dir(&staging);
                return Err(error);
            }
        };
        Ok(Self {
            staging,
            destination,
            archive: BufWriter::new(archive),
            digest: Context::new(&SHA256),
            remaining: source.size,
        })
    }

    pub(crate) fn put(&mut self, data: &[u8]) -> io::Result<()> {
        let count = u32::try_from(data.len()).map_err(io::Error::other)?;
        if count == 0 || count > self.remaining {
            return Err(invalid("The workspace transfer exceeded the declared size"));
        }
        self.archive.write_all(data)?;
        self.digest.update(data);
        self.remaining -= count;
        Ok(())
    }

    pub(crate) fn complete(&self) -> bool {
        self.remaining == 0
    }

    pub(crate) async fn install(mut self, source: &AgentWorkspaceSource) -> io::Result<PathBuf> {
        if !self.complete() || self.digest.clone().finish().as_ref() != source.sha256.as_slice() {
            return Err(invalid(
                "The worker received an incomplete or incorrect Git bundle",
            ));
        }
        self.archive.flush()?;
        self.archive.get_ref().sync_all()?;
        let checkout = self.staging.join("checkout");
        private_directory(&checkout)?;
        let object_format = if source.head.len() == 40 {
            "--object-format=sha1"
        } else {
            "--object-format=sha256"
        };
        run_git(
            &checkout,
            &["init", "--quiet", "--template=", object_format],
        )
        .await?;

        let archive = self.staging.join("source.bundle");
        let archive_path = archive
            .to_str()
            .ok_or_else(|| invalid("The workspace root must be UTF-8"))?;
        run_git(
            &checkout,
            &[
                "fetch",
                "--quiet",
                "--no-tags",
                "--no-recurse-submodules",
                archive_path,
                SNAPSHOT_REF,
            ],
        )
        .await?;
        let parent = run_git(&checkout, &["rev-parse", "--verify", "FETCH_HEAD^"]).await?;
        if parent.trim() != source.head {
            return Err(invalid(
                "The Git snapshot does not match the expected starting commit",
            ));
        }
        run_git(
            &checkout,
            &["checkout", "--quiet", "--detach", "FETCH_HEAD"],
        )
        .await?;
        run_git(&checkout, &["reset", "--quiet", "--mixed", &source.head]).await?;
        renameat_with(
            CWD,
            &checkout,
            CWD,
            &self.destination,
            RenameFlags::NOREPLACE,
        )
        .map_err(io::Error::from)?;
        File::open(
            self.destination
                .parent()
                .ok_or_else(|| invalid("No project directory"))?,
        )?
        .sync_all()?;
        Ok(self.destination.clone())
    }
}

impl Drop for WorkspaceTransfer {
    fn drop(&mut self) {
        // This name was exclusively created by this transfer. The installed workspace has a different name.
        if let Err(error) = fs::remove_dir_all(&self.staging)
            && error.kind() != io::ErrorKind::NotFound
        {
            eprintln!(
                "Could not remove a staged agent checkout ({})",
                error.kind()
            );
        }
    }
}

fn git_command(directory: &Path) -> Command {
    let mut command = Command::new("/usr/bin/git");
    command
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_TERMINAL_PROMPT", "0")
        .args([
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "protocol.file.allow=always",
        ])
        .current_dir(directory)
        .stdin(Stdio::null())
        .stderr(Stdio::inherit())
        .kill_on_drop(true);
    command
}

async fn run_git(directory: &Path, args: &[&str]) -> io::Result<String> {
    let response = git_command(directory).args(args).output().await?;
    if !response.status.success() {
        return Err(invalid(
            "Could not build the Git checkout from the received workspace",
        ));
    }
    String::from_utf8(response.stdout).map_err(io::Error::other)
}

const MAX_PATCH_BYTES: u64 = 16 * 1024 * 1024;

struct TemporaryIndex(PathBuf);

impl Drop for TemporaryIndex {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Build a binary patch without changing the provider's index or refs.
pub(crate) async fn workspace_patch(
    directory: &Path,
    run_id: &str,
    base: &str,
) -> io::Result<(String, Vec<u8>)> {
    use tokio::io::AsyncReadExt as _;
    if !matches!(base.len(), 40 | 64)
        || !base
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        return Err(invalid("Invalid workspace checkpoint tree"));
    }
    let parent = directory
        .parent()
        .ok_or_else(|| invalid("No project folder for the checkpoint"))?;
    let temporary = parent.join(format!(".{run_id}.checkpoint"));
    private_directory(&temporary)?;
    let index = TemporaryIndex(temporary);
    let object_format = if base.len() == 40 {
        "--object-format=sha1"
    } else {
        "--object-format=sha256"
    };
    run_git(
        &index.0,
        &["init", "--quiet", "--bare", "--template=", object_format],
    )
    .await?;
    let objects = directory.join(".git").join("objects");
    if objects.canonicalize()? != objects {
        return Err(invalid("The worker's Git object directory was replaced"));
    }
    // Read the workspace through fresh Git configuration. A provider can edit
    // its own .git/config; its filters must not run in the worker supervisor.
    let checkpoint_git = || {
        let mut git = git_command(directory);
        git.env("GIT_OBJECT_DIRECTORY", &objects)
            .env("GIT_DIR", &index.0)
            .env("GIT_WORK_TREE", directory)
            .env("GIT_INDEX_FILE", index.0.join("checkpoint-index"))
            .args(["-c", "core.bare=false"]);
        git
    };
    let mut git = checkpoint_git();
    git.args(["read-tree", base]);
    if !git.status().await?.success() {
        return Err(invalid("Could not start the worker's workspace checkpoint"));
    }
    let mut git = checkpoint_git();
    git.args(["add", "-A", "--", "."]);
    if !git.status().await?.success() {
        return Err(invalid(
            "Could not record the files in the worker's workspace checkpoint",
        ));
    }
    let tree = checkpoint_git().args(["write-tree"]).output().await?;
    if !tree.status.success() || tree.stdout.len() > 66 {
        return Err(invalid("Could not read the worker's checkpoint tree"));
    }
    let tree = String::from_utf8(tree.stdout)
        .map_err(io::Error::other)?
        .trim()
        .to_owned();
    let mut diff = checkpoint_git()
        .args([
            "diff",
            "--binary",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--no-renames",
            "--no-relative",
            base,
            &tree,
            "--",
        ])
        .stdout(Stdio::piped())
        .spawn()?;
    let mut patch = Vec::new();
    diff.stdout
        .take()
        .ok_or_else(|| invalid("No worker diff output"))?
        .take(MAX_PATCH_BYTES + 1)
        .read_to_end(&mut patch)
        .await?;
    if patch.len() as u64 > MAX_PATCH_BYTES || !diff.wait().await?.success() {
        return Err(invalid(
            "The worker changes could not fit in a workspace checkpoint",
        ));
    }
    Ok((tree, patch))
}
