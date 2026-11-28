//! What a worker sends back of a run's changes, a checkpoint, and how much its home takes at once.
//!
//! A checkpoint is the patch of the files the agent changed and hasn't committed, its new commits as a bundle and,
//! where asked, the patch of what it staged. Each is written to a file in the checkpoint's scratch folder and sent from
//! there, never held whole in memory. A home that says it takes large checkpoints (`takes_large_checkpoints` in its
//! hello) takes each up to the protocol's 4 GiB, through its own disk; an older one takes a 16 MiB patch and 64 MiB of
//! commits, and a checkpoint larger than that says so, and stays on the worker.

use std::{
    fs::File,
    io::{self, Read},
    path::PathBuf,
};

const MIB: u64 = 1024 * 1024;

/// How much of each part the home takes in one checkpoint.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct CheckpointLimits {
    pub(crate) patch: u64,
    pub(crate) commits: u64,
    /// The home takes large checkpoints: past these, the protocol's sizes are what is too large.
    pub(crate) large: bool,
}

impl CheckpointLimits {
    pub(crate) fn of(large: bool) -> Self {
        if large {
            Self {
                patch: u64::from(u32::MAX),
                commits: u64::from(u32::MAX),
                large,
            }
        } else {
            Self {
                patch: 16 * MIB,
                commits: 64 * MIB,
                large,
            }
        }
    }

    /// Where a part is larger than the home takes: why, in words the home shows, and what to do.
    pub(crate) fn check(&self, what: Part, size: u64) -> io::Result<()> {
        let limit = match what {
            Part::Patch | Part::Staged => self.patch,
            Part::Commits => self.commits,
        };
        if size <= limit {
            return Ok(());
        }
        let said = format!(
            "The worker’s {} come to {}; ",
            what.words(),
            size_words(size)
        );
        let message = if self.large {
            format!(
                "{said}a checkpoint carries at most {} of them at once. {} The changes stay on the worker.",
                size_words(limit),
                what.advice()
            )
        } else {
            format!(
                "{said}this home takes at most {} of them at once. Update Althar on the home: it then takes up to 4 GB. The changes stay on the worker.",
                size_words(limit)
            )
        };
        Err(io::Error::new(io::ErrorKind::FileTooLarge, message))
    }
}

/// Which part of a checkpoint.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Part {
    Patch,
    Staged,
    Commits,
}

impl Part {
    fn words(self) -> &'static str {
        match self {
            Part::Patch => "uncommitted changes",
            Part::Staged => "staged changes",
            Part::Commits => "new commits",
        }
    }

    fn advice(self) -> &'static str {
        match self {
            Part::Commits => "Ask its agent to commit large files to Git LFS, or not at all.",
            Part::Patch | Part::Staged => {
                "Ask its agent to ignore or remove the large files it made."
            }
        }
    }
}

/// A part of a checkpoint as the worker made it: in a file of its scratch folder, or none where it is empty.
#[derive(Debug, Default)]
pub(crate) struct Written {
    pub(crate) path: Option<PathBuf>,
    pub(crate) size: u64,
}

impl Written {
    /// Its SHA-256, read through once.
    pub(crate) fn digest(&self, hash: &mut impl FnMut(&[u8])) -> io::Result<()> {
        let Some(path) = &self.path else {
            return Ok(());
        };
        let mut file = File::open(path)?;
        let mut buffer = vec![0; 64 * 1024];
        loop {
            let count = file.read(&mut buffer)?;
            if count == 0 {
                return Ok(());
            }
            hash(&buffer[..count]);
        }
    }

    /// Its bytes in pieces of at most `chunk`, in order, to send.
    pub(crate) fn chunks(&self, chunk: usize) -> io::Result<Chunks> {
        Ok(Chunks {
            file: self.path.as_ref().map(File::open).transpose()?,
            buffer: vec![0; chunk],
        })
    }

