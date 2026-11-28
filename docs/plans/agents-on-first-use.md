# Agents come on first use, and workers run every agent

> **Decided, 28 November 2026,** by the person: no agent's program ships in
> Althar, its home or its workers; each comes when it is first used, the
> person's own install where it fits; and a worker runs every agent Althar
> supports. This is the plan to build it, not architecture. Delete this file
> when the last step ships, once ADR text records it.

## Why

Host 0.3.0's worker download was 420 MB, and 354 MB of it was the programs
of two agents, Claude Code and Codex, which every worker got whether it used
them or not, and got again on every update. The desktop app and the home
carry the same two. Meanwhile a worker could run no other agent at all:
OpenCode, Copilot CLI, Antigravity and the rest, which Althar already runs
on a Mac and can already download there, never reached a worker.

They were bundled for one reason. Claude Code and Codex don't speak ACP
themselves; Althar drives each through an adapter built for one exact
version of its program, and a mismatch starts nothing (24 November:
"Internal error" on every start). Bundling guaranteed the match. Pinning
does the same without bundling.

## What it is

Every agent's program comes from its maker, at a version Althar pins and
checks by digest, kept under the profile and reused until the pin moves:

| Where it comes from | Agents | How it is checked |
|---|---|---|
| npm, the exact package the adapter's lockfile names | Claude Code, Codex | the package's sha512 integrity, from `bun.lock` |
| GitHub, the latest release on its line | OpenCode, Copilot CLI | the sha256 GitHub publishes per file |
| its maker's address, one version | Antigravity | the archive's and each file's sha256 |

The person's own install is used where it fits:

- for an agent that speaks ACP itself, any install of theirs (as before);
- for Claude Code and Codex, an install whose version the adapter can
  drive, read from where it is installed (no program runs to say it):
  Claude Code at or past the version its SDK names (`claudeCodeVersion`),
  Codex within the range codex-acp depends on. One that doesn't fit is
  passed over, and Althar's pinned copy runs.

The adapter is told which program to drive (`CLAUDE_CODE_EXECUTABLE`,
`CODEX_PATH`) wherever that isn't the copy beside it.

Nothing is bundled: the desktop app, the home's release and the worker's
release carry the adapters (JavaScript) and no agent program. A release
from before this still carries them, and they are found there.

## Workers

A worker is a profile like any other: the same installs, kept under its own
folder. It lists every agent Althar supports, each installed or not. Signing
an agent in on it installs that agent first, as the window shows; an agent
whose sign-in is its own command (OpenCode, Copilot CLI, Grok and the rest)
signs in in a terminal on the worker, which the window opens over SSH. An
update keeps the programs of the agents signed in there. The sandbox's
bubblewrap and ripgrep are the worker release's own (`tools/bin`).

Releases stay updatable from 0.3.0: a worker release's manifest still names
the whole release (with both programs, as 0.3.0's updater and older windows
expect) as its `archive`, and the release without them as its base, which
newer workers and windows take.

## Steps

1. Pins and installs: npm downloads in `Installs`, pins generated from
   `bun.lock` (and a test that they match), the fit check, adapters pointed
   at the program they drive.
2. The desktop app, its Flatpak and the CLI ship no program.
3. The home's release ships no program.
4. The worker's release ships no program; a worker installs agents as a
   profile does, keeps those signed in across updates.
5. Every agent on a worker: listed, installed on sign-in, signed in in the
   window or in a terminal over SSH; the home places tasks on any of them.
6. The window shows it: an agent not installed yet, its download, its
   sign-in, on a Mac and on a worker.
