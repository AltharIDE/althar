use std::{
    env,
    ffi::{OsStr, OsString},
    io,
    path::{Component, Path, PathBuf},
    process::Stdio,
    sync::OnceLock,
    time::Duration,
};

use tokio::{
    io::AsyncReadExt,
    process::Command,
    time::{Instant, timeout},
};

use crate::{
    agent_workspace_set::AgentWorkspace,
    valid_id,
    wire::{AgentRepositorySetupResult, AgentWorkspaceSetup, AgentWorkspaceSetupResult},
};

pub(crate) const LIMIT: Duration = Duration::from_secs(10 * 60);
pub(crate) const OUTPUT_BYTES: usize = 2_048;
pub(crate) const DESCRIPTOR_BYTES: usize = 128 * 1024;
const COMMANDS: usize = 20;
const COMMAND_BYTES: usize = 8_000;
const GROUP_OUTPUT_BYTES: usize = 192;
const TOOLS: usize = 8;
/// The tools a worker installs for a project itself, into its own folder, without root.
const KNOWN_TOOLS: [&str; 4] = ["bun", "node", "pnpm", "uv"];
/// How the home names the tools a run needs to its agent unit, which installs them before its setup.
pub(crate) const TOOLS_VARIABLE: &str = "ALTHAR_WORKER_TOOLS";

pub(crate) struct WorkspaceSetup {
    pub(crate) folder: PathBuf,
    pub(crate) commands: Vec<OsString>,
}

pub(crate) enum SetupPlan {
    Single(WorkspaceSetup),
    Set(Vec<(String, WorkspaceSetup)>),
}

impl SetupPlan {
    pub(crate) fn from_wire(
        workspaces: &AgentWorkspace,
        given: &AgentWorkspaceSetup,
    ) -> io::Result<Self> {
        tools_of(given)?;
        if given.repositories.is_empty() {
            return Ok(Self::Single(WorkspaceSetup::from_wire(
                &workspaces.root,
                given,
            )?));
        }
        if !given.directory.is_empty() || !given.commands.is_empty() || given.repositories.len() > 8
        {
            return Err(invalid("The worker setup has an invalid repository list"));
        }
        let mut repositories = Vec::new();
        for given in &given.repositories {
            let checkout = workspaces
                .checkout(&given.workspace_id)
                .ok_or_else(|| invalid("The setup repository is outside this worker workspace"))?;
            if repositories.iter().any(|(id, _)| *id == given.workspace_id) {
                return Err(invalid("The worker setup repeats a repository"));
            }
            let setup = WorkspaceSetup::new(
                checkout,
                Path::new(&given.directory),
                given.commands.iter().map(OsString::from).collect(),
            )?;
            repositories.push((given.workspace_id.clone(), setup));
        }
        Ok(Self::Set(repositories))
    }

    pub(crate) fn guardian_args(&self) -> Vec<OsString> {
        let arguments = |args: &mut Vec<OsString>, plan: &WorkspaceSetup| {
            args.push(plan.folder.clone().into_os_string());
            args.push(plan.commands.len().to_string().into());
            args.extend(plan.commands.iter().cloned());
        };
        match self {
            Self::Single(plan) => {
                let mut args = vec!["--agent-unit-with-setup".into()];
                arguments(&mut args, plan);
                args
            }
            Self::Set(repositories) => {
                let mut args = vec![
                    "--agent-unit-with-repository-setup".into(),
                    repositories.len().to_string().into(),
                ];
                for (id, plan) in repositories {
                    args.push(id.into());
                    arguments(&mut args, plan);
                }
                args
            }
        }
    }

