# ADR-037: A task keeps its place from its first step until its work comes back

- **Status:** Accepted
- **Date:** 2026-10-14
- **Owner:** Repository maintainers
- **Supersedes:** what [ADR-032](032-agents-at-once-on-this-machine.md)
  counts, an agent at work, and its follow-up, what is left running counts
  while it works. Its default, the person's own number and a wait kept in the
  store across a restart stay as they were.
- **Context:** ADR-032 counted agents, and every step and every turn asked
  for a place again: the step after another, a settle, an answer, a resume, a
  restart, a reset, each turn. Each ask was a moment where a task already
  under way could lose its place. On 14 October, with the number at 6 and
  twenty things waiting, a task's lead reported its step while it was still
  writing its last message. Its review asked for a place a second too early,
  found none, and went to the back of the queue, behind tasks queued an hour
  before. Six seconds later the lead's turn ended and its place went to
  another task: the board showed the task on its review, waiting. The same
  evening, five prototypes whose leads had finished showed in Running as
  "Waiting" for an hour, because a message the coordinator had passed on to
  each lead waited for a place, and a turn waiting counted as work under
  way. Nothing of theirs showed in Needs you. And a finished prototype's dev
  server that rebuilt while the person looked at it took a place of its own:
  the board said 7 busy on a Mac that runs 6.
- **Decision:**
  - **What counts is a task, not an agent.** A task takes a place when its
    run's first step starts, and keeps it until the run ends: ready, stopped,
    failed or abandoned. Its steps follow on in that place (implement,
    review, settle, publishing, the lead's turns between them), and none asks
    again. Its lead and its reviewer are one task, in one place.
  - **The place is read from the run, as the store has it.** A task is at
    work while its run is under way and none of its steps is held, while a
    conflict or check-fix round is asked of its lead, while one of its
    agents is starting, and while one of its agents is in a turn. Nothing
    else keeps a record of places, so there is nothing to fall out of step
    with the run, and a restart reads the same places back.
  - **Waiting on the person keeps the place.** A permission, a question, a
    step that needs the person: most are answered in seconds, and the
    answer then goes on at once instead of waiting behind other work.
  - **A step held for something outside the machine gives its place up:**
    an agent's usage limit until its reset, an agent that isn't there. When
    it can go on, it goes before tasks that haven't started.
  - **A round of work after the plan**
    ([ADR-034](034-a-task-goes-back-to-work-and-ships-again.md)) takes the
    place while its lead is in a turn or starting, and for its review and
    settle, but not between its lead's turns: then it is the person's move.
  - **What a task left running takes no place.** A server or a test run
    left running doesn't hold one once its run has ended, and Althar no
    longer reads the CPU of what agents left running.
  - **What waits starts in this order:** first what was at work when
    Althar stopped, so a restart doesn't change who is at work; then what
    the person did (a message of theirs to a task, their answer, a task they
    resumed); then the work of a task already under way (a step back from a
    usage limit, a conflict or check-fix round, a turn on a round of work);
    then the rest (a plan's first step, a message the coordinator passed
    on). In each group, what waited longest goes first. Nothing at work is
    stopped for it.
  - **What the person says to a lead while its turn runs follows on in its
    place.** Its next turn is on its way as the last ends, so the place
    isn't given to anything else in between.
  - **A follow-up waiting for a place doesn't move the task.** A task whose
    lead finished stays in Needs you, or in Done if it was done, and says
    its follow-up waits: "Follow-up waiting: 6 of 6 tasks at work on this
    Mac". It moves to Running when its lead starts on the follow-up.
  - **The setting is "Tasks at once".** It is the same number with the same
    default (ADR-032 already sized it per task: 2.5 cores and 3 GB each),
    and the words of a wait name tasks: "Waiting: 6 of 6 tasks at work on
    this Mac".
  - **Who holds the places** is the tasks at work, by title ("Held by …").
    Since nothing left running counts, there is no server to stop from
    there.
- **Alternatives considered:**
  - **Hand the place from each step to the next.** It fixes the review, but
    each of the seven asks still decides on its own terms, and a new kind
    of step adds an eighth.
  - **Keep counting agents, in order of when their task started.** It
    orders the queue, but a task between two steps still has no place for a
    moment, and whatever looks at the queue then takes it.
  - **A table of places, written as a task takes and gives one up.** A
    second record of what the run already says, to be kept in step at every
    end, stop and restart. It is what a weight per task or another machine
    would need first, and either can read the run as well.
  - **Give the place up while waiting on the person, and take it back
    first.** An answer given in five seconds would wait for a place to free.
  - **Keep counting what is left running while it works.** A prototype the
    person looks at rebuilds and takes a place, and leads now leave their
    prototypes' servers running for the person.
- **Trade-off:** A task whose question goes unanswered for an hour keeps its
  place for that hour; it shows in Needs you meanwhile. A test run a lead
  leaves running after its run ended takes no place, so the machine can be
  busier than the number says; the CPU and memory meter shows it. A step
  after another starts in its task's place even where the number was
  lowered meanwhile, as work already at work carries on.
- **Deferred:** a time after which a task waiting on the person gives its
  place up; a weight per task, so a heavy one counts as two; places on
  another machine; the person choosing what goes next.
- **Revisit when:** tasks waiting on the person often hold places that others
  wait for, or machines overload with the number unchanged, which says what
  is left running needs counting again.
