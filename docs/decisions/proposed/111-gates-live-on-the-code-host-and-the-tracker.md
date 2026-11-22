# ADR-111: Gates live on the code host and the tracker; Althar reads and shows them

> A proposal, not built. Where it would fold in:
> [code-hosts.md § Merging and the merge line](../code-hosts.md#merging-and-the-merge-line)
> (what a feature's stage shows of the host's gates). The plan is
> [Althar for the whole team](../../plans/whole-team.md).

- **Status:** Proposed
- **Date:** 2026-11-22
- **Owner:** Runtime and connector maintainers
- **Related:** [ADR-011, connectors](../code-hosts.md#connectors),
  [ADR-081, acting on the host](../code-hosts.md#acting-on-the-host),
  [ADR-082, one feature for every host](../foundations.md#a-feature-ships-for-every-service-that-can-have-it),
  [ADR-108, lenses](108-a-role-is-a-lens-not-a-separate-app.md),
  [ADR-110, handoffs](110-a-stage-hands-over-when-its-artefact-merges.md).

## Context

The person asked whether Althar needs gating between stages, or whether
users and admins should set it on the code host if they want it. Several
repositories make the question sharper: a gate kept in one person's Althar
would have to agree with every repository's own rules.

## Decision

**Althar adds no gate of its own.** Approval and gating are the code
host's and the tracker's, set there by the team: CODEOWNERS, branch
protection and rulesets, required reviews and checks, merge queues,
tracker workflows. Althar reads them and shows them; it never adds one,
and never goes around one.

- **A stage is done when its artefact merged on the default branch**
  ([ADR-110](110-a-stage-hands-over-when-its-artefact-merges.md)), which
  already carries every gate the host enforces. A multi-repository stage
  is done when all its linked pull requests merged, each through its own
  repository's gates.
- **What Althar reads today, it shows on the stage.** `MergeRules` already
  holds, per pull request, branch protection and rulesets, required checks,
  required reviews, who is asked, open threads and merge queues, for
  GitHub, GitLab and Bitbucket, and code-owner reviews for GitHub and
  GitLab (`githubRules.ts`, `gitlabRules.ts`; Bitbucket's is still to
  read, as ADR-082 asks). A feature's timeline shows,
  for each stage's open pull requests, what still waits ("needs a review
  from design's code owners") in the host's words.
- **CODEOWNERS is read, to say who owns an artefact.** Today only the
  "require code owner review" switch is read. Althar would read the file
  from the default branch, on every host that has one (GitHub, GitLab,
  Bitbucket), to show which team owns `specs/<feature>/design/`, and to
  offer the lines that make stages gated, as a change the person reviews:

  ```
  /specs/**/spec.md   @org/product
  /specs/**/design/   @org/design
  /specs/**/ops.md    @org/devops
  ```

  Whether the host requires those owners' reviews stays the team's switch.
- **The tracker's workflow is shown, not driven.** Where a feature mirrors
  to a tracker ([ADR-109](109-a-feature-moves-through-stages-kept-in-the-repository.md)),
  its status is shown on the timeline beside the stage. A workflow that
  needs a person's approval to move stays theirs; Althar moves only what
  the project lets it move already.
- **A soft signal is not a lock.** "Ready for next" and a lens's owner are
  shown, and stop nothing. Every role can open and merge a stage's pull
  request where the host lets them.
- **Nothing approves its own work**, as now (ADR-081): an agent never
  approves the pull request it made, nor widens what the host lets agents
  do.

## Alternatives

- **Althar's own stage approvals.** A second set of rules beside the
  host's, which a merge made outside Althar would go around anyway, kept
  per person until a server shares it. Rejected.
- **An Althar commit status** (`althar/stage`) a team could make required.
  It would work with the host's own protection, but needs Althar running
  to post it, or a server; reconsider with the Cloud.
- **Gates only for multi-repository features.** Each repository already
  gates its own merges; a stage needing all of them is a reading, not a
  gate.

## Consequences

- A team with no protection on `specs/` gets no gates, by its own choice;
  the timeline says plainly that nothing was required.
- One place to change who approves: the host. Althar can't drift from it.

## What an implementation touches

- `packages/connectors/src/model.ts` (`MergeRules`, `HostNeed`, and a
  code owners read), `githubRules.ts`, `gitlabRules.ts`, `bitbucketRules.ts`,
  a new `codeOwners.ts` parser shared by the three.
- `packages/runtime/src/mergeNeeds.ts` (what waits, per stage),
  `features.ts` from ADR-109, `projectTracker.ts`.
- The feature timeline in the desktop app (ADR-109's).
