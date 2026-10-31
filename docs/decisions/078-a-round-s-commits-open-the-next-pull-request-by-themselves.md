# ADR-078: A round's commits after a merged or closed pull request open the next one by themselves

- **Status:** Accepted
- **Date:** 2026-10-31
- **Supersedes:** in part, [ADR-034](034-a-task-goes-back-to-work-and-ships-again.md) (a round never publishes by itself)
- **Amends:** [ADR-072](072-a-lead-s-commits-push-as-its-turn-ends.md)
- **Owner:** Repository maintainers
- **Context:** A task goes back to work whenever its lead does (ADR-034).
  A round that ended with commits after its last pull request merged or
  closed didn't publish them: its card went to Needs you as "Ready for a new
  pull request", and its only button opened one. ADR-034 chose that on
  purpose: a second pull request on a merged task is a bigger step than the
  first, the person could still leave the commits out or abandon the task
  before anything went to the host, and a round can be a question whose
  commits are incidental. It was to be revisited "once people want it".
  DEV-173 asks that a card be in Needs you only when the person has a real
  decision to make, never just to press a button Althar could have pressed.
  Shown those reasons, the person chose on 31 October 2026 that Althar opens
  the next pull request by itself.
- **Decision:**
  - **A round of work that ends with commits after its task's last pull
    request merged or closed opens the next by itself,** as a plan's ending
    opens the first (`Runs.conclude`, then `Runs.publish`): a draft, on a new
    branch, made as ADR-034 says (cherry-picked after a merge, renamed after a
    close), described from what came after the last one. In a task of
    several repositories, each with commits and no open pull request opens
    its own, a repository's first among them, as the task's Open does.
  - **Only where the project's rules would have opened the first:** the
    task has had a pull request, and its project's ending (`Changes.endFor`)
    opens one, as a draft or ready. A project that leaves work on its
    branch, or on no host Althar knows, stays as it was, and so does a task
    that never had one. A quick task's round isn't for a pull request,
    unless the person had it made a change.
  - **It opens apart from the round's end,** since publishing takes the
    task's lock, which what ends a round may hold. Where it can't, such as
    the default branch not fetched or the host refusing the push, the
    thread says "What the follow-up committed isn't in a pull request yet."
    and the card offers **Open a new pull request**, as before.
  - **What stays the person's** is the pull request once it is open: to
    merge, to close, or to take back through the task's menu, where
    **Abandon** leaves the commits out (`leaveOut`) as ADR-034 says. Commits
    for an open pull request go up as its lead's turn ends (ADR-072), not
    by this.
- **Alternatives considered:**
  - **Keep offering it (ADR-034).** Every such round ended in Needs you
    with one button the person pressed each time.
  - **Push the branch, and leave the pull request to the person.** Half a
    step: the card would still wait on them for one press.
  - **Open it ready rather than as a draft.** The first pull request opens
    as the project says; the next one is new to whoever reviews it, so it
    opens as a draft, as ADR-034's Open did.
- **Trade-off:** commits a round made in passing, such as while answering a
  question, go to the host as a draft pull request before the person has
  seen them, and leaving them out now means closing it on the host as well
  as Abandon in the task.
- **Revisit when:** the person closes many of these drafts unmerged, or
  wants to look before some rounds publish but not others.
