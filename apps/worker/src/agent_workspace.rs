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

use crate::{
    agent_history::{History, git_command, run_git},
    wire::AgentWorkspaceSource,
};

#[cfg(test)]
use crate::agent_history::SNAPSHOT_REF;

fn invalid(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

pub(crate) struct WorkspaceTransfer {
    staging: PathBuf,
    destination: PathBuf,
    /// The project's folder, where its copy of the history is kept (agent_history.rs).
    project: PathBuf,
    archive: BufWriter<File>,
    digest: Context,
    remaining: u32,
}

pub(crate) fn private_directory(path: &Path) -> io::Result<()> {
    DirBuilder::new().mode(0o700).create(path)
}

impl WorkspaceTransfer {
    /// A send for `destination`, staged beside it and made into a checkout from the copy of the history kept in
    /// `project`. A send may be as large as its 32-bit size says: after the first, it carries only what's new.
    pub(crate) fn create(
        destination: PathBuf,
        run_id: &str,
        source: &AgentWorkspaceSource,
        project: &Path,
    ) -> io::Result<Self> {
        if source.size == 0
            || source.sha256.len() != 32
            || !matches!(source.head.len(), 40 | 64)
            || !source
                .head
                .bytes()
                .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
        {
            return Err(invalid("The home sent invalid Git workspace metadata"));
        }
        let parent = destination
            .parent()
            .ok_or_else(|| invalid("No project directory"))?;
        match private_directory(parent) {
            Ok(()) => (),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => (),
            Err(error) => return Err(error),
        }
        if parent.canonicalize()? != parent || !parent.is_dir() {
            return Err(invalid("The worker project directory is unavailable"));
        }
        if project.canonicalize()? != project || !project.is_dir() {
            return Err(invalid("The worker project directory is unavailable"));
        }
        if fs::symlink_metadata(&destination).is_ok() {
            return Err(invalid(
                "A worker workspace already exists; keep it for recovery",
            ));
        }
        let staging = parent.join(format!(".{run_id}.import"));
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
            project: project.to_owned(),
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
        let sha256 = source.head.len() == 64;
        let object_format = if sha256 {
            "--object-format=sha256"
        } else {
            "--object-format=sha1"
        };
        run_git(
            &checkout,
            &["init", "--quiet", "--template=", object_format],
        )
        .await?;
        // The project's copy of the history takes the send in, whole or only what it lacked, and the checkout is
        // fetched from the copy.
        let history = History::open(&self.project, sha256).await?;
        let taken = history.take(&self.staging.join("source.bundle")).await?;
        let installed = self.check_out(&checkout, &history, &taken, source).await;
        history
            .settle(taken, installed.is_ok().then_some(source.head.as_str()))
            .await;
        installed
    }

    async fn check_out(
        &self,
        checkout: &Path,
        history: &History,
        taken: &crate::agent_history::Taken,
        source: &AgentWorkspaceSource,
    ) -> io::Result<PathBuf> {
        history.fetch_into(checkout, taken).await?;
        let parent = run_git(checkout, &["rev-parse", "--verify", "FETCH_HEAD^"]).await?;
        if parent.trim() != source.head {
            return Err(invalid(
                "The Git snapshot does not match the expected starting commit",
            ));
        }
        run_git(checkout, &["checkout", "--quiet", "--detach", "FETCH_HEAD"]).await?;
        run_git(checkout, &["reset", "--quiet", "--mixed", &source.head]).await?;
        install_git_guard(checkout).await?;
        renameat_with(
            CWD,
            checkout,
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

const MAX_PATCH_BYTES: u64 = 16 * 1024 * 1024;
const MAX_COMMIT_BUNDLE_BYTES: u64 = 64 * 1024 * 1024;
const COMMITS_REF: &str = "refs/althar/worker-head";

pub(crate) struct WorkspacePatch {
    pub tree: String,
    pub head: String,
    pub patch: Vec<u8>,
    pub commits: Vec<u8>,
    pub index: Option<(String, Vec<u8>)>,
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
    capture_index: bool,
) -> io::Result<WorkspacePatch> {
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
    let git_in_index = |name: &str| {
        let mut git = git_command(directory);
        git.env("GIT_OBJECT_DIRECTORY", &objects)
            .env("GIT_DIR", &index.0)
            .env("GIT_WORK_TREE", directory)
            .env("GIT_INDEX_FILE", index.0.join(name))
            .args(["-c", "core.bare=false"]);
        git
    };
    let checkpoint_git = || git_in_index("checkpoint-index");
    let saved_index = if capture_index {
        let original = crate::agent_files::read_in_checkout(directory, ".git/index")?;
        fs::write(index.0.join("saved-index"), &original)?;
        let staged = git_in_index("saved-index")
            .args(["write-tree"])
            .output()
            .await?;
        if !staged.status.success() || staged.stdout.len() > 66 {
            return Err(invalid("Could not read the worker's staged tree"));
        }
        let staged = String::from_utf8(staged.stdout)
            .map_err(io::Error::other)?
            .trim()
            .to_owned();
        if !object_id(&staged) || staged.len() != head.len() {
            return Err(invalid("Invalid worker staged tree"));
        }
        Some((original, staged))
    } else {
        None
    };
    // When copying staged files, begin from what Git tracks in the live index.
    // A force-added ignored file can have both staged and working contents.
    let tracked = saved_index.as_ref().map_or(head.as_str(), |(_, tree)| tree);
    let mut git = checkpoint_git();
    git.args(["read-tree", tracked]);
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
    let patch = workspace_diff(checkpoint_git(), base, &tree).await?;
    let staged = match saved_index {
        Some((original, staged)) => {
            let patch = workspace_diff(checkpoint_git(), base, &staged).await?;
            if crate::agent_files::read_in_checkout(directory, ".git/index")? != original {
                return Err(invalid(
                    "The worker changed its staged files while the snapshot was being made",
                ));
            }
            Some((staged, patch))
        }
        None => None,
    };
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
        index: staged,
    })
}

async fn workspace_diff(mut git: Command, base: &str, tree: &str) -> io::Result<Vec<u8>> {
    use tokio::io::AsyncReadExt as _;
    let mut diff = git
        .args([
            "diff",
            "--binary",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--no-renames",
            "--no-relative",
            base,
            tree,
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
    Ok(patch)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{agent_workspace_set::WorkspaceSet, wire::AgentWorkspaceRepository};

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
        let primary = format!("ws_{}", "1".repeat(32));
        let second = format!("ws_{}", "2".repeat(32));
        let entries = [
            AgentWorkspaceRepository {
                workspace_id: primary.clone(),
                directory: "api".into(),
                source: Some(specification.clone()),
            },
            AgentWorkspaceRepository {
                workspace_id: second.clone(),
                directory: "web".into(),
                source: Some(specification.clone()),
            },
        ];
        let grouped = fixture.path().join("project").join("grouped");
        {
            let plan = WorkspaceSet::new(grouped.clone(), "bad-group", &primary, &entries)?;
            let mut transfers = plan.uploads(&entries)?.into_iter();
            let (mut first, spec) = transfers
                .next()
                .ok_or_else(|| invalid("Missing first repo"))?;
            first.put(&bytes)?;
            first.install(spec).await?;
            let (mut wrong, spec) = transfers
                .next()
                .ok_or_else(|| invalid("Missing second repo"))?;
            wrong.put(&vec![0; bytes.len()])?;
            assert!(wrong.install(spec).await.is_err());
            assert!(!grouped.exists());
        }
        let plan = WorkspaceSet::new(grouped.clone(), "good-group", &primary, &entries)?;
        for (mut transfer, spec) in plan.uploads(&entries)? {
            transfer.put(&bytes)?;
            transfer.install(spec).await?;
            assert!(!grouped.exists());
        }
        let workspace = plan.publish()?;
        assert_eq!(
            workspace.checkout(&primary),
            Some(grouped.join("api").as_path())
        );
        assert_eq!(
            workspace.checkout(&second),
            Some(grouped.join("web").as_path())
        );
        assert!(workspace.checkout("").is_none());
        assert_eq!(fs::read_to_string(grouped.join("web/README.md"))?, "Home\n");
        let destination = fixture.path().join("project").join("attempt");
        let project = fixture.path().join("project");
        let mut bad_transfer =
            WorkspaceTransfer::create(destination.clone(), "bad", &specification, &project)?;
        bad_transfer.put(&vec![0; bytes.len()])?;
        assert!(bad_transfer.install(&specification).await.is_err());
        assert!(!destination.exists());
        let mut transfer =
            WorkspaceTransfer::create(destination, "good", &specification, &project)?;
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
        fs::write(worker.join("stage.txt"), "Staged by the worker\n")?;
        run_git(&worker, &["add", "stage.txt"]).await?;
        let staged = run_git(&worker, &["write-tree"]).await?;
        fs::write(worker.join("stage.txt"), "Working file on the worker\n")?;
        let update = workspace_patch(&worker, "check", &tree, &head, true).await?;
        let (index_tree, index_patch) = update.index.as_ref().expect("Requested staged tree");
        assert_eq!(index_tree, staged.trim());
        assert!(String::from_utf8_lossy(index_patch).contains("+Staged by the worker"));
        assert!(!String::from_utf8_lossy(index_patch).contains("Working file on the worker"));
        assert!(String::from_utf8_lossy(&update.patch).contains("+Working file on the worker"));
        assert_eq!(run_git(&worker, &["write-tree"]).await?, staged);
        assert!(String::from_utf8_lossy(&update.patch).contains("+On the worker"));
        assert!(String::from_utf8_lossy(&update.patch).contains("+Unsaved in Git"));
        assert!(!update.commits.is_empty());
        assert_eq!(
            update.head,
            run_git(&worker, &["rev-parse", "HEAD"]).await?.trim()
        );
        assert_eq!(
            run_git(&worker, &["status", "--porcelain"]).await?.trim(),
            "AM stage.txt\n?? draft.txt"
        );

        fs::write(worker.join(".gitignore"), "ignored.txt\n")?;
        fs::write(worker.join("ignored.txt"), "Forced into the index\n")?;
        run_git(&worker, &["add", "-f", "ignored.txt"]).await?;
        fs::write(worker.join("ignored.txt"), "New working contents\n")?;
        let copied = workspace_patch(&worker, "copy", &tree, &head, true).await?;
        let (_, index_patch) = copied.index.expect("Requested staged tree");
        assert!(String::from_utf8_lossy(&index_patch).contains("+Forced into the index"));
        assert!(String::from_utf8_lossy(&copied.patch).contains("+New working contents"));
        Ok(())
    }
}