    pub(crate) fn repository_args<'a>(
        root: &Path,
        args: &'a [OsString],
    ) -> io::Result<(Self, &'a OsString, &'a [OsString])> {
        let parse = |count: &OsString| count.to_str().and_then(|count| count.parse::<usize>().ok());
        let Some((count, mut tail)) = args.split_first() else {
            return Err(invalid("Missing repository setup"));
        };
        let count = parse(count)
            .filter(|count| (1..=8).contains(count))
            .ok_or_else(|| invalid("Invalid repository setup count"))?;
        let mut repositories = Vec::with_capacity(count);
        for _ in 0..count {
            let [id, folder, count, rest @ ..] = tail else {
                return Err(invalid("Incomplete repository setup"));
            };
            let id = id
                .to_str()
                .filter(|id| valid_id(id, "ws_"))
                .ok_or_else(|| invalid("Invalid repository setup ID"))?;
            let count = parse(count)
                .filter(|count| *count < rest.len())
                .ok_or_else(|| invalid("Invalid setup command count"))?;
            let (commands, remaining) = rest.split_at(count);
            let directory = Path::new(folder)
                .strip_prefix(root)
                .map_err(io::Error::other)?;
            repositories.push((
                id.into(),
                WorkspaceSetup::new(root, directory, commands.to_vec())?,
            ));
            tail = remaining;
        }
        let (executable, args) = tail
            .split_first()
            .ok_or_else(|| invalid("Missing agent executable"))?;
        Ok((Self::Set(repositories), executable, args))
    }

    pub(crate) async fn run(&self) -> AgentWorkspaceSetupResult {
        let until = Instant::now() + LIMIT;
        let tools = env::var(TOOLS_VARIABLE).unwrap_or_default();
        let tools: Vec<&str> = tools.split_whitespace().collect();
        if !tools.is_empty() {
            let installed = install_tools(&tools, LIMIT).await;
            if installed.exit_code != 0 {
                return installed;
            }
            if let Self::Single(setup) = self
                && setup.commands.is_empty()
            {
                return installed;
            }
        }
        self.run_commands(until).await
    }

    async fn run_commands(&self, until: Instant) -> AgentWorkspaceSetupResult {
        match self {
            Self::Single(setup) => {
                run_workspace_setup(setup, until.saturating_duration_since(Instant::now())).await
            }
            Self::Set(repositories) => {
                let mut result = AgentWorkspaceSetupResult::default();
                for (id, setup) in repositories {
                    let outcome =
                        run_workspace_setup(setup, until.saturating_duration_since(Instant::now()))
                            .await;
                    let output_tail = outcome.output_tail
                        [outcome.output_tail.len().saturating_sub(GROUP_OUTPUT_BYTES)..]
                        .to_vec();
                    result.repositories.push(AgentRepositorySetupResult {
                        workspace_id: id.clone(),
                        exit_code: outcome.exit_code,
                        timed_out: outcome.timed_out,
                        output_tail,
                    });
                }
                result
            }
        }
    }
}

fn invalid(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}

/// The tools a setup asks for, as `name@version` (a version, or `latest`): only those a worker installs itself.
pub(crate) fn tools_of(given: &AgentWorkspaceSetup) -> io::Result<Vec<String>> {
    let version = |text: &str| {
        !text.is_empty()
            && text.len() <= 32
            && text
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'+'))
    };
    if given.tools.len() > TOOLS
        || given
            .tools
            .iter()
            .any(|tool| !KNOWN_TOOLS.contains(&tool.name.as_str()) || !version(&tool.version))
    {
        return Err(invalid(
            "The worker setup asks for a tool it doesn't install",
        ));
    }
    Ok(given
        .tools
        .iter()
        .map(|tool| format!("{}@{}", tool.name, tool.version))
        .collect())
}

