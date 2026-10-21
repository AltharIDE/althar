# ADR-056: The coordinator is a trusted reader, in copies of its own, held by a sandbox where it has one

- **Status:** Accepted
- **Date:** 2026-10-21
- **Owner:** Repository maintainers
- **Context:** The coordinator talks with the person about the project and
  reads the project's repositories in throwaway copies (ADR-004), under the
  reader rules a review's lead has too (docs/architecture/04). Those rules
  are written for a repository Althar doesn't trust: a pull request from
  outside, whose files may be named to become flags and whose config may
  name programs. Read on the coordinator's own sessions in October 2026
  (the research "what leads and the coordinator can't do yet"), they kept
  it from what it is asked about every day: 22 times `gh` wasn't signed in
  for it, it couldn't see a pull request's state, and 11 commands were
  refused: `$(…)`, `gh pr list`, `git fetch`, `uptime`. It couldn't run
  a test or `git tag`. Its copies were worktrees of the person's
  repositories, so a `git fetch` or `git tag` there would have written the
  person's repository, refs and objects. ADR-048 says where the runtime
  runs and who may reach it; this says what the coordinator's own commands
  may reach. DEV-69 (#216) tightened what a lead asks for, and this keeps
  every refusal it added: credentials, the device bridge, where keys are.
- **Decision:**
  - **The coordinator reads the code host through Althar:**
    `read_pull_request` reads any of the project's pull requests, whoever
    opened it, by its number or link, as its host has it now: its state,
    where it goes and whether it conflicts there, its size, its
    description, its checks with the end of a failed one's log, and what
    everyone said on it, each in their words, as data. `read_check_log`
    reads a check's whole log a page at a time, as a lead's does
    (ADR-041). Both only read, through the connections the person made;
    `gh` is never signed in for an agent.
  - **Its copies are repositories of their own.** Each copy's git folder
    is made again before every turn: it borrows the person's repository's
    objects to read (`objects/info/alternates`), and its only remote is the
    person's repository, from which it fetches the branches, the remote's
    branches and the tags. Before the turn Althar fetches the project's
    remote, all its branches, into the person's repository, as any fetch
    there would. So the coordinator's `git fetch` brings the remote as of
    the turn and reaches no network itself, and its `git tag`, its fetches
    and anything else it writes stay in the copy, thrown away with it.
    Nothing the coordinator leaves there is read by Althar's own git: the
    git folder, its config, hooks and refs, goes before Althar's next
    checkout, and a link left in place of the copy or of its git folder is
    removed, never followed, so Althar's checkout and clean never run in
    the person's checkout. A copy made as a worktree before is taken over
    and dropped from the repository's worktrees. Tags made there aren't
    signed with the person's key.
  - **Where its agent has a sandbox Althar can hold to the copies, its
    commands run there without asking.** Claude Code's coordinator runs
    its shell commands in its sandbox, held to the coordinator's folder:
    they write only there and in the sandbox's own temporary folder, reach
    no network (no domain allowed, every other refused without asking) and
    no socket, read nothing where the person keeps keys and sign-ins, and
    never run outside it. A session whose sandbox can't start doesn't start
    at all, so Althar asks for this only where it can start (macOS; Linux
    with bubblewrap and socat, outside a Flatpak); elsewhere the coordinator
    starts as any reader, every command asking. Its edit tools stay denied:
    a change is a task.
  - **Elsewhere, the reader rules take a little more from the
    coordinator,** and only from it: a substitution, `$(…)` or backticks,
    each of whose commands is read as a line of its own and only looks,
    with what it prints read as words the shell expands (never the program,
    nor a flag of a program whose flags can write, unless it prints only
    commits' and refs' names, as `git describe` does); a few programs that
    say how the computer stands (`uptime`, `uname`, `df`; not `ps`, whose
    lines carry other programs' arguments); and `git tag` listing with
    patterns and sorting. Nothing that writes, installs, reaches the
    network or changes the code host. A review's lead keeps the strict
    list: it reads a repository it doesn't trust.
  - **A test runs only with what its copy has.** The copies have no
    packages installed, and Althar installs none: a test file the sandbox
    can run with nothing installed runs (`node --test`, `bun test` of a file
    that imports none, Python's `unittest`); one that needs the project's
    setup doesn't, and is a task's, or `start_task`'s.
- **Alternatives considered:**
  - **The coordinator's sandbox reaching the project's remotes:** git
    would need the person's keys or their SSH agent's socket inside the
    sandbox, which is what it keeps out. Althar fetching the remote before
    the turn gives the same branches without either.
  - **Keeping worktrees and allowing only fetches:** a worktree's fetch,
    tag or ref writes the person's repository, so the sandbox would have to
    let commands write its git folder, the folder a lead's sandbox guards.
  - **Letting the coordinator install the project's setup in its copies:**
    an install runs the project's scripts with the network, beyond what a
    reader should do unasked; a task's lead does it, under the project's
    rules.
  - **The same additions for every reader:** a review's lead reads code
    whose authors may aim it at its rules, so it keeps the list that names
    every flag a program may take.
- **Trade-off:** the coordinator runs the project's own code on Claude
  Code where a test asks it to, inside a sandbox, as leads already do
  inside theirs; the risk is that of the sandbox. A command the person's
  own Claude Code settings both exempt from the sandbox and allow runs
  outside it unasked, as it would in their own Claude Code. The copies'
  `git fetch` is as fresh as the turn, not the moment. Codex keeps its
  read-only sandbox, whose commands can't write the copy, so its `git
  fetch` and `git tag` are refused when they ask to go beyond it; OpenCode
  and agents with no sandbox Althar holds get only the rules' additions.
  What Claude Code's sandbox does with these settings is read from its
  documentation and its settings' schema, and tried on a real session
  (tests/agents/reader.test.ts).
- **Revisit when:** Codex's sandbox can be held to a folder with writes
  in its git folder; Althar can tell before a session starts that an
  agent's sandbox will start on Windows; the coordinator needs the
  project's setup in its copies often enough to keep one set up.
