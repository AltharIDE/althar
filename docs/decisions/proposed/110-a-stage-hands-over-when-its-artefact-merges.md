# ADR-110: A stage hands over when its artefact merges, and the next role's coordinator proposes its tasks

> A proposal, not built. Where it would fold in:
> [coordinator.md](../coordinator.md) (proposing the next stage's tasks),
> [code-hosts.md § Hearing from the host](../code-hosts.md#hearing-from-the-host)
> (a stage's merge as news), and [tasks.md § Needs you and settling](../tasks.md#needs-you-and-settling)
> (a handoff waiting). The plan is [Althar for the whole team](../../plans/whole-team.md).

- **Status:** Proposed. Handoffs (the plan's Phase 3) are accepted only
  once DEV-267 is fixed; reading stages (Phase 2) doesn't wait on it.
- **Date:** 2026-11-22
- **Owner:** Runtime maintainers
- **Related:** [ADR-061, automations](../scheduling.md#automations),
  [ADR-081, acting on the host](../code-hosts.md#acting-on-the-host),
  [tasks wait for their blockers (DEV-228)](../scheduling.md#tasks-wait-for-their-blockers),
  [waiting for an external change](../scheduling.md#waiting-for-an-external-change),
  [ADR-109, features and stages](109-a-feature-moves-through-stages-kept-in-the-repository.md),
  [ADR-111, gates](111-gates-live-on-the-code-host-and-the-tracker.md).

## Context

A feature's stages are read from the repository
([ADR-109](109-a-feature-moves-through-stages-kept-in-the-repository.md)).
What's left is how the next link learns that it is its turn, and what
Althar does for it, when each person runs their own Althar and no server
carries a message from one to the next.

## Decision

**What counts as done.** A stage is done when its artefact has merged on
the default branch of the feature's home repository and, for a stage with
pull requests (Build, by default), when every pull request in the stage's
set has merged into its repository's default branch. The set is
[ADR-109](109-a-feature-moves-through-stages-kept-in-the-repository.md)'s:
the frontmatter's list where it has one, else the pull requests marked for
that stage. Whatever the host required for those merges is the stage's
gate ([ADR-111](111-gates-live-on-the-code-host-and-the-tracker.md)). A
pull request closed without merging leaves the set. One added to the set
after the stage was done reopens it on the timeline, but its handoff is
not proposed again. A stage whose merges can't all be confirmed is
**unverified** (ADR-109), and hands over nothing until they can be.

**A feature sweep of its own reconciles each person's Althar.** Nothing
reads every repository's default branch today: the merge line's watch on
main (`redWatch` in `MergeLine.ts`) reads only a branch that this Althar's
own merge line landed on in the past hour, so a designer who never merged
anything would hear nothing. A new sweep, while the app runs:

- **reads the default branch's head of every repository the project
  binds,** with conditional requests, every five minutes, the pace the
  open pull requests are already followed at;
- **reads the pull requests that carry a feature's marker or label,** open
  ones from that same follow and those merged or closed since its last
  read, as a marker added, a label changed or a pull request opened can
  change a stage without moving any head;
- **catches up on start:** it keeps, per feature, the commits and pull
  request states it last read, and on start (or after a lost connection)
  reads again from there, so a computer that was off hears every stage
  that became done meanwhile, once;
- **reads the features again** when a head moved or a marked pull request
  changed, and a stage that became done, and is verified, is news, like an
  errand's next step.

The news is keyed by feature, stage and the commit or pull request that
completed it, so it comes once. Nothing is sent between people: each
person's Althar reads the same repositories.

**It goes to whoever owns the next stage,** not to whoever looks through
that lens now: everyone whose project roles include the stage's owner role
([ADR-108](108-a-role-is-a-lens-not-a-separate-app.md)), and anyone
`spec.md` names as the stage's owner. A designer who looks through
Engineering's lens when the spec merges still gets Design's handoff. The
lens in use only shapes how it is shown and notified.

**The coordinator proposes the next role's tasks, held.** Woken, it reads
the merged artefact and the feature's frontmatter, and proposes the next
stage's tasks with `propose_plan`, from the presets the owner role's
lens puts first:
design prototypes or directions after a spec; build changes after a
design, split per repository the spec names; a rollout checklist and an
Ops task after the build. Each is held for the person rather than counting
down: someone else's work arriving is not their word to start. It says so
in a line in the person's thread ("Offline sync's spec merged: three
design directions proposed"), and the handoff waits in Needs you, notified
as the person's lens says.

**"Ready for next" is a soft signal.** A stage owner sets `ready:` in the
frontmatter, or the `ready-for:<stage>` label on the stage's pull request.
The timeline shows it, and the next role's coordinator may propose early,
marked as early. It locks nothing, waits on nothing and is never required.

**Going back is a question.** A later stage asks an earlier one on the
pull request or the tracker; the timeline shows the open question on the
earlier stage, and the feature doesn't move back.

**Three mechanisms, each for what it fits:**

| What | How | State |
|---|---|---|
| A stage became done | The feature sweep, as news | New |
| A next-stage task already planned waits for this stage's tasks | `waits_for` on its plan (`task_waits`) | Built (DEV-228) |
| The person's "later" ask ("when the build merges, draft the rollout") | An errand, its step waiting on the merge | Built, but waits never fire (DEV-267) |

**DEV-267 is a condition of accepting handoffs.** The first mechanism
needs no errand, so the feature's timeline and its stages (the plan's
Phase 2) are delivered without it. Handoffs (Phase 3) are not accepted
until DEV-267 is fixed, as the brief and the canvas said: the third
mechanism is where people will ask for errands most, and DEV-267's "Done
when" (a wait fires for an event that happened before the errand was
kept, and a step whose target merged or was settled fires or says it
can't) is what a handoff's follow-ups need. Errands also need a wait on a
path merging on the default branch, beside `task_merged`, which today
serves only a release's tag. Whether automatic handoffs could ship before
DEV-267 is left open for Balázs in the plan.

## Alternatives

- **Althar messages the next person.** Needs a server between people. With
  the Cloud it may add delivery; the read from the repository stays the
  source.
- **Starting the next role's tasks at once.** Spends someone's plan on work
  they haven't looked at. Rejected; a lens may let them count down.
- **An errand per feature, kept from the first stage.** Every handoff would
  rest on errands, which don't fire today, and on the one computer that
  kept them. Reading state is idempotent and works on everyone's.
- **A sign-off in Althar** before a stage hands over. Rejected in
  [ADR-111](111-gates-live-on-the-code-host-and-the-tracker.md).

## Consequences

- A handoff is late by at most a sweep, and only while the next person's
  Althar runs; the catch-up on start means it is never lost.
- Two people owning the next stage both get proposals. Their coordinators
  see each other's tasks only through pull requests and the tracker until
  the Cloud; a `Feature:` pull request already open for the stage is
  shown on the proposal so nobody starts it twice.

## What an implementation touches

- `packages/runtime/src/errandWaits.ts`, `errandTaskWaits.ts`,
  `errandWatch.ts`, `Errands.ts`: DEV-267's fix, and a wait on a path
  merged on the default branch.
- New: the feature sweep, beside the open pull requests' follow and the
  news in `Coordinator.ts` (not `MergeLine.ts`'s `redWatch`, which stays
  as it is), with its last-read state per feature in a migration; and
  `features.ts` from ADR-109: a stage done as news, keyed once.
- `packages/runtime/src/agentTools.ts` (a person's project roles, for
  whom a handoff goes to).
- `packages/runtime/src/sessionBriefs.ts` (what the coordinator does with
  that news), `Plans.ts` (held proposals), `waits.ts` (blockers on the
  previous stage's tasks).
- `packages/contracts/src/attention.ts` and `waiting.ts`,
  `packages/runtime/src/Nudges.ts`, `needsYou.ts`,
  `apps/desktop/src/main/notify.ts`: a handoff kind in Needs you and its
  notification.
