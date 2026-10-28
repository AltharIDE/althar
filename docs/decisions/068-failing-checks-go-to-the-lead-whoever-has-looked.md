# ADR-068: Failing checks go to the lead, whoever has looked

- **Status:** Accepted
- **Date:** 2026-10-28
- **Amends:** [ADR-040](040-a-change-reaches-the-person-green.md)
- **Owner:** Repository maintainers
- **Context:** ADR-040 had a change's lead see its checks through only until
  the person first looked: opened the task, spoke on it, stopped its lead or
  pushed. After that a failure reached a running lead only, and every push
  was the person's. So a failure after a glance at the task, after main moved
  and a conflict was resolved, or after the person pushed, sat in Needs you
  with an idle lead, and all the person did was tell it "please fix it". The
  person asked on 28 October that failing checks Althar knows of go back to
  Running and the lead find a fix, leaving it to the lead to tell when
  something is broken on main rather than by the change. Conflicts already
  resolve on their own (ADR-030); failing checks now do too.
- **Decision:**
  - **A new failure on an open pull request of an open task's, its own or
    one attached to it, goes to its lead, whether or not the person has
    looked** (`Changes.fixesOf`, read from the record each time), while
    Althar follows that pull request: one an attached pull request replaced
    says nothing of the task any more. It is run
    again once first, as ADR-041 has it, then the lead is told, started
    again on the agent it was last on if its session has ended. A running
    lead, as one the person is talking to, is told. Its card is Running
    with the step "Fixing the checks" while it works, and "Checks running"
    while the checks on its fix run.
  - **The lead decides what the failure is,** and is told so: its change
    broke it, and it fixes, commits and pushes; it failed by chance, and it
    runs it again with `rerun_check`, once; it is broken on the default
    branch, or fails for a reason that has nothing to do with the change,
    and it changes nothing on its branch to work around it, and calls
    `hand_checks_to_person` with one short line saying so and what would
    fix it ("Fails on main too: runtime (windows) times out in
    busy.test.ts", in plain words: the row shows no code marks, and
    Althar drops any); or it needs the person to decide, and says what.
    `read_default_branch_checks` shows it the checks on the default branch's
    latest commit, with the ends of the failed ones' logs.
  - **A fix pushes at once,** after the person has looked too: while the
    checks on the pull request's head fail and the run of failures is the
    lead's, `push_to_pull_request` pushes rather than asking. Not where the
    person said anything on the task since those checks came: what the lead
    commits may be for that, and waits for their push, as anything else it
    commits does. Nor where the branch had commits the pull request didn't
    when the lead was told (kept with the failure, `checks_told`): a push of
    the fix would take them up too, so fix and all wait for the person.
  - **The checks on a fix are waited for `checksAppear`** from the push that
    made it (kept as `pushed`), however often the pull request is looked at;
    by then without checks, the change is the person's. Checks the host
    won't show make it the person's at once, as ADR-041 has it.
  - **Three fixes (`FIX_ROUNDS`) a run of failures.** A run counts, by
    commit, from the end of the plan's run, the person's last push, or the
    checks last passing, whichever came last. Failing again after the third
    fix, the thread says "The checks on PR #1 still fail after 3 fixes by
    its lead, so the change is yours now", and the lead is told once to say,
    with `hand_checks_to_person`, what it tried and why they still fail,
    changing nothing more.
  - **The person stays in charge.** Stopped or interrupted by the person
    since a failure came, the lead isn't told that failure again, run again
    or not; a new failure on a new commit is its again. Checks that ran too
    long, or couldn't be read, end the run the same way.
  - **A lead that ends its turn on a failure with nothing done** (no fix
    pushed or asked to be, no rerun, no line for the person, no question
    waiting) is waited for as a conflict round's lead is, then asked once to
    do one of those. Ending its turn so again, the failure is the person's,
    and the card says "test still fails, and the lead stopped without a fix
    or a reason. Tell it what to do." Not where the person spoke since the
    failure came: they are at it together. **Its agent stopping on its own**
    before it did any of those, mid-turn or after, is looked at as it goes:
    the lead is started again on the same agent and asked once; stopping so
    again, or not starting, the card says "test still fails, and the lead's
    agent stopped on its own without a fix or a reason. Tell it what to do."
    A lead the person stopped stays stopped, and one another agent took over
    from carries on there.
  - **It comes to the person only with a reason:** it is ready (Needs you,
    Stuck) with the lead's line, or, where its tries are spent and it said
    nothing, "test still fails after 3 fixes by the lead"; never a bare
    "Checks failed". The line is its Needs you row's and its task's, cut to
    one line where it is long, and the thread has it whole. The board card
    shows only the check that fails, as for any failure, and no "Ask the lead
    to fix it": a card is not the place for a paragraph of red.
  - Settled tasks, reviews of someone else's pull request, and the checks on
    a merge a conflict round pushed (the round's own, ADR-030) are as
    before.
- **Alternatives considered:**
  - **Store the round of a failure as a conflict round is.** A table and
    states to keep in step, where who looked, stopped, pushed and said what
    is in the record already, as ADR-040 reads it.
  - **Have Althar check main itself before telling the lead.** Main's
    checks often differ from a pull request's, and the same failure can be
    another pull request's alone; the person wanted the lead to judge.
  - **Push every commit the lead makes while checks fail.** It may be doing
    what the person asked it meanwhile; only a fix with nothing said since
    goes up.
- **Trade-off:** a lead can be woken for a failure the person was about to
  deal with themselves; stopping it keeps that failure theirs. A lead that
  shrugs a failure off costs one more turn before it is the person's.
- **Revisit when:** a lead's tools can read other open pull requests'
  checks, so it can tell main's breakage from its own without main's
  checks; or people want a way to keep a task's failures from its lead.
