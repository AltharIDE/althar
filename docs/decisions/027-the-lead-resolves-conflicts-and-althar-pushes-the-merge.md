# ADR-027: Where the project says so, the lead resolves a conflict unasked, and Althar pushes the merge

- **Status:** Accepted
- **Date:** 2026-10-12
- **Owner:** Repository maintainers
- **Context:** A task's branch that conflicts with its default branch waited
  for the person. Merging here, a conflict offered a button that sent the
  lead a note naming the files; on a pull request, the host's page said so
  and Althar said nothing. Either way the person had to notice, ask, wait
  for the lead, and then push what it committed, since after the first push
  pushing is the person's ([06](../architecture/06-integrations-and-skills.md)).
  For a team whose default branch moves often, that is a round trip per task
  for work the person doesn't judge: the lead settles the conflict, and the
  checks say whether it holds (DEV-85).
- **Decision:**
  - **A project rule, off unless the person turns it on,** from a switch in
    the project's settings, beside its rules: "Resolve conflicts". It is
    kept as a revision of the rules like any other
    ([ADR-013](013-project-rules.md)). App-wide defaults for new projects
    are DEV-15.
  - **On, a conflict is the lead's to resolve, unasked,** whether a merge
    here found it or the pull request's host said so. Althar sends the note
    the person's press sends, in the same words; for a pull request, the
    branch it goes into is fetched first, and the note says Althar pushes the
    merge.
  - **Althar judges the branch, not the lead's word.** Once the lead's turn
    is over, the branch it conflicted with must be in it, nothing half
    merged, and no conflicted file with markers left. Not resolved, the lead
    is asked once more with why; then it is the person's, in Needs you,
    where the button's flow would leave it.
  - **No review round.** The checks the lead runs before committing the
    merge, and the host's on what is pushed, are enough. A check that fails
    on the pull request goes back to the lead, as any does.
  - **Althar pushes the resolution itself:** the one exception to "after the
    first push, pushing is the person's". Only the merge, made on the branch
    as the pull request had it, and commits on top of it in the same round,
    such as a fix its checks needed. Where the branch had other commits the
    pull request didn't, or something else came in, nothing is pushed, and
    the task's Push card sends it all once the person has looked. It uses the
    same push as that card, with the connection.
  - **The lead still never pushes.** Its environment has no way to
    ([ADR-011](011-own-connectors-for-hosts-and-trackers.md)); its brief, and
    the rules' word when it tries `gh`, say Althar pushes this merge for it.
  - **Merging stays the person's.** Nothing here merges a pull request or
    the default branch.
- **Alternatives considered:**
  - **Let the lead push its own resolution.** It would need a way to the
    host, which is exactly what agents don't have. Althar pushing a commit
    it checked keeps the boundary.
  - **Push whatever the lead committed once the conflict is resolved.** It
    would carry unreviewed work up with the merge, under cover of a rule
    meant only for conflicts.
  - **A review round on the resolution.** A conflict settled so both sides
    hold is what checks catch; a review would cost a round for little.
  - **Rebase the task's branch instead of merging.** It rewrites what the
    pull request already has, and would need a forced push.
- **Trade-off:**
  - **A lead may settle a conflict in a way the person wouldn't,** and it
    goes up without them looking. The checks, and the pull request's own
    review on the host, are what stand between it and the default branch.
  - **A host that doesn't say a pull request conflicts** (Bitbucket Cloud)
    gets no help until the person merges here or asks.
  - **What counts as the resolution is read from git's history:** a lead
    that commits other work after the merge, in the same round, has it
    pushed with it.
- **Revisit when:**
  - Althar runs a project's checks itself, rather than the lead: judge the
    resolution by them before pushing.
  - A lead may ask Althar to push its commits: one path for both.
