use std::{fs, path::Path};

use crate::{agent_reservation::account_reserved, wire::AgentWorkerCapacity};

const MIB: u64 = 1024 * 1024;

fn memory_available(meminfo: &str) -> Option<u64> {
    meminfo.lines().find_map(|line| {
        let value = line.strip_prefix("MemAvailable:")?;
        let mut words = value.split_ascii_whitespace();
        let kib = words.next()?.parse::<u64>().ok()?;
        (words.next()? == "kB").then_some(kib.saturating_mul(1024))
    })
}

/// Use the smaller of Linux's available RAM and the worker's cgroup budgets.
fn memory_limit(host: u64, cgroups: &Path, membership: &str) -> u64 {
    let Some(group) = membership
        .lines()
        .find_map(|line| line.strip_prefix("0::/"))
    else {
        return host;
    };
    let path = Path::new(group);
    if path
        .components()
        .any(|piece| !matches!(piece, std::path::Component::Normal(_)))
    {
        return host;
    }
    let mut free = host;
    for relative in path.ancestors() {
        let scope = cgroups.join(relative);
        let numeric = |name: &str| {
            fs::read_to_string(scope.join(name))
                .ok()?
                .trim()
                .parse::<u64>()
                .ok()
        };
        if let (Some(maximum), Some(current)) = (numeric("memory.max"), numeric("memory.current")) {
            free = free.min(maximum.saturating_sub(current));
        }
    }
    free
}

pub(crate) fn worker_capacity(root: &Path) -> Option<AgentWorkerCapacity> {
    let architecture = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        _ => return None,
    };
    let cpu_cores = u32::try_from(std::thread::available_parallelism().ok()?.get()).ok()?;
    let host = memory_available(&fs::read_to_string("/proc/meminfo").ok()?)?;
    let membership = fs::read_to_string("/proc/self/cgroup").unwrap_or_default();
    let usable_memory = memory_limit(host, Path::new("/sys/fs/cgroup"), &membership);
    let disk = rustix::fs::statvfs(root).ok()?;
    let free_disk = disk.f_bavail.saturating_mul(disk.f_frsize);
    let mib = |bytes: u64| u32::try_from(bytes / MIB).unwrap_or(u32::MAX);
    Some(AgentWorkerCapacity {
        platform: "linux".into(),
        architecture: architecture.into(),
        cpu_cores,
        free_memory_mib: mib(usable_memory),
        free_disk_mib: mib(free_disk),
        account_reserved: account_reserved(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_measurement_is_constrained_by_the_parent_cgroup() -> std::io::Result<()> {
        assert_eq!(
            memory_available("MemFree: 99999 kB\nMemAvailable: 250 kB\n"),
            Some(256000)
        );
        assert_eq!(memory_available("MemAvailable: 10 Gb"), None);
        let root = tempfile::tempdir()?;
        fs::create_dir_all(root.path().join("user/app"))?;
        fs::write(root.path().join("user/app/memory.max"), "max")?;
        assert_eq!(memory_limit(9000, root.path(), "0::/user/app"), 9000);
        fs::write(root.path().join("user/memory.max"), "1024\n")?;
        fs::write(root.path().join("user/memory.current"), "256\n")?;
        assert_eq!(memory_limit(9000, root.path(), "0::/user/app"), 768);
        assert_eq!(memory_limit(300, root.path(), "0::/user/app"), 300);
        Ok(())
    }
}
