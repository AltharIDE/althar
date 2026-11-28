//! The Git history of each project that the worker keeps, so its home sends only what that copy lacks.
//!
//! Each project's folder holds a bare repository of its own, `.althar-history.git` (`-sha256.git` for SHA-256
//! projects), that only the worker writes. A send from the home is a bundle whose prerequisites, where it has any, are
//! commits this copy holds. The copy takes the bundle in, the run's checkout is fetched from the copy, and the commit the
//! run starts from is then kept as known (`refs/althar/known/<commit>`). The worker's hello tells its home the newest
//! of those, and its next send for the project leaves them and all before them out.
//!
//! Git's own housekeeping packs what arrives and, after its grace period, drops what no ref reaches any more, such as
//! a send's uncommitted files.
//!
//! Each send's files are kept too, as their basis: a commit of the send's tree with no parent, author, date or message
//! of its own, which the home makes alike (packages/runtime/src/workerWorkspace.ts). The home makes the commits this
//! copy holds parents of its next send, so Git leaves out their files as well as their history: a large file the task
//! hasn't committed goes once, not with each start. Bases have no parents, so dropping one lets its files go. Checkouts are fetched from the copy, never linked to it: nothing an agent does in its
//! checkout can change the copy another run is made from.

use std::{
    fs::{self, DirBuilder},
    io,
    os::unix::fs::DirBuilderExt,
    path::{Path, PathBuf},
    process::Stdio,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use prost::Message;
use tokio::process::Command;

use crate::wire::{AgentWorkerHello, AgentWorkerHistory};

pub(crate) const SNAPSHOT_REF: &str = "refs/althar/worker-snapshot";
const KNOWN: &str = "refs/althar/known/";
const INCOMING: &str = "refs/althar/incoming/";
/// As many commits as the hello tells of one project, as the home takes them.
const TOLD: usize = 32;
/// As many projects as the hello tells of.
const PROJECTS: usize = 64;
/// As many known commits as a copy keeps: more than it tells, so one it told stays while the home builds a send on it.
const KEPT: usize = 128;
/// A basis, as the home makes it: the same commit for the same tree, wherever it is made.
const BASIS_MESSAGE: &str = "Althar worker basis";
const BASIS_DATE: &str = "1700000000 +0000";

fn invalid(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

pub(crate) fn git_command(directory: &Path) -> Command {
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

pub(crate) async fn run_git(directory: &Path, args: &[&str]) -> io::Result<String> {
    let response = git_command(directory).args(args).output().await?;
    if !response.status.success() {
        return Err(invalid(
            "Could not build the Git checkout from the received workspace",
        ));
    }
    String::from_utf8(response.stdout).map_err(io::Error::other)
}

fn folder_of(sha256: bool) -> &'static str {
    if sha256 {
        ".althar-history-sha256.git"
    } else {
        ".althar-history.git"
    }
}

fn path_text(path: &Path) -> io::Result<&str> {
    path.to_str()
        .ok_or_else(|| invalid("The worker's workspace folder must be UTF-8"))
}

fn object_id(value: &str) -> bool {
    matches!(value.len(), 40 | 64)
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}

/// A name no other send, in this process or another, uses at the same time.
fn unique() -> String {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_nanos());
    format!(
        "{}-{nanos}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    )
}

/// A project's copy of its history on this worker.
pub(crate) struct History {
    path: PathBuf,
}

/// A send the copy took in, under a ref of its own until the checkout is made from it.
pub(crate) struct Taken {
    reference: String,
}

impl History {
    /// The project's copy, made the first time: made aside and moved into place, so two sends at once both find one.
    pub(crate) async fn open(project: &Path, sha256: bool) -> io::Result<Self> {
        let path = project.join(folder_of(sha256));
        if path.is_dir() {
            return Ok(Self { path });
        }
        let aside = project.join(format!(".althar-history.{}", unique()));
        DirBuilder::new().mode(0o700).create(&aside)?;
        let made = async {
            let format = if sha256 {
                "--object-format=sha256"
            } else {
                "--object-format=sha1"
            };
            run_git(
                &aside,
                &["init", "--quiet", "--bare", "--template=", format],
            )
            .await?;
            // Nothing in the copy is a branch anyone moves: its refs record what it holds, not what was done.
            run_git(&aside, &["config", "core.logAllRefUpdates", "false"]).await?;
            fs::rename(&aside, &path)
        }
        .await;
        if made.is_err() || aside.exists() {
            let _ = fs::remove_dir_all(&aside);
        }
        // Another send made it first: that one is the copy.
        if path.is_dir() {
            return Ok(Self { path });
        }
        made.map(|()| Self { path })
    }

    /// Takes in a bundle the home sent: the history the copy lacked and the task's changes.
    pub(crate) async fn take(&self, bundle: &Path) -> io::Result<Taken> {
        let reference = format!("{INCOMING}{}", unique());
        let fetched = git_command(&self.path)
            .args([
                "fetch",
                "--quiet",
                "--no-tags",
                "--no-write-fetch-head",
                "--no-recurse-submodules",
                path_text(bundle)?,
                &format!("+{SNAPSHOT_REF}:{reference}"),
            ])
            .status()
            .await?;
        if !fetched.success() {
            return Err(invalid(
                "The worker's copy of the project's history lacks what the home's send builds on. Start the task again: the home then sends what it lacks.",
            ));
        }
        Ok(Taken { reference })
    }

    /// Fetches a send the copy took into a new, empty checkout, as `FETCH_HEAD`.
    pub(crate) async fn fetch_into(&self, checkout: &Path, taken: &Taken) -> io::Result<()> {
        run_git(
            checkout,
            &[
                "fetch",
                "--quiet",
                "--no-tags",
                "--no-recurse-submodules",
                path_text(&self.path)?,
                &taken.reference,
            ],
        )
        .await
        .map(drop)
    }

    /// Done with a send: where its checkout was made, the commit it started from and the basis of the files it carried
    /// are kept as known, for the next send to leave out. The oldest known go, past as many as it keeps.
    pub(crate) async fn settle(&self, taken: Taken, made_from: Option<&str>) {
        if let Some(head) = made_from.filter(|head| object_id(head)) {
            let basis = self.basis_of(&taken).await;
            for commit in [Some(head.to_owned()), basis.ok()].into_iter().flatten() {
                if let Err(error) = self.keep(&commit).await {
                    eprintln!("Could not keep the project's history on this worker: {error}");
                }
            }
        }
        if let Err(error) = run_git(&self.path, &["update-ref", "-d", &taken.reference]).await {
            eprintln!("Could not let a received send go: {error}");
        }
        for (reference, _) in self.known_refs().await.into_iter().skip(KEPT) {
            let _ = run_git(&self.path, &["update-ref", "-d", &reference]).await;
        }
    }

    /// The basis of a send's files: a commit of its tree alone, as the home made it.
    async fn basis_of(&self, taken: &Taken) -> io::Result<String> {
        let tree = run_git(
            &self.path,
            &[
                "rev-parse",
                "--verify",
                &format!("{}^{{tree}}", taken.reference),
            ],
        )
        .await?;
        let made = git_command(&self.path)
            .env("GIT_AUTHOR_NAME", "Althar")
            .env("GIT_AUTHOR_EMAIL", "althar@localhost")
            .env("GIT_COMMITTER_NAME", "Althar")
            .env("GIT_COMMITTER_EMAIL", "althar@localhost")
            .env("GIT_AUTHOR_DATE", BASIS_DATE)
            .env("GIT_COMMITTER_DATE", BASIS_DATE)
            .args([
                "commit-tree",
                "--no-gpg-sign",
                tree.trim(),
                "-m",
                BASIS_MESSAGE,
            ])
            .output()
            .await?;
        let commit = String::from_utf8(made.stdout)
            .map_err(io::Error::other)?
            .trim()
            .to_owned();
        if !made.status.success() || !object_id(&commit) {
            return Err(invalid("Could not keep the files a send carried"));
        }
        Ok(commit)
    }

    /// Keeps `commit` as known, the newest: named by when, as a basis's own date says nothing of it.
    async fn keep(&self, commit: &str) -> io::Result<()> {
        let when = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |since| since.as_millis());
        // One name per commit: kept again, it moves to the front.
        for (reference, known) in self.known_refs().await {
            if known == commit {
                run_git(&self.path, &["update-ref", "-d", &reference]).await?;
            }
        }
        run_git(
            &self.path,
            &[
                "update-ref",
                &format!("{KNOWN}{when:016}-{}-{commit}", unique()),
                commit,
            ],
        )
        .await
        .map(drop)
    }

    /// Its known refs and their commits, newest first.
    async fn known_refs(&self) -> Vec<(String, String)> {
        let listed = run_git(
            &self.path,
            &[
                "for-each-ref",
                "--sort=-refname",
                "--format=%(refname) %(objectname)",
                KNOWN,
            ],
        )
        .await
        .unwrap_or_default();
        listed
            .lines()
            .filter_map(|line| line.split_once(' '))
            .filter(|(_, commit)| object_id(commit))
            .map(|(reference, commit)| (reference.to_owned(), commit.to_owned()))
            .collect()
    }

    /// What its objects take on disk: about what a checkout made from it holds again, as a pack.
    pub(crate) fn stored_bytes(&self) -> u64 {
        fn size(path: &Path) -> u64 {
            let Ok(metadata) = fs::symlink_metadata(path) else {
                return 0;
            };
            if !metadata.is_dir() {
                return metadata.len();
            }
            fs::read_dir(path).map_or(0, |entries| {
                entries.flatten().map(|entry| size(&entry.path())).sum()
            })
        }
        size(&self.path.join("objects"))
    }

    /// The newest commits the copy holds with all they reach, newest first.
    async fn commits(&self) -> Vec<String> {
        self.known_refs()
            .await
            .into_iter()
            .map(|(_, commit)| commit)
            .take(TOLD)
            .collect()
    }
}

/// What the worker holds of each project's history, for its hello: the projects used last first.
pub(crate) async fn known(root: &Path) -> Vec<AgentWorkerHistory> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    let mut copies = Vec::new();
    for entry in entries.flatten() {
        let Some(project) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if !crate::valid_id(&project, "proj_") {
            continue;
        }
        for sha256 in [false, true] {
            let path = entry.path().join(folder_of(sha256));
            let Ok(metadata) = fs::symlink_metadata(&path) else {
                continue;
            };
            if metadata.is_dir() {
                let used = metadata.modified().unwrap_or(UNIX_EPOCH);
                copies.push((used, project.clone(), History { path }));
            }
        }
    }
    copies.sort_by_key(|copy| std::cmp::Reverse(copy.0));
    let mut histories: Vec<AgentWorkerHistory> = Vec::new();
    for (_, project_id, history) in copies {
        let commits = history.commits().await;
        if commits.is_empty() {
            continue;
        }
        if let Some(told) = histories
            .iter_mut()
            .find(|one| one.project_id == project_id)
        {
            told.commits.extend(commits);
            told.commits.truncate(TOLD);
        } else if histories.len() < PROJECTS {
            histories.push(AgentWorkerHistory {
                project_id,
                commits,
            });
        }
    }
    histories
}

