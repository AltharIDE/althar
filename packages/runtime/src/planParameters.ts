import { ShipRoute, WorksIn } from '@althar/contracts'
import { Schema } from 'effect'

import { ShipBranchMove } from './shipBranchMove'

/*
 * What a task's plan holds, as its run keeps it (docs/architecture/05; docs/plans/mvp.md, "The plan"): its steps and
 * who does them, why its lead was chosen, and what happens when the work is done. Read by every part that reads a plan,
 * from the run that carries it out to the brief that tells an agent of it.
 */

export const PlanStep = Schema.Struct({
  key: Schema.Literals(['implement', 'review']),
  agentId: Schema.String,
  model: Schema.NullOr(Schema.String),
  /** How hard its agent thinks; the agent's own default without one. */
  effort: Schema.optional(Schema.NullOr(Schema.String)),
  skipped: Schema.Boolean,
})

export type PlanStep = typeof PlanStep.Type

/** How a task ends, as its parts say it: `here`, nothing leaving this computer until it ships; else as `TaskEnd`. */
export type TaskEnding = 'here' | TaskEnd

/** How a plan's parameters end, as `TaskEnding` says it: null where they say nothing, which the project's rule settles. */
export const endingOf = (parameters: { readonly end?: TaskEnd | null | undefined; readonly here?: boolean | undefined }) =>
  parameters.end != null ? parameters.end : parameters.here === true ? ('here' as const) : null

/**
 * What a task does when its steps are done (the kit's "When the work is
 * done"): open a draft pull request, open one for review, or push its branch
 * only. Null where nothing reaches the repository's host: the task ends ready
 * on its branch.
 */
export const TaskEnd = Schema.Literals(['draft', 'ready', 'none'])

export type TaskEnd = typeof TaskEnd.Type