    /// All of it, for what is known to be small, such as a test's.
    #[cfg(test)]
    pub(crate) fn bytes(&self) -> io::Result<Vec<u8>> {
        self.path.as_ref().map_or(Ok(Vec::new()), std::fs::read)
    }
}

pub(crate) struct Chunks {
    file: Option<File>,
    buffer: Vec<u8>,
}

impl Chunks {
    pub(crate) fn next_chunk(&mut self) -> io::Result<Option<Vec<u8>>> {
        let Some(file) = &mut self.file else {
            return Ok(None);
        };
        let count = file.read(&mut self.buffer)?;
        Ok((count > 0).then(|| self.buffer[..count].to_vec()))
    }
}

/// A size for the person: 900 bytes, 12 KB, 3.4 MB, 81 MB, 1.2 GB, as the home says them.
pub(crate) fn size_words(bytes: u64) -> String {
    for (size, unit) in [(1024 * MIB, "GB"), (MIB, "MB"), (1024, "KB")] {
        if bytes < size {
            continue;
        }
        let value = bytes as f64 / size as f64;
        return if value < 10.0 {
            let rounded = (value * 10.0).round() / 10.0;
            if rounded.fract() == 0.0 {
                format!("{rounded:.0} {unit}")
            } else {
                format!("{rounded:.1} {unit}")
            }
        } else {
            format!("{} {unit}", value.round())
        };
    }
    format!("{bytes} bytes")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn says_sizes_as_the_home_does() {
        assert_eq!(size_words(900), "900 bytes");
        assert_eq!(size_words(12 * 1024 + 300), "12 KB");
        assert_eq!(size_words(3 * MIB + 420 * 1024), "3.4 MB");
        assert_eq!(size_words(64 * MIB), "64 MB");
        assert_eq!(size_words(u64::from(u32::MAX)), "4 GB");
    }

    #[test]
    fn an_older_home_takes_what_it_did_and_a_newer_one_up_to_4_gb() {
        let older = CheckpointLimits::of(false);
        assert!(older.check(Part::Commits, 64 * MIB).is_ok());
        let refused = older
            .check(Part::Commits, 210 * MIB)
            .expect_err("more than an older home takes");
        assert_eq!(refused.kind(), io::ErrorKind::FileTooLarge);
        assert_eq!(
            refused.to_string(),
            "The worker’s new commits come to 210 MB; this home takes at most 64 MB of them at once. Update Althar on the home: it then takes up to 4 GB. The changes stay on the worker."
        );
        assert!(older.check(Part::Patch, 17 * MIB).is_err());
        let newer = CheckpointLimits::of(true);
        assert!(newer.check(Part::Patch, 17 * MIB).is_ok());
        assert!(newer.check(Part::Commits, 3 * 1024 * MIB).is_ok());
        let past = newer
            .check(Part::Patch, 5 * 1024 * MIB)
            .expect_err("more than the protocol carries");
        assert!(past.to_string().starts_with(
            "The worker’s uncommitted changes come to 5 GB; a checkpoint carries at most 4 GB"
        ));
    }

    #[test]
    fn reads_a_part_in_pieces_and_whole() -> io::Result<()> {
        let temp = tempfile::tempdir()?;
        let path = temp.path().join("part");
        std::fs::write(&path, b"abcdefghij")?;
        let written = Written {
            path: Some(path),
            size: 10,
        };
        let mut chunks = written.chunks(4)?;
        let mut pieces = Vec::new();
        while let Some(piece) = chunks.next_chunk()? {
            pieces.push(piece);
        }
        assert_eq!(pieces.concat(), b"abcdefghij");
        assert!(pieces.iter().all(|piece| piece.len() <= 4));
        let mut seen = Vec::new();
        written.digest(&mut |bytes| seen.extend_from_slice(bytes))?;
        assert_eq!(seen, b"abcdefghij");
        assert!(Written::default().chunks(4)?.next_chunk()?.is_none());
        Ok(())
    }
}
