# ADR-006: A git worktree per task

- **Status:** Accepted
- **Date:** 2026-09-28
- **Owner:** Repository maintainers
- **Context:** Charrette must not change the user's checkout. A task's steps
  work on the same code, and a switch to another agent keeps it.
- **Decision:**
  - Each task gets one git worktree per repository, in a folder Charrette
    owns. The lead, its steps, and any agent that takes over share it.
  - A project can declare a setup command and untracked files to copy into
    each worktree, such as `.env`.
  - Working on a plain branch in the user's own checkout may come later, as an
    explicit per-project choice.
  - Details: [01](../architecture/01-concepts-and-project-model.md).
- **Alternatives considered:**
  - Full clones: slower and heavier.
  - The user's own checkout: changes their working copy and collides with
    parallel tasks. Kept as a possible later opt-in.
  - Containers: a later execution host, not the MVP.
- **Trade-off:** dependencies install per worktree; untracked files must be
  copied; some tools assume a single checkout path.
- **Revisit when:** parallel writers need a workspace per branch; users ask
  for plain branches; containers arrive.
