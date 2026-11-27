//! What a run leaves in its project's folder, taken away once nothing can need it.
//!
//! A run makes these in `<workspaces>/<project>/`, named by its ID:
//!
//! - its checkout, `<workspace>-<run>` (a repository set's, with each repository inside);
//! - each helper's own copy, `<run>-<command>`;
//! - its scratch: `.<run>.import`, `.<run>.workspaces`, `.<run>.checkpoint`, `.<run>.skills`, and a helper's
//!   `.<run>-<command>.…`.
//!
//! A checkout is kept while the home may still ask for the run: until the run's end is confirmed and the home has
//! recorded it, which is when the journal forgets the run's control group (agent.rs). Nothing reads a checkout once its
//! run has ended, so then it all goes. A worker that stopped mid-run keeps the run's checkout until its home reconciles
//! it. Anything else named for a run is left over from a crash, and the sweep at start takes it. A workspace an operator
//! set up by hand, `<workspace>` alone, is never the worker's to remove.

use std::{
    fs, io,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
};

use crate::{diagnostic::DiagnosticJournal, valid_id};

const RUN_ID: usize = "war_".len() + 32;

/// The run a folder in a project's folder was made for, where its name says one.
fn run_of(name: &str) -> Option<&str> {
    let name = name.strip_prefix('.').unwrap_or(name);
    let run = if let Some(rest) = name.strip_prefix("ws_") {
        // `<workspace>-<run>`: a workspace ID, a dash, then the run.
        let (workspace, run) = rest.split_at_checked(32)?;
        if !valid_id(&format!("ws_{workspace}"), "ws_") {
            return None;
        }
        run.strip_prefix('-')?
    } else {
        // `<run>`, `<run>.<what>` or `<run>-<command>…`.
        let (run, rest) = name.split_at_checked(RUN_ID)?;
        if !(rest.is_empty() || rest.starts_with('.') || rest.starts_with('-')) {
            return None;
        }
        run
    };
    valid_id(run, "war_").then_some(run)
}

/// Removes a folder and all in it, links not followed. What a build left unwritable (Go's module cache, a read-only
/// checkout) is made writable first, so it goes too.
pub(crate) fn remove_tree(path: &Path) -> io::Result<()> {
    match fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::PermissionDenied => {
            writable(path)?;
            match fs::remove_dir_all(path) {
                Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
                other => other,
            }
        }
        Err(error) => Err(error),
    }
}

/// Lets its owner change each folder in `path` again, not through links.
fn writable(path: &Path) -> io::Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_dir() {
        return Ok(());
    }
    let mode = metadata.permissions().mode();
    if mode & 0o700 != 0o700 {
        fs::set_permissions(path, fs::Permissions::from_mode(mode | 0o700))?;
    }
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            writable(&entry.path())?;
        }
    }
    Ok(())
}

/// Each project's folder under the workspaces' root.
fn projects(root: &Path) -> io::Result<Vec<PathBuf>> {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    let mut found = Vec::new();
    for entry in entries {
        let entry = entry?;
        if entry.file_type()?.is_dir()
            && entry
                .file_name()
                .to_str()
                .is_some_and(|name| valid_id(name, "proj_"))
        {
            found.push(entry.path());
        }
    }
    Ok(found)
}

/// Removes what each project's folder holds for the runs `remove` picks; says each it couldn't, and goes on.
fn remove_runs(root: &Path, remove: impl Fn(&str) -> bool) -> io::Result<()> {
    for project in projects(root)? {
        for entry in fs::read_dir(&project)? {
            let entry = entry?;
            let name = entry.file_name();
            let Some(run) = name.to_str().and_then(run_of) else {
                continue;
            };
            if !remove(run) {
                continue;
            }
            let path = entry.path();
            let removed = if entry.file_type()?.is_dir() {
                remove_tree(&path)
            } else {
                fs::remove_file(&path)
            };
            if let Err(error) = removed {
                eprintln!("Couldn't remove {}: {error}", path.display());
            }
        }
    }
    Ok(())
}

/// Everything a run made, now its end is recorded: its checkout, its helpers' copies and its scratch.
pub(crate) fn forget_run(root: &Path, run_id: &str) -> io::Result<()> {
    if !valid_id(run_id, "war_") {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Invalid agent run identity",
        ));
    }
    remove_runs(root, |run| run == run_id)
}

