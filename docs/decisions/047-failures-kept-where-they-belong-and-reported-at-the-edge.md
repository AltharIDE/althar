# ADR-047: Failures are kept to what they belong to, and what Althar didn't expect is reported where it is kept

- **Status:** Accepted
- **Date:** 2026-10-18
- **Owner:** Repository maintainers
- **Context:** A tester opened the Agents settings and saw only "Althar's
  runtime couldn't do that. Its log has the details." and no agents at all
  (Linear DEV-98). `Status` checks every agent at once with `Effect.forEach`,
  which fails as soon as one item fails: one agent's failed check took every
  agent off the screen. Effect makes failures values, but its combinators
  (`forEach`, `all`, `forever`) end at the first one unless each item is
  caught, so a failure travels as far as nothing stops it. The same shape was
  in the Connect guide (one `gh` that didn't answer took every instance's
  sign-in off), the coordinator's deliveries and the pull requests' polling
  (one failed round ended the loop for the launch). And nobody heard of any of
  it: a call's failure was written to `runtime.log` alone, and crash reports
  (ADR-046) carry only what nothing caught.
- **Decision:**
  - **A failure is kept to the smallest thing it belongs to**
    (`ARCHITECTURE.md`, Failures and diagnostics). Where work covers
    independent things, one that fails says so on its own and the rest carry
    on; a loop survives the round or item it couldn't handle. All or nothing
    is for what can't stand in parts: a project made of its repositories, a
    write in one transaction.
  - **One way to keep one** (`contained`, in `@althar/runtime`'s
    `Failures.ts`): where an effect fails, other than by being interrupted,
    the failure is logged and reported, and a stand-in takes its place. A
    stand-in says what is true: an account whose check failed is `unknown`,
    an agent whose own check failed carries a `problem` in words for the
    person (`AgentStatus.problem`), shown on its row and its settings tab
    with Check again (`RuntimeState.Unchecked` in the kit).
  - **What the person caused or can put right is shown, never reported.**
    `api()` already tells those apart (`expected`, in `words.ts`); a `gh`
    that is slow to answer is the same.
  - **The rest is reported where it is kept, at the edge**: by `contained`,
    by `api()` for a call that fails for no reason of the person's, named by
    the call (the RPC server's span, `RpcServer.Status`), and for an agent
    that stops on its own (a session `lost`), by its id and how its process
    ended, never what it wrote. The runtime says each to the main process as
    a `handled` crash (`Failures` events, posted as `crash` with
    `how: 'handled'`), which sends it through ADR-046's sender: masked,
    behind the crash reports switch, as an `$exception` with `handled: true`,
    level `error`, and `where` and `agent`, each kept only when shaped as
    Althar's own names.
  - **Handled failures have a budget of their own**: ten a launch, apart
    from the twenty crashes, so they never crowd one out; the same failure
    in two places is two reports.
- **Alternatives considered:**
  - **Reporting from the log** (a logger that sends every warning with a
    cause). Nothing would need touching, but the log is written for a person
    reading a file: its warnings include what the person can put right, its
    fields (thread and turn ids) would need masking of their own, and the
    noise would spend the budget.
  - **Counts only, as usage data** (`call_failed`, with the call and the
    error's tag). Nothing to mask, but too little to put anything right
    with: no message, no place in the code.
  - **Failing whole, with a better sentence.** The window would say why,
    and still show no agents.
- **Trade-off:**
  - **A stand-in hides a failure from the person** where it says only
    `unknown`. It is in the log and, where they allow it, reported.
  - **Kept failures are reported once a launch per place.** A loop that
    fails each round logs each round, and is reported once.
  - **Not every all-or-nothing is gone.** The ones found and not changed
    here are in `docs/open-questions.md`.
- **Revisit when:**
  - A stand-in misleads: an agent shown as checked that wasn't.
  - Handled failures are most of what PostHog receives: the budget, or what
    counts as expected, changes.
