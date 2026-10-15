# ADR-042: Allow everything is one switch, for a project or a task

- **Status:** Accepted
- **Date:** 2026-10-15
- **Owner:** Repository maintainers
- **Context:** A project's rules ([ADR-013](013-project-rules.md)) said what
  happens to what no rule keeps in one of four modes, and "allow everything"
  was the fourth: an underlined word at the end of the last sentence, next
  to "allowed", "the coordinator decides" and "ask me". It wasn't one of
  them. It overrides what always asks and what goes ahead, not only the
  rest, and turning it off meant picking another mode, with nothing saying
  which one held before. Nor could the person allow everything on one task:
  a burst of prompts on a task they trust (seven in a row, in one thread)
  could only be cleared by allowing everything in the whole project, or by
  answering each. A card for a kind the project always asks about offered
  Never but no "always allow", and didn't say why. Five directions were
  prototyped side by side on the app's own screens, on this change's
  branch, and taken out once the person chose the one switch.
- **Decision:** allowing everything is a switch over the rules, for a
  project and for a task, apart from what the rest gets.
  - **The project's switch** is `allowEverything` in its rules, a new
    revision as any change is. The mode is what the rest gets again once
    it's off: `rules`, `coordinator` or `ask`. An earlier revision that says
    `allow` as its mode reads as the switch on, over `rules`; the first
    change after it writes it that way. On the Rules page the switch sits
    over the sentences; while it's on, Ask me, Go ahead and The rest say
    they are off, and stay as they were, to hold again once it's off.
  - **A task's switch** is its own column, `allow_everything`, off until the
    person turns it on from the task's menu, recorded as a fact on the task
    (`task.allow_everything_set`). The rules a task's requests are decided by
    are its project's, with everything allowed where either switch is on.
    The project's holds over the task's: while it is on, the task's switch
    shows on and can't be turned off there.
  - **Turned on, what waits is decided again**, as when the rules change:
    every call of the task (or the project) still waiting on the person goes
    ahead, short of what is never allowed. Turning it off changes only what
    comes next.
  - **What allow everything never allows holds:** what Never lists is still
    refused, and, while it lists anything, a command Althar can't read is
    refused too, so a Never can't be slipped past by writing it unreadably.
    No agent reads the person's credentials or reaches the code host except
    through Althar, whatever the switch says.
  - **It shows wherever the task does:** "Unrestricted" beside the task's
    menu in its header, with what it means on hover, and at the foot of its
    board card until it settles, up next included. The project's switch
    changing reads its board again and each of its tasks' heads, as no
    task's own change says so.
  - **A card the project always asks about says why it has no "always
    allow"**, and offers the ways out: allowing everything on this task, or
    the rules. The runtime already kept this as `held` on the call; it is
    read out now.
- **Alternatives considered:**
  - **The four modes as a segmented control, with a chip on the task to
    override them.** Clearer that a task can differ, but it asks the person
    to think in modes for what is nearly always one question: may it stop
    asking? A per-task "Ask me" or "The coordinator decides" was never asked
    for.
  - **Escalating from the card ("Yes, and stop asking on this task").**
    Comes at the moment of pain, and may come later on top of this switch;
    the switch is the one place it would set, so it comes first.
  - **Allowing everything for an hour, or until the task is ready.** Ends
    by itself, but adds a clock to reason about to every request; nothing
    has asked for it yet.
- **Trade-off:** "Unrestricted" is a word of its own for the state; the
  menu's switch says "Allow everything on this task". A task's switch lasts
  until the person turns it off, through follow-ups, as its other settings
  do. Reading the task's switch adds a query to each request decided and to
  each board card not settled.
- **Revisit when:** people want allowing everything to end by itself, or
  from the card; or a task needs a mode of its own other than allowing
  everything.
