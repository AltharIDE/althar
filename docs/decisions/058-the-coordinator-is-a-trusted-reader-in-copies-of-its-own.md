# ADR-058: The coordinator is a trusted reader, in copies of its own, held by a sandbox where it has one

- **Status:** Accepted
- **Date:** 2026-10-21
- **Amended:** 2026-10-29: the coordinator's line may also loop (`for … in …`,
  `while read …`), branch (`if`, `&&`, `||`), set variables of its own and
  use them later in it, and work out arithmetic, where every command inside
  only looks. Each variable holds what sets it, as written or as what a
  substitution prints (where what sets it may not run, whatever the
  environment holds too), and the line is read once for each value, with
  the value in its place, by every rule here. What a command printed is
  never a `sed` script nor arithmetic, which would run it, unless it keeps
  only digits (`| grep -oE '[0-9]+'`, `wc -l`, `git rev-list --count`).
  Arithmetic sets nothing and reads only numbers. No variable the shells
  read for themselves may be set: none with an upper-case name, nor zsh's
  own (`path`). It was refused a loop of `git status` across its copies
  many times a day. A review's lead keeps the strict list.
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
    objects to read (`objects/info/alternates`), and its only remote is a
    bare mirror of the person's repository's refs, its branches, its
    remotes' branches and its tags, which Althar keeps beside the
    coordinator's folder (`.coordinator-mirrors`) and alone writes. Before
    the turn Althar fetches the project's remote, all its branches, into the
    person's repository, as any fetch there would, and the person's refs
    into the mirror. So the coordinator's `git fetch` brings the remote as of
    the turn, reaches no network itself and never reads the person's
    checkout, and its `git tag`, its fetches
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
    no socket, and never run outside it. They read none of the home folder,
    the person's checkouts or the project's task folders, but what Althar
    gives back: the coordinator's folder, the mirrors, the objects folders
    the copies borrow, the toolchains kept in the home folder (bun, Node's
    version managers, Rust's, Python's; never a folder that holds a key),
    and git's config files one by one (`~/.gitconfig`, and `config`,
    `ignore` and `attributes` in its config folder, never the folder, where
    its credential store keeps passwords in `credentials`); and nothing
    where the person keeps keys and sign-ins. Its own tools for reading and
    searching files aren't in the sandbox, so the reader rules hold them to
    the same places: a read outside its folder that reaches into one held
    from it, not given back, is refused, and so is a search that starts at
    or above one (its folder, or one a pattern of paths names), since it
    goes down into it.
    It loads no settings file, the person's or the repository's, and runs no
    hook, as a review's lead: no allow rule or sandbox exemption of theirs
    lets a command out, and no hook of a repository it reads runs beside it.
    A session whose sandbox can't start doesn't start
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
    network or changes the code host. On every agent, the coordinator reads
    no `.env` file outside its folder, as the person's checkout's, whose
    secrets DEV-69 keeps from leads as well. A review's lead keeps the strict
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
  inside theirs; the risk is that of the sandbox. The person's own Claude
  Code settings don't reach the coordinator: their allow rules and
  sandbox exemptions, and their hooks, aren't loaded for it. The copies'
  `git fetch` is as fresh as the turn, not the moment. Codex keeps its
  read-only sandbox, whose commands can't write the copy, so its `git
  fetch` and `git tag` are refused when they ask to go beyond it; OpenCode
  and agents with no sandbox Althar holds get only the rules' additions.
  A command Claude Code can't read itself, such as one with `$?`, asks
  instead of running in the sandbox, and then meets the reader rules: the
  brief says to write such commands plainly. What Claude Code's sandbox
  does with these settings was read from its documentation and settings'
  schema, and tried on a real session on macOS on 22 October 2026
  (tests/agents/reader.test.ts), in a repository whose own settings
  carried a hook writing outside and allow rules and exemptions for
  `touch` and `cat`: `git fetch`, `git tag`, `$(…)` with `uptime`, a
  `node --test` file and `bun --version` ran without asking; a write
  outside the folder, a write or tag in the person's checkout, reading
  its `.env` or a folder of the person's, a socket, `curl`, and reading
  `~/.ssh` were refused, and the hook didn't run; its Read tool was
  refused the folder of the person's and the checkout's `.env`. Linux
  isn't tried yet.
- **Revisit when:** Codex's sandbox can be held to a folder with writes
  in its git folder; Althar can tell before a session starts that an
  agent's sandbox will start on Windows; the coordinator needs the
  project's setup in its copies often enough to keep one set up.
