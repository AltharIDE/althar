# ADR-090: Conflicts and failed checks send a task back to work, unless the person turned it off or stopped it

- **Status:** Accepted
- **Date:** 2026-11-03
- **Amends:** [ADR-030](030-the-lead-resolves-conflicts-and-althar-pushes-the-merge.md),
  [ADR-070](070-failing-checks-go-to-the-lead-whoever-has-looked.md)
- **Owner:** Repository maintainers
- **Context:** PR #563 sat in Needs you as "Not ready to accept",
  "Conflicts with main · 4 checks failed", with Ask the lead to resolve it
  and no reason. Its project resolved conflicts, and its lead had resolved
  one: Althar pushed the merge at 21:02:55 and waited for the checks on it.
  Main moved on 16 seconds later and conflicted again, but a round waiting
  for its merge's checks counted as under way, so the new conflict wasn't
  asked. The board counted that wait as nothing under way, so the host's
  conflict and the four checks that had already failed, others still
  running, put the card in front of the person. The quick task it started
  as wasn't the cause: the task said nothing of conflicts, so it went by
  the project's rules (on), and its pull request was listened to. The person
  expects either reason to put a task back to work on its own.
- **Decision:**
  - **On unless the person turns it off.** "Resolve merge conflicts
    automatically" is on for a project whose rules don't say. A project or
    task that turned it off stays off.
  - **A round waiting for its merge's checks doesn't hide a new conflict.**
    It is under way while the branch it merged stays as it was. Once that
    branch moved on and conflicts again, the round is over and the new
    conflict is a round of its own, asked at once. While it waits, the card
    is under way, on the checks running.
  - **One ask for both.** A conflict found as the checks fail, or after they
    failed while they are still the lead's (ADR-070), is asked with them:
    which failed and the ends of their logs, to fix in the one commit on top
    of the merge that Althar pushes with it. While the pull request
    conflicts, Althar doesn't run the failed checks again first, since the
    merge's checks run anew. While a round is under way, failed checks
    aren't told to the lead apart from it.
  - **Checks still running with some failed are under way** where failures
    go to the lead once they end. They are the person's only once its tries
    are spent.
  - **Flaky failures on a round's merge are run again once** before the lead
    is asked to fix them, as other failed checks are. The round reads the
    checks as the pull request's look did, so the two never disagree.
  - **Limits.** A round asks the lead twice at most (ATTEMPTS). A change's
    tries at its checks count across rounds (FIX_ROUNDS), so a check that
    keeps failing as main keeps moving doesn't go round again. A round that
    gives up hands the checks to the person, so the same failure heard again
    wakes no one, and the card says why.
  - **Waiting on the person always says why.** Turned off, a conflict the
    host reports says "“Resolve merge conflicts automatically” is off for
    this task" or "… in the project's settings", beside Resolve now. Failed
    checks on a task the person stopped say so. A task the person stopped
    stays stopped.
- **Alternatives considered:**
  - **Keep it off by default** and say on the card that it is off. The
    person said both reasons should send the task back by themselves, so
    the card would only explain a default they don't want.
  - **Let failed checks wake the lead mid-round.** That makes two asks where
    there should be one, and the lead's fix would sit on top of a merge
    Althar then won't push.
- **Trade-off:** a project that never chose now has its leads resolve
  conflicts and Althar push the merge. Its settings show the switch on, and
  turning it off holds.
- **Revisit when:** a team's default branch moves so often that rounds
  overtake each other before their checks end.
