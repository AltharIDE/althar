# ADR-086: The coordinator moves a task on when the person's message asks, and asks on a card otherwise

- **Status:** Accepted; partly superseded by [ADR-097](097-agents-work-as-the-person-s-own-and-only-what-can-t-be-undone-asks.md) (2026-11-06):
  stopping, holding, restarting, settling and discarding a task go at once
  in any turn, for the coordinator and for leads, with the lines in both
  threads; resuming or turning on an automation stays on the person's word
- **Date:** 2026-11-03
- **Amends:** [ADR-048](048-where-the-runtime-runs-and-who-may-reach-it.md),
  [ADR-081](081-the-coordinator-acts-on-the-code-host-as-the-person-s-account-can.md)
- **Owner:** Repository maintainers
- **Context:** The coordinator couldn't stop, hold, restart or settle a task
  (DEV-184). Asked "stop the review task" or "that's done, settle it", it
  could only say which button to press. Starting a task from the head of a
  pull request it attaches to waited for a second yes, though the task's own
  commits are kept on top. Resuming an automation or running it now was a
  card even when the person had just asked for it in words.

  ADR-048 took the person's word only from a press in the window. ADR-081
  widened that to their message, for what can't be undone, in the turn the
  message started (`byPerson`, the person's message ids, from the window or a
  paired device; never news, a lead, or the local socket), and #500 built
  it. ADR-081's build listed these task actions as things that can be undone,
  done whenever the coordinator judged, with only discarding asked-for.
- **Decision:**
  - **Four tools, each the person's own button:** `stop_task` (Stop, or with
    `turn` only the lead's current turn, as Interrupt), `hold_task` (Hold, on
    a plan counting down), `restart_task` (Start for a held plan, Resume for a
    stopped task, Reopen for a discarded one), and `settle_task` (done, keep
    for later, discard). Each goes through the same services the person's
    buttons do (`Tasks`, `Plans`, `Changes.leadStopped`), so what applies
    where a task stands is decided once (`actionsOf`), and a move that no
    longer applies does nothing and says so, as a second press does.
  - **All four go on the person's word, not only discarding.** In a turn the
    person's own message started, each acts at once. In any other turn, a
    card in the coordinator's thread asks: one button that does it as the
    person's press, and Not now. The coordinator gives why, in a line, on it.
    Stopping or settling a task changes the person's own course of work:
    what news, a pull request or a lead says shouldn't move it, and the card
    costs one press where it would. Superseded by ADR-097: each can be
    undone, so each goes at once, with the lines below.
  - **The same for resuming an automation, running one now, and starting an
    attached task from its pull request's head:** at once in a turn the
    person's message started; otherwise as before (the automation's card, or
    `start_from_head` once they agree).
  - **Each action says so in a line in two threads,** the coordinator's and
    the task's, with the person's words quoted: "Stopped “Review the
    importer”, as you asked: “Stop the review task”". A card pressed says so
    in the task's thread, and the card folds to what became of it. The
    coordinator hears the answer to its card at its next turn.
  - **Discarding deletes nothing.** It abandons the task: its plan is
    declined, its calls withdrawn, its agents stop, and its worktree and
    branch stay. Its folder goes only as ADR-056's cleanup lets it, which
    keeps the last commit under `refs/althar/kept/…` and holds back anything
    uncommitted or pushed nowhere. A merged task with commits after its pull
    request leaves those out, as its menu's Abandon does. `restart_task`
    reopens it.
  - **Done and keep for later are for a task that isn't a change,** as the
    lead's own `settle_task` has it: a change is done when its pull request
    merges, which stays the merge tools'; it can be discarded.
- **Alternatives considered:**
  - **Acting from any turn, as ADR-081's build had it, since each can be
    undone:** a closed pull request or a lead's words could stop or discard
    the person's work while they were away. Undoing it means noticing first.
  - **A card for every ask, as ADR-048 stood:** the person chose on 31
    October that their message is their word; a second press for "stop it"
    is what DEV-184 set out to remove.
  - **Routing the actions through `Errands.execute` and its receipts:** those
    serve writes to a host whose answer can be lost. A task action is a local
    write whose outcome is read back at once, and a second one is idempotent
    by `actionsOf`; a receipt keyed on the target and request would also have
    taken a later "stop it again" as the first.
- **Trade-off:**
  - An errand kept for later ("settle it once it merges") can't take these
    steps by itself: when its news arrives, that turn isn't the person's, so
    the coordinator asks on a card. The person still presses once.
  - As ADR-081 accepted, in a turn the person started, text the coordinator
    reads there could steer it to another task than the one they meant. The
    lines in both threads are where they see it, and each move can be undone.
- **Revisit when:**
  - Errands should carry a task's steps through without a card: the tools
    would take an errand's recorded step as their authority too.
  - A change can be kept for later.
