# ADR-054: A task's steps are a graph of its own face, in a lane for each agent, read from the runtime's runs

- **Status:** Accepted
- **Date:** 2026-10-20
- **Owner:** Repository maintainers
- **Context:** A task's header shows its plan's steps as a track of bars, and
  its thread tells the rest in rounds (ADR-042). Neither shows what a task
  went through: a review that found something and was settled and reviewed
  again, who did each step, a step waiting for a free agent or for the
  person, a follow-up after its pull request merged (ADR-034). Early
  prototype work had drawn a task's steps as a graph; the kit's `GraphStrip`,
  `GraphChanged` and `GraphProposal` came from it, but nothing in the app
  used them. A prototype drew the graph in today's app several ways (a strip
  in the header, a drawn view, a rail by the thread, a tiny graph on the
  board's card, several canvas layouts); the person picked a lane for each
  agent on a dotted canvas, with straight lines, markers where each round of
  work starts, and no composer under it.
- **Decision:**
  - **The runtime says what a task went through.** `ThreadSnapshot.task.graph`
    carries each run, the plan's and each follow-up's, with its steps in the
    order they ran: which step (implement, review, settle, publish), the
    how-manyth review, where its last try stands (done, running, waiting,
    held and why, failed, cancelled), the agent and model of that try, when
    it started and ended, and whether a change to the steps put it in; and
    what started a follow-up, the person's message or what the coordinator
    passed on. What is still to come is only what the plan has and hasn't
    started (its work, its first review, its pull request): a review's
    settling and the review after it start the moment the step before
    reports, so they show as they happen and are never guessed. It is read
    from the store's runs, nodes and tries (`graph.ts`, `Queries`), never
    stored; a graph that can't be read leaves the field out, not the thread.
    A run and a try at a step belong to their task's thread in the change
    feed, so the window reads the graph again as steps move.
  - **The window adds what the person cares about.** What each step came to
    is read from its report (findings, how many settled, the pull request and
    whether it merged), so the thread read now carries every step's report,
    not the lead's alone; the calls waiting on the person are put on the step
    they hold up, and a fourth review that needs their say is drawn where it
    would go (`features/task/graph.ts`).
  - **It is a face of its own, Graph (g), beside Conversation and Outputs,**
    offered once the task has rounds of work. The kit's `StepGraph` draws it:
    a lane for each agent and model, the lead's first and Althar's last, held
    at the left as the canvas pans; each step a card (number, mark, time,
    name, agent, what it came to) in the order the steps ran; straight lines
    turning at right angles between lanes; a marker where each round starts,
    saying who started it, with what was said on hover. It opens on all of
    the task where that is readable, else on the round at work; it follows
    new steps until the person moves it. A card opens its report in the
    kit's Popover; a stuck step's call, or the permissions waiting, are
    answered there. A marker, and a report's Show in the conversation, take
    the person to that place in the thread, reading earlier pages where it
    is further back.
- **Alternatives considered:**
  - *Reading the graph from the thread's items in the window.* The prototype
    did, matching notices' words and guessing a loop's next steps; it broke
    on every wording change and couldn't know who ran a step or what held
    it. Only the runtime has its runs.
  - *Every try its own card.* A restart or a hand to another agent is a try
    of the same step; drawing each made a stuck review look like several.
  - *A strip in the header, a rail by the thread, a graph on the board's
    card.* Each was too small to say who did what, or crowded what it sat
    beside; the board keeps its track.
  - *Conflicts and checks as steps.* They aren't nodes of the run's graph
    today; drawing them meant guessing from notices again. They wait for
    the runtime to model them.
- **Trade-off:** The thread read does a little more each time (a task's runs,
  steps and tries, at most a hundred runs, and up to two hundred reports).
  Steps of a run carry no notion of a conflict or of fixing checks, so those
  don't show in the graph yet. The early `GraphChanged` and `GraphProposal`
  stay unused: a change to the steps shows on the graph itself, dashed until
  its steps run.
- **Revisit when:** the runtime models conflicts and checks as steps, a
  workflow has steps other than its plan's, or tasks run so many rounds that
  the canvas needs to fold earlier ones.