impl WorkspaceSetup {
    pub(crate) fn from_wire(root: &Path, given: &AgentWorkspaceSetup) -> io::Result<Self> {
        let commands: Vec<OsString> = given.commands.iter().map(OsString::from).collect();
        // A setup of tools alone runs no command of its own.
        if commands.is_empty() && !given.tools.is_empty() && given.directory.is_empty() {
            return Ok(Self {
                folder: workspace_folder(root, Path::new(""))?,
                commands,
            });
        }
        Self::new(root, Path::new(&given.directory), commands)
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

/// The folders of the tools installed for this run, once its unit has installed them.
static TOOL_FOLDERS: OnceLock<Vec<PathBuf>> = OnceLock::new();

fn data_home() -> Option<PathBuf> {
    env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(|| env::var_os("HOME").map(|home| Path::new(&home).join(".local/share")))
}

/// Where a run's commands and its agent find programs, as the release's own check finds them (apps/host's
/// `workerPath`): the tools installed for the run first, then what the worker ships for its agents' sandbox (its `bin`
/// holds only bubblewrap, socat and ripgrep, under the one AppArmor rule that lets them), the person's own folders
/// (`~/.local/bin`, `~/.bun/bin`, `~/.cargo/bin`, where a lead's fix installs), the system's, and last its own Node.
pub(crate) fn worker_path() -> OsString {
    let mut folders: Vec<PathBuf> = TOOL_FOLDERS.get().cloned().unwrap_or_default();
    if let Some(data) = data_home() {
        folders.push(data.join("althar-worker/bin"));
    }
    if let Some(home) = env::var_os("HOME") {
        let home = Path::new(&home);
        folders.extend([".local/bin", ".bun/bin", ".cargo/bin"].map(|folder| home.join(folder)));
    }
    folders.extend(["/usr/local/bin", "/usr/bin", "/bin"].map(PathBuf::from));
    if let Some(program) = env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
    {
        folders.push(program.join("node/bin"));
    }
    env::join_paths(folders.iter().filter(|folder| folder.is_absolute()))
        .unwrap_or_else(|_| "/usr/local/bin:/usr/bin:/bin".into())
}

pub(crate) fn worker_environment(command: &mut Command) -> &mut Command {
    command.env_clear().env("PATH", worker_path());
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

/// Installs the tools a run needs with the release's own installer (`althar-host worker tools`), into the worker's
/// folder, without root: each folder it says (`path\t<folder>`) goes first on the run's PATH; what else it says is kept
/// as the setup's output, so a failure reaches the home with its words.
async fn install_tools(tools: &[&str], duration: Duration) -> AgentWorkspaceSetupResult {
    let mut output_tail = Vec::with_capacity(OUTPUT_BYTES);
    let Some(program) = env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
    else {
        append_tail(
            &mut output_tail,
            b"Althar could not find its own release.\n",
        );
        return AgentWorkspaceSetupResult {
            exit_code: 1,
            output_tail,
            ..Default::default()
        };
    };
    let node = program.join("node/bin/node");
    let host = program.join("dist/althar-host.js");
    if !node.is_file() || !host.is_file() {
        append_tail(
            &mut output_tail,
            b"This worker wasn't installed from a release, so it can't install tools.\n",
        );
        return AgentWorkspaceSetupResult {
            exit_code: 1,
            output_tail,
            ..Default::default()
        };
    }
    let mut folders = Vec::new();
    let finished = timeout(duration, async {
        let mut installer = Command::new(&node);
        let output = worker_environment(&mut installer)
            .arg(&host)
            .args(["worker", "tools"])
            .args(tools)
            .current_dir(env::var_os("HOME").map_or_else(|| PathBuf::from("/"), PathBuf::from))
            .stdin(Stdio::null())
            .kill_on_drop(true)
            .output()
            .await?;
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            match line.split_once('\t') {
                Some(("path", folder)) if Path::new(folder).is_absolute() => {
                    folders.push(PathBuf::from(folder));
                }
                _ => {
                    append_tail(&mut output_tail, line.as_bytes());
                    append_tail(&mut output_tail, b"\n");
                }
            }
        }
        append_tail(&mut output_tail, &output.stderr);
        Ok::<_, io::Error>(
            output
                .status
                .code()
                .and_then(|code| u32::try_from(code).ok())
                .unwrap_or(1),
        )
    })
    .await;
    let (exit_code, timed_out) = match finished {
        Ok(Ok(code)) => (code, false),
        Ok(Err(_)) => {
            append_tail(
                &mut output_tail,
                b"Althar could not start the tool installer.\n",
            );
            (1, false)
        }
        Err(_) => (1, true),
    };
    if exit_code == 0 {
        let _ = TOOL_FOLDERS.set(folders);
    }
    AgentWorkspaceSetupResult {
        exit_code,
        timed_out,
        output_tail,
        ..Default::default()
    }
}

async fn run_workspace_setup(
    setup: &WorkspaceSetup,
    duration: Duration,
) -> AgentWorkspaceSetupResult {
    if duration.is_zero() {
        return AgentWorkspaceSetupResult {
            exit_code: 1,
            timed_out: true,
            ..Default::default()
        };
    }
    let mut output_tail = Vec::with_capacity(OUTPUT_BYTES);
    let finished = timeout(duration, async {
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
        ..Default::default()
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
        let result = run_workspace_setup(&setup, LIMIT).await;
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
    fn a_setup_asks_only_for_tools_a_worker_installs_itself() -> io::Result<()> {
        use crate::wire::AgentWorkerTool;
        let tool = |name: &str, version: &str| AgentWorkerTool {
            name: name.into(),
            version: version.into(),
        };
        let given = AgentWorkspaceSetup {
            tools: vec![
                tool("bun", "1.3.5"),
                tool("node", "24"),
                tool("uv", "latest"),
            ],
            ..Default::default()
        };
        assert_eq!(tools_of(&given)?, vec!["bun@1.3.5", "node@24", "uv@latest"]);
        for (name, version) in [
            ("cargo", "1"),
            ("bun", ""),
            ("bun", "1;touch x"),
            ("node", "../x"),
        ] {
            let asked = AgentWorkspaceSetup {
                tools: vec![tool(name, version)],
                ..Default::default()
            };
            assert!(tools_of(&asked).is_err(), "{name}@{version}");
        }
        let fixture = tempfile::tempdir()?;
        let alone = AgentWorkspaceSetup {
            tools: vec![tool("bun", "latest")],
            ..Default::default()
        };
        assert!(
            WorkspaceSetup::from_wire(fixture.path(), &alone)?
                .commands
                .is_empty()
        );
        assert!(
            WorkspaceSetup::from_wire(fixture.path(), &AgentWorkspaceSetup::default()).is_err(),
            "no tools and no commands is no setup"
        );
        Ok(())
    }

    #[test]
    fn a_run_finds_the_sandbox_the_worker_ships_then_the_persons_programs_then_the_systems() {
        let path = worker_path();
        let folders: Vec<_> = env::split_paths(&path).collect();
        let at = |end: &str| folders.iter().position(|folder| folder.ends_with(end));
        let system = at("usr/bin").expect("the system's");
        assert!(at(".local/bin").is_none_or(|own| own < system));
        assert!(at("althar-worker/bin").is_none_or(|shipped| shipped < system));
        assert!(at("node/bin").is_none_or(|node| node > system));
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