/// At start, before any run: what a crash left of runs the home has nothing more to ask of. A run whose control group
/// the journal still records keeps its files until the home reconciles it.
pub fn sweep(root: &Path, journal: &DiagnosticJournal) -> io::Result<()> {
    remove_runs(root, |run| {
        // Unsure, keep it: the home may still ask.
        matches!(journal.agent_group(run), Ok(None))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grpc::WorkerEnrollment;

    fn id(prefix: &str, digit: char) -> String {
        format!("{prefix}{}", digit.to_string().repeat(32))
    }

    #[test]
    fn names_a_run_made_say_their_run_and_no_other_name_does() {
        let run = id("war_", '1');
        let workspace = id("ws_", '2');
        let command = id("proc_", '3');
        for name in [
            format!("{workspace}-{run}"),
            format!("{run}-{command}"),
            format!(".{run}.import"),
            format!(".{run}.workspaces"),
            format!(".{run}.checkpoint"),
            format!(".{run}.skills"),
            format!(".{run}-{command}.import"),
        ] {
            assert_eq!(run_of(&name), Some(run.as_str()), "{name}");
        }
        for name in [
            workspace.clone(),
            format!("{workspace}-"),
            format!("{workspace}-war_123"),
            format!("{workspace}{run}"),
            format!("{run}x"),
            "war_".into(),
            "notes".into(),
            format!("ws_{}-{run}", "g".repeat(32)),
        ] {
            assert_eq!(run_of(&name), None, "{name}");
        }
    }

    #[test]
    fn a_recorded_run_loses_all_it_made_and_nothing_else() -> io::Result<()> {
        let temp = tempfile::tempdir()?;
        let root = temp.path().join("workspaces");
        let project = root.join(id("proj_", 'a'));
        fs::create_dir_all(&project)?;
        let run = id("war_", '1');
        let other = id("war_", '9');
        let workspace = id("ws_", '2');
        let command = id("proc_", '3');
        let checkout = project.join(format!("{workspace}-{run}"));
        // A build's read-only folder inside the checkout, as Go's module cache leaves them.
        let locked = checkout.join("pkg/mod/example");
        fs::create_dir_all(&locked)?;
        fs::write(locked.join("go.mod"), "module example\n")?;
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o500))?;
        fs::set_permissions(locked.parent().unwrap(), fs::Permissions::from_mode(0o500))?;
        fs::create_dir(project.join(format!("{run}-{command}")))?;
        fs::create_dir(project.join(format!(".{run}.import")))?;
        fs::write(
            project.join(format!(".{run}.import/source.bundle")),
            b"bundle",
        )?;
        let kept = [
            project.join(format!("{workspace}-{other}")),
            project.join(&workspace),
            root.join("notes"),
        ];
        for path in &kept {
            fs::create_dir(path)?;
        }
        forget_run(&root, &run)?;
        assert_eq!(
            fs::read_dir(&project)?
                .map(|entry| entry.map(|entry| entry.path()))
                .collect::<io::Result<std::collections::BTreeSet<_>>>()?,
            kept[..2].iter().cloned().collect()
        );
        assert!(kept[2].is_dir());
        assert!(forget_run(&root, "../war_1").is_err());
        Ok(())
    }

    #[test]
    fn the_sweep_keeps_what_the_home_may_still_ask_for() -> io::Result<()> {
        let temp = tempfile::tempdir()?;
        let journal_folder = temp.path().join("journal");
        let home = id("home_", '4');
        let worker = id("wrk_", '5');
        let journal = DiagnosticJournal::open(
            &journal_folder,
            &WorkerEnrollment {
                home_id: &home,
                worker_id: &worker,
                home_ca_pem: b"",
                worker_certificate_pem: b"",
                worker_private_key_pem: b"",
                server_name: None,
            },
        )?;
        let root = temp.path().join("workspaces");
        let project = root.join(id("proj_", 'a'));
        fs::create_dir_all(&project)?;
        let workspace = id("ws_", '2');
        let unfinished = id("war_", '1');
        let crashed = id("war_", '6');
        journal.record_agent_group(&unfinished, b"/user.slice/althar-agent.service")?;
        for run in [&unfinished, &crashed] {
            fs::create_dir(project.join(format!("{workspace}-{run}")))?;
            fs::create_dir(project.join(format!(".{run}.import")))?;
        }
        sweep(&root, &journal)?;
        assert!(project.join(format!("{workspace}-{unfinished}")).is_dir());
        assert!(project.join(format!(".{unfinished}.import")).is_dir());
        assert!(!project.join(format!("{workspace}-{crashed}")).exists());
        assert!(!project.join(format!(".{crashed}.import")).exists());
        // No workspaces yet: nothing to sweep.
        sweep(&temp.path().join("none"), &journal)?;
        Ok(())
    }
}
