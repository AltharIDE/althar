//! Taking a worker its home set up off this computer: what its setup put here (apps/host/src/workerSetup.ts), and
//! nothing else.
//!
//! - its services, `althar-worker.service`, its check and its update timer, stopped and their files removed, and the
//!   units of any run still going stopped;
//! - its folder (its key, certificate, journal, checkouts, agents' launchers and tools) and its program folder (the
//!   releases it ran);
//! - the AppArmor rule its setup made for its bubblewrap, where it names this worker's program folder and this login may
//!   use `sudo` without a password. Otherwise it says the command for the computer's administrator.
//!
//! The agents' own sign-ins (`~/.codex`, `~/.claude`) stay: they are the agents' files, in the login's home, and may be
//! older than Althar. So does the login's lingering, and the login Althar made where it was set up as root.
//!
//! The person runs it as `althar-worker uninstall`. When its home says it was removed, the service starts it in a unit
//! of its own (`begin`), which outlives the service it stops.

use std::{
    env, fs, io,
    path::{Path, PathBuf},
};

use tokio::process::Command;

use crate::cleanup::remove_tree;

const SERVICE: &str = "althar-worker.service";
const UNITS: [&str; 4] = [
    SERVICE,
    "althar-worker-check.service",
    "althar-worker-update.service",
    "althar-worker-update.timer",
];
/// A run's units, as agent_reservation.rs, agent_managed.rs and project.rs name them.
const RUN_UNITS: [&str; 3] = [
    "althar-agent-*.service",
    "althar-managed-*.service",
    "althar-wpr_*.service",
];
const APPARMOR_RULE: &str = "/etc/apparmor.d/althar-worker-bwrap";
const UNINSTALL_UNIT: &str = "althar-worker-uninstall";

fn home() -> io::Result<PathBuf> {
    env::var_os("HOME")
        .filter(|home| !home.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "No HOME for this login"))
}

/// Where a worker its home set up keeps its files: `${XDG_DATA_HOME:-$HOME/.local/share}/althar-worker`.
pub fn default_folder() -> io::Result<PathBuf> {
    let data = match env::var_os("XDG_DATA_HOME").filter(|data| !data.is_empty()) {
        Some(data) => PathBuf::from(data),
        None => home()?.join(".local/share"),
    };
    Ok(data.join("althar-worker"))
}

fn units_folder() -> io::Result<PathBuf> {
    let config = match env::var_os("XDG_CONFIG_HOME").filter(|config| !config.is_empty()) {
        Some(config) => PathBuf::from(config),
        None => home()?.join(".config"),
    };
    Ok(config.join("systemd/user"))
}

/// The folder and the program folder beside it, where `folder` is a worker's own: named so, and absolute.
fn places(folder: &Path) -> io::Result<(PathBuf, PathBuf)> {
    if !folder.is_absolute()
        || folder
            .file_name()
            .is_none_or(|name| name != "althar-worker")
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "That isn't a worker's folder: it is named althar-worker",
        ));
    }
    Ok((
        folder.to_path_buf(),
        folder.with_file_name("althar-worker-program"),
    ))
}

async fn systemctl(args: &[&str]) -> bool {
    Command::new("systemctl")
        .arg("--user")
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .status()
        .await
        .is_ok_and(|status| status.success())
}

/// The root part, as one `sh -c` script: the AppArmor rule, unloaded and removed. None where the rule isn't this
/// worker's: another login's worker on this computer may need it.
fn root_script(rule: Option<&str>, program: &Path) -> Option<String> {
    let ours = format!(" {}/bundle-*/", program.display());
    rule?.contains(&ours).then(|| {
        format!("apparmor_parser -R {APPARMOR_RULE} 2>/dev/null; rm -f -- {APPARMOR_RULE}")
    })
}

/// Takes the worker in `folder` off this computer, saying each step. Fails, once all it could do is done, where some of
/// it stays.
pub async fn uninstall(folder: &Path) -> io::Result<()> {
    uninstall_with(folder, &units_folder()?).await
}

