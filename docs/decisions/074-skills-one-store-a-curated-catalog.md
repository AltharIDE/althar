# ADR-074: Skills are one store on the computer, from a curated catalog, given to each lead for its session

- **Status:** Accepted
- **Date:** 2026-10-18
- **Owner:** Repository maintainers
- **Context:** Claude Code, Codex and OpenCode each read skills (the Agent
  Skills format: a folder with a `SKILL.md`) from folders of their own, in
  the person's home or in the repository. A lead Althar starts got whatever
  happened to be there, different for each agent, and nothing Althar chose,
  reviewed or could say it gave. Two MIT repositories,
  [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) and
  [obra/superpowers](https://github.com/obra/superpowers), hold most of what
  a lead would want, but tell agents to push and open pull requests, write
  plans into the repository, and assume plugins and hooks Althar doesn't run.
  The plan is in [docs/plans/skills-across-harnesses.md](../plans/skills-across-harnesses.md).
- **Decision:**
  - **One store, in the profile's `skills/`, outside every repository**
    (`@althar/skills`). A skill's files are kept by content hash and never
    change; `installs.json` says which versions are installed, where each
    came from (`althar-default`, `github` with its commit, or `local`) and
    which is active. Only a reviewed install can be active.
  - **The same skills for every agent.** For each session of a task's lead,
    Althar lays out read-only copies of the active set under
    `runs/<session>/<agent>/` and hands them over the way the agent's
    registry entry says (`skills.via`): Claude Code as a session plugin,
    Codex as an added folder its `.agents/skills` root is read from, OpenCode
    in `skills.paths`. The copies go when the session ends. The account's
    home, the person's own folders and the repository are never written. A
    skill that needs subagents is left out for an agent that can't be
    counted on to have them, and the thread says which.
  - **Fixed for the session, and recorded.** The set is read once as the
    session starts and doesn't change under it; which skills, at which
    content hashes, is kept with the session. A change reaches each lead the
    next time it starts. Installing, approving and removing a skill are kept
    as the person's acts.
  - **Who gets them.** Only a task's lead. Readers, reviewers, a review's
    lead (its repository is untrusted) and the coordinator get none.
  - **A curated catalog, vendored and pinned.** The app ships
    `packages/skills/catalog/`: skill folders copied from the two
    repositories at pinned commits, each with its source, commit, upstream
    hashes, licence and copyright line, and the patch Althar applied. Every
    skill of both is carried unless two do the same job, when the better one
    is (`catalog/CURATION.md`): 32. Patches take out push and pull request
    steps (Althar pushes), hand merging and worktree cleanup to Althar, keep
    planning files out of commits and make the text agent-neutral; a skill
    that only makes worktrees Althar already gives (`using-git-worktrees`)
    is left out. `scripts/vendor.ts` rebuilds the catalog from
    `scripts/curation.ts`, and stops where upstream changed under a patch.
  - **All are off until the person turns them on**, in Settings, under
    Skills. They change how every lead works, and there is no per-project
    selection yet, so none is given to a lead unasked. The catalog is
    installed once per revision (by its catalog.json's hash), not on every
    session start.
  - **Installs from GitHub are reviewed.** A ref is resolved once to a
    commit; only the skill's own folder is fetched, each file checked
    against the commit's tree. The review card shows source, commit,
    licence, findings (scripts, links, permission-like frontmatter), the
    files and the diff from the installed version; only approving it
    installs. `allowed-tools` and `hooks` in frontmatter are refused. Updates
    are checked only when the person asks, and the replaced version is kept
    to roll back to. Nothing a skill carries is run by Althar.
- **Alternatives considered:**
  - **Forks of both repositories.** Full control, but they carry as much
    plugin, hook and per-agent code as skills, and every upstream change to
    a patched file would be a conflict.
  - **A catalog of pins only, fetched on first run.** Small, but a first run
    needs the network, and a force-push upstream breaks a fresh install.
  - **Each agent's own folders** (`~/.claude/skills` and the like). No
    store to keep, but writing there changes the person's own setup, leaks
    one run's set into the next, and for Claude Code a per-run home would
    break its sign-in.
  - **About fifteen skills by default**, as the plan first proposed, to fit
    Codex's starting budget (about 8,000 characters for the list when it
    doesn't know the context size). Read in full, the two sets did few jobs
    twice, and leaving a skill out loses what only it does.
- **Trade-off:**
  - **All of them on is more than Codex may list.** Their names and
    descriptions come to more than its fallback budget, so Codex can shorten
    or drop some; nothing checks or reports that yet. The person can't
    choose a set for one project yet either: what they turn on is on for
    every lead.
  - **Off by default means nobody gets them unasked.** Someone who never
    opens Settings never has them; the catalog is a choice to make, not a
    default behaviour change.
  - **Skill text is not a boundary.** The catalog's patches keep its skills
    from telling an agent to push, but a person's own install may; the push
    guard ([ADR-075](075-skill-and-openspec-files-stay-off-the-repository.md))
    and the project's rules are what hold.
  - **A catalog update needs an app release** until `althar-skills` and its
    update channel exist.
- **Revisit when:**
  - Per-project selection lands: the default set, and whether all 33 stay
    on, is decided again there.
  - Codex is seen dropping skills from its list.
  - An agent gains a way to be given skills for one session that differs
    from the one here.