/// Tells `hello` of the commits each project's copy holds, as many as fit in `budget` bytes with the rest of it: the
/// newest of every project first, then the next of each. One a send builds on leaves out the history it shares with the
/// task, so even the newest alone keeps most of a send away.
pub(crate) fn tell(hello: &mut AgentWorkerHello, known: &[AgentWorkerHistory], budget: usize) {
    let depth = known.iter().map(|one| one.commits.len()).max().unwrap_or(0);
    for at in 0..depth {
        for project in known {
            let Some(commit) = project.commits.get(at) else {
                continue;
            };
            let entry = match hello
                .histories
                .iter()
                .position(|one| one.project_id == project.project_id)
            {
                Some(entry) => entry,
                None => {
                    hello.histories.push(AgentWorkerHistory {
                        project_id: project.project_id.clone(),
                        commits: Vec::new(),
                    });
                    hello.histories.len() - 1
                }
            };
            hello.histories[entry].commits.push(commit.clone());
            if hello.encoded_len() > budget {
                hello.histories[entry].commits.pop();
                if hello.histories[entry].commits.is_empty() {
                    hello.histories.remove(entry);
                }
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tells_the_newest_of_each_project_first_within_its_room() {
        let project = |digit: char, commits: usize| AgentWorkerHistory {
            project_id: format!("proj_{}", digit.to_string().repeat(32)),
            commits: (0..commits).map(|at| format!("{at:040x}")).collect(),
        };
        let known = [project('a', 32), project('b', 2)];
        let mut roomy = AgentWorkerHello::default();
        tell(&mut roomy, &known, 4096);
        assert_eq!(roomy.histories.len(), 2);
        assert_eq!(roomy.histories[0].commits.len(), 32);
        assert_eq!(roomy.histories[1].commits.len(), 2);
        let mut tight = AgentWorkerHello::default();
        tell(&mut tight, &known, 200);
        assert!(tight.encoded_len() <= 200);
        assert_eq!(tight.histories.len(), 2);
        assert_eq!(tight.histories[0].commits[0], known[0].commits[0]);
        assert_eq!(tight.histories[1].commits[0], known[1].commits[0]);
        let mut none = AgentWorkerHello::default();
        tell(&mut none, &known, 10);
        assert!(none.histories.is_empty());
    }

    async fn commit(
        repository: &Path,
        file: &str,
        contents: &[u8],
        message: &str,
    ) -> io::Result<String> {
        fs::write(repository.join(file), contents)?;
        run_git(repository, &["add", "-A"]).await?;
        run_git(
            repository,
            &[
                "-c",
                "user.name=Home",
                "-c",
                "user.email=home@althar.test",
                "commit",
                "--quiet",
                "-m",
                message,
            ],
        )
        .await?;
        Ok(run_git(repository, &["rev-parse", "HEAD"])
            .await?
            .trim()
            .to_owned())
    }

    /// A send as the home makes it: the task's files on top of `head`, leaving out what `known` reaches.
    async fn send(home: &Path, to: &Path, known: &[&str]) -> io::Result<()> {
        let tree = run_git(home, &["write-tree"]).await?;
        let snapshot = run_git(
            home,
            &[
                "-c",
                "user.name=Home",
                "-c",
                "user.email=home@althar.test",
                "commit-tree",
                tree.trim(),
                "-p",
                "HEAD",
                "-m",
                "Snapshot",
            ],
        )
        .await?;
        run_git(home, &["update-ref", SNAPSHOT_REF, snapshot.trim()]).await?;
        let mut args = vec!["bundle", "create", path_text(to)?, SNAPSHOT_REF];
        let excluded: Vec<String> = known.iter().map(|one| format!("^{one}")).collect();
        args.extend(excluded.iter().map(String::as_str));
        run_git(home, &args).await.map(drop)
    }

    /// The basis of the home's last send, as the home makes it.
    async fn basis(home: &Path) -> io::Result<String> {
        let tree = run_git(home, &["rev-parse", &format!("{SNAPSHOT_REF}^{{tree}}")]).await?;
        let made = git_command(home)
            .env("GIT_AUTHOR_NAME", "Althar")
            .env("GIT_AUTHOR_EMAIL", "althar@localhost")
            .env("GIT_COMMITTER_NAME", "Althar")
            .env("GIT_COMMITTER_EMAIL", "althar@localhost")
            .env("GIT_AUTHOR_DATE", "1700000000 +0000")
            .env("GIT_COMMITTER_DATE", "1700000000 +0000")
            .args([
                "commit-tree",
                "--no-gpg-sign",
                tree.trim(),
                "-m",
                "Althar worker basis",
            ])
            .output()
            .await?;
        Ok(String::from_utf8_lossy(&made.stdout).trim().to_owned())
    }

    async fn checkout(history: &History, taken: &Taken, at: &Path) -> io::Result<String> {
        fs::create_dir(at)?;
        run_git(
            at,
            &["init", "--quiet", "--template=", "--object-format=sha1"],
        )
        .await?;
        history.fetch_into(at, taken).await?;
        run_git(at, &["checkout", "--quiet", "--detach", "FETCH_HEAD"]).await?;
        Ok(run_git(at, &["rev-parse", "HEAD^"])
            .await?
            .trim()
            .to_owned())
    }

    #[tokio::test]
    async fn keeps_the_history_once_and_makes_a_checkout_from_a_send_of_only_what_is_new()
    -> io::Result<()> {
        let temp = tempfile::tempdir()?;
        let home = temp.path().join("home");
        fs::create_dir(&home)?;
        run_git(
            &home,
            &["init", "--quiet", "--template=", "--object-format=sha1"],
        )
        .await?;
        // A history worth keeping: 4 MB nothing can pack smaller.
        let mut state = 0x9e37_79b9_7f4a_7c15_u64;
        let noise: Vec<u8> = (0..4 * 1024 * 1024)
            .map(|_| {
                state ^= state << 13;
                state ^= state >> 7;
                state ^= state << 17;
                (state >> 32) as u8
            })
            .collect();
        let first = commit(&home, "assets.bin", &noise, "History").await?;
        let root = temp.path().join("workspaces");
        let project = root.join(format!("proj_{}", "a".repeat(32)));
        fs::create_dir_all(&project)?;

        // Nothing kept yet: the hello tells of nothing, and the first send carries the whole history.
        assert!(known(&root).await.is_empty());
        let whole = temp.path().join("whole.bundle");
        send(&home, &whole, &[]).await?;
        let history = History::open(&project, false).await?;
        let taken = history.take(&whole).await?;
        assert_eq!(
            checkout(&history, &taken, &temp.path().join("one")).await?,
            first
        );
        history.settle(taken, Some(&first)).await;
        let told = known(&root).await;
        assert_eq!(told.len(), 1);
        // The commit it started from, and the basis of the files it carried, newest first: the same basis the home makes.
        let first_basis = basis(&home).await?;
        assert_eq!(told[0].commits, vec![first_basis.clone(), first.clone()]);

        // The task's next commit and an uncommitted file: the send leaves out all the copy holds.
        let second = commit(&home, "README.md", b"# Meridian\n", "Next").await?;
        fs::write(home.join("draft.txt"), "Not committed\n")?;
        run_git(&home, &["add", "-A"]).await?;
        let new = temp.path().join("new.bundle");
        send(&home, &new, &[&first]).await?;
        let (sizes, whole_size) = (fs::metadata(&new)?.len(), fs::metadata(&whole)?.len());
        assert!(sizes * 100 < whole_size, "{sizes} of {whole_size}");
        // Opened again, it is the same copy.
        let history = History::open(&project, false).await?;
        let taken = history.take(&new).await?;
        let made = temp.path().join("two");
        assert_eq!(checkout(&history, &taken, &made).await?, second);
        assert_eq!(fs::read(made.join("assets.bin"))?, noise);
        assert_eq!(
            fs::read_to_string(made.join("draft.txt"))?,
            "Not committed\n"
        );
        history.settle(taken, Some(&second)).await;
        let second_basis = basis(&home).await?;
        assert_eq!(
            known(&root).await[0].commits,
            vec![second_basis, second.clone(), first_basis, first.clone()]
        );
        // The send's own ref is gone; only what it was made from stays known.
        let refs = run_git(&history.path, &["for-each-ref", "--format=%(refname)"]).await?;
        assert!(!refs.contains(INCOMING));

        // A copy that lacks what a send builds on says so, and holds nothing more.
        let other = root.join(format!("proj_{}", "b".repeat(32)));
        fs::create_dir_all(&other)?;
        let empty = History::open(&other, false).await?;
        let Err(refused) = empty.take(&new).await else {
            panic!("It took a send it lacks the history for");
        };
        assert!(refused.to_string().contains("Start the task again"));
        assert_eq!(known(&root).await.len(), 1);
        Ok(())
    }
}
