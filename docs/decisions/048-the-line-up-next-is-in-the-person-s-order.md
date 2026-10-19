# ADR-048: The line up next is every task no agent has worked on yet, in the person's order

- **Status:** Accepted
- **Date:** 2026-10-19
- **Owner:** Repository maintainers
- **Context:** PR #192 moved a task waiting for a free agent from Running to
  Up next, but only a plan whose first step, Implement, waited to start. A
  review of someone else's pull request has no plan: its lead starts at
  once, and its first turn waits for a place, as what Althar tells an agent
  does. So six reviews waiting for an agent sat in Running with no agent on
  them, and, ranked as work under way
  ([ADR-037](037-what-the-person-does-goes-first.md)), they went ahead of
  every plan that had waited longer. And the order of what waits was always
  the oldest first, though the person had picked, in the prototype "Tasks
  waiting for a free agent", a line they reorder by dragging.
- **Decision:**
  - **A task is in its project's line while it waits for a place and no
    turn of any of its agents has reached one** (no turn delivered on its
    threads), whatever its kind: a plan's first step, a quick task's, a
    review's lead's first turn, one a restart stopped before it began. It
    is up next on the board, not running. A task an agent has worked on,
    whose next turn waits, stays under way, in Running.
  - **The line is new work** (ADR-037's third order), however its wait
    began: a review's first turn waits behind work under way, as a plan
    does, not ahead of it.
  - **The person puts the line in their order** (`MoveInLine`: a task to a
    place, from 0 the front). Each task in the line takes one of the times
    the line stood at, in its new order, kept on the task (`line_at`), and
    the line sorts by that time rather than since when each waits. So the
    order survives a restart, a task that joins later, waiting since later,
    goes to its end, and the line keeps its place among other projects'
    work. `LineOldestFirst` clears them. A task's time is cleared as it
    starts.
  - **Cards say a task is in the line (`inLine`), its place there, and
    whether the line is in the person's order (`reordered`)**, which is when
    the board offers Back to oldest first.
- **Alternatives considered:**
  - **A place number per task.** A task that joins later would need one
    past every other, and two projects' lines would interleave by
    accident; times sort with since when everything else waits.
  - **Keep the line in memory.** Lost at every restart, which the person
    would read as Althar ignoring what they said.
  - **One line for the whole machine.** The board shows a project's work;
    the person orders what they see.
- **Trade-off:** a project's line is ordered among its own tasks only: a
  task the person puts first in one project still starts after another
  project's task that stood before the whole line.
- **Revisit when:** the person wants to order work across projects, from
  the home.
