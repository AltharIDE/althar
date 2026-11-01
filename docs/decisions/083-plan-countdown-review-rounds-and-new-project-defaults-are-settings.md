# ADR-083: The plan countdown, review rounds and new-project defaults are settings

- **Status:** Accepted
- **Date:** 2026-10-31
- **Amends:** [ADR-013](013-project-rules.md)
- **Owner:** Repository maintainers
- **Context:** A plan's 25 s countdown (`Plans.ts`) and 3 rounds of review
  (`Runs.ts`) were fixed in code, and every new project's rules started from
  the same built-in revision. Linear DEV-15 asks for these to be the
  person's. It also named when a quiet turn is restarted and the check-in
  after a long run (`Stalls.ts`); they are Althar's to manage, not choices
  the person can judge, and stay as they were.
- **Decision:**
  - **Two settings, each a choice from a few, in the `settings` table**
    (`plansAndReviews.ts`): the countdown (right away, 10 s, 25 s, 1 minute)
    and rounds of review (1, 2, 3, 5). A row exists only once a value differs
    from today's, so a profile that never changed one reads exactly as
    before. They are one Settings section, Plans and reviews.
  - **Read where they apply, not at startup.** The countdown as each plan is
    proposed, the rounds as a run is made and as a review settles. A change
    holds from the next plan or round, without a restart. A test's own option
    (`countdown`) still wins over the setting.
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
- **Trade-off:** a plan already counting down keeps the wait it was given.
  The graph's `review.rounds` records the setting at the time a run was made;
  the decision to stop reads the setting as the review settles.
- **Revisit when:** a project needs its own countdown or rounds, a default
  lead or reviewer means something to the coordinator, or people ask to tune
  the stall limits.
