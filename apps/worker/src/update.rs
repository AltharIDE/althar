//! Updating the worker now, when its home asks (`AgentWorkerUpdate`), as its hourly timer would: the update its setup
//! installed (`althar-worker-update.service`, apps/host/src/workerSetup.ts) started in its own unit, which outlives the
//! restart into the new release; watched until it ends; and what it said told back.
//!
//! On success the updater restarts the worker into its new release, so this process never hears that: the home sees
//! it come back on its new release. What it does hear, it says: no newer release it trusts (`Current`), something of
//! its own running (`Waiting`), or why it failed, in the updater's own words where its journal has them.

use std::{
    env,
    ffi::OsString,
    io,
    path::PathBuf,
    process::Stdio,
    time::{Duration, Instant},
};

use tokio::process::Command;

/// The update its setup installed, beside its timer.
pub const UNIT: &str = "althar-worker-update.service";
/// The longest an update the home asked for is watched: a release downloads and unpacks well within it.
const LIMIT: Duration = Duration::from_secs(20 * 60);
const EVERY: Duration = Duration::from_secs(2);
/// The longest message told back, as the home keeps it.
const MAX_MESSAGE: usize = 512;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Outcome {
    /// No newer release it trusts; the version it found, where it said.
    Current {
        version: String,
    },
    /// Something of its own runs: it updates later.
    Waiting {
        version: String,
    },
    Failed {
        message: String,
    },
}

/// Where its update's unit stands, as `systemctl show` says it.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct UnitState {
    pub active: String,
    pub result: String,
    pub invocation: String,
}

/// What systemd says a unit's `ActiveState` is; anything else is a read it can't trust.
const ACTIVE_STATES: [&str; 8] = [
    "active",
    "reloading",
    "inactive",
    "failed",
    "activating",
    "deactivating",
    "maintenance",
    "refreshing",
];

impl UnitState {
    /// Seen to have ended: only these say it no longer runs. Every other state may still restart the worker.
    fn ended(&self) -> bool {
        matches!(self.active.as_str(), "inactive" | "failed")
    }
}

/// `systemctl show --property=ActiveState --property=Result --property=InvocationID`, read.
pub fn unit_state(show: &str) -> UnitState {
    let mut state = UnitState::default();
    for line in show.lines() {
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let value = value.trim().to_owned();
        match key.trim() {
            "ActiveState" => state.active = value,
            "Result" => state.result = value,
            "InvocationID" => state.invocation = value,
            _ => {}
        }
    }
    state
}

/// A string field of a line of JSON the updater printed (`{"step":"update","state":"failed","message":"…"}`), unescaped;
/// none where the line has no such field. Its lines are flat objects of strings, so this needs no more than that.
pub fn field(line: &str, name: &str) -> Option<String> {
    let key = format!("\"{name}\"");
    let mut rest = &line[line.find(&key)? + key.len()..];
    rest = rest.trim_start().strip_prefix(':')?.trim_start();
    let mut chars = rest.strip_prefix('"')?.chars();
    let mut value = String::new();
    loop {
        match chars.next()? {
            '"' => return Some(value),
            '\\' => match chars.next()? {
                'n' => value.push('\n'),
                't' => value.push('\t'),
                'r' => value.push('\r'),
                'b' | 'f' => value.push(' '),
                'u' => {
                    let hex: String = chars.by_ref().take(4).collect();
                    let code = u32::from_str_radix(&hex, 16).ok()?;
                    value.push(char::from_u32(code).unwrap_or('\u{fffd}'));
                }
                other => value.push(other),
            },
            other => value.push(other),
        }
    }
}

/// How the update ended, from what its updater printed (one JSON line a step) and the unit's result.
pub fn outcome(journal: &str, result: &str) -> Outcome {
    let said = journal
        .lines()
        .filter(|line| field(line, "step").as_deref() == Some("update"))
        .filter_map(|line| field(line, "state").map(|state| (state, line)))
        .next_back();
    let version = |line: &str| field(line, "version").unwrap_or_default();
    match said {
        Some((state, line)) if state == "waiting" => Outcome::Waiting {
            version: version(line),
        },
        Some((state, line)) if state == "failed" => Outcome::Failed {
            message: message(&field(line, "message").unwrap_or_default(), result),
        },
        // Done would have restarted it into its new release; were it still here, nothing newer is running.
        Some((_, line)) if result == "success" => Outcome::Current {
            version: version(line),
        },
        None if result == "success" => Outcome::Current {
            version: String::new(),
        },
        _ => Outcome::Failed {
            message: message("", result),
        },
    }
}

/// The updater's words, bounded; where it said none, the unit's result and where to read more.
fn message(said: &str, result: &str) -> String {
    let said = said.trim();
    if !said.is_empty() {
        return said.chars().take(MAX_MESSAGE).collect();
    }
    let how = if result.is_empty() || result == "success" {
        String::new()
    } else {
        format!(" ({result})")
    };
    format!("Its updater stopped{how}. `journalctl --user -u {UNIT}` on the worker says why.")
}

