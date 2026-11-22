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
        install_git_guard(&checkout).await?;
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

/// Published changes flow through the home, which holds the project's Git credentials and approvals.
async fn install_git_guard(checkout: &Path) -> io::Result<()> {
    let hooks = checkout.join(".git/althar-hooks");
    private_directory(&hooks)?;
    let mut hook = OpenOptions::new()
        .create_new(true)
        .mode(0o700)
        .write(true)
        .open(hooks.join("pre-push"))?;
    hook.write_all(
        b"#!/bin/sh\nprintf '%s\\n' 'Publish this task from its Althar home.' >&2\nexit 1\n",
    )?;
    hook.sync_all()?;
    run_git(
        checkout,
        &["config", "--local", "core.hooksPath", ".git/althar-hooks"],
    )
    .await?;
    run_git(checkout, &["config", "--local", "credential.helper", ""]).await?;
    Ok(())
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
const MAX_COMMIT_BUNDLE_BYTES: u64 = 64 * 1024 * 1024;
const COMMITS_REF: &str = "refs/althar/worker-head";

pub(crate) struct WorkspacePatch {
    pub tree: String,
    pub head: String,
    pub patch: Vec<u8>,
    pub commits: Vec<u8>,
}

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
    base_head: &str,
) -> io::Result<WorkspacePatch> {
    use tokio::io::AsyncReadExt as _;
    let object_id = |value: &str| {
        matches!(value.len(), 40 | 64)
            && value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    };
    if !object_id(base) || !object_id(base_head) || base.len() != base_head.len() {
        return Err(invalid("Invalid workspace checkpoint identity"));
    }
    let head = run_git(directory, &["rev-parse", "--verify", "HEAD^{commit}"])
        .await?
        .trim()
        .to_owned();
    if !object_id(&head) || base.len() != head.len() {
        return Err(invalid("Invalid worker checkout commit"));
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
    git.args(["read-tree", &head]);
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
    if run_git(directory, &["rev-parse", "--verify", "HEAD^{commit}"])
        .await?
        .trim()
        != head
    {
        return Err(invalid(
            "The worker committed while its files were being read",
        ));
    }
    let commits = if head == base_head {
        Vec::new()
    } else {
        if !checkpoint_git()
            .args(["merge-base", "--is-ancestor", base_head, &head])
            .status()
            .await?
            .success()
        {
            return Err(invalid(
                "The worker rewrote the history the home already had",
            ));
        }
        if !checkpoint_git()
            .args(["update-ref", COMMITS_REF, &head])
            .status()
            .await?
            .success()
        {
            return Err(invalid("Could not reference the worker's new commits"));
        }
        let bundle = index.0.join("commits.bundle");
        if !checkpoint_git()
            .args(["bundle", "create"])
            .arg(&bundle)
            .arg(COMMITS_REF)
            .arg(format!("^{base_head}"))
            .status()
            .await?
            .success()
        {
            return Err(invalid("Could not package the worker's new commits"));
        }
        if fs::metadata(&bundle)?.len() > MAX_COMMIT_BUNDLE_BYTES {
            return Err(invalid(
                "The worker committed more than the home can receive in one checkpoint",
            ));
        }
        fs::read(bundle)?
    };
    Ok(WorkspacePatch {
        tree,
        head,
        patch,
        commits,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn stages_an_authenticated_bundle_and_exports_worker_commits_and_dirty_files()
    -> io::Result<()> {
        let fixture = tempfile::tempdir()?;
        let source = fixture.path().join("source");
        private_directory(&source)?;
        run_git(
            &source,
            &["init", "--quiet", "--template=", "--object-format=sha1"],
        )
        .await?;
        fs::write(source.join("README.md"), "Home\n")?;
        run_git(&source, &["add", "README.md"]).await?;
        let author = [
            "-c",
            "user.name=Worker",
            "-c",
            "user.email=worker@althar.test",
        ];
        let mut commit = author.to_vec();
        commit.extend(["commit", "--quiet", "-m", "Base"]);
        run_git(&source, &commit).await?;
        let head = run_git(&source, &["rev-parse", "HEAD"])
            .await?
            .trim()
            .to_owned();
        let tree = run_git(&source, &["rev-parse", "HEAD^{tree}"])
            .await?
            .trim()
            .to_owned();
        let mut snapshot = author.to_vec();
        snapshot.extend(["commit-tree", &tree, "-p", &head, "-m", "Snapshot"]);
        let snapshot = run_git(&source, &snapshot).await?;
        run_git(&source, &["update-ref", SNAPSHOT_REF, snapshot.trim()]).await?;
        let archive = fixture.path().join("input.bundle");
        let archive_name = archive
            .to_str()
            .ok_or_else(|| invalid("The bundle path must be UTF-8"))?;
        run_git(&source, &["bundle", "create", archive_name, SNAPSHOT_REF]).await?;
        let bytes = fs::read(archive)?;
        let specification = AgentWorkspaceSource {
            size: bytes.len() as u32,
            head: head.clone(),
            sha256: ring::digest::digest(&SHA256, &bytes).as_ref().to_vec(),
        };
        let destination = fixture.path().join("project").join("attempt");
        let mut bad_transfer =
            WorkspaceTransfer::create(destination.clone(), "bad", &specification)?;
        bad_transfer.put(&vec![0; bytes.len()])?;
        assert!(bad_transfer.install(&specification).await.is_err());
        assert!(!destination.exists());
        let mut transfer = WorkspaceTransfer::create(destination, "good", &specification)?;
        for chunk in bytes.chunks(128) {
            transfer.put(chunk)?;
        }
        let worker = transfer.install(&specification).await?;
        assert_eq!(fs::read_to_string(worker.join("README.md"))?, "Home\n");
        let push = Command::new("/usr/bin/git")
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .args([
                "-c",
                "protocol.file.allow=always",
                "push",
                source
                    .to_str()
                    .ok_or_else(|| invalid("Source path must be UTF-8"))?,
                "HEAD:refs/heads/from-worker",
            ])
            .current_dir(&worker)
            .output()
            .await?;
        assert!(!push.status.success());
        assert!(
            String::from_utf8_lossy(&push.stderr)
                .contains("Publish this task from its Althar home.")
        );
        fs::write(worker.join("README.md"), "On the worker\n")?;
        run_git(&worker, &["add", "README.md"]).await?;
        run_git(&worker, &commit).await?;
        fs::write(worker.join("draft.txt"), "Unsaved in Git\n")?;
        let update = workspace_patch(&worker, "check", &tree, &head).await?;
        assert!(String::from_utf8_lossy(&update.patch).contains("+On the worker"));
        assert!(String::from_utf8_lossy(&update.patch).contains("+Unsaved in Git"));
        assert!(!update.commits.is_empty());
        assert_eq!(
            update.head,
            run_git(&worker, &["rev-parse", "HEAD"]).await?.trim()
        );
        assert_eq!(
            run_git(&worker, &["status", "--porcelain"]).await?.trim(),
            "?? draft.txt"
        );
        Ok(())
    }
}
