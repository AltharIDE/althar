# ADR-076: A task folder's setup is recorded by a lead, and replayed by Althar

- **Status:** Accepted; amends [ADR-023](023-althar-runs-the-project.md)
- **Date:** 2026-10-31
- **Owner:** Repository maintainers
- **Context:** ADR-023 had Althar set up each new task's worktree with the
  install its lockfile names, or a setup line kept with `set_run_command`.
  Leads still spent their first minutes getting the folder ready, and often
  failed: what failed was rarely the install, but tools that download
  outside the folder or write to caches outside it, which the lead's sandbox
  refuses. Electron downloads its build from GitHub's releases into
  `~/Library/Caches/electron`, Playwright its browsers into
  `~/Library/Caches/ms-playwright`, Bun keeps every package in
  `~/.bun/install/cache`. And nothing copied the ignored files a folder
  needs, such as `.env`. Conductor and the Codex app have the person write a
  setup script for each project. A first design had Althar suggest a setup
  from the repository for the person to confirm (DEV-174); the person turned
  it down: nobody should write or confirm setup config.
- **Decision:**
  - **A lead's sandbox writes to its tools' caches and reaches where they
    download from.** One list (`toolPlaces.ts`) holds, for each package
    manager and each tool that downloads as it installs, the caches it
    writes on a Mac and on Linux and the hosts it downloads from, by the
    files or packages that say a project uses it. A Claude Code lead's
    sandbox takes them from the start (`sandbox.filesystem.allowWrite`,
    `sandbox.network.allowedDomains`), never where keys and sign-ins are
    kept, and Node's `fetch` takes the sandbox's proxy
    (`NODE_USE_ENV_PROXY=1`), which Electron's download goes through. A network request is read as a host, never as a command, so
    GitHub's release downloads are no release script.
  - **The first lead works the setup out.** Where a repository has no setup
    recorded, the lead's brief asks it to get the folder ready first (its
    dependencies, what its tools download, the ignored files it needs from
    the person's checkout) and to record what worked with `record_setup`:
    the files to copy, from the repository's root, and the commands, one
    after another from the repository's folder. Althar copies the files into
    the lead's folder at once, so it needn't read the person's checkout for
    them, and keeps the setup on the repository (`recorded_setup`). Every
    later lead is asked the same until one records it.
  - **Althar replays it in every later task's folder,** as ADR-023 sets up a
    worktree: as the folder is made, while the task waits for an agent
    place if it has to, outside any sandbox, before the lead's first turn.
    It copies the files from the person's checkout, never over or into what
    the worktree has, nor through a link out of it; then runs the commands
    until one fails. A file it couldn't copy fails the setup as a command
    does, so the lead is told which. A recorded setup comes before a kept setup line, which comes
    before the lockfile's install. The card says "Installing dependencies"
    while it runs, and the thread keeps what it did and printed, folded.
  - **A replay that fails never holds the task up.** The lead starts, told
    what failed, with the end of what it printed, and asked to get the
    folder ready and record the setup that works, which replaces the old
    one for every later task.
  - **Secret files are copied by default.** `.env` and the like are copied
    as any other file the setup names; the person asked for it. The lead's
    sandbox can read the person's checkout already, so asking for each file
    wouldn't keep it from the lead.
  - **The person reads it in the project's settings,** and can change it
    there, or clear it so the next lead works it out again.
- **Alternatives considered:**
  - **Althar suggests a setup from the repository, the person confirms
    it.** A step the person has to take for every project, and a guess from
    lockfiles misses what the tools download (Electron's build, Playwright's
    browsers), which is where leads lost their time.
  - **The person writes a setup script, as Conductor and Codex have.** A
    setting nobody writes until it fails.
  - **Running every install outside the sandbox.** Each would ask, or run
    unread; writing to known caches inside the sandbox keeps the rest of it.
  - **Asking before copying each secret file.** The person chose not to.
- **Trade-off:**
  - **A lead could leave something in a shared cache** that a later install
    of the person's picks up. ADR-023 turned down widening the sandbox for
    this; the person chose a folder that gets ready without anyone over it.
  - **A recorded setup runs what a lead chose, outside any sandbox, in every
    later task:** as a kept setup line already did (ADR-023), and as the
    project's own install scripts do. The person sees it in the project's
    settings.
  - **Codex's and OpenCode's leads get neither the caches nor the hosts:**
    Codex's `workspace-write` takes no such list in the mode Althar starts
    it in, and OpenCode has no sandbox.
- **Revisit when:**
  - A replay fails often enough that a lead recording a broken setup costs
    more than it saves.
  - Codex's sandbox takes writable folders and hosts in the mode Althar
    starts it in.
