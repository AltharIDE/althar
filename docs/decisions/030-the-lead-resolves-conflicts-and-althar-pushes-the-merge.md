# ADR-030: Where the project says so, the lead resolves a conflict unasked, and Althar pushes the merge

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
    the project's settings, beside its rules: "Resolve conflicts
    automatically". It is
    kept as a revision of the rules like any other
    ([ADR-013](013-project-rules.md)). App-wide defaults for new projects
    are DEV-15.
  - **A task can say otherwise than its project,** from its ⋯ menu: as the
    project says, on, or off. It is kept on the task, and shown beside the
    menu only where it differs from the project's, so the task's window stays
    quiet. Each conflict goes by what is said when it is found.
  - **Turning it on resolves what already conflicts.** The project's switch
    going on, or a task's say where its lead wasn't resolving conflicts, has
    Althar look at once at each open task with a branch: a branch merging
    here is merged with its default branch without anything moving, and a
    listened pull request is asked about now. What conflicts starts a round
    as a conflict found later would, under the same rules.
  - **On, a conflict is the lead's to resolve, unasked,** whether a merge
    here found it or the pull request's host said so. Althar sends the note
    the person's press sends, in the same words; for a pull request, the
    branch it goes into is fetched first, and the note says Althar pushes the
    merge.
  - **Althar judges the branch, not the lead's word.** Once the lead is
    done, the branch it conflicted with must be in it, nothing half merged,
    and no conflicted file with markers left. Not resolved, the lead is
    asked once more with why; then it is the person's, in Needs you, where
    the button's flow would leave it. Where all that was left was to commit
    the merge, the lead is told its merge is resolved but not committed, and
    to commit it, not asked to resolve it again.
  - **The lead commits before it finishes.** It commits the merge as soon as
    the conflicts are settled and the quick checks pass, before the full
    test suites, and doesn't end its turn with the merge uncommitted or
    while it waits on something running in the background. If the full tests
    then find something, it fixes it in one follow-up commit on top of the
    merge.
  - **Done is the turn over and nothing in hand.** A lead that backgrounded
    the full tests and ended its turn isn't done: Claude Code wakes it when
    they end (ADR-022), and it commits then. The round waits for a lead
    with a command it left running going, in a call of its own, or that
    spoke outside a turn Althar sent less than half a minute ago, as
    `Sessions.busy` says; nothing says when a turn the agent starts itself
    ends, so quiet is how it is told. A server it left running, which says
    where it answers, isn't waited for. The wait is bounded (45 minutes),
    and past it the branch is judged as it is, then asked once more and
    given to the person as before.
  - **No review round.** The lead runs the quick checks and commits the
    merge, and the pull request's checks run on what Althar pushes.
  - **Althar pushes the resolution itself:** the one exception to "after the
    first push, pushing is the person's". Only the merge, made on the branch
    as the pull request had it, with nothing after it, and only where nobody
    else asked the lead anything meanwhile, and with at most the one commit
    the lead made on top of it for what the full tests found, the same
    one commit a fix for failed checks is. Where the branch had other
    commits the pull request didn't, or anything else is on it, such as
    more than that one commit, nothing is pushed, and the task's Push card
    sends it all once the person has looked. It uses the same push as that
    card, with the connection.
  - **The round follows the checks on what Althar pushed.** Passed, the task
    is ready to merge. Failed, the lead is asked to fix them within the
    round, as one commit on top of the merge, and that commit alone is
    pushed in turn; anything after it waits for the person's Push. That fix
    is the lead's one more try: checks that fail again are the person's, in
    Needs you.
  - **Only once the task's run has succeeded, and only until the person
    stops it.** A task the person stopped isn't started again for a
    conflict, and stopping or interrupting the lead, or stopping the task,
    mid-round makes the round theirs: nothing more is pushed, and failed
    checks don't ask the lead again.
    Stopping listening to the pull request ends its round as well.
  - **The lead still never pushes.** Its environment has no way to
    ([ADR-011](011-own-connectors-for-hosts-and-trackers.md)); its brief, and
    the rules' word when it tries `gh`, say Althar pushes this merge for it.
  - **Merging stays the person's.** Nothing here merges a pull request or
    the default branch.
- **Alternatives considered:**
  - **A switch on the task's header.** Most tasks follow their project; a
    control always in view would be noise for a choice rarely made.
  - **Wait for the next conflict once it is turned on.** A conflict found
    before would stay until something new happened, though turning it on is
    when the person wants the board's conflicts gone.
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
  - **Turning it on over a whole project may start several leads at once,**
    one per task that conflicts. That is what the person asked for, and each
    is a task already done, waiting to merge.
  - **A lead's brief says what Althar pushes for it as its session starts.**
    Changed afterwards, the note asking it to resolve a conflict says it
    again, in the words that hold then.
  - **What counts as the resolution is read from git's history and the
    thread:** the merge alone, then the one commit made on top of it when the
    lead was asked to fix its checks, with nothing else asked of it. Other
    work a lead slips into that very commit goes up with it; the checks, and
    the pull request's review, are what catch it. A fix split over several
    commits waits for the person.
  - **A fix the quick checks needed found before the merge is committed is
    in the merge,** and one the full tests found after it is the one
    commit on top. Two or more commits after the merge leave it for the
    person to push. A test fix is told apart from other work only by being
    the one commit; other work the lead slips into that commit goes up with
    it, as it does in a fix for failed checks.
  - **A lead that is woken after Althar judged it** has its commits wait for
    the person's Push. Past the bound, or for an agent that says what it left
    running only after its turn (Codex, ADR-022), a round can be judged
    while tests still run.
  - **The wait for "done" rests on quiet.** A turn Claude Code starts itself
    shows as messages and calls with no end marker, so half a minute without
    one is taken as the end. A long call the agent doesn't report as a call
    of its own can outlast that.
- **Revisit when:**
  - Althar runs a project's checks itself, rather than the lead: judge the
    resolution by them before pushing.
  - A lead may ask Althar to push its commits: one path for both.
