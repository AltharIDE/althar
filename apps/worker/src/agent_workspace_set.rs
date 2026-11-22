use std::{
    collections::{BTreeMap, HashSet},
    fs, io,
    path::{Path, PathBuf},
};

use rustix::fs::{CWD, RenameFlags, renameat_with};

use crate::{
    agent_workspace::{MAX_BUNDLE_BYTES, WorkspaceTransfer, private_directory},
    valid_id,
    wire::{AgentWorkspaceRepository, AgentWorkspaceSource},
};

const MAX_REPOSITORIES: usize = 8;
const MAX_SET_BYTES: u64 = 2 * MAX_BUNDLE_BYTES as u64;

fn invalid() -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidInput,
        "Invalid or oversized set of worker repositories",
    )
}

fn valid_folder(folder: &str) -> bool {
    (1..=64).contains(&folder.len())
        && folder.as_bytes()[0].is_ascii_alphanumeric()
        && folder.bytes().all(|c| {
            c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, b'.' | b'_' | b'-')
        })
}

pub(crate) struct AgentWorkspace {
    pub(crate) root: PathBuf,
    repositories: BTreeMap<String, PathBuf>,
}

impl AgentWorkspace {
    pub(crate) fn single(root: PathBuf) -> Self {
        Self {
            root,
            repositories: BTreeMap::new(),
        }
    }

    pub(crate) fn checkout(&self, workspace: &str) -> Option<&Path> {
        if self.repositories.is_empty() && workspace.is_empty() {
            return Some(&self.root);
        }
        self.repositories.get(workspace).map(PathBuf::as_path)
    }
}

pub(crate) struct WorkspaceSet {
    staging: PathBuf,
    destination: PathBuf,
    installed: AgentWorkspace,
}

impl WorkspaceSet {
    pub(crate) fn new(
        destination: PathBuf,
        run_id: &str,
        primary: &str,
        repos: &[AgentWorkspaceRepository],
    ) -> io::Result<Self> {
        if !(2..=MAX_REPOSITORIES).contains(&repos.len()) {
            return Err(invalid());
        }
        let mut sizes = 0_u64;
        let mut names = HashSet::new();
        let mut repositories = BTreeMap::new();
        for entry in repos {
            if !valid_id(&entry.workspace_id, "ws_")
                || !valid_folder(&entry.directory)
                || !names.insert(entry.directory.as_str())
            {
                return Err(invalid());
            }
            if repositories
                .insert(
                    entry.workspace_id.clone(),
                    destination.join(&entry.directory),
                )
                .is_some()
            {
                return Err(invalid());
            }
            sizes += u64::from(entry.source.as_ref().ok_or_else(invalid)?.size);
        }
        if sizes > MAX_SET_BYTES {
            return Err(invalid());
        }
        if !repositories.contains_key(primary) {
            return Err(invalid());
        }
        let project = destination.parent().ok_or_else(invalid)?;
        match private_directory(project) {
            Ok(()) => (),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => (),
            Err(error) => return Err(error),
        }
        if project.canonicalize()? != project
            || !project.is_dir()
            || fs::symlink_metadata(&destination).is_ok()
        {
            return Err(invalid());
        }
        let staging = project.join(format!(".{run_id}.workspaces"));
        private_directory(&staging)?;
        let installed = AgentWorkspace {
            root: destination.clone(),
            repositories,
        };
        Ok(Self {
            staging,
            destination,
            installed,
        })
    }

    pub(crate) fn uploads<'a>(
        &self,
        entries: &'a [AgentWorkspaceRepository],
    ) -> io::Result<Vec<(WorkspaceTransfer, &'a AgentWorkspaceSource)>> {
        entries
            .iter()
            .map(|entry| {
                let source = entry.source.as_ref().ok_or_else(invalid)?;
                let transfer = WorkspaceTransfer::create(
                    self.staging.join(&entry.directory),
                    &entry.workspace_id,
                    source,
                )?;
                Ok((transfer, source))
            })
            .collect()
    }

    pub(crate) fn publish(self) -> io::Result<AgentWorkspace> {
        renameat_with(
            CWD,
            &self.staging,
            CWD,
            &self.destination,
            RenameFlags::NOREPLACE,
        )
        .map_err(io::Error::from)?;
        fs::File::open(self.destination.parent().ok_or_else(invalid)?)?.sync_all()?;
        Ok(AgentWorkspace {
            root: self.installed.root.clone(),
            repositories: self.installed.repositories.clone(),
        })
    }
}

impl Drop for WorkspaceSet {
    fn drop(&mut self) {
        // Once published, the staging name is gone. Never remove a checkout an agent used.
        if let Err(error) = fs::remove_dir_all(&self.staging)
            && error.kind() != io::ErrorKind::NotFound
        {
            eprintln!("Could not remove a staged workspace set ({})", error.kind());
        }
    }
}
