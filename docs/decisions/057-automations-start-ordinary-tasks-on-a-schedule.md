# ADR-057: Automations start ordinary tasks on a schedule, on this computer

- **Status:** Accepted
- **Date:** 2026-10-21
- **Owner:** Repository maintainers
- **Context:** The person wants work that Althar starts by itself, instead of
  asking each time: a morning review of the new pull requests, release notes
  every Friday, a nightly dependency bump, a weekly polish pass. Claude Code's
  desktop tasks and routines, Codex, Cursor, Orca and Superset all have this;
  the ways they go wrong are known (a run marked done when it was only
  dispatched, eight missed runs replayed at once, a run cancelled by the
  next, an agent-made schedule spending a month's allowance in a day). The
  design was prototyped on the app's own screens and picked by the person
  (an Automations tab of cards, each automation on its own page, one card in
  the coordinator's conversation and on the page), and the build plan
  (`docs/plans/automations.md`) took the calls the person made and those the
  other tools agree on.
- **Decision:** an automation is a kept request and a schedule; each time it
  fires, Althar keeps an occurrence and starts an ordinary task for it.
  - **Three records, three lifetimes.** The automation is the person's, on
    the computer it was made on (`automations`: where it stands, the definition it
    runs, when it was turned on, whether its reviews post themselves). Its
    definitions are kept, one for every change, never changed after
    (`automation_definitions`). An occurrence is one time it was due, run or
    not (`automation_occurrences`), unique for its slot and subject in the
    store, so a day's 9:00 runs once however often the clock is read; it
    names its task in the transaction that makes the task, so a restart in
    between never makes a second.
  - **A slot is a local time,** read in the computer's zone of the moment, with a
    time daylight saving skips run an hour later and one it repeats run the
    first time (`slots.ts`). Never more often than once an hour. Each
    automation starts a fixed few minutes after its time, from its id.
  - **The clock is the runtime's,** while Althar runs, windows or not: it
    looks every 30 seconds and whenever an automation changes. A slot the
    computer slept through, or Althar was closed for, runs once when it is back,
    if it is still within half the time to the next slot (at most 12 hours),
    after a moment to settle; one past that is missed, and says so; never
    every slot it missed. Its lead is told when it was due and when it is.
  - **What a run does is fixed when it fires,** never asked of the
    coordinator: a task from its prompt, its plan held then started (a report
    on this computer, or a draft or ready pull request), or a review of each pull
    request opened by anyone but the person that no task reviews yet, a few
    a run, oldest first, one review task each. A listing that has more is
    read on from its last, a few listings deep; a run that couldn't read a
    repository to its end says so, in its history beside the reviews it
    started. A review is over once drafted, or once its lead has gone
    without drafting one: stopped or ended, or its last turn failed or
    stopped from the composer with nothing since for as long as the run
    may work.
  - **It waits its turn and keeps small.** A run's work waits after
    everything else for a place among the agents at work, every step of it,
    and only one automation's task is at work at once (`Busy.ts`). It is
    skipped, and says why, while its last run still goes, while every
    automation is paused, with five of its pull requests open, past 24 runs
    a day, or where none of its agent's accounts is on a plan, as the
    agent's own status says: per use, or where it can't tell (plans only,
    until cost is counted). Every session of a run is held to the same
    wherever it starts (`Limits.pick`), so a usage limit moves it to another
    agent on a plan, never to an account paid per use. A run starts one at
    a time, its limits checked and its occurrence kept together, so a slot
    and Run now never both pass. It works at most its minutes, counted over
    its turns, and is stopped past them. Three failures in a row pause it,
    saying why.
  - **With nobody there, it goes ahead.** Its task allows everything where
    its automation says (on by default), and pushing to the default branch
    is never allowed, which allowing everything doesn't go past
    (`runRules`); a review's lead still only reads. What it posts is signed
    with its name ("From Althar's morning review, by Claude Code"), the
    pull requests it opens too. Its first review waits for the person, whose
    "Post this automation's reviews from now on" lets the next ones post; a
    pull request from outside the team always waits.
  - **The coordinator writes them, the person turns them on.** Its tools
    propose one and change one, each on a card in its thread; a change that
    reaches further than before (anything but a shorter time) needs the
    person to turn it on again, and the card has Undo. It pauses one in
    words; resuming and running one now go on a small card the person
    presses, since both spend their plan. Leads have none of these tools.
- **Alternatives considered:**
  - **The coordinator told it's time, deciding what to do.** Judgement at
    each fire, but a coordinator turn every time, nothing to do or not; a
    coordinator that can't start misses everything quietly; and a machine's
    message lands in the person's conversation every morning.
  - **A daemon that outlives Quit, or waking the computer to run.** Runs after
    Quit or while asleep, but at the cost of a second process and its
    upgrades, or a root helper, for a laptop that still won't wake with its
    lid shut. Open at login, in the background, covers a restart.
  - **Files in the repository, as GitHub Actions keeps them.** Shareable,
    but each would fire on every teammate's computer, spending each one's plan in
    their name; automations for a team need one runner, in the cloud.
  - **Catching up every slot missed, or holding one for the person,** as a
    plan that came due while Althar was closed is held. Every slot floods the
    board on waking; holding asks the person every morning, which undoes
    "starts by itself".
- **Trade-off:** nothing runs after Quit or while the computer is asleep, and the
  screen says so. A run goes ahead without asking, so its floor is what no
  switch passes: the default branch, the code host's writes being Althar's,
  credentials. Being picky about when a run may start means some mornings a
  run is skipped, and says why, rather than piling up.
- **Revisit when:** events (a review asked, checks failing on main, a label)
  join schedules; a run should carry on its open pull request rather than
  open another; per-use models get caps; or runs move to the cloud.
