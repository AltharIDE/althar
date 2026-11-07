# ADR-101: A small change takes one step and is reviewed after it merges; Auto moves a lead to a lighter model as its plan runs out

- **Status:** Accepted; built 2026-11-07
- **Date:** 2026-11-07
- **Amends:**
  [ADR-097](097-agents-work-as-the-person-s-own-and-only-what-can-t-be-undone-asks.md)
  (a plan of a few lines needn't wait its countdown; a review may read a
  change after it merged), [ADR-012](012-several-accounts-per-agent.md) and
  [ADR-015](015-coordinator-picks-models.md) (a step may move to a lighter
  model of the same agent before its plan is out, which the person can keep
  it from for a task), [ADR-034](034-a-review-is-a-round-of-its-own.md) (the
  review after a merge is a task of its own, of a merged pull request)
- **Owner:** Repository maintainers
- **Context:** The person's note of 6 November: a one-line fix took about 40
  minutes, which they called ridiculous; cutting that overhead is a
  priority. Measured the same day against the profile's own record
  ([small-task-timeline.md](../research/small-task-timeline.md)): of a small
  task's time to its pull request, 42% was waiting for an agent's place,
  33% the lead working and 22% its review; the countdown before a plan
  started took 0.4–0.8 minutes, and a review took 1.2 minutes in the middle
  and up to 13. Waiting for a place was cut first
  ([ADR-032](032-agents-at-once-on-this-machine.md)'s follow-up, 6
  November). What kept a one-line fix slow after that was everything a
  change of any size goes through: a plan to read and hold, two gateways
  between steps, and a review that runs before anyone may merge. And when
  the person's plan runs low, a step as small as that still goes to the
  biggest model, until the plan is out and the step waits.
- **Decision:**
  - **A change of a few lines is planned small.** Its plan holds one step,
    its lead on a light, quick model (Sonnet at low effort where it lists
    one), and a review step that names who reads it, skipped so nothing
    waits on it. It starts at once, with no countdown: the fast lane's "no
    plan" is the person's not having to read one.
  - **It is reviewed after it merges.** Its pull request merges on the
    person's word, as every merge does, and its merge starts a review task
    of its own on the merged change. A review of a merged pull request reads
    its head as any review reads a pull request's, and posts what it finds
    the same way (`Reviews.start` with `afterMerge`). Until then nothing
    blocks the merge.
  - **One card in its thread says what it skipped**, each step with its
    time (Started, Changed a line in …, Checks pass, Merged), with Merge,
    which still asks, and Make it a full task, which starts its review
    before the merge instead of after and folds the card to a line. Its
    words are short and never narrate what is on screen.
  - **Auto moves a lead's next step to a lighter model of the same agent**
    when the plan's tightest window is 90% used or more, and says so in the
    thread: from and to which model, the share used, the window and when it
    resets. Its words after the line are the new model's. Keep turns it back
    for that task, and Auto keeps to it, at every step after; Undo puts the
    move again. Plan usage comes from the usage endpoint
    ([the person's note of 21 October](../../AGENTS.md)).
- **Where it goes another way than the sketched README:**
  - **A small change's card is read from the task, not stored.** The
    README had Althar post a card and keep it current; read as the task
    stands, from its plan, its first report, its pull request's snapshot and
    its review, it cannot go stale, and a thread read after an absence is
    right the first time.
  - **Its review runs as a task of its own on the merged pull request**,
    rather than a round that waits inside the change's task. The change's
    task is done when it merged, and a review that found something is then
    a task that can be fixed or set aside, as any review is.
  - **The review a merge starts is refused where the plan named no
    reviewer**, and where the pull request was closed without merging:
    there is nothing to read.
- **Alternatives considered:**
  - **No review at all for small changes:** the person's plan for a change
    of a few lines was "no review", and the coordinator still planned one
    when it mattered. Reviewing after the merge keeps the fast merge without
    losing the second pair of eyes.
  - **A stored card, kept current by each step:** more moving parts, and one
    the runtime can miss (a merge seen while Althar is closed); reading it
    from the task has neither problem.
  - **The review as a round inside the change's task:** it keeps the task
    open after its merge, which stops a second small change from starting
    from it, and the person needs the merge to be the end.
  - **A model move that asks first:** it would cost a card in the fast
    lane's own way of working. The move is said, and undone in one press.
- **Trade-off:**
  - **A small change merges unreviewed.** The review that follows can find
    what a pre-merge review would have stopped, and its finding then needs a
    fix of its own. The plan names who reads it, and Make it a full task is
    there for anything the person wants read first.
  - **A merged pull request's review posts on a change already in.** It
    still reads and speaks as any review does; on GitHub, a review of a
    merged pull request is allowed.
  - **The light model can be too light for what looked like a small
    change.** The lead can ask for help, or the person makes it a full task;
    the card says which model ran.
  - **Auto's move changes what a task costs** where the person would rather
    spend the bigger model's usage on it: Keep is one press, and it holds
    for the whole task.
  - **The share is read where the plan is read.** A plan the endpoint hasn't
    said anything about moves nothing, as before.
- **Revisit when:** a small change's review keeps finding what a pre-merge
  review would have stopped, so the lane needs a review before the merge
  for a kind of change; a merged pull request refuses a review at a host we
  use; Auto's moves surprise the person, or the threshold is wrong for a
  week of work.
