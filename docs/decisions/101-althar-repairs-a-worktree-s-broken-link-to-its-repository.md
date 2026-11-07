# ADR-101: Althar repairs a worktree's broken link to its repository

- **Status:** Accepted
- **Date:** 2026-11-07
- **Owner:** Repository maintainers
- **Context:** A linked worktree and its repository name each other: the
  worktree's `.git` file names its git directory under the repository's
  `.git/worktrees/`, and that directory's `gitdir` file names the worktree
  back. Moving either side breaks the link. When a person moved from the
  Flatpak to a native build with the same profile, every task worktree of a
  project stopped opening: git said `fatal: gitfile does not point to a valid
  repository` for every command, while `git worktree list` in the main
  checkout still showed them as healthy. Cards said "Codex couldn't start.
  GitFailed:." and the log had only a stack. `git worktree repair` fixes it,
  but until now Althar wrote to git's worktree metadata only to add or remove
  a worktree.
- **Decision:**
  - **Althar repairs the link by itself.** It does this for a task's worktree
    or the copy its reviews read (`.review/<task>/<repository>`) whose `.git`
    file names no git directory, or names one that isn't there, or whose
    repository's record names another place. It runs `git worktree repair
    <folder>` from the main checkout of the repository the worktree was made
    from, which puts both sides right.
  - **When:** as Althar starts, for every worktree it keeps that isn't
    cleaned, and the first time a git command in a worktree under its
    worktree folder fails for its link. That command then runs once more.
    Every broken worktree of the repository is repaired and recorded
    together, because git repairs them together.
  - **Judged by the link, not git's exit code.** Git repairs a worktree
    through the main checkout's record of it, yet still exits 1 where the
    `.git` file named a worktree by another name. What counts is whether the
    link reads right afterwards.
  - **Never another worktree's record.** Git names a repository's records of
    its worktrees by their folders' names, and every task's worktree of a
    repository has the same name, so they are `<name>`, `<name>1`, and so on.
    A prune, which Althar runs itself, drops the record of a worktree whose
    folder moved and frees its name, and the next worktree made takes it. The
    moved folder's `.git` then names another task's record, and git's repair
    would point that record at it, with the other task's HEAD, branch and
    index. So before it runs git, Althar finds the record the repair would
    join the folder to: one that names this folder, else the git directory
    its `.git` names, else the record by that directory's name. It repairs
    only where that record names this folder or a folder that isn't there
    (one that is there counts as another's even without its `.git`, since a
    detached review copy has no branch to tell it by), and isn't on a branch other than the task's (for a review's copy, on no
    branch). Otherwise it records `workspace.repair_failed`, says the record
    is another folder's, or on another branch, and changes nothing.
  - **What it records:** a `workspace.repaired` (or
    `workspace.repair_failed`) fact on the workspace, a line in the task's
    thread ("Althar repaired this task's folder link to the repository"), and
    an INFO line in the log.
  - **What it never does:** move, remove, reset or prune anything. Where git
    can't repair a folder, git's own words go to the thread and the log, the
    folder stays as it is, and Althar doesn't try that folder again until it
    restarts. A worktree whose folder is missing is left to "its folder isn't
    on this computer".
- **Alternatives considered:**
  - **Ask the person first.** The repair only rewrites two pointer files to
    what they must be, and the person can't work in the task until it's done;
    asking would only add a step to each of a project's tasks.
  - **Say what to run, and do nothing.** What the person saw before, without
    even git's words; it left every task stuck.
  - **`git worktree prune` and add again.** Prune removes the repository's
    record of worktrees it thinks are gone, and with it what the worktree
    held but hadn't committed. Never.
- **Consequences:**
  - A profile, repository or worktree folder that moves heals itself on the
    next start, or at the first git command in a broken worktree.
  - Althar now writes to git's worktree metadata outside adding and removing
    worktrees, but only through `git worktree repair`.
