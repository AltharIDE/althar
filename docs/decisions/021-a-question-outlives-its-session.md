# ADR-021: A question waits on the person, and outlives the agent that asked

- **Status:** Accepted
- **Date:** 2026-10-10
- **Owner:** Repository maintainers
- **Context:** Agents ask the person to choose (Claude Code's
  AskUserQuestion, Codex's request_user_input) through ACP form elicitation.
  Althar answered every question "cancel", so on long unattended runs an
  agent carried on as if the person had nothing to say (DEV-13). A question
  can wait for hours, longer than the agent's session may last: Althar can
  restart, the agent can exit, or the person can hand the thread to another
  agent while it waits.
- **Decision:**
  - A question becomes a call (an attention request of the kind `question`)
    and an item of its thread, where it is answered. The home, the edge and
    the board list it with what it asks.
  - It belongs to the thread, not the session. While the agent that asked
    waits, the answer goes back to it in its own fields. If the session has
    gone, the question stays open and a run's step waits on it; the answer is
    then told quietly, as a message from Althar, to the agent on the thread
    next, which is started for it.
  - It is withdrawn only when the agent takes it back, its turn is stopped,
    or its task is stopped or abandoned. A session ending doesn't withdraw it.
  - Only roles someone answers are offered a way to ask: the lead and the
    coordinator. The adapter advertises form elicitation only when the
    caller answers questions, so reviewers, permission judges and model
    probes are given none (Claude Code then turns AskUserQuestion off).
  - Details: [03](../architecture/03-agent-runtime-and-auth.md), Questions to
    the person.
- **Alternatives considered:**
  - Withdrawing a question when its session ends, as a permission request
    is: a restart or a crash would lose what the agent needed, and the step
    would need the person anyway, as a stuck call that no longer says what
    was asked.
  - Answering every question at once with "decline", telling the agent to
    decide for itself: autonomous, but it changes what the agent does
    without the person knowing, which is what the ticket set out to stop.
  - Letting reviewers ask: a review that waits on the person holds the task
    for what is the reviewer's own judgment.
- **Trade-off:** an answer told after the session went reaches a new
  session, which reads the thread from its brief rather than holding the
  tool call it made; what the agent meant to do with the answer it
  reconstructs from the thread.
- **Revisit when:** sessions can be loaded after a restart (the answer could
  then go back to the same session); Codex offers request_user_input outside
  Plan mode, or OpenCode forwards its questions over ACP; questions are
  answered from the home or the edge.
