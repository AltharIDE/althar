use std::{
    fs::{self, File, OpenOptions},
    future::Future,
    io::{self, Read, Write},
    os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    time::Duration,
};

use rustix::{
    fs::{FlockOperation, Mode, OFlags, flock, open},
    io::Errno,
    process::geteuid,
};
use tokio::{process::Command, time::timeout};

use crate::{
    project::{cgroup_empty, cgroup_path},
    valid_id,
};

const LOCK: &str = "althar-worker-agent.lock";
const RECORD: &str = "althar-worker-agent.run";

fn runtime() -> PathBuf {
    PathBuf::from(format!("/run/user/{}", geteuid().as_raw()))
}

fn unavailable(text: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::ResourceBusy, text)
}

fn checked(file: &File) -> io::Result<()> {
    let metadata = file.metadata()?;
    if !metadata.is_file()
        || metadata.nlink() != 1
        || metadata.uid() != geteuid().as_raw()
        || metadata.permissions().mode() & 0o077 != 0
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "The worker reservation files must be private",
        ));
    }
    Ok(())
}

fn own_lock(directory: &Path) -> io::Result<File> {
    let metadata = fs::symlink_metadata(directory)?;
    if !metadata.is_dir()
        || metadata.uid() != geteuid().as_raw()
        || metadata.permissions().mode() & 0o077 != 0
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "The worker needs its private systemd user runtime directory",
        ));
    }
    let fd = open(
        directory.join(LOCK),
        OFlags::RDWR | OFlags::CREATE | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::RUSR | Mode::WUSR,
    )?;
    let file = File::from(fd);
    checked(&file)?;
    flock(&file, FlockOperation::NonBlockingLockExclusive).map_err(|error| {
        if error == Errno::WOULDBLOCK {
            unavailable("Another home is using this worker account")
        } else {
            error.into()
        }
    })?;
    Ok(file)
}

fn previous(directory: &Path) -> io::Result<Option<String>> {
    let fd = match open(
        directory.join(RECORD),
        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::empty(),
    ) {
        Ok(file) => file,
        Err(Errno::NOENT) => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    let file = File::from(fd);
    checked(&file)?;
    let mut record = String::new();
    file.take(37).read_to_string(&mut record)?;
    if !valid_id(&record, "war_") {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "The last worker reservation could not be verified",
        ));
    }
    Ok(Some(record))
}

pub(crate) fn agent_service(run_id: &str) -> String {
    format!("althar-agent-{run_id}.service")
}

async fn previous_stopped(run_id: &str) -> io::Result<bool> {
    let unit = agent_service(run_id);
    let inspected = timeout(
        Duration::from_secs(3),
        Command::new("/usr/bin/systemctl")
            .args([
                "--user",
                "show",
                "--property=ActiveState",
                "--property=LoadState",
                "--property=ControlGroup",
                &unit,
            ])
            .kill_on_drop(true)
            .output(),
    )
    .await??;
    let output = std::str::from_utf8(&inspected.stdout).map_err(io::Error::other)?;
    let property = |prefix| output.lines().find_map(|line| line.strip_prefix(prefix));
    let inactive = matches!(property("ActiveState="), Some("inactive" | "failed"));
    let empty = match property("ControlGroup=") {
        Some(group) if !group.is_empty() => cgroup_empty(&cgroup_path(&unit, group.as_bytes())?),
        _ => inactive,
    };
    Ok(inactive
        && empty
        && (inspected.status.success() || property("LoadState=") == Some("not-found")))
}

async fn reserve_in<F: Future<Output = io::Result<bool>>>(
    directory: &Path,
    run_id: &str,
    stopped: impl FnOnce(String) -> F,
) -> io::Result<File> {
    if !valid_id(run_id, "war_") {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Invalid worker reservation",
        ));
    }
    let lock = match own_lock(directory) {
        Err(error) if error.kind() == io::ErrorKind::ResourceBusy => {
            // A capacity probe may have held the file just as this start submitted.
            tokio::time::sleep(Duration::from_millis(20)).await;
            own_lock(directory)?
        }
        result => result?,
    };
    if let Some(before) = previous(directory)?
        && !stopped(before).await?
    {
        return Err(unavailable("The worker is still stopping its previous run"));
    }
    let staged = directory.join(format!(".althar-reservation-{run_id}"));
    let mut update = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&staged)?;
    let result = update
        .write_all(run_id.as_bytes())
        .and_then(|()| update.sync_data())
        .and_then(|()| fs::rename(&staged, directory.join(RECORD)));
    if result.is_err() {
        let _ = fs::remove_file(staged);
    }
    result?;
    Ok(lock)
}

/// Used in capacity reports. The start itself still takes the authoritative lock.
pub(crate) fn account_reserved() -> bool {
    own_lock(&runtime()).is_err()
}

/// Two homes can enroll this account. Only one can stage or run work at a time.
/// The last service ID stays on disk so a killed worker cannot free a live task.
pub(crate) async fn reserve(run_id: &str) -> io::Result<File> {
    reserve_in(&runtime(), run_id, |before| async move {
        previous_stopped(&before).await
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn two_homes_cannot_overbook_and_a_stale_service_must_finish() -> io::Result<()> {
        let directory = tempfile::tempdir()?;
        fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o700))?;
        let first = format!("war_{}", "1".repeat(32));
        let second = format!("war_{}", "2".repeat(32));
        let lock = reserve_in(directory.path(), &first, |_| async {
            panic!("first owner")
        })
        .await?;
        let busy = reserve_in(directory.path(), &second, |_| async { panic!("lock held") })
            .await
            .unwrap_err();
        assert_eq!(busy.kind(), io::ErrorKind::ResourceBusy);
        drop(lock);
        let expected = first.as_str();
        let still_active = reserve_in(directory.path(), &second, |old| async move {
            assert_eq!(old, expected);
            Ok(false)
        })
        .await
        .unwrap_err();
        assert_eq!(still_active.kind(), io::ErrorKind::ResourceBusy);
        let after = reserve_in(directory.path(), &second, |old| async move {
            assert_eq!(old, expected);
            Ok(true)
        })
        .await?;
        assert_eq!(previous(directory.path())?, Some(second));
        drop(after);
        Ok(())
    }
}
