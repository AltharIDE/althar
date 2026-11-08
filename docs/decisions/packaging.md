# Packaging

This document covers how Althar reaches people's computers and reports back:
signed releases and the updater, the two Mac builds, the Linux and Windows
packages and the keyring, the Flatpak and its git over SSH, and the three
things the app sends home (usage data, problem reports and crash reports).

**Replaces:** ADR-024,
ADR-027,
ADR-028,
ADR-036,
ADR-045,
ADR-046,
ADR-073,
ADR-075

## Releases

Releases are made by CI from a version tag on main, and land on one draft
GitHub Release. The repository is public, so its Releases serve the downloads
and the update feed without a server of Althar's own.

- **`.github/workflows/release.yml` runs on a tag `v<version>`** pushed on a
  commit on main, or by hand from main, and never on a pull request. It checks
  the tag against `apps/desktop/package.json` and that
  `apps/desktop/release-notes/<version>.md` exists. Then it builds every
  platform, and one last job puts all their files on one draft release. A
  person publishes the draft after a smoke run of the dmg. Platforms are jobs
  of this one workflow, so nothing races to make the release.
- **Secrets live in a `release` environment** with required reviewers, open
  only to `v*` tags and main. Every job that uses one waits for a person to
  approve the run. The signing certificate goes into a keychain of the job's
  own, deleted after.
- **Only CI publishes.** `bun run release` builds and checks a release the
  same way on a Mac, for trying one before it is tagged. If GitHub Actions is
  down, the files can go to a draft by hand.
- **From Althar,** the person asks for a release and an agent tags it,
  approves the run's `release` environment and publishes the draft on their
  word ([code-hosts.md](code-hosts.md)). The workflow is the same either way.

### What a release holds

- **Mac:** two builds, Apple silicon and Intel (see below), each a dmg to
  install from and a zip for the updater, with blockmaps, and one
  `latest-mac.yml` for both.
- **Linux:** an AppImage with `latest-linux.yml`, and a deb and an rpm from
  the same build, each recommending a keyring.
- **Windows (x64):** an NSIS installer, `Althar-<version>-x64-setup.exe`. It
  installs for the person alone, with no administrator's prompt, and comes with
  `latest.yml` for the updater.
- ARM Linux and ARM Windows have no build of their own. ARM Windows runs the
  x64 build emulated.

### Signing on a Mac

macOS refuses an app from the internet unless it is signed with a Developer
ID, under the hardened runtime, and notarized.

- **Every executable is signed on its own with Althar's Developer ID,**
  deepest first, never with `--deep`. Claude Code's and Codex's binaries are
  signed again with Althar's, so the app has one signer and one team for
  library validation. Each executable gets its own entitlements
  (`scripts/entitlements.ts`), and nothing allows DYLD variables, debugging
  or Apple events.
- **Notarized with notarytool,** from an App Store Connect API key or a
  keychain profile. The app is notarized and stapled before the dmg and zip
  are made, and the dmg is notarized too. Each submission's log is kept in
  `out/notary/`. In CI the release fails unless the app is signed, notarized,
  stapled and accepted by Gatekeeper. A build without credentials says so and
  is signed ad hoc.

### Windows is unsigned for now

The installer and app carry no Authenticode signature yet, so SmartScreen
warns on the first download (More info, then Run anyway), and an update isn't
checked against a publisher. The release workflow keeps a skipped "Sign" step,
and `scripts/package.ts` a `WINDOWS_SIGNING` slot naming what Azure Artifact
Signing or an OV certificate needs.

Not built yet: Windows signing.

### Two Mac builds, not one universal app

Most of the app's size is the agents' binaries, Node and Electron, which all
come per processor. A universal app would hold each twice, doubling everyone's
download.

- `bun run package --arch=arm64,x64` stages, packages, signs and notarizes
  each build with only its own processor's binaries. Both are cross-built on
  the Apple silicon runner; nothing is compiled there, only fetched and
  signed.
