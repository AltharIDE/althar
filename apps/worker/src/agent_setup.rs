use std::{
    ffi::{OsStr, OsString},
    io,
    path::{Component, Path, PathBuf},
    process::Stdio,
    time::Duration,
};

use tokio::{io::AsyncReadExt, process::Command, time::timeout};

use crate::wire::{AgentWorkspaceSetup, AgentWorkspaceSetupResult};

pub(crate) const LIMIT: Duration = Duration::from_secs(10 * 60);
pub(crate) const OUTPUT_BYTES: usize = 2_048;
pub(crate) const DESCRIPTOR_BYTES: usize = 128 * 1024;
const COMMANDS: usize = 20;
const COMMAND_BYTES: usize = 8_000;

pub(crate) struct WorkspaceSetup {
    pub(crate) folder: PathBuf,
    pub(crate) commands: Vec<OsString>,
}

fn invalid(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}

impl WorkspaceSetup {
    pub(crate) fn from_wire(root: &Path, given: &AgentWorkspaceSetup) -> io::Result<Self> {
        Self::new(
            root,
            Path::new(&given.directory),
            given.commands.iter().map(OsString::from).collect(),
        )
    }

    pub(crate) fn new(root: &Path, directory: &Path, commands: Vec<OsString>) -> io::Result<Self> {
        if commands.is_empty()
            || commands.len() > COMMANDS
            || commands.iter().any(|command| {
                let bytes = command.as_encoded_bytes();
                bytes.len() > COMMAND_BYTES
                    || bytes.contains(&0)
                    || command.to_str().is_none_or(|text| text.trim().is_empty())
            })
        {
            return Err(invalid("The worker setup contains unsupported commands"));
        }
        Ok(Self {
            folder: workspace_folder(root, directory)?,
            commands,
        })
    }
}

pub(crate) fn workspace_folder(root: &Path, directory: &Path) -> io::Result<PathBuf> {
    let supported = |path: &Path| {
        path.components().all(
            |component| matches!(component, Component::Normal(part) if part != OsStr::new(".git")),
        )
    };
    if !supported(directory) {
        return Err(invalid("Choose a folder inside the worker checkout"));
    }
    let root = root.canonicalize()?;
    let folder = root.join(directory).canonicalize()?;
    if !folder.is_dir() || !folder.strip_prefix(&root).is_ok_and(supported) {
        return Err(invalid("The folder leaves its worker checkout"));
    }
    Ok(folder)
}

pub(crate) fn worker_environment(command: &mut Command) -> &mut Command {
    command
        .env_clear()
        .env("PATH", "/usr/local/bin:/usr/bin:/bin");
    for name in [
        "HOME",
        "LANG",
        "XDG_CONFIG_HOME",
        "XDG_DATA_HOME",
        "XDG_CACHE_HOME",
    ] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    command
}

fn append_tail(tail: &mut Vec<u8>, data: &[u8]) {
    let data = &data[data.len().saturating_sub(OUTPUT_BYTES)..];
    let remove = tail
        .len()
        .saturating_add(data.len())
        .saturating_sub(OUTPUT_BYTES);
    if remove > 0 {
        tail.drain(..remove);
    }
    tail.extend_from_slice(data);
}

pub(crate) async fn run_workspace_setup(setup: &WorkspaceSetup) -> AgentWorkspaceSetupResult {
    let mut output_tail = Vec::with_capacity(OUTPUT_BYTES);
    let finished = timeout(LIMIT, async {
        for line in &setup.commands {
            // Each command is a separate shell, as for a recorded setup on the home.
            let mut script = OsString::from("exec 2>&1\n");
            script.push(line);
            let mut shell = Command::new("/bin/sh");
            let mut child = worker_environment(&mut shell)
                .args([OsStr::new("-c"), script.as_os_str()])
                .current_dir(&setup.folder)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .kill_on_drop(true)
                .spawn()?;
            let mut output = child
                .stdout
                .take()
                .ok_or_else(|| invalid("No setup output pipe"))?;
            let drain = async {
                let mut buffer = [0; 512];
                loop {
                    let size = output.read(&mut buffer).await?;
                    if size == 0 {
                        return Ok::<(), io::Error>(());
                    }
                    append_tail(&mut output_tail, &buffer[..size]);
                }
            };
            let (status, ()) = tokio::try_join!(child.wait(), drain)?;
            if !status.success() {
                return Ok::<u32, io::Error>(
                    status
                        .code()
                        .and_then(|code| u32::try_from(code).ok())
                        .unwrap_or(1),
                );
            }
        }
        Ok(0)
    })
    .await;
    let (exit_code, timed_out) = match finished {
        Ok(Ok(code)) => (code, false),
        Ok(Err(_)) => {
            append_tail(
                &mut output_tail,
                b"Althar could not start the worker setup.\n",
            );
            (1, false)
        }
        Err(_) => (1, true),
    };
    AgentWorkspaceSetupResult {
        exit_code,
        timed_out,
        output_tail,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, os::unix::fs::symlink};

    #[tokio::test]
    async fn workspace_setup_runs_in_its_checked_folder_and_keeps_the_output_tail() -> io::Result<()>
    {
        let fixture = tempfile::tempdir()?;
        let root = fixture.path();
        let project = root.join("project folder");
        fs::create_dir(&project)?;
        let setup = WorkspaceSetup::new(
            root,
            Path::new("project folder"),
            vec![
                "printf staged > marker; head -c 4600 /dev/zero | tr '\\000' 'x'".into(),
                "printf 'failed here' >&2; exit 7".into(),
                "touch unexpected".into(),
            ],
        )?;
        let result = run_workspace_setup(&setup).await;
        assert_eq!(result.exit_code, 7);
        assert!(!result.timed_out);
        assert_eq!(result.output_tail.len(), OUTPUT_BYTES);
        assert!(result.output_tail.ends_with(b"failed here"));
        assert_eq!(fs::read_to_string(project.join("marker"))?, "staged");
        assert!(!root.join("marker").exists());
        assert!(!project.join("unexpected").exists());
        Ok(())
    }

    #[test]
    fn workspace_setup_rejects_paths_outside_the_checkout_and_git_metadata() -> io::Result<()> {
        let fixture = tempfile::tempdir()?;
        let root = fixture.path().join("checkout");
        fs::create_dir(&root)?;
        fs::create_dir(root.join(".git"))?;
        symlink(fixture.path(), root.join("outside"))?;
        symlink(root.join(".git"), root.join("metadata"))?;
        for folder in ["../", "/", ".git", "outside", "metadata"] {
            assert!(WorkspaceSetup::new(&root, Path::new(folder), vec!["true".into()]).is_err());
        }
        assert!(WorkspaceSetup::new(&root, Path::new(""), vec!["   ".into()]).is_err());
        assert!(WorkspaceSetup::new(&root, Path::new(""), vec!["true".into()]).is_ok());
        Ok(())
    }
}
