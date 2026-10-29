# ADR-071: A lead's commits push as its turn ends, unless the project says otherwise

- **Status:** Accepted
- **Date:** 2026-10-29
- **Amends:** [ADR-040](040-a-change-reaches-the-person-green.md), [ADR-070](070-failing-checks-go-to-the-lead-whoever-has-looked.md)
- **Owner:** Repository maintainers
- **Context:** Once the person had looked at a task, spoken on it or pushed
  to it, everything its lead committed waited for them to press Push
  (ADR-040). ADR-070 let a fix for failing checks go up by itself; anything
  else, such as work the person or the coordinator asked of the lead, still
  waited. So cards sat in Needs you saying "Push 1 commit" for work the
  person had already asked for, and pushing was all they did with it. The
  person asked on 29 October: "Why am I needed for that? Perhaps it can be a
  setting."
- **Decision:**
  - **A project rule, `pushCommits`, on unless the person turns it off:**
    "Push the lead's commits automatically", among the project's Tasks
    switches beside resolving conflicts. Like those, it is the project's
    alone, with no app-wide default.
  - **On, what a lead commits goes up to its task's open pull request as its
    turn ends,** whoever has looked (`Changes.pushLeft`). Its turn ending, or
    its session going, is waited out as a conflict round's is: a lead may
    commit just after its turn, and one still at work on what it left
    running is pushed for when that ends. Not while its plan publishes, or a
    conflict round is under way: those push themselves. `push_to_pull_request`
    pushes at once too, rather than asking. Turned on, and at launch, what
    open tasks' leads left waiting goes up (`pushNow`).
  - **What goes up never changes:** the task's own pull request's branch,
    never the default branch, as a plain push, never forced: a branch whose
    pushed commits were rewritten waits for the person's Replace, as before.
    Only an open pull request takes commits; one merged or closed sends them
    to the task's next, which the person opens (ADR-034). A task with no pull
    request yet publishes as before. The push is Althar's own, as the
    person's Push is, so the rules on agents' commands (ADR-067) have nothing
    new to ask about.
  - **Someone else's commits hold it.** Where the pull request's branch is
    anywhere but where Althar last pushed it (`repository_changes`), someone
    pushed there outside Althar, from this checkout or another, and the
    lead's commits wait for the person rather than go on top unseen. So do
    they where the person stopped or interrupted the lead since anything last
    went up or was said to it, and where the push, or asking the host before
    it, failed, the pull request's host isn't connected, or the lead was
    still at work long after its turn. A hold is the last word: a fix for
    failing checks doesn't go up past it, as ADR-070's would.
  - **Whatever stops it, the person has Push.** Nothing that ends an
    automatic push leaves commits that are neither going up nor theirs to
    push: Althar doesn't try again on its own until the lead's next turn
    ends, the rule is turned on again, or it starts, so a hold, with why, is
    how the person gets them up meanwhile.
  - **The card shows Push only where a push is held, and why.** Each hold is
    kept (`push_held`, with why) until anything next goes up; the change's
    summary carries it (`pushing.held`), and the card shows Push with that
    line, "Someone else pushed to PR #402". Commits going up on their own
    are no Push, but no Accept either: the card and the dock say "1 commit
    going up to the PR" until they're on it, so the pull request is never
    merged at the head before them, leaving them behind.
  - **Off, nothing changes from before:** every push but a fix for failing
    checks (ADR-070) is the person's. On, ADR-070's fix push gives way to
    this one, which takes the fix up with the rest.
  - The lead is told which holds in its brief, and `push_to_pull_request`
    says what it did.
- **Alternatives considered:**
  - **Push every commit as it is made.** A lead's turn is a unit of work;
    half of one on the pull request runs its checks on something the lead is
    still changing.
  - **Tell the person's commits by author.** A lead commits as the person,
    with their git name; only where the pull request's branch stands says
    who pushed.
  - **Read the remote each time a card is drawn.** A network call per card;
    the hold is decided when the push is, and kept.
  - **An app-wide default.** The similar switches (resolve conflicts, move
    issues) are per project; one more place to look for one switch.
- **Trade-off:** commits the person made in the task's own folder and never
  pushed go up with the lead's, since Althar can't tell them apart there.
  The first launch with this pushes what open tasks' leads had left waiting.
  A lead whose turn ends mid-thought pushes what it committed so far.
- **Revisit when:** the person wants to look before some pushes but not
  others, by task or by kind of change; or a lead's commits can be told from
  the person's own.
