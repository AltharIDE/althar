# ADR-022: What an agent leaves running is shown over the composer, and stops with its session

- **Status:** Accepted
- **Date:** 2026-10-10
- **Owner:** Repository maintainers
- **Context:** A lead starts things that outlive the tool call that started
  them: a dev server, a test watcher, a webhook forwarder. Althar didn't
  know they existed. They died with the agent's session, mostly, and the
  person had no way to see where one answered or to stop it. The task also
  listens to its pull request (ADR-011), and nothing on screen said so.
  What the agents report, as of claude-agent-acp 0.88, codex-acp 2.1.1 and
  OpenCode 1.18, tried with real sessions:
  - **Claude Code and Codex** report a command they sent to the background
    through the JetBrains AIR `asyncTasks` extension, to a client that asks:
    `async_task_spawned`, `async_task_progress` and
    `async_task_state_update`, stopped by the `_session/async_task/stop`
    request. Claude Code names one by what its tool call says it does, and
    gives the file its output goes to; Codex names it by its command, says
    it only after the turn, and streams its output on its tool call. Claude
    Code reports some other background work the same way; its background
    agents and monitors come another way.
  - **ACP's schema doesn't have these updates yet,** and the SDK drops what
    its schema doesn't know, before any handler.
  - **Neither says where a server answers.** Its output does, mostly.
  - **What one leaves running sits in a process group of its own,** so
    stopping the agent's group misses it; closing the session stops it, but
    nothing says so.
  - **OpenCode reports nothing** of the kind.
- **Decision:**
  - **Althar asks for them** (`asyncTasks` beside `sessionFailure` in its
    AIR capabilities) and takes these updates off the agent's stream before
    the SDK reads it, for the process and the in-process transport alike.
    Only commands are kept (`taskType: shell`).
  - **The session keeps them, in memory, not in the store.** They live as
    long as the session does: an entry has the command (its tool call's
    line, else what the agent calls it), what the agent calls it where that
    says more (Claude Code's description of the call: "Site dev server"),
    where it answers, when it started,
    and, once it ends by itself, its exit code where its output says.
    Stopped, by the person or the agent, it goes from the list; ended by
    itself, it stays, to say how, until the person clears it.
  - **Where one answers is read from two places,** whichever says first,
    for ten minutes, as long as Althar's own runs are watched. Its output:
    the first address on this machine it prints (Claude Code's file, or
    Codex's output on its tool call), read every half second, colours taken
    out. And its ports: every two seconds, the TCP ports its processes
    listen on, from `lsof` (`ss` where there is none) on macOS and Linux and
    `netstat` on Windows, with the processes' tree from `ps` or PowerShell.
    The processes are those holding the file its output goes to open where
    the agent gives one (Claude Code), whose tree is the command's own; a
    port another entry answers on is left to it. Where none does (Windows,
    Codex), the only tree is the agent's, shared by every command, so a port
    is taken only if it is the one new port since the turn the command began
    in started (read as the turn begins, and the prompt waits for it, so a server the
    turn starts is never in it; Codex reports one after the turn, by when a
    quiet server already listens) and no
    other command is still without an address; otherwise it is left unknown.
    An address from a port stands until the output says its own, which
    replaces it. A server that writes to a log file, holds its output back or
    starts slowly is found by its port, shown as `localhost:5173`, which the
    row opens.
  - **A row says what the command is and where it answers,** not the line
    that started it: its name and address first, the command at a glance
    (`vp dev`, ADR-044's last meaningful part, without `node_modules/.bin/`,
    `npx` or a flag that only names a file) and how long it has run under,
    the whole command on hover. What it printed is one click away
    (`ReadBackgroundOutput`).
  - **Closing a session stops each command it left running first,** then
    closes it, so nothing outlives the session it came from.
  - **Clients get them on the session summary, and as `Background` on the
    watch,** whole each time they change, as the context's fullness is. Stop
    (`StopBackground`) asks the agent to stop one; Clear
    (`ClearBackground`) takes one that ended off the list.
  - **The task shows them over its composer,** beside the pull requests it
    listens to: the kit's Running and Listening pills, each opening a list
    with Stop. Listening can be stopped too (`StopListening`): nothing said
    on that pull request after reaches the thread or the lead. Neither pill
    draws the eye: their dots stay still, and Listening's rings for a moment
    when something arrives.
  - **Althar declares that it shows notices** (`session.notices`), so what
    an agent says of itself, such as a command stopped, is a notice in the
    thread, not a line in the agent's words.
- **Alternatives considered:**
  - **A row per command in the store.** It would outlive the session that
    can stop it, and say something runs after a restart that killed it.
  - **Ports alone.** Output says more than a port does (a path, a host),
    and costs nothing; ports are the second source, for what it doesn't say.
  - **Waiting for ACP's schema to have these updates.** Nothing would show
    until it does.
- **Trade-off:**
  - **OpenCode's leads show nothing they leave running.**
  - **An address is found only in a server's first ten minutes,** and
    where only the agent's whole tree is known, several commands started
    together stay without an address from ports, until their output says it.
  - **Claude Code starts a turn of its own** when something it left running
    ends; that turn's work shows in the thread like any other.
- **Revisit when:**
  - ACP has background tasks in its schema, or OpenCode reports them.
  - Reading ports from the process tree shows wrong addresses, or costs
    more than a few `ps` and `lsof` calls every two seconds for ten minutes.
