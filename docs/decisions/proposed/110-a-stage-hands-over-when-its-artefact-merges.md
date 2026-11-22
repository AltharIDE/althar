# ADR-110: A stage hands over when its artefact merges, and the next role's coordinator proposes its tasks

> A proposal, not built. Where it would fold in:
> [coordinator.md](../coordinator.md) (proposing the next stage's tasks),
> [code-hosts.md § Hearing from the host](../code-hosts.md#hearing-from-the-host)
> (a stage's merge as news), and [tasks.md § Needs you and settling](../tasks.md#needs-you-and-settling)
> (a handoff waiting). The plan is [Althar for the whole team](../../plans/whole-team.md).

- **Status:** Proposed. Depends on DEV-267 for errands (below).
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
the default branch of the feature's home repository; a stage with pull
requests (Build, by default) when every pull request linked to the
feature for it has merged, in every repository. Whatever the host required
for those merges is the stage's gate
([ADR-111](111-gates-live-on-the-code-host-and-the-tracker.md)). A pull
request closed without merging no longer counts; one opened later for the
stage reopens it.

**Each person's Althar hears it on its own.** Althar reads the default
branch's head on every sweep already (for main going red). When the head
moves, it reads the features again, and a stage that became done is news,
like an errand's next step: it wakes the coordinator of every person whose
lens owns the next stage, on their own computer. Nothing is sent between
people. The news is keyed by feature, stage and the merge commit, so it
comes once, and a sweep that was missed, or a computer that was off, finds
it at the next read.

**The coordinator proposes the next role's tasks, held.** Woken, it reads
the merged artefact and the feature's frontmatter, and proposes the next
stage's tasks with `propose_plan`, from the presets the lens puts first:
design prototypes or directions after a spec; build changes after a
design, split per repository the spec names; a rollout checklist and an
Ops task after the build. Each is held for the person rather than counting
down: someone else's work arriving is not their word to start. It says so
in a line in the person's thread ("Offline sync's spec merged: three
design directions proposed"), and the handoff waits in Needs you, notified
as the lens says ([ADR-108](108-a-role-is-a-lens-not-a-separate-app.md)).

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
| A stage became done | Read from the default branch on each sweep, as news | New |
| A next-stage task already planned waits for this stage's tasks | `waits_for` on its plan (`task_waits`) | Built (DEV-228) |
| The person's "later" ask ("when the build merges, draft the rollout") | An errand, its step waiting on the merge | Built, but waits never fire (DEV-267) |

The first needs no errand, so it doesn't wait on DEV-267. The third does,
and handoffs are where people will ask for it most: DEV-267's "Done when"
(a wait fires for an event that happened before the errand was kept, and
a step whose target merged or was settled fires or says it can't) is what
a handoff needs. Errands also need a wait on a path merging on the default
branch, beside `task_merged`, which today serves only a release's tag.

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

- A handoff is late by at most a sweep and a fetch, and only while the
  next person's Althar runs; it is never lost.
- Two people owning the next stage both get proposals. Their coordinators
  see each other's tasks only through pull requests and the tracker until
  the Cloud; a `Feature:` pull request already open for the stage is
  shown on the proposal so nobody starts it twice.

## What an implementation touches

- `packages/runtime/src/errandWaits.ts`, `errandTaskWaits.ts`,
  `errandWatch.ts`, `Errands.ts`: DEV-267's fix, and a wait on a path
  merged on the default branch.
- The host sweep that reads main's head (beside `MergeLine.ts` and the
  news in `Coordinator.ts`), and `features.ts` from ADR-109: a stage done
  as news, keyed once.
- `packages/runtime/src/sessionBriefs.ts` (what the coordinator does with
  that news), `Plans.ts` (held proposals), `waits.ts` (blockers on the
  previous stage's tasks).
- `packages/contracts/src/attention.ts` and `waiting.ts`,
  `packages/runtime/src/Nudges.ts`, `needsYou.ts`,
  `apps/desktop/src/main/notify.ts`: a handoff kind in Needs you and its
  notification.