/// Where its units are: `${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user`.
fn units_folder() -> Option<PathBuf> {
    let config = env::var_os("XDG_CONFIG_HOME")
        .filter(|config| !config.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            env::var_os("HOME")
                .filter(|home| !home.is_empty())
                .map(|home| PathBuf::from(home).join(".config"))
        })?;
    Some(config.join("systemd/user"))
}

/// Whether it can update when asked: its setup installed its update. One set up by hand has none, and says so.
pub fn available() -> bool {
    units_folder().is_some_and(|folder| folder.join(UNIT).is_file())
}

/// The programs it runs and how it watches them: systemd's own, every two seconds, for up to twenty minutes.
pub struct Tools {
    pub systemctl: OsString,
    pub journalctl: OsString,
    pub every: Duration,
    pub limit: Duration,
}

impl Default for Tools {
    fn default() -> Self {
        Self {
            systemctl: "systemctl".into(),
            journalctl: "journalctl".into(),
            every: EVERY,
            limit: LIMIT,
        }
    }
}

async fn output(program: &OsString, args: &[&str]) -> io::Result<(bool, String, String)> {
    let output = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .kill_on_drop(true)
        .output()
        .await?;
    Ok((
        output.status.success(),
        String::from_utf8_lossy(&output.stdout).into_owned(),
        String::from_utf8_lossy(&output.stderr).into_owned(),
    ))
}

/// Its update's unit as systemd says it now: an error where `systemctl` failed, or said no state it knows, so a read
/// that says nothing is never taken for the unit having ended.
async fn show(tools: &Tools) -> io::Result<UnitState> {
    let (ok, out, error) = output(
        &tools.systemctl,
        &[
            "--user",
            "show",
            UNIT,
            "--property=ActiveState",
            "--property=Result",
            "--property=InvocationID",
        ],
    )
    .await?;
    if !ok {
        return Err(io::Error::other(format!(
            "systemctl couldn't say how its update stands: {}",
            error.trim()
        )));
    }
    let state = unit_state(&out);
    if !ACTIVE_STATES.contains(&state.active.as_str()) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "systemctl said no state for its update",
        ));
    }
    Ok(state)
}

/// Starts its update in its own unit and watches it to its end: what it said, or why it couldn't.
pub async fn run(tools: &Tools) -> Outcome {
    match watch(tools).await {
        Ok(outcome) => outcome,
        Err(error) => Outcome::Failed {
            message: message(&error.to_string(), ""),
        },
    }
}

async fn watch(tools: &Tools) -> io::Result<Outcome> {
    let before = show(tools).await?;
    // A failed run before this one would leave the unit failed: cleared, so this one's result is its own.
    let _ = output(&tools.systemctl, &["--user", "reset-failed", UNIT]).await;
    let (started, _, error) =
        output(&tools.systemctl, &["--user", "start", "--no-block", UNIT]).await?;
    if !started {
        let error = error.trim();
        return Ok(Outcome::Failed {
            message: if error.is_empty() {
                format!("Its update ({UNIT}) wouldn't start.")
            } else {
                message(error, "")
            },
        });
    }
    let since = Instant::now();
    // Already under way (its timer started it), the run it joined counts; else a new one, by its own invocation.
    let mut seen = !before.ended();
    loop {
        tokio::time::sleep(tools.every).await;
        if since.elapsed() >= tools.limit {
            return Ok(stop(tools).await);
        }
        // Not read this time: looked at again, never taken for ended while it may still run.
        let Ok(now) = show(tools).await else {
            continue;
        };
        if !now.ended() {
            seen = true;
        } else if seen || (!now.invocation.is_empty() && now.invocation != before.invocation) {
            let journal = if now.invocation.is_empty() {
                String::new()
            } else {
                let filter = format!("_SYSTEMD_INVOCATION_ID={}", now.invocation);
                output(
                    &tools.journalctl,
                    &["--user", &filter, "--output=cat", "--no-pager"],
                )
                .await
                .map(|(_, out, _)| out)
                .unwrap_or_default()
            };
            return Ok(outcome(&journal, &now.result));
        }
    }
}