async fn uninstall_with(folder: &Path, units: &Path) -> io::Result<()> {
    let (folder, program) = places(folder)?;
    // Nothing of a worker for this login: run as another (root, where the worker is `althar`'s), it says so, and
    // takes nothing.
    if !folder.exists() && !program.exists() && !units.join(SERVICE).exists() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!(
                "No worker is set up for this login at {}. Run this as the worker's own login.",
                folder.display()
            ),
        ));
    }
    // Without its login's service manager, its services would go on running from files taken away under them: stop
    // before anything is.
    if !systemctl(&["show-environment"]).await {
        return Err(io::Error::other(
            "This login's service manager can't be reached, so the worker's services can't be stopped. Log in as the worker's login over SSH, or use `sudo machinectl shell <login>@`, and run this again.",
        ));
    }
    let mut stayed = Vec::new();
    // Its services first, so nothing starts a run or an update while its files go.
    if !systemctl(&["disable", "--now", SERVICE, "althar-worker-update.timer"]).await
        && units.join(SERVICE).exists()
    {
        return Err(io::Error::other(
            "The worker's services couldn't be stopped, so nothing was removed. `journalctl --user -u althar-worker.service` says why.",
        ));
    }
    let mut stop = vec![
        "stop",
        "althar-worker-check.service",
        "althar-worker-update.service",
    ];
    stop.extend(RUN_UNITS);
    systemctl(&stop).await;
    println!("Stopped the worker's services and its runs.");
    for unit in UNITS {
        match fs::remove_file(units.join(unit)) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => stayed.push(format!("{}: {error}", units.join(unit).display())),
        }
    }
    systemctl(&["daemon-reload"]).await;
    let mut failed = vec!["reset-failed"];
    failed.extend(UNITS);
    systemctl(&failed).await;
    println!("Removed its services.");
    for (path, what) in [
        (&folder, "its files and checkouts"),
        (&program, "its releases"),
    ] {
        if !path.exists() {
            continue;
        }
        match remove_tree(path) {
            Ok(()) => println!("Removed {what} ({}).", path.display()),
            Err(error) => stayed.push(format!("{}: {error}", path.display())),
        }
    }
    let rule = fs::read_to_string(APPARMOR_RULE).ok();
    if let Some(script) = root_script(rule.as_deref(), &program) {
        let removed = Command::new("sudo")
            .args(["-n", "sh", "-c", &script])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await
            .is_ok_and(|status| status.success());
        if removed {
            println!("Removed the sandbox's AppArmor rule.");
        } else {
            println!(
                "The sandbox's AppArmor rule stays: this login can't use sudo without a password. An administrator removes it with:\nsudo sh -c '{script}'"
            );
        }
    }
    if stayed.is_empty() {
        println!("The worker is off this computer. Its agents' sign-ins stay, as their own files.");
        return Ok(());
    }
    Err(io::Error::other(format!(
        "Some of the worker stays:\n{}",
        stayed.join("\n")
    )))
}

/// From the worker's own service: starts `uninstall` in a unit of its own, which stops the service and outlives it.
pub async fn begin(folder: &Path) -> io::Result<()> {
    places(folder)?;
    let executable = env::current_exe()?;
    let started = Command::new("systemd-run")
        .args(["--user", "--collect", "--quiet", "--unit", UNINSTALL_UNIT])
        .arg(&executable)
        .arg("uninstall")
        .arg(folder)
        .stdin(std::process::Stdio::null())
        .status()
        .await?;
    if !started.success() {
        return Err(io::Error::other(
            "systemd couldn't start the worker's uninstall",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_workers_own_folder_is_taken_away() {
        assert!(places(Path::new("/home/someone/.local/share/althar-worker")).is_ok());
        assert_eq!(
            places(Path::new("/srv/althar-worker")).unwrap().1,
            Path::new("/srv/althar-worker-program")
        );
        for folder in [
            "/home/someone",
            "althar-worker",
            "/",
            "/srv/althar-worker-program",
        ] {
            assert!(places(Path::new(folder)).is_err(), "{folder}");
        }
    }

    #[tokio::test]
    async fn says_so_and_takes_nothing_where_this_login_has_no_worker() -> io::Result<()> {
        let temp = tempfile::tempdir()?;
        let folder = temp.path().join("althar-worker");
        let units = temp.path().join("units");
        let error = uninstall_with(&folder, &units)
            .await
            .expect_err("nothing to take");
        assert_eq!(error.kind(), io::ErrorKind::NotFound);
        assert!(
            error
                .to_string()
                .contains("No worker is set up for this login")
        );
        assert!(!folder.exists() && !units.exists());
        Ok(())
    }

    #[test]
    fn the_rule_goes_only_where_it_names_this_workers_program() {
        let program = Path::new("/home/althar/.local/share/althar-worker-program");
        let rule = "abi <abi/4.0>,\ninclude <tunables/global>\nprofile althar-worker-bwrap /home/althar/.local/share/althar-worker-program/bundle-*/**/bwrap flags=(unconfined) {\n  userns,\n}\n";
        assert_eq!(
            root_script(Some(rule), program).as_deref(),
            Some(
                "apparmor_parser -R /etc/apparmor.d/althar-worker-bwrap 2>/dev/null; rm -f -- /etc/apparmor.d/althar-worker-bwrap"
            )
        );
        // Another login's worker's rule, or none: no root part.
        assert_eq!(
            root_script(
                Some(rule),
                Path::new("/home/other/.local/share/althar-worker-program")
            ),
            None
        );
        assert_eq!(root_script(None, program), None);
    }
}
