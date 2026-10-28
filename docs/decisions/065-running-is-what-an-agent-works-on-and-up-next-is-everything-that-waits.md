# ADR-065: Running is what an agent works on now, and Up next is everything that waits, in the order it goes on

- **Status:** Accepted
- **Date:** 2026-10-27
- **Owner:** Repository maintainers
- **Context:** [ADR-049](049-the-line-up-next-is-in-the-person-s-order.md)
  put a task in Up next only while no turn of its agents had reached a
  place; one an agent had worked on, whose next turn waited, stayed in
  Running. On a busy machine that read wrong: a board said "Running 11",
  and its top cards were "Waiting · 6 of 6 agents busy on this Mac" (a
  follow-up round waiting to start, a fix waiting on its Implement), above
  the work that was under way. The person asked for a waiting task to move
  to Up next, or at the least for waiting to sort to the bottom.
- **Decision:**
  - **Running is work under way that isn't waiting:** an agent of the task
    at work (in a turn, starting, on its step), or its checks Althar sees
    through ([ADR-040](040-a-change-reaches-the-person-green.md)). **Its
    count counts only those.** A stopped task stays at its foot, saying so,
    and isn't counted: nothing waits for it to go on but the person.
  - **Up next is everything that goes on by itself without an agent at
    work now, in the order it will:**
    1. **What continues:** a task already under way whose next work waits
       for a place, none of its agents at work (Busy's `line` lists them as
       `continuing`, ahead of the line, in ADR-037's order, which they
       keep). Its row says it continues and what ("Continues · Follow-up",
       "Continues · Review") and why it waits ("6 of 6 agents busy on this
       Mac"). A task with one agent at work and another's turn waiting is
       running.
    2. **The line**, as ADR-049 has it: new work, in the person's order,
       draggable, with Back to oldest first. A row's place counts what
       continues ahead of it ("3rd in line").
    3. **What is paused:** a step held for a usage limit or for the
       connection ([ADR-060](060-a-lost-connection-is-waited-out-and-a-failing-service-tried-again.md)),
       none of its agents in a turn, under a divider of its own, saying what
       it waits for ("Codex is out of usage until 13:40", "Waiting for the
       connection"). It waits for a time or the network, not a place, so it
       comes after what does: once it can go on, it asks for a place as
       work under way, and continues first.
    4. Plans on their countdown, then those held, as before.
  - **What continues isn't dragged.** Its order is ADR-037's, by when each
    began waiting: its agent's cache is warm and its work half done, and the
    person's own order is for new work. Letting it be dragged among the
    line would put work under way behind new work; among itself, it would
    need a second order kept on the task for a wait that usually lasts
    minutes. The person who wants one first says so to its agent, which
    goes at once, as anything the person does (ADR-037).
  - **Cards say a task continues (`continues`) and its place in Up next
    (`place`)**, counting what continues first, then the line; a task's view
    says whether it can go first in its line (`front`), which is when it
    offers to.
  - **Nothing moves under the person.** While the pointer is in Up next or
    Running, or a row of the line is dragged, a task that would move between
    the two stays in the lane it was in, saying what it does now, and moves
    once the pointer leaves. The board has no move animation; a card arrives
    in its new lane in place. (Amended by ADR-069: it travels there.)
  - **The task's dock names it Up next, and the home and the task's header
    already said Waiting or Paused**, not running; the home counts only what
    is moving.
- **Alternatives considered:**
  - **Leave them in Running and sort waiting to its foot.** The person's
    fallback; Running's count would still count work that isn't running.
  - **One Up next order across what continues and the line, all draggable.**
    The person could put new work ahead of half-done work, which ADR-037
    exists to stop.
  - **Paused work in Running, or among what continues.** It isn't running,
    and it has no place in the order of what waits for a place.
- **Trade-off:** a task can move between Running and Up next several times
  in a round of work, as places free and fill: a follow-up round whose turns
  wait between steps shows up next each time. Holding it while the person
  points at the board keeps that from moving a card they reach for.
- **Supersedes:** ADR-049's "a task an agent has worked on, whose next turn
  waits, stays under way, in Running". The rest of ADR-049 stands.
- **Revisit when:** waits between a task's own turns are often short enough
  that the move reads as flicker; then a task might stay in Running for a
  grace period before it moves.