- **Every Mach-O file is checked for its processor** (`scripts/archs.ts`), and
  one without the build's slice fails the build. `scripts/mac-smoke.ts
  --arch=x64` opens the Intel build under Rosetta until its first screen
  finds the agents. Rosetta is close to an Intel Mac, not the same.
- **Names carry the processor** (`Althar-<version>-arm64.dmg`,
  `Althar-<version>-x64.dmg` and their zips). One `latest-mac.yml` lists both
  (`joinFeeds` in `scripts/feed.ts`). The updater picks its Mac's files by
  name, so a Mac never switches builds.
- Intel's Node needs `allow-unsigned-executable-memory`, since V8 there makes
  its code pages executable with `mprotect`.
- The Homebrew cask gives each processor its own url and digest. The site's
  Download picks the build where the browser says the chip, and links the
  other build under the button.

## Updates

There is one update track, stable, from GitHub Releases, with electron-updater.
The agents' adapters ship inside the app, so an app update is an adapter
update.

- **When:** a packaged app checks ten seconds after it starts, then every
  four hours, and from the app menu's Check for Updates…. A newer version
  downloads in the background. One quiet line in the window's bar and in
  Settings' foot says when it's ready.
- **How:** on a Mac, Squirrel takes the zip only if it is signed as the
  running app is. On Windows, the installer runs silently as Althar quits. On
  Linux, the AppImage is replaced.
- **Never restarted under running work.** Althar never restarts on its own.
  Restart is offered only while no work runs, and the main process refuses it
  otherwise. An update already in place installs as Althar quits, and quitting
  stops and records every agent as any quit does.
- **The version shows in Settings' foot,** with What's new opening its
  release notes.
- **A test feed:** `ALTHAR_UPDATE_FEED`, an `http` address on this computer,
  points the updater at a local server, so an update can be tried end to end.
- There is no rollback. An update that breaks something is fixed by the next
  one, and a migration in it can't be undone.

Not built yet: a beta channel, and adapters that update without an app
release.

## Off a Mac: windows and the keyring

- **The window draws its own chrome.** Off a Mac it is frameless, and the
  tabs' strip is the title bar. One `WindowButtons` primitive closes,
  minimizes and maximizes it. At rest they are the same grey dots a Mac shows,
  with glyphs and colours on hover or focus, so colour never carries their
  meaning alone. Screens without tabs carry the same buttons in their own bar.
  How the window dresses for each desktop is in [desktop-app.md](desktop-app.md).
- **The menu bar is hidden; the menu stays for its shortcuts:** text zoom,
  full screen and quit, plus reload and devtools while developing. macOS keeps
  its system menu bar.
- **Sign-ins are never sealed in plain text.** Electron's `basic_text`
  fallback is refused, with an allow-list of real backends (`gnome_libsecret`,
  `kwallet*`), so anything unknown fails closed. Where Electron doesn't
  recognise the desktop (sway, i3, Hyprland, COSMIC and others), the app asks
  for `--password-store=gnome-libsecret` before it starts. A
  `--password-store` the person chose is left alone. Windows uses DPAPI, which
  Electron always finds.
- **A sealed sign-in the keychain can no longer open** is marked unreadable,
  and its connection says it needs signing in again. The runtime doesn't ask
  for it again. The refusal of plain text is the only keychain error shown
  word for word; every other one gets a general sentence.

## The Flatpak

The Flatpak (`dev.althar.app`) is experimental until a whole task has run
under GNOME and KDE. In a Flatpak the home is empty and the filesystem is the
runtime's. The person's own tools, editors, git sign-in and SSH agent aren't
inside it, while the agents Althar bundles are.

- **It has the network, the display, the GPU and the keyring,** plus
  `--talk-name=org.freedesktop.Flatpak`, which lets it run commands on the
  device through `flatpak-spawn`. That permission is broad and is not a
  boundary against a compromised app, but reaching the person's own tools
  needs it. It doesn't limit what agents reach on the network.
- **The person's own Codex, OpenCode and editors run on the device,**
  through `flatpak-spawn --host`. Paths are translated only at that edge (the
  document portal's path differs inside and out; the profile and worktrees
  are at the same path on both sides). A launch takes only what Althar sets
  for it, such as an account's home and Althar's settings, plus the device's
  home, PATH and runtime folder. All of this is gated on `FLATPAK_ID`, so dev
  runs, macOS, AppImage, deb and rpm are unchanged.
- **Codex runs on the device,** through `flatpak/codex-host.sh`. A Flatpak
  can't make the user namespaces Codex's own sandbox needs, and codex-acp has
  no mode that drops its sandbox and still sends permission requests to
  Althar. A session without Codex installed on the device stops with a
  sentence saying so.
- **Claude Code runs bundled, inside.** Its usual account keeps one
  `claude-usual` home under the profile that both sides see. The bundled CLI
  is a Bun executable whose payload is in a trailer, so the manifest keeps
  flatpak-builder from stripping it.
- **The person's skill folders are in the sandbox, read-only**
  (`~/.claude/skills`, `~/.codex/skills`, `~/.agents/skills`,
  `~/.config/opencode/skills`), and nothing else of the home.
- **The tray works** through `--talk-name=org.kde.StatusNotifierWatcher`.
- **Sign-ins prefer the Secret portal's key for this app on every desktop,
  KDE included.** The main process accepts only Chromium's `v12` seal, from a
  stable secret scoped to the app id. The shared Secret Service seal (`v11`
  async) and Chromium's fixed key (`v10`) are never stored. Where no portal
  can seal, the app falls back to synchronous libsecret only when the backend
  is the sandbox-local `gnome_libsecret`. That key may change at each start,
  so the person may have to sign in again after a restart.
- **The profile is the app's own,** at `~/.var/app/dev.althar.app/data/althar`,
  with the worktrees beside it. Projects reach the app through the document
  portal.
- **Agents can't use the device bridge.** The rules refuse a command that
  runs `flatpak-spawn` or `althar-host-ssh`, or sets either for git to run
  later. Running a command on the device is a way out of the sandbox, and the
  sandbox is the boundary ([what-agents-may-do.md](what-agents-may-do.md)).

Not built yet: agents using the person's own sign-in inside the Flatpak (their
SSH agent, `gh` and `glab`), as [what-agents-may-do.md](what-agents-may-do.md)
describes for other installs. Passing the SSH agent's socket in
(`--socket=ssh-auth`) is the likely way.

### git over SSH in the Flatpak

The sandbox has no `~/.ssh`, so no keys and no known hosts. Before this was
settled, a fetch over SSH waited for good on a host-key question nobody could
see.

- **Althar's own git never waits on a question, on any platform.** Each git
  command Althar runs (`packages/runtime/src/git.ts`) starts in a session of
  its own with no terminal, without askpass, and with
  `SSH_ASKPASS_REQUIRE=never`, `GIT_TERMINAL_PROMPT=0` and
  `GCM_INTERACTIVE=never`. When its time is up, the whole process group ends.
  The coordinator's fetch of `origin` gets 15 seconds; after that its copy is
  made from the last fetch.
- **In the Flatpak, Althar's own SSH git runs the device's ssh.** git stays
  in the sandbox, and only its transport crosses (`GIT_SSH_COMMAND` set to
  `/app/bin/althar-host-ssh` for Althar's own commands, never in the process
  environment). The device's ssh has the person's agent, keys,
  `~/.ssh/config` and `~/.ssh/known_hosts`, as a terminal would. It runs with
  `BatchMode=yes` and `StrictHostKeyChecking=yes`. An HTTPS remote stays in
  the sandbox.
- **ssh inside the sandbox trusts the pinned code hosts and never asks.**
  `/app/bin/ssh` comes first on PATH, with Althar's pinned file
  (`flatpak/known_hosts`) as its known hosts. It covers github.com,
  gitlab.com, bitbucket.org, codeberg.org and ssh.dev.azure.com, and their
  port-443 names. Each key comes from the vendor's page and is checked by
  `apps/desktop/tests/knownHosts.test.ts`, and nothing scans at build time.
  It has no agent, so an agent's SSH fetch is refused at sign-in, in under a
  second.
- **An unknown host fails at once, saying what to do:** check the key and
  accept it once from a terminal (`ssh -T <host>`). Althar doesn't ask in its
  own UI. The question would come from a background fetch where nobody is
  looking at a fingerprint. And what the person accepts in a terminal counts
  for every tool.

## Usage data

Anonymous counts of how people get through setting up, starting tasks and
coming back, from the main process alone (`main/usageData.ts`), to PostHog's
US cloud over Electron's own network.

- **Named events only, each with named properties:** Althar opened, first
  screen done, an agent signed in, a project made, a task started and
  settled, an ask answered, a usage limit hit, an update installed. Each
  property is a count, a word from a short list, or an agent's or model
  family's id. The main process drops anything else, so its list is all that
  can ever leave. Each event carries the app's version, the system, the
  processor and a random install id kept in `desktop.json`. Person profiles
  are off and GeoIP is never looked up.
- **The window has no analytics SDK,** so nothing is captured automatically,
  and its Content Security Policy keeps `connect-src 'none'`.
- **The runtime says what happened, from the record** (`UsageData`): it reads
  `record_events` as the ledger grows, so no workflow sends events itself.
- **On by default, turned off in Settings** ("Usage data"). The first screen
  doesn't ask, so setting up stays about agents and repositories. The switch
  is checked before each request, so nothing leaves once it is off.
  `DO_NOT_TRACK` keeps it off, and so does a `desktop.json` that can't be
  read.
- **Only a release sends.** PostHog's key goes to a packaged build alone.
  Development builds, end-to-end tests and forks send nothing.

## Problem reports

When a tester says "it just stopped", the logs and their words are what
explain it.

- **Logs on disk, quiet, per process:** `main.log`, `runtime.log` and
  `agents.log`, where the system keeps an app's logs, turned over by size and
  kept about a week. They hold lifecycle, errors, and each turn's start and
  end by id, never prompts, messages or file contents.
- **One dialog in the app,** from Help on a Mac, the quick settings' foot,
  About Althar in Settings, and Report this on what went wrong, carrying its
  task. One box is required. The screenshot and logs are on and can be
  switched off. See what's sent lists every item. An email is optional.
- **Masked before it leaves:** paths under the home folder lose their
  folders, project and repository names become stand-ins, and the person's
  name, the computer's name, emails and anything shaped like a key go
  (`logs/mask.ts`).
- **A Cloudflare Worker holds the Linear key** (`apps/report`). It validates
  and caps the report, rate-limits it per install and per address, and files
  it in the Development team's Triage, labelled "From the app", with the
  screenshot and logs attached. The app never holds a Linear key. A build
  without the Worker's address saves a zip in Downloads and opens an email to
  send it with.
- The report carries the same install id as usage data, whether or not usage
  data is on.

## Crash reports

Errors and crashes reach the team without anyone writing in, through PostHog's
error tracking, from the main process alone (`main/crashReports.ts`).

- **What is reported:** uncaught errors in the window and the runtime, a
  process that stops other than cleanly, the runtime stopping too often to
  restart, what was caught and carried on past, and an agent that stops on its
  own ([foundations.md](foundations.md) covers how failures are contained).
- **Native minidumps stay on this computer.** Crashpad runs with uploads off.
  On the next launch one "Native crash" event says which process and when,
  never the dump, which can hold anything the process held.
- **Masked before anything leaves,** with Problem reports' masker. A stack
  frame keeps only its place. An event keeps only the exceptions, their level,
  the process, the version, the system and the processor. A message is cut
  at 1,000 characters, a chain at five exceptions and a stack at 50 frames. A
  report that can't be masked never goes.
- **A switch of its own, on by default:** "Crash reports", beside Usage data,
  with one quiet line on the first screen. People may want one and not the
  other. `DO_NOT_TRACK` keeps it off and locked.
- **Little, and anonymous:** at most 20 reports a launch, each distinct one
  once a launch. Reporting never throws into what failed, and quitting waits
  only a few seconds for reports on their way. Only a release sends.

Not built yet: uploading the window's source maps in the release workflow, so
its minified stacks read by name.

## Changes

- 8 Nov 2026: written from the ADRs under Replaces.
