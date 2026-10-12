# ADR-031: Althar hands the coordinator to a fresh session before its context fills, and keeps the project's notes

- **Status:** Accepted
- **Date:** 2026-10-11
- **Owner:** Repository maintainers
- **Context:** The coordinator is one long conversation (ADR-004). Its
  agent's context fills, and the agent then compacts it by itself, at a
  moment of its choosing, mid-reply even, into a summary of its own. What
  the person decided only in conversation, such as "issue drafts need an
  approval card, on every tracker", may not survive that summary, and
  nothing in the code says it. Althar already knows how full the
  coordinator's context is (the composer's context ring, from ACP's usage
  updates), and already starts sessions from a brief (ADR-005).
- **Decision:**
  - **Althar hands the coordinator over itself.** Once its agent says its
    context is 80% full (`HANDOVER_AT`), Althar starts a fresh session on
    the same agent, account, model and effort, and stops the old one as
    superseded by it. A session can only say so in a turn or between turns;
    either way the handover starts between turns, never in one. The old
    session takes no more turns once it starts, and what the person says
    meanwhile waits for the fresh one.
  - **The fresh session is briefed from Althar's records, not the raw
    thread:** the coordinator's role and tools as every session of it has
    them; a line that it took over, and to read earlier details through
    `read_thread`, `read_task` or the code rather than guess; the project
    as `project_overview` gives it; the project's notes; every open task,
    none left out, with where it stands, who leads it, and what waits on the
    person (a call, a question its lead asked, an open pull request with
    commits they haven't pushed, a change to look over), the newest 25 also
    with their plan and what their lead last reported; and the
    conversation's last twelve messages, word for word. Each part is
    bounded. Older conversation is read through `read_thread`, which without
    a task reads the coordinator's own conversation, a part at a time, back
    to its start; a message longer than a part comes in parts too.
  - **The person sees a quiet line** in the coordinator's thread ("Started
    a fresh session; picked up 3 open tasks.") and the whole conversation
    stays theirs to scroll: the thread is Althar's record, not the
    session's.
  - **Nothing Althar owns moves:** a plan in its countdown, a held plan, a
    draft and a running task belong to Althar, not to the coordinator's
    session, and carry on as they were. What became of them since the old
    session's last turn is the fresh one's news, as for any turn.
  - **A handover that fails leaves the old session carrying on,** its agent
    compacting by itself as before, and isn't tried again for that session.
    So does one whose brief would take 40% or more of a fresh session's
    context (`FRESH_ROOM`, judged at about four characters a token): that
    session would be due again at once, and the one after it.
  - **A project keeps notes:** short decisions the person made in
    conversation that the code doesn't show, a sentence each, at most 40.
    The coordinator keeps, lists and drops them with its tools (`keep_note`,
    `list_notes`, `drop_note`), and its brief tells it to keep one when the
    person decides something like that. Every brief of the coordinator holds
    them, a fresh one's or not, and so does `project_overview`. The person
    sees them in the project's settings, and drops one that no longer holds.
    Each is a row with its record (`project_note.kept`, `.dropped`); a
    dropped one keeps its row.
- **Alternatives considered:**
  - **Leaving it to the agent's compaction.** What happens now: at the
    agent's moment, by the agent's summary.
  - **A summary written by a model at the handover** (ADR-005's generated
    handoff; docs/architecture/04's compaction seam). It costs a model call
    and loses what the model leaves out; the records already say where the
    work stands, and the notes keep what they can't.
  - **The whole thread, as far as it fits,** as a switch of agent does. The
    point of the handover is a context with room in it.
  - **Notes kept as files in the repository,** such as `CLAUDE.md`. That
    changes the person's repository (ADR-005), and a lead would read them
    too.
- **Trade-off:**
  - **The fresh session doesn't remember the conversation, only its last
    messages:** an earlier detail the notes don't keep is read with
    `read_thread`, which the brief says to do, or missed.
  - **The threshold is a guess:** an agent that compacts below 80% does so
    first, as before. Agents that never say how full they are are never
    handed over, and nor is one whose brief would nearly fill it, as with a
    model of a small context and a project of many open tasks.
  - **Notes are as good as the coordinator's judgment of what is a
    decision;** the person can drop one, but not yet add or edit one.
- **Revisit when:**
  - Agents let a client set or turn off their own compaction.
  - Continuous compaction writes summaries as records
    (docs/architecture/04): the brief would hold them before its last
    messages.
  - People want to write or edit notes themselves.
