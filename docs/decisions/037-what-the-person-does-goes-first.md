# ADR-037: What the person does goes first, a task keeps its place between its steps, and new work waits

- **Status:** Accepted
- **Date:** 2026-10-15
- **Owner:** Repository maintainers
- **Context:** [ADR-032](032-agents-at-once-on-this-machine.md) let a
  machine run a number of agents at once, and started what waited first
  come, first served. In use on 14 October that order worked against the
  person:
  - Two prototypes finished, and their places went at once to tasks the
    coordinator had queued. The person read one, said "carry on with this
    one", and their words waited behind that new work.
  - A review that followed its lead's step went to the back of the queue:
    the lead's place was freed, and anything already waiting took it first.
  - A lead that asked the person a question gave its place up at once, so
    an answer a minute later waited too.
  - Work that waits loses more than time. An agent's prompt cache lasts
    minutes, so a lead that waits behind new work reads its whole context
    again when it goes on: about 6% of that day's tokens.
  The machine is still what the number protects, but the order decides
  whose work waits, and it should be the work nobody is looking at yet.
- **Decision:**
  - **What waits stands in one of three orders** (`Order` in Busy.ts), and
    within each, what waited longest goes first:
    1. **What the person did:** their answer to a question or a stuck step,
       what they say to an agent (their words, by their author), an agent
       they start or switch to, a task they resume. **It never waits:** it
       starts though every place is taken, and the machine runs one over
       for as long as it takes. New work then waits until it is back under
       the number. The person can only act so fast, so this can't run away.
    2. **The work of a task already under way:** the step after another, a
       step carried on after a restart or back from a usage limit, a
       conflict or check round, what Althar tells an agent (a check that
       failed, a nudge to carry on).
    3. **New work:** a plan's first step, as the coordinator files it or
       the person starts it.
  - **A task keeps its place between its own steps.** A step after another
    on the same task (the review after the lead's step, the lead settling
    after a review, a follow-up's review) takes the place of the agent
    before it, ahead of whatever waits, whatever that agent left running:
    its servers go on in the task's one place (ADR-032's follow-up of 21
    October). Any work of a task kept only by what it left running starts
    in that place too. Work of a task that has to wait while another of its
    agents is at work has the task's place first once it frees.
  - **What the person said to an agent, still to be delivered, counts as
    its next turn on its way:** the place isn't given to anything else in
    the moment between one turn and the next.
  - **An agent waiting on the person keeps its place for five minutes**
    (`askGrace`), on a question or a permission, so an answer soon goes on
    where it was, while its cache is warm. Past that, it takes none, unless
    what it left running is at work, as ADR-032 has it.
  - **Unchanged from ADR-032:** what counts as an agent at work, the
    number and its default, a step held for a usage limit giving its place
    up, and what an agent left running counting only while it works.
- **Alternatives considered:**
  - **A task holds one place from its first step until its work comes back
    to the person, and keeps it while it waits on them, however long.**
    Tried in PR #171 and closed: four tasks waiting on unanswered questions
    would hold every place while the machine sat idle, which is the
    rigidity the person asked to be rid of.
  - **Hold a finished task's place for a while in case the person answers
    it.** A machine left idle on a guess; "the person goes first" does the
    same without holding anything.
  - **Stop new work to make room for what the person did.** An agent can't
    be paused mid-turn without losing the turn; running one over for a
    while costs less.
  - **Weights by kind** (a prototype counts half). A task's kind is what
    the person wants it to end in, not how much it loads the machine
    ([ADR-035](035-a-task-s-kind-is-read-from-what-it-has.md)).
- **Trade-off:** the number is now a limit on what Althar starts by itself,
  not a hard ceiling: the person's own actions can take the machine past it
  for a while, and the cards say so ("4 of 4 agents busy, and 1 more"). Five
  minutes of a place held for a question the person may not answer soon is
  five minutes another task waits.
- **Revisit when:** heavy commands take turns instead of whole agents (the
  next step for the number), or people often end up far over the number by
  their own actions.
