# ADR-006: A git worktree per task

- **Status:** Accepted
- **Date:** 2026-09-28
- **Owner:** Repository maintainers
- **Context:** Althar must not change the user's checkout. A task's steps
  work on the same code, and a switch to another agent keeps it.
- **Decision:**
  - Each task gets one git worktree per repository, in a folder Althar
    owns. The lead, its steps, and any agent that takes over share it.
  - They live in a visible folder with readable names and no spaces:
    `~/Althar/<project>/<task>/<repository>`. The root can be changed in
    settings, and per project. "Open in editor" opens the task's folder, so a
    task across several repositories opens as one workspace. Althar's own
    data stays in its profile folder.
  - A project can declare a setup command and untracked files to copy into
    each worktree, such as `.env`.
  - Working on a plain branch in the user's own checkout may come later, as an
    explicit per-project choice.
  - Details: [01](../architecture/01-concepts-and-project-model.md).
- **Alternatives considered:**
  - Inside the repository, as Claude Code does (`.claude/worktrees`): needs a
    `.gitignore` entry, and the original checkout's editor, search, watchers
    and test runners see every worktree.
  - Beside each repository: a task across two repositories would be split
    across two places.
  - A hidden app folder (`~/.codex/worktrees`, `~/.superset/worktrees`, or
    the profile folder): harder to find and open by hand; the macOS profile
    folder's path also has a space, which some build tools mishandle.
  - Full clones: slower and heavier.
  - The user's own checkout: changes their working copy and collides with
    parallel tasks. Kept as a possible later opt-in.
  - Containers: a later execution host, not the MVP.
- **Trade-off:** dependencies install per worktree; untracked files must be
  copied; some tools assume a single checkout path.
- **Revisit when:** parallel writers need a workspace per branch; users ask
  for plain branches; containers arrive.