/// Past its time: its update stopped, and seen stopped, before it's said to have failed. Until then it runs nothing new,
/// as its home holds it: an updater left going could restart the worker under a task.
async fn stop(tools: &Tools) -> Outcome {
    let _ = output(&tools.systemctl, &["--user", "stop", UNIT]).await;
    loop {
        if let Ok(now) = show(tools).await
            && now.ended()
        {
            return Outcome::Failed {
                message: format!(
                    "Its update took too long, so it was stopped. `journalctl --user -u {UNIT}` on the worker says where it got to."
                ),
            };
        }
        tokio::time::sleep(tools.every).await;
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::{fs, os::unix::fs::PermissionsExt, path::Path};

    #[test]
    fn reads_the_units_state() {
        assert_eq!(
            unit_state("ActiveState=activating\nResult=success\nInvocationID=abc\nOther=1\n"),
            UnitState {
                active: "activating".into(),
                result: "success".into(),
                invocation: "abc".into()
            }
        );
        assert_eq!(unit_state("garbage"), UnitState::default());
    }

    #[test]
    fn reads_a_field_with_its_escapes() {
        let line =
            r#"{"step":"update","state":"failed","code":"X","message":"No \"room\" left\nhere é"}"#;
        assert_eq!(field(line, "state").as_deref(), Some("failed"));
        assert_eq!(
            field(line, "message").as_deref(),
            Some("No \"room\" left\nhere é")
        );
        assert_eq!(field(line, "version"), None);
        assert_eq!(field(r#"{"state": 3}"#, "state"), None);
        assert_eq!(field(r#"{"state":"open"#, "state"), None);
    }

    #[test]
    fn says_how_it_ended_from_its_last_update_line() {
        let check = r#"{"step":"check","state":"done"}"#;
        assert_eq!(
            outcome(
                &format!(
                    "{check}\n{{\"step\":\"update\",\"state\":\"current\",\"version\":\"0.3.0\"}}\n{check}"
                ),
                "success"
            ),
            Outcome::Current {
                version: "0.3.0".into()
            }
        );
        assert_eq!(
            outcome(
                r#"{"step":"update","state":"waiting","version":"0.3.1"}"#,
                "success"
            ),
            Outcome::Waiting {
                version: "0.3.1".into()
            }
        );
        assert_eq!(
            outcome(
                r#"{"step":"update","state":"failed","code":"Io","message":"No space left on device"}"#,
                "exit-code"
            ),
            Outcome::Failed {
                message: "No space left on device".into()
            }
        );
        // Nothing said, it says the unit's result and where to read more.
        assert_eq!(
            outcome("", "exit-code"),
            Outcome::Failed {
                message: format!(
                    "Its updater stopped (exit-code). `journalctl --user -u {UNIT}` on the worker says why."
                )
            }
        );
        assert_eq!(
            outcome("", "success"),
            Outcome::Current {
                version: String::new()
            }
        );
        let long = "x".repeat(2000);
        let Outcome::Failed { message } = outcome(
            &format!(r#"{{"step":"update","state":"failed","message":"{long}"}}"#),
            "exit-code",
        ) else {
            panic!("expected a failure")
        };
        assert_eq!(message.chars().count(), MAX_MESSAGE);
    }

    /// A fake systemctl and journalctl: `show` answers with the next of its states, one a call; `start` succeeds or not.
    fn fakes(dir: &Path, states: &[&str], start: bool, journal: &str) -> Tools {
        fakes_stopping(dir, states, start, journal, 0)
    }

    /// As `fakes`, its `stop` failing and its next reads failing too, `fails_after_stop` of them, where that's above 0.
    fn fakes_stopping(
        dir: &Path,
        states: &[&str],
        start: bool,
        journal: &str,
        fails_after_stop: usize,
    ) -> Tools {
        for (i, state) in states.iter().enumerate() {
            fs::write(dir.join(format!("state{i}")), state.replace(';', "\n")).unwrap();
        }
        fs::write(dir.join("journal"), journal).unwrap();
        let script = |name: &str, body: String| {
            let path = dir.join(name);
            fs::write(&path, format!("#!/bin/sh\n{body}")).unwrap();
            fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
            path.into_os_string()
        };
        let d = dir.display();
        let systemctl = script(
            "systemctl",
            format!(
                r#"echo "$*" >> {d}/calls
case "$2" in
  show) if [ -f {d}/stopped ]; then
          k=$(cat {d}/k 2>/dev/null || echo 0); echo $((k + 1)) > {d}/k
          if [ "$k" -lt "$(cat {d}/stopped)" ]; then exit 1; fi
          printf 'ActiveState=inactive\nResult=exit-code\nInvocationID=new\n'; exit 0
        fi
        n=$(cat {d}/n 2>/dev/null || echo 0); f={d}/state$n; [ -f "$f" ] || f={d}/state{last}; echo $((n + 1)) > {d}/n
        if [ "$(cat "$f")" = FAIL ]; then echo 'Failed to connect to bus' >&2; exit 1; fi
        cat "$f" ;;
  start) {start} ;;
  stop) echo {fails_after_stop} > {d}/stopped; {stop} ;;
esac
"#,
                last = states.len() - 1,
                stop = if fails_after_stop > 0 {
                    "exit 1"
                } else {
                    "exit 0"
                },
                start = if start {
                    "exit 0"
                } else {
                    "echo 'Unit althar-worker-update.service not found.' >&2; exit 5"
                },
            ),
        );
        let journalctl = script(
            "journalctl",
            format!("echo \"$*\" >> {d}/journal-calls\ncat {d}/journal\n"),
        );
        Tools {
            systemctl,
            journalctl,
            every: Duration::from_millis(5),
            limit: Duration::from_millis(400),
        }
    }

    #[tokio::test]
    async fn starts_its_update_and_says_what_it_found() {
        let dir = tempfile::tempdir().unwrap();
        let tools = fakes(
            dir.path(),
            &[
                "ActiveState=inactive;Result=success;InvocationID=old",
                "ActiveState=activating;Result=success;InvocationID=new",
                "ActiveState=inactive;Result=success;InvocationID=new",
            ],
            true,
            r#"{"step":"update","state":"current","version":"0.3.0"}"#,
        );
        assert_eq!(
            run(&tools).await,
            Outcome::Current {
                version: "0.3.0".into()
            }
        );
        let calls = fs::read_to_string(dir.path().join("calls")).unwrap();
        assert!(calls.contains(&format!("--user start --no-block {UNIT}")));
        assert!(calls.contains(&format!("--user reset-failed {UNIT}")));
        // Its journal, read for this run alone.
        let read = fs::read_to_string(dir.path().join("journal-calls")).unwrap();
        assert!(read.contains("_SYSTEMD_INVOCATION_ID=new"));
    }

    #[tokio::test]
    async fn sees_a_run_that_ended_between_two_looks_by_its_new_invocation() {
        let dir = tempfile::tempdir().unwrap();
        let tools = fakes(
            dir.path(),
            &[
                "ActiveState=inactive;Result=success;InvocationID=old",
                "ActiveState=failed;Result=exit-code;InvocationID=new",
            ],
            true,
            r#"{"step":"update","state":"failed","message":"The release's signature didn't match."}"#,
        );
        assert_eq!(
            run(&tools).await,
            Outcome::Failed {
                message: "The release's signature didn't match.".into()
            }
        );
    }

    #[tokio::test]
    async fn says_when_its_update_wont_start_or_doesnt_finish() {
        let dir = tempfile::tempdir().unwrap();
        let tools = fakes(
            dir.path(),
            &["ActiveState=inactive;InvocationID="],
            false,
            "",
        );
        assert_eq!(
            run(&tools).await,
            Outcome::Failed {
                message: "Unit althar-worker-update.service not found.".into()
            }
        );
        let dir = tempfile::tempdir().unwrap();
        let tools = fakes(
            dir.path(),
            &[
                "ActiveState=inactive;InvocationID=old",
                "ActiveState=activating;InvocationID=new",
            ],
            true,
            "",
        );
        // It outlives its time: stopped, and seen stopped, before it's said to have failed.
        assert_eq!(
            run(&tools).await,
            Outcome::Failed {
                message: format!(
                    "Its update took too long, so it was stopped. `journalctl --user -u {UNIT}` on the worker says where it got to."
                )
            }
        );
        let calls = fs::read_to_string(dir.path().join("calls")).unwrap();
        assert!(calls.contains(&format!("--user stop {UNIT}")));
    }

    #[tokio::test]
    async fn never_takes_a_status_read_that_failed_for_the_update_having_ended() {
        let dir = tempfile::tempdir().unwrap();
        let tools = fakes(
            dir.path(),
            &[
                "ActiveState=inactive;Result=success;InvocationID=old",
                "ActiveState=activating;Result=success;InvocationID=new",
                "FAIL",
                "ActiveState=;Result=;InvocationID=",
                "ActiveState=inactive;Result=success;InvocationID=new",
            ],
            true,
            r#"{"step":"update","state":"current","version":"0.3.0"}"#,
        );
        // Seen running, then two reads that said nothing it can trust: still running, until it's seen to end.
        assert_eq!(
            run(&tools).await,
            Outcome::Current {
                version: "0.3.0".into()
            }
        );
    }

    #[tokio::test]
    async fn past_its_time_waits_to_see_it_stopped_through_a_failed_stop_and_failed_reads() {
        let dir = tempfile::tempdir().unwrap();
        let tools = fakes_stopping(
            dir.path(),
            &[
                "ActiveState=inactive;InvocationID=old",
                "ActiveState=activating;InvocationID=new",
            ],
            true,
            "",
            3,
        );
        let Outcome::Failed { message } = run(&tools).await else {
            panic!("expected a failure")
        };
        assert!(message.starts_with("Its update took too long, so it was stopped."));
        // Three reads failed after the stop, and only the fourth, seen inactive, let it go.
        assert_eq!(
            fs::read_to_string(dir.path().join("k")).unwrap().trim(),
            "4"
        );
    }
}
