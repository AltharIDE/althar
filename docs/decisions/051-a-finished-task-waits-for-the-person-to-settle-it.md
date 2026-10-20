# ADR-051: A finished task that isn't a change waits in Needs you until the person settles it

- **Status:** Accepted
- **Date:** 2026-10-19
- **Amended:** 2026-10-20: in the task's header, Done and the pin sit
  inside the chip that says where it stands, in its violet, as its
  segments, not in ink beside it: one coloured thing in the bar, holding
  what you do about it.
- **Owner:** Repository maintainers
- **Context:** A quick task, a prototype, a spike or a chat-like task
  ([ADR-035](035-a-task-s-kind-is-read-from-what-it-has.md)) finished as
  `Finished`, out of Needs you, and opening its screen settled it as Done on
  the spot (`SeeTask`). The person found that opening one moved it without
  asking, often before they had looked at what it made; and that writing to
  it again ([ADR-034](034-a-task-goes-back-to-work-and-ships-again.md)) sent
  it back to Running and then straight to Settled when the round made
  nothing new, so they never saw that the new round had finished. They want
  settling to be explicit: only they move a finished task on.
- **Decision:**
  - **Opening a task moves nothing.** `SeeTask` keeps when it was seen.
  - **A finished task that isn't a change is in Needs you**, counted as any
    task ready, on the board, the home, the edge, the tabs and the
    notifications: `needsYou` (`shared/calls.ts`) is every ready task again.
  - **Two ways on, beside where it stands:** in its card's corner, as a
    check and a pin shown as the card is hovered or has the focus, and in its
    task's header, inside the chip that says where it stands, in its violet:
    Done in words, then the pin, with no step bar once it finished. **Done** settles it (`MarkTaskDone`, `task.done` with
    `marked: true`) and stops what its agents left running, such as a page,
    first: one that won't stop leaves it unsettled, said so, to try again;
    **Keep for later** takes it out of Needs you as it is (`KeepTaskForLater`,
    `tasks.kept_at`, the phase `kept`). While something is kept, Settled's
    head names both, Settled and Kept with their counts, and pressing Kept
    shows what was kept in Settled's place, a line each, with Done on hover.
    A review with a draft only keeps: it settles as its draft is posted. A
    change keeps its own course.
  - **The rest is said to its lead**, which has `settle_task` (done, keep or
    discard) beside `make_it_a_change`, used only when the person says so.
    The task's composer suggests "Mark this as done" in grey; Tab takes it,
    Enter sends it.
  - **Another round ends in Needs you.** Writing to a kept task brings it
    back (`kept_at` cleared); a round on a settled one that makes nothing
    new no longer puts it back in Settled: only a merged change goes back to
    done. A review posted has no round: writing to it opens it again, and
    what its lead does next waits in Needs you, a draft to post, or, with
    none, Finished, with Done and Keep for later as a quick task's.
- **Alternatives considered:**
  - Keeping settle-on-open and adding a way back: it still moves work the
    person hasn't looked at, and a round's end stays invisible.
  - Kept for later on top of Settled, or in a panel over it (the prototype's
    other two places): the tab leaves Settled as it was and shows only when
    something is kept.
  - A keyword in what the person writes, as the prototype faked: a tool
    leaves it to the lead to understand them, and says what it did.
- **Trade-off:** Needs you holds more: each finished prototype or question
  waits there until it is settled or kept. Keep for later is the way to
  clear it without settling.
- **Revisit when:** finished tasks pile up in Needs you because people
  don't settle them, or a review's draft wants Done of its own.
