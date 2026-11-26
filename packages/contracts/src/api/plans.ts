import { Schema } from 'effect'
import { RpcGroup } from 'effect/rpc'
import { call, ClientAuthority, command } from './rpc'
import { IssuePriority, IssueSummary, PlanStep, TaskEnd, TaskSummary, WorksIn } from './shared'

export const IssueList = Schema.Struct({ issues: Schema.Array(IssueSummary) })
export type IssueList = typeof IssueList.Type

export const WorkerSelection = Schema.Union([Schema.Literal('auto'), Schema.String.check(Schema.isPattern(/^wrk_[a-f0-9]{32}$/u))])

/**
 * A task's plan before and as it starts: starting, holding, changing it, and a draft the coordinator holds.
 * Issues: the drafts and changes the coordinator makes to them, the issues on trackers, and which part of one a task does.
 */
export const PlansApi = RpcGroup.make(
  /** Starts a task you planned yourself: it shows in the coordinator's thread like one it planned, and starts at once. */
  command(
    'StartTask',
    {
      projectId: Schema.String,
      workerId: Schema.optional(WorkerSelection),
      title: Schema.String,
      description: Schema.optional(Schema.String),
      steps: Schema.Array(PlanStep),
      /** The issue it comes from: its link or its key. */
      issue: Schema.optional(Schema.String),
      /** Other issues it comes from, beside issue, on any trackers: each its link or key. */
      issues: Schema.optional(Schema.Array(Schema.String)),
      /** What happens when the work is done; without it, a draft pull request where the repository's host is connected. */
      end: Schema.optional(Schema.NullOr(TaskEnd)),
      /** The project's repositories it changes, by name: needed only in a project of several. */
      repositories: Schema.optional(Schema.Array(Schema.String)),
      /**
       * An aside: a chat of the person's own beside the coordinator's conversation (docs/decisions/tasks.md, "Asides"). It is
       * plain, made on Scratch, and nothing of it leaves this computer; `end` is not read. Started as + is pressed, with no
       * `description`, its lead's brief waits for the person's first words, sent to its thread as any message is.
       */
      chat: Schema.optional(Schema.Boolean),
      /** The id the window made for it, as a project's may be: an aside's pill is keyed by it from the moment + is pressed. */
      taskId: Schema.optional(Schema.String),
      /**
       * With `chat`, an artifact's own chat (ADR-104, "Talking to an artifact") rather than an aside: about the canvas by its
       * id, or a new artifact it draws first with null. It is never listed as a task or an aside, nor waits on the person. An
       * artifact has one: asked again for a canvas that has one open, the runtime answers with that one.
       */
      artifact: Schema.optional(Schema.Struct({ canvasId: Schema.NullOr(Schema.String) })),
    },
    TaskSummary,
  ),
  /** Starts a planned task now, rather than when its time runs out. */
  command(
    'StartPlan',
    {
      planId: Schema.String,
      /** Where it runs: a worker, any free one, or null for the home; absent, where it was placed before it started (PlacePlan). */
      workerId: Schema.optional(Schema.NullOr(WorkerSelection)),
    },
    Schema.Void,
  ),
  /** Holds a planned task: it waits until you start it. Whether it was held: false where it had begun already, and its team changes as a running task's does. */
  command('HoldPlan', { planId: Schema.String }, Schema.Boolean),
  /**
   * Where a planned task runs once it starts (ADR-103), chosen as it counts down or is held: a worker, any free worker, or null
   * for the home. Its countdown starts it there. Whether it was held: one counting down that the place can't take now is.
   */
  command(
    'PlacePlan',
    {
      planId: Schema.String,
      workerId: Schema.NullOr(WorkerSelection),
      /** When the person chose it, in milliseconds: one chosen before the plan's last choice reaches it late and changes nothing. */
      chosenAt: Schema.optional(Schema.Number),
    },
    Schema.Boolean,
  ),
  /** Holds a task the coordinator is drafting, by its draft's key: its plan comes held, even one that would start at once. */
  command('HoldDraft', { threadId: Schema.String, key: Schema.String }, Schema.Void),
  /** Changes who does a planned task's steps, or skips one, before it starts. */
  command(
    'ChangePlan',
    {
      planId: Schema.String,
      steps: Schema.Array(PlanStep),
      end: Schema.optional(Schema.NullOr(TaskEnd)),
      /** Where it works (ADR-091), until its first step starts; the plan's as it was without it. */
      worksIn: Schema.optional(WorksIn),
      /** The branch it works toward (ADR-093), until its first step starts; null for the default branch, absent to leave it. */
      toward: Schema.optional(Schema.NullOr(Schema.String)),
    },
    Schema.Void,
  ),
  /** Changes what an issue the coordinator drafted says, before it is filed. */
  command(
    'ChangeIssueDraft',
    {
      draftId: Schema.String,
      title: Schema.String,
      body: Schema.String,
      labels: Schema.Array(Schema.String),
      /** Left out, it stays as it is; null files it at the tracker's default. */
      priority: Schema.optional(Schema.NullOr(IssuePriority)),
    },
    Schema.Void,
  ),
  /** Files an issue the coordinator drafted, on its tracker; or one that wasn't filed, again. Its card says how it went. */
  command('FileIssueDraft', { draftId: Schema.String }, Schema.Void),
  /** Discards an issue the coordinator drafted: nothing is filed. */
  command('DiscardIssueDraft', { draftId: Schema.String }, Schema.Void),
  /** Applies changes to issues on their trackers; or what didn't apply, again. Its card says how it went. */
  command('ApplyIssueChanges', { changesId: Schema.String }, Schema.Void),
  /**
   * Says to the coordinator, as the person, that issues are filed and
   * changed at once from now on, or that each waits on the person's card
   * first; it keeps that as one of the project's notes, and a task's lead
   * where it was said hears it too. From an issue card, in `threadId`.
   */
  command('PreferIssueCards', { threadId: Schema.String, atOnce: Schema.Boolean }, Schema.Void),
  /** Whether a task does only part of its issue: its merge comments on the issue and leaves it open, rather than closing it. */
  /** Whether a task does only part of an issue it came from: the one named by its ref or key, or its first where none is. */
  command('SetTaskIssuePart', { taskId: Schema.String, partOf: Schema.Boolean, issue: Schema.optional(Schema.String) }, Schema.Void),
  /** Discards changes to issues: nothing changes on the tracker. */
  command('DiscardIssueChanges', { changesId: Schema.String }, Schema.Void),
  /** The person's open issues on the connected trackers, and in the project's repository. */
  call('ListIssues', { projectId: Schema.String }, IssueList),
).middleware(ClientAuthority)
