use std::{
    fs::File,
    io::{self, Read},
    os::unix::fs::MetadataExt,
    path::{Path, PathBuf},
};

use rustix::fs::{CWD, Mode, OFlags, ResolveFlags, openat2};

use crate::{
    agent::{CHUNK_BYTES, Sender, send},
    wire::{
        AgentFileChunk, AgentFileRequest, AgentFileResult,
        agent_worker_frame::Payload as WorkerMessage,
    },
};

const MAX_BYTES: u64 = 16 * 1024 * 1024;

fn invalid() -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidInput,
        "File outside the worker checkout or beyond its limits",
    )
}

fn read_file(root: &Path, path: &str) -> io::Result<Vec<u8>> {
    if path.len() > 512
        || path
            .chars()
            .any(|value| value.is_control() || value == '\\')
        || path
            .split('/')
            .any(|entry| matches!(entry, "" | "." | "..") || entry.eq_ignore_ascii_case(".git"))
    {
        return Err(invalid());
    }
    read_in_checkout(root, path)
}

/** Opens a fixed file beneath the authenticated checkout without following links. */
pub(crate) fn read_in_checkout(root: &Path, path: &str) -> io::Result<Vec<u8>> {
    let checkout = openat2(
        CWD,
        root,
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC,
        Mode::empty(),
        ResolveFlags::NO_SYMLINKS,
    )?;
    let source = openat2(
        checkout,
        path,
        OFlags::RDONLY | OFlags::CLOEXEC | OFlags::NONBLOCK,
        Mode::empty(),
        ResolveFlags::BENEATH | ResolveFlags::NO_XDEV | ResolveFlags::NO_SYMLINKS,
    )?;
    let mut file = File::from(source);
    let before = file.metadata()?;
    if !before.is_file() || before.nlink() != 1 || before.len() > MAX_BYTES {
        return Err(invalid());
    }
    let mut contents = Vec::with_capacity(before.len() as usize);
    (&mut file).take(MAX_BYTES + 1).read_to_end(&mut contents)?;
    let after = file.metadata()?;
    if contents.len() as u64 != before.len()
        || after.len() != before.len()
        || before.ctime() != after.ctime()
        || before.ctime_nsec() != after.ctime_nsec()
    {
        return Err(invalid());
    }
    Ok(contents)
}

pub(crate) async fn send_file(
    outgoing: Sender,
    root: Option<PathBuf>,
    request: AgentFileRequest,
) -> io::Result<()> {
    let file = request.file;
    let contents = tokio::task::spawn_blocking(move || {
        let root = root.ok_or_else(invalid)?;
        read_file(&root, &request.relative_path)
    })
    .await
    .map_err(io::Error::other)?;
    let bytes = match contents {
        Ok(bytes) => bytes,
        Err(_) => {
            return send(
                &outgoing,
                WorkerMessage::FileResult(AgentFileResult {
                    file,
                    unavailable: true,
                    ..Default::default()
                }),
            )
            .await;
        }
    };
    let digest = ring::digest::digest(&ring::digest::SHA256, &bytes)
        .as_ref()
        .to_vec();
    send(
        &outgoing,
        WorkerMessage::FileResult(AgentFileResult {
            file: file.clone(),
            unavailable: false,
            size: bytes.len() as u32,
            sha256: digest,
        }),
    )
    .await?;
    for piece in bytes.chunks(CHUNK_BYTES) {
        send(
            &outgoing,
            WorkerMessage::FileChunk(AgentFileChunk {
                file: file.clone(),
                data: piece.to_vec(),
            }),
        )
        .await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, os::unix::fs::symlink};

    #[test]
    fn reads_untracked_outputs_and_never_follows_links_or_git_internals() -> io::Result<()> {
        let temp = tempfile::tempdir()?;
        let root = temp.path().canonicalize()?.join("repo");
        fs::create_dir(&root)?;
        fs::write(root.join("work.bin"), [4, 2])?;
        let external = temp.path().join("outside");
        fs::write(&external, "external")?;
        symlink(&external, root.join("link"))?;
        fs::hard_link(&external, root.join("hard"))?;
        fs::create_dir(root.join(".git"))?;
        fs::write(root.join(".git/private"), "git internals")?;
        assert_eq!(read_file(&root, "work.bin")?, [4, 2]);
        for path in [
            "../outside",
            "/work.bin",
            "link",
            "hard",
            ".git/private",
            "missing",
        ] {
            assert!(read_file(&root, path).is_err());
        }
        Ok(())
    }
}
