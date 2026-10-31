# ADR-077: Long-run limits and new-project defaults are settings

- **Status:** Accepted
- **Date:** 2026-10-31
- **Amends:** [ADR-013](013-project-rules.md)
- **Owner:** Repository maintainers
- **Context:** How long work goes on alone was fixed in code: a plan's
  25 s countdown (`Plans.ts`), 3 rounds of review (`Runs.ts`), a quiet turn's
  restart at 10 minutes (20 while a command runs) and the check-in after
  6 hours or 40 turns (`Stalls.ts`). Every new project's rules also started
  from the same built-in revision. Linear DEV-15 asks for both to be the
  person's.
- **Decision:**
  - **Four long-run settings, each a choice from a few, in the `settings`
    table** (`longRuns.ts`): the countdown (right away, 10 s, 25 s, 1 minute),
    rounds of review (1, 2, 3, 5), the quiet-turn restart (5, 10, 20 minutes;
    twice that while a tool runs) and the check-in (2, 6, 12 hours, or never,
    which lifts the 40-turn limit too). A row exists only once a value
    differs from today's, so a profile that never changed one reads exactly as
    before.
  - **Read where they apply, not at startup.** The countdown as each plan is
    proposed, the rounds as a run is made and as a review settles, the stall
    limits at each look at the running turns (every 30 s). A change holds from
    the next plan, round or look, without a restart. A test's own option
    (`countdown`, `stalls`) still wins over the setting.
  - **New-project defaults seed the first revision of a project's rules**,
    written when the project is made (`Policies.seedRules`): who answers what
    no rule keeps (allow except what is kept, the coordinator, ask), what a
    usage limit does, whether work tries an agent's next account first, and
    how a task ends. Only what differs from the built-in is written, so
    untouched defaults make the same rules as always. A project made earlier
    has its revision already, or gets the built-in one when first read, and
    never reads the defaults; its rules screen stays the place to change it.
  - **Only choices that mean something now.** Allowing everything is not a
    default: a project turns it on for itself, and only what can't be undone
    from the task still waits (ADR-067). The lead and the reviewer are not
    default rules: the coordinator picks them for each plan from the models
    that are free, and no rule reads a project's choice.
  - **The card draws the countdown it has.** The plan snapshot carries
    `startsAfter`, the seconds from proposal to start, so a 10 s countdown
    draws as a 10 s ring, not a 25 s one.
- **Trade-off:** a stall limit changed while a turn runs holds for it within
  a look, not instantly. A plan already counting down keeps the wait it was
  given. The graph's `review.rounds` records the setting at the time a run
  was made; the decision to stop reads the setting as the review settles.
- **Revisit when:** a project needs its own long-run limits, or a default
  lead or reviewer means something to the coordinator.
