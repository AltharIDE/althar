# ADR-059: A lost connection is waited out, and a failing service tried again, as a usage limit is held

- **Status:** Accepted
- **Date:** 2026-10-25
- **Owner:** Repository maintainers
- **Context:** A person's internet went off mid-step, and the task ended
  Stuck: "Claude Code stopped twice without saying whether the step is
  done, even after Althar reminded it", with no way to simply try again.
  A step's turn that ended without a report was reminded once and then
  needed the person, whatever ended it; the failure table said transient
  failures were "retried after a pause", and nothing did that. Recorded
  against an API host that wasn't there, couldn't be looked up, dropped
  the connection or failed (`provider-adapters/src/testing/recorded.ts`):
  Claude Code (claude-agent-acp 0.95) retries by itself for three minutes,
  then ends its turn `end_turn`, having used nothing, with the failure only
  on the prompt's response (`service`, action `retry`), which Althar didn't
  read, so the turn looked blank or unreported; Codex (codex-acp 2.2),
  offline, never ends its turn, and says every minute it waits for the
  network; OpenCode fails the prompt with "Cannot connect to API", which
  read as `unknown`. Nothing in the app knew whether the computer was
  online.
- **Decision:**
  - **A turn that failed on its connection or its service is not a missing
    report.** The adapter reads a failure off the prompt's response as
    well as off a `session_info_update`, and the texts the agents fail with
    when they can't connect are `transient`. Such a turn is never reminded
    and doesn't count toward `no_report`.
  - **The step is held as a usage limit holds one, not by a second
    mechanism.** Its attempt is `held`, for `agent_unavailable`, with the
    same record a usage limit keeps (who, until when, the account and
    model, and here whether it waits for the connection and how often its
    service failed), and the same loop brings it back, after a restart too.
    As a step held for a reset does, it gives up its place among the agents
    at work here, and asks for one again as the work of a task under way
    (ADR-037) when it carries on.
  - **Offline, it waits for the connection, however long that takes.** The
    desktop app's main process reads Electron's `net.isOnline()` and tells
    the runtime whenever it changes; the runtime also asks the agent's
    service (its API address, in the registry) whether it answers, with a
    light request, any answer at all. While either says no, the step says
    Waiting for the connection, and none of the wait counts. Once both say
    yes, its turn goes again in the session it was in, told quietly that its
    last turn stopped on the connection and to carry on; where that session
    went, it starts again as after a reset. An agent that says mid-turn it is
    reconnecting, while its service doesn't answer, has that turn stopped and
    the step held at once, rather than left to wait on a dead connection or to
    Althar's stall watch.
  - **Online, a failing service is tried again after a growing pause:** 15
    seconds, a minute, four minutes. A fourth failure in a row makes the step
    Stuck, `transient`, with the service's name and what it said
    ("Anthropic's service kept failing: …"). A turn that goes through starts
    the count again.
  - **While the computer is offline, no new work starts.** Nothing but what
    the person did takes a place it hasn't already: Up next, and the next
    step of a task, wait until the computer is back. One line in the
    window's bar says so for the whole app ("Offline: work picks up when
    you're back"), never a card per task.
  - **Every Stuck card can be tried again**, on the agent the step was on,
    in the session it was in; first, as the card's own button, where the
    connection or the session failed rather than the work. The coordinator's
    chat offers Try again under a last turn that ended in an error: a failed
    turn gives the person's words back to the queue, as a usage limit does,
    and Try again delivers them again.
- **Consequences:** A step survives a lost connection of any length, and a
  short outage of its service, without the person; a service that keeps
  failing comes to them once, saying so, with an easy way on. Usage-limit
  handling is unchanged. The agents' own retries come first: Claude Code's
  three minutes, Codex's five; Althar's pauses come after them. Where an agent
  names no service (OpenCode, which runs on the provider the person picks),
  only whether the computer is online counts. A captive portal or a proxy
  that answers for the service reads as reachable, and its failures are
  tried again as a failing service's are.
