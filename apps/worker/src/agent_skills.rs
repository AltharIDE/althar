use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
};

use crate::{agent_workspace::private_directory, wire::AgentSkillFiles};

pub(crate) const MAX_BYTES: usize = 8 * 1024 * 1024;
const MAX_FILES: usize = 512;

fn invalid() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, "Invalid selected skill files")
}

pub(crate) struct SkillDirectory {
    path: PathBuf,
}

impl SkillDirectory {
    pub(crate) fn write(root: &Path, run_id: &str, bundle: AgentSkillFiles) -> io::Result<Self> {
        if bundle.files.is_empty() || bundle.files.len() > MAX_FILES {
            return Err(invalid());
        }
        let site = root.parent().ok_or_else(invalid)?;
        if site.canonicalize()? != site {
            return Err(invalid());
        }
        let path = site.join(format!(".{run_id}.skills"));
        private_directory(&path)?;
        let directory = Self { path };
        for file in bundle.files {
            if file.path.len() > 512
                || file.path.chars().any(|ch| ch.is_control() || ch == '\\')
                || file
                    .path
                    .split('/')
                    .any(|part| matches!(part, "" | "." | ".." | ".git"))
            {
                return Err(invalid());
            }
            let filename = directory.path.join(file.path);
            fs::create_dir_all(filename.parent().ok_or_else(invalid)?)?;
            let mode = if file.executable { 0o500 } else { 0o400 };
            let mut output = OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(filename)?;
            output.write_all(&file.data)?;
            output.set_permissions(fs::Permissions::from_mode(mode))?;
        }
        Ok(directory)
    }

    pub(crate) fn as_str(&self) -> io::Result<&str> {
        self.path.to_str().ok_or_else(invalid)
    }
}

impl Drop for SkillDirectory {
    fn drop(&mut self) {
        if let Err(error) = fs::remove_dir_all(&self.path)
            && error.kind() != io::ErrorKind::NotFound
        {
            eprintln!("Could not remove the run’s skill files ({})", error.kind());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wire::AgentSkillFile;

    #[test]
    fn writes_executable_projected_assets_outside_the_checkout_and_cleans_them() -> io::Result<()> {
        let fixture = tempfile::tempdir()?;
        let root = fixture.path().join("checkout");
        let file = AgentSkillFile {
            path: ".agents/skills/example/script.sh".into(),
            data: b"exit 0\n".to_vec(),
            executable: true,
        };
        let forbidden = AgentSkillFile {
            path: "../../escape.md".into(),
            ..file.clone()
        };
        assert!(
            SkillDirectory::write(
                &root,
                "test",
                AgentSkillFiles {
                    files: vec![file.clone(), forbidden]
                }
            )
            .is_err()
        );
        assert!(!fixture.path().join(".test.skills").exists());
        let directory = SkillDirectory::write(
            &root,
            "test",
            AgentSkillFiles {
                files: vec![file.clone()],
            },
        )?;
        let asset = Path::new(directory.as_str()?).join(file.path);
        assert_eq!(fs::read(&asset)?, file.data);
        assert_eq!(fs::metadata(&asset)?.permissions().mode() & 0o777, 0o500);
        assert!(!asset.starts_with(root));
        drop(directory);
        assert!(!asset.exists());
        Ok(())
    }
}
