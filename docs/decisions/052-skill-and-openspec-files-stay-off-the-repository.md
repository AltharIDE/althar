# ADR-052: Skill and OpenSpec files stay off the repository unless the project says so, and a push is held back for them

- **Status:** Accepted
- **Date:** 2026-10-18
- **Owner:** Repository maintainers
- **Context:** Althar gives its leads skills from a store outside the
  repository ([ADR-051](051-skills-one-store-a-curated-catalog.md)), but an
  agent can still write `.claude/skills/…`, `.agents/skills/…`,
  `.opencode/skills/…` or `openspec/…` into the worktree, a skill can tell it
  to, and the agent commits by itself, where Althar can't see its staging.
  Pushing is Althar's ([ADR-016](016-push-without-a-connection.md)), and
  Althar pushes a lead's merge of the default branch on its own
  ([ADR-030](030-the-lead-resolves-conflicts-and-althar-pushes-the-merge.md)).
  A repository's skills shape every agent that later works in it, so these
  files reaching a shared repository should be the person's choice, made
  once per project, not something a task drifts into.
- **Decision:**
  - **Three switches in the project's rules** (`repositoryFiles`,
    [ADR-013](013-project-rules.md)): `writeSkills` ("Write Althar-managed
    skills"), `writeOpenSpec` ("Write OpenSpec artifacts") and
    `pushProtected` ("Push skill/OpenSpec files"). Each is off until the
    person turns it on, in the project's Settings under Repository files,
    and each change is a new revision of the rules, as the rest are. An
    agent can't change them.
  - **Protected paths are found by path alone**, whoever wrote them:
    the three skill roots at any depth, and `openspec/` at any depth.
  - **Every push Althar makes for a task is checked first** (publishing,
    pushing the branch or to a pull request, replacing after a rewrite,
    pushing after a local merge). A protected path the task's own commits
    changed is held back unless both its class's write switch and
    `pushProtected` are on; one doesn't follow from the other. A protected
    directory the repository already tracked where the task started, or on
    its default branch (`.claude/skills`, `web/openspec`), is the
    repository's own: what the task changes in it goes, so a repository
    that versions its skills or specs is not held back, and only a protected
    directory the task brought in is. The push is
    refused whole (`PushRefused`, `protected`), naming the files and the
    switches that would let them go.
  - **The task's own commits** are the ones no remote, no default branch
    Althar fetched (`refs/althar/base/…`) and nothing it pushed before
    already has; a merge counts only for what its resolution changed against
    every parent. Files that came in with the default branch don't hold a
    push back, and a file slipped into a resolution does. With nothing to
    stop at, every commit counts, so a push is held rather than let through
    unseen. Paths are read from git with NUL separators, no quoting and no
    rename detection, so neither a name nor a rename hides one.
- **Alternatives considered:**
  - **Blocking at commit.** The plan's first barrier, but the agent runs
    `git commit` itself, in its own process; Althar would need to stand in
    for the agent's git. Not built.
  - **Blocking the write in the agent.** Each agent's file and shell tools
    would need a path rule Althar can enforce; not yet the same across the
    three.
  - **`.gitignore`.** The repository's own, the person's to change, and
    `git add -f` passes it.
  - **One switch** for writing and pushing. Simpler, but keeping skill files
    in a local checkout is a smaller step than sending them to everyone who
    clones it.
- **Trade-off:**
  - **The write switches don't stop a write.** With `writeSkills` off, a
    lead can still write and commit a skill in its worktree; it is held at
    the push. The task's diff shows it, and the person can drop it.
  - **A merge into the default branch on this computer is not checked**
    (Althar's local merge), only pushes.
  - **A held push holds the whole push**, not the protected files alone:
    taking them out is the lead's or the person's change to make.
- **Revisit when:**
  - Althar stands in for the agents' git, so the commit can be checked.
  - The agents give Althar a write rule by path.
  - OpenSpec work moves into Althar's own store, as the plan proposes.