/** What a plan holds: its steps, why the lead was chosen, and what happens when the work is done. */
export const PlanParameters = Schema.Struct({
  steps: Schema.Array(PlanStep),
  reason: Schema.NullOr(Schema.String),
  end: Schema.optional(Schema.NullOr(TaskEnd)),
  /** Its ending was the person's choice (or a preset of theirs with one), not the project's setting taken as it stood. */
  endChosen: Schema.optional(Schema.Boolean),
  /**
   * Nothing of it leaves this Mac when it is done, whatever the project's
   * host: a task the coordinator starts at once (`start_task`), which it told
   * the person so. Without it, a plan with no end opens its pull request once
   * its host is connected.
   */
  here: Schema.optional(Schema.Boolean),
  /**
   * Whether it runs only on this home (`homeOnly` in its worker requirements): as `here` says, without it. A task started
   * at once and placed on a worker (`start_task` with `runs_on`) keeps `here`, so nothing of it goes up when it is done,
   * and sets this false, so it runs where it was placed; its work comes home at each turn's end as any worker's does.
   */
  homeOnly: Schema.optional(Schema.Boolean),
  /**
   * An aside the person started (`StartTask` with `chat`, docs/decisions/tasks.md, "Asides"): its first step ends with its
   * lead's turn, its reply the answer, as a turn after a plan does, and the coordinator hears nothing of it. Not once it is
   * work: its lead changed the repository and it left Scratch for the board.
   */
  aside: Schema.optional(Schema.Boolean),
  /**
   * A round of work's run only: it ends as its plan's run does, publishing
   * as its ending says, where a round never publishes by itself (ADR-034).
   * The round under way as its quick task was made a change
   * (make_it_a_change), which the person asked to end in a pull request.
   */
  publishes: Schema.optional(Schema.Boolean),
  /**
   * A Ship's run only (a task is a conversation plus parts, "A tweak waits
   * for Ship"): the person shipped what waited on the task's branch. It has
   * no Implement step: its review, where the plan has one before it ships,
   * reads only what came after `from`, each worktree's head as the last
   * review read it, by path; then its ending sends the commits up, past the
   * hold. Absent from every other run, so a store written before reads the
   * same.
   */
  ships: Schema.optional(
    Schema.Struct({
      from: Schema.Record(Schema.String, Schema.String),
      /** Explicit Open draft PR applies to this Ship only, including later groups, without changing the task's ending. */
      openDraft: Schema.optional(Schema.Boolean),
      /** The accepted committed boundary, persisted before publication, by workspace. Later work waits for another Ship. */
      heads: Schema.optional(Schema.Record(Schema.String, Schema.String)),
      /** The immutable copy the latest review reads, until its tree is resolved to an actual committed boundary. */
      snapshots: Schema.optional(Schema.Record(Schema.String, Schema.String)),
      /** An unfinished branch move is reconciled before retrying publication; the original branch always keeps its work. */
      rebranching: Schema.optional(Schema.Record(Schema.String, ShipBranchMove)),
      /**
       * Review and merge (a task is a conversation plus parts, "Merge, with commits not shipped"): once what waited is up, its
       * pull requests merge, unless the lead set a finding of its review aside, which brings the task back to the person
       * first. Absent from a plain Ship. Kept for a Ship admitted before routes: one admitted since says it with `route`.
       */
      merges: Schema.optional(Schema.Boolean),
      /**
       * Its route, as the person chose it or the task's own (`TaskView.shipRoute`), as changed since (RouteShip): whether its
       * review runs (off, its review steps are skipped from the start), and how far it goes: `push`, a new pull request a
       * draft and a draft left one; `ready`, a new one ready and an open draft marked ready; `merge`, as ready, then merged
       * once the checks its target requires pass. Absent from a Ship admitted before routes, which goes as it always did.
       */
      route: Schema.optional(ShipRoute),
      /**
       * The stop past its push it has reached, for its card and for RouteShip: marking ready, then merging (or waiting to,
       * on its required checks). Absent before, while it reviews or pushes.
       */
      at: Schema.optional(Schema.Literals(['ready', 'merge'])),
      /**
       * The change this Ship sends, by workspace, where its task has several (a task is a conversation plus parts, "Each
       * change ships and is followed on its own"): its review reads it alone, and only it goes up. Absent where the task has
       * one, which ships whole as before.
       */
      only: Schema.optional(Schema.Array(Schema.String)),
      /**
       * The changes that ship after it, each in a Ship of its own with its own review, in order: the bottom of a stack first.
       * Each is its workspaces' ids, joined by commas: a change in several repositories ships as one.
       */
      next: Schema.optional(Schema.Array(Schema.String)),
      /**
       * A review added after the work went up (a skipped review can be added back until merge): the run only reviews what is
       * on the branch now, from the last review or, with none, from where the task started, and sends nothing: the commits
       * are up already.
       */
      reviewOnly: Schema.optional(Schema.Boolean),
      /**
       * Its task came to stay here while it shipped (its ending changed to here, as a change made a chat): nothing goes up,
       * nothing merges, and what waited still waits for the next Ship. Absent from every other Ship.
       */
      stays: Schema.optional(Schema.Boolean),
    }),
  ),
  /** A small change starts without a countdown; its size never determines when its reviewer reads it. */
  smallChange: Schema.optional(Schema.Boolean),
  /** The preset it was planned from, by name: its card names it while its parts still have that preset's shape. */
  preset: Schema.optional(Schema.String),
  /** Explicitly chosen after-merge timing. Kept for older configured tasks; size no longer sets it. */
  reviewAfterMerge: Schema.optional(Schema.Boolean),
  /**
   * A review of someone else's pull request (`review_pull_request`): its one
   * step is the review's lead, which reads a read-only copy, so only an
   * agent its session holds to reading may take it. It has no run: started,
   * its lead starts in the task's thread (Reviews.lead).
   */
  reads: Schema.optional(Schema.Boolean),
  /**
   * Where it works (ADR-091): a worktree of its own, or Local, in its
   * repositories' own checkouts here, taken as its first step begins. A
   * worktree without it, as before.
   */
  worksIn: Schema.optional(WorksIn),
  /** Why it works there, in the coordinator's words, where that isn't the project's default. */
  worksInWhy: Schema.optional(Schema.NullOr(Schema.String)),
  /**
   * When its lead was last changed after its steps began (`changeTeam`): who leads it is the plan's from then, until a session
   * of the lead starts after, as the thread's lead reads.
   */
  leadChanged: Schema.optional(Schema.String),
})

export type PlanParameters = typeof PlanParameters.Type

/** How far a Ship's route goes, as its run keeps it: a Ship admitted before routes says merging alone, and nothing else. */
export const farOf = (ships: PlanParameters['ships']): ShipRoute['far'] | undefined =>
  ships?.route?.far ?? (ships?.merges === true ? 'merge' : undefined)
