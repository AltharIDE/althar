use std::{
    collections::HashSet,
    fs, io,
    io::BufRead,
    net::{Ipv4Addr, Ipv6Addr, SocketAddr},
    path::{Path, PathBuf},
};

use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    sync::mpsc,
    time::{Duration, timeout},
};
use tokio_stream::wrappers::ReceiverStream;
use tonic::transport::Channel;

use crate::{
    agent::{CHUNK_BYTES, Failure},
    grpc::control_client,
    wire::{AgentPreviewRequest, agent_preview_request::Payload},
};

const OPEN_TIMEOUT: Duration = Duration::from_secs(3);

fn refused() -> io::Error {
    io::Error::new(
        io::ErrorKind::PermissionDenied,
        "Only a loopback port listening in this command’s process group can be previewed",
    )
}

fn listeners(table: &Path, ip: &str, port: u16) -> io::Result<HashSet<String>> {
    let address = format!("{ip}:{port:04X}");
    let mut owned = HashSet::new();
    for line in io::BufReader::new(fs::File::open(table)?).lines().skip(1) {
        let line = line?;
        let mut columns = line.split_ascii_whitespace();
        if columns.nth(1) != Some(address.as_str()) || columns.nth(1) != Some("0A") {
            continue;
        }
        if let Some(inode) = columns.nth(5).filter(|inode| *inode != "0") {
            owned.insert(format!("socket:[{inode}]"));
        }
    }
    Ok(owned)
}

fn listening_in(group: &Path, port: u16) -> io::Result<SocketAddr> {
    let tables = [
        (
            "/proc/net/tcp",
            "0100007F",
            SocketAddr::from((Ipv4Addr::LOCALHOST, port)),
        ),
        (
            "/proc/net/tcp6",
            "00000000000000000000000001000000",
            SocketAddr::from((Ipv6Addr::LOCALHOST, port)),
        ),
    ];
    let processes = io::BufReader::new(fs::File::open(group.join("cgroup.procs"))?)
        .lines()
        .take(4_096)
        .collect::<Result<Vec<_>, _>>()?;
    for (table, ip, address) in tables {
        let mut sockets = match listeners(Path::new(table), ip, port) {
            Ok(list) => list,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error),
        };
        if sockets.is_empty() {
            continue;
        }
        for pid in processes.iter().filter_map(|pid| pid.parse::<u32>().ok()) {
            let Ok(fds) = fs::read_dir(format!("/proc/{pid}/fd")) else {
                continue;
            };
            for fd in fds.filter_map(Result::ok) {
                if let Ok(link) = fs::read_link(fd.path())
                    && let Some(target) = link.to_str()
                {
                    sockets.remove(target);
                    if sockets.is_empty() {
                        return Ok(address);
                    }
                }
            }
        }
    }
    Err(refused())
}

pub(crate) async fn forward_preview(
    channel: Channel,
    tunnel_id: String,
    group: PathBuf,
    port: u16,
) -> Result<(), Failure> {
    let first = group.clone();
    let address = timeout(
        OPEN_TIMEOUT,
        tokio::task::spawn_blocking(move || listening_in(&first, port)),
    )
    .await???;
    let connection = timeout(OPEN_TIMEOUT, TcpStream::connect(address)).await??;
    if timeout(
        OPEN_TIMEOUT,
        tokio::task::spawn_blocking(move || listening_in(&group, port)),
    )
    .await???
        != address
    {
        return Err(refused().into());
    }
    let (send, receive) = mpsc::channel(4);
    send.send(AgentPreviewRequest {
        payload: Some(Payload::TunnelId(tunnel_id)),
    })
    .await?;
    let mut peer = timeout(
        OPEN_TIMEOUT,
        control_client(channel).agent_preview(ReceiverStream::new(receive)),
    )
    .await??
    .into_inner();
    let (mut local_input, mut local_output) = connection.into_split();
    let upload = async move {
        let mut bytes = [0; CHUNK_BYTES];
        loop {
            let count = local_input.read(&mut bytes).await?;
            if count == 0 {
                return Ok::<(), Failure>(());
            }
            send.send(AgentPreviewRequest {
                payload: Some(Payload::Data(bytes[..count].to_vec())),
            })
            .await?;
        }
    };
    let download = async {
        while let Some(frame) = peer.message().await? {
            if frame.data.is_empty() || frame.data.len() > CHUNK_BYTES {
                return Err(refused().into());
            }
            local_output.write_all(&frame.data).await?;
        }
        local_output.shutdown().await?;
        Ok::<(), Failure>(())
    };
    tokio::try_join!(upload, download)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn preview_requires_its_own_loopback_listener() -> io::Result<()> {
        let group = tempfile::tempdir()?;
        let membership = group.path().join("cgroup.procs");
        let loopback = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        let public = TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0))?;
        let address = loopback.local_addr()?;
        fs::write(&membership, "0\n")?;
        assert!(listening_in(group.path(), address.port()).is_err());
        fs::write(membership, format!("{}\n", std::process::id()))?;
        assert_eq!(listening_in(group.path(), address.port())?, address);
        assert!(listening_in(group.path(), public.local_addr()?.port()).is_err());
        Ok(())
    }
}
