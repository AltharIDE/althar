import { Ids, newId, type ActorId, type ProjectId } from '@althar/domain'
import { Effect, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { ChangeRefused, NotFound } from './errors'
import { type ModelPick, type PresetModels } from './presetModels'
import { fact, timestamp } from './records'
import { addItem } from './threads'

/*
 * Presets (a task is a conversation plus parts): a named set of a task's
 * starting parts, only a start. What a task has is its parts; changing them
 * never changes the preset. The person's, in Althar's settings, working in
 * every project, or kept to the project a task saved it from.
 *
 * Built in: Chat, Change, Small change, Review a PR and Prototype. Saved: from
 * any task's menu (Save as preset), taking its parts, team and the first
 * lines of its brief; or offered by the coordinator, on a card in its thread,
 * once the person set up the same parts more than once (`offerPreset`).
 */

/** A preset's parts: where it works, Checked by and when, how it ends, where it sits, its lead and reviewer, and a brief. */
export const PresetParts = Schema.Struct({
  workspace: Schema.Literals(['copy', 'worktree', 'local']),
  /** When its own work is reviewed: before it ships, after it merges, or not at all. */
  checked: Schema.Literals(['before', 'after', 'none']),
  /**
   * How it ends: a draft pull request, one ready for review, or its branch alone, only where the person set it. Absent, the
   * task ends as the project's "How a task ends" says; the built-in Change and Small change leave it so.
   */
  end: Schema.optional(Schema.Literals(['draft', 'ready', 'none'])),
  shelf: Schema.Literals(['scratch', 'board']),
  /** Its lead and reviewer as `agent/model`, or null where the coordinator picks. */
  lead: Schema.NullOr(Schema.String),
  reviewer: Schema.NullOr(Schema.String),
  brief: Schema.String,
  /** A review of someone else's pull request. */
  reviews: Schema.optional(Schema.Boolean),
})
export type PresetParts = typeof PresetParts.Type

export interface Preset {
  readonly id: string
  readonly name: string
  readonly parts: PresetParts
  readonly builtin: boolean
  /** The project it is kept to; null for every project. */
  readonly projectId: string | null
  /** The project of the task it was saved from, where it was: the one it can be kept to. */
  readonly fromProjectId?: string | null
}

/** The presets Althar has built in. */
export const BUILT_IN: ReadonlyArray<Preset> = [
  {
    id: 'builtin:chat',
    name: 'Chat',
    builtin: true,
    projectId: null,
    parts: { workspace: 'copy', checked: 'none', end: 'none', shelf: 'scratch', lead: null, reviewer: null, brief: '' },
  },
  {
    id: 'builtin:change',
    name: 'Change',
    builtin: true,
    projectId: null,
    parts: { workspace: 'worktree', checked: 'before', shelf: 'board', lead: null, reviewer: null, brief: '' },
  },
  {
    id: 'builtin:small-change',
    name: 'Small change',
    builtin: true,
    projectId: null,
    parts: { workspace: 'worktree', checked: 'after', shelf: 'board', lead: null, reviewer: null, brief: '' },
  },
  {
    id: 'builtin:review',
    name: 'Review a PR',
    builtin: true,
    projectId: null,
    parts: { workspace: 'copy', checked: 'none', end: 'none', shelf: 'board', lead: null, reviewer: null, brief: '', reviews: true },
  },
  {
    id: 'builtin:prototype',
    name: 'Prototype',
    builtin: true,
    projectId: null,
    parts: {
      workspace: 'worktree',
      checked: 'none',
      end: 'none',
      shelf: 'board',
      lead: 'claude-code/claude-opus-5-5',
      reviewer: null,
      brief: 'A prototype: show the idea working, quickly. Its effort follows its size.',
    },
  },
]

const decodeParts = Schema.decodeUnknownOption(Schema.fromJsonString(PresetParts))

/**
 * The presets the person has in a project: the built-in ones, then their own, those kept to the project included. With no
 * project, as Settings lists them, every one of theirs, wherever it is kept.
 */
export const presetsIn = (projectId: string | null) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ id: string; name: string; parts: string; projectId: string | null; fromProjectId: string | null }>`
      SELECT p.id, p.name, p.parts, p.project_id, (SELECT k.project_id FROM tasks k WHERE k.id = p.from_task_id) AS from_project_id
      FROM presets p
      WHERE p.builtin = 0 AND (${projectId === null ? 1 : 0} = 1 OR p.project_id IS NULL OR p.project_id = ${projectId ?? ''})
      ORDER BY p.created_at, p.rowid`
    const own = rows.flatMap((row): ReadonlyArray<Preset> => {
      const parts = decodeParts(row.parts)
      return parts._tag === 'Some'
        ? [
            {
              id: row.id,
              name: row.name,
              parts: parts.value,
              builtin: false,
              projectId: row.projectId,
              fromProjectId: row.fromProjectId ?? row.projectId,
            },
          ]
        : []
    })
    return [...BUILT_IN, ...own]
  })

/**
 * Edits one of the person's presets, as Settings does: its name, its parts, and whether it is kept to the project of the
 * task it was saved from. A built-in one stays as it is; a name another of theirs in the same place has is refused.
 */
export const editPreset = (input: {
  readonly id: string
  readonly name: string
  readonly parts: PresetParts
  readonly projectOnly?: boolean | undefined
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ projectId: string | null; fromProjectId: string | null }>`
      SELECT p.project_id, (SELECT k.project_id FROM tasks k WHERE k.id = p.from_task_id) AS from_project_id
      FROM presets p WHERE p.id = ${input.id} AND p.builtin = 0`
    if (row === undefined) return yield* new NotFound({ kind: 'preset', id: input.id })
    const name = input.name.trim().slice(0, 40)
    const projectId = input.projectOnly === undefined ? row.projectId : input.projectOnly ? (row.projectId ?? row.fromProjectId) : null
    const [taken] = yield* sql<{ id: string }>`
      SELECT id FROM presets WHERE id <> ${input.id} AND coalesce(project_id, '') = ${projectId ?? ''} AND lower(name) = lower(${name})`
    if (taken !== undefined) return yield* new ChangeRefused({ message: `Another preset is called ${name}.` })
    yield* sql`
      UPDATE presets SET name = ${name === '' ? 'Preset' : name}, parts = ${JSON.stringify(input.parts)}, project_id = ${projectId},
        updated_at = ${yield* timestamp}
      WHERE id = ${input.id}`
  })

/** How the project's "How a task ends" stands now: its rule, or a draft pull request where it says nothing. */
export const projectEndOf = (projectId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ end: string | null }>`
      SELECT json_extract(rules, '$.end') AS end FROM policies WHERE project_id = ${projectId} ORDER BY revision DESC LIMIT 1`
    return row?.end === 'ready' || row?.end === 'none' ? row.end : ('draft' as const)
  })

/**
 * The parts of a plan, as a preset holds them. With `projectEnd`, the project's ending now, a plan that ends as it does (or
 * has no ending of its own) leaves the preset's unset, so it follows the project later: only an ending that differs was the
 * person's choice.
 */
export const partsOfPlan = (
  parameters: {
    readonly steps: ReadonlyArray<{
      readonly key: string
      readonly agentId: string
      readonly model: string | null
      readonly skipped: boolean
    }>
    readonly end?: string | null | undefined
    readonly here?: boolean | undefined
    readonly reads?: boolean | undefined
    readonly reviewAfterMerge?: boolean | undefined
    readonly worksIn?: string | undefined
  },
  shelf: string | null,
  brief: string,
  projectEnd?: 'draft' | 'ready' | 'none',
): PresetParts => {
  const lead = parameters.steps.find((step) => step.key === 'implement')
  const review = parameters.steps.find((step) => step.key === 'review')
  const named = (step: typeof lead) => (step === undefined ? null : `${step.agentId}/${step.model ?? 'default'}`)
  return {
    workspace: parameters.reads === true || parameters.here === true ? 'copy' : parameters.worksIn === 'checkout' ? 'local' : 'worktree',
    checked:
      review === undefined || (review.skipped && parameters.reviewAfterMerge !== true)
        ? 'none'
        : parameters.reviewAfterMerge === true
          ? 'after'
          : 'before',
    ...(projectEnd !== undefined && (parameters.end == null || parameters.end === projectEnd)
      ? {}
      : { end: parameters.end === 'draft' || parameters.end === 'ready' ? parameters.end : ('none' as const) }),
    shelf: shelf === 'scratch' ? 'scratch' : 'board',
    lead: named(lead),
    reviewer: review === undefined ? null : named(review),
    brief: brief.split('\n').slice(0, 3).join('\n').trim(),
    ...(parameters.reads === true ? { reviews: true } : {}),
  }
}

/** Whether a preset's parts and a plan's are alike: where it works, how it's checked and ends, where it sits, and its kind. */
const alike = (a: PresetParts, b: PresetParts) =>
  a.workspace === b.workspace &&
  a.checked === b.checked &&
  (a.end === undefined || b.end === undefined || a.end === b.end) &&
  a.shelf === b.shelf &&
  (a.reviews ?? false) === (b.reviews ?? false) &&
  (a.lead === null || b.lead === null || a.lead === b.lead) &&
  (a.reviewer === null || b.reviewer === null || a.reviewer === b.reviewer)

/** The preset a plan's parts are, as its card names it: the person's own first, then the built-in ones; Change where none fits. */
export const presetOf = (presets: ReadonlyArray<Preset>, parts: PresetParts) =>
  [...presets.filter((one) => !one.builtin), ...presets.filter((one) => one.builtin)].find((one) => alike(one.parts, parts))?.name ??
  'Change'

/** Saves a preset, from a task or as the coordinator offered it: its name, its parts, kept to a project or not. */
export const savePreset = (input: {
  readonly name: string
  readonly parts: PresetParts
  readonly projectId: string | null
  readonly fromTaskId: string | null
  readonly actorId: ActorId
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const given = input.name.trim().slice(0, 40)
    const name = given === '' ? 'Preset' : given
    const id = yield* newId(Ids.artifact)
    const at = yield* timestamp
    yield* sql`
      INSERT INTO presets ${sql.insert({
        id: `pst_${id.slice(4)}`,
        name,
        parts: JSON.stringify(input.parts),
        projectId: input.projectId,
        fromTaskId: input.fromTaskId,
        createdAt: at,
        updatedAt: at,
      })}
      ON CONFLICT (coalesce(project_id, ''), lower(name)) DO UPDATE SET parts = excluded.parts, updated_at = excluded.updated_at`
    return { name }
  })

/** A task's parts, as Save as preset takes them: its plan's, where it sits, and the first lines of its brief. */
export const partsOfTask = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [task] = yield* sql<{
      projectId: ProjectId
      title: string
      description: string
      shelf: string | null
      parameters: string | null
    }>`
      SELECT k.project_id, k.title, k.description, k.shelf,
        (SELECT p.parameters FROM task_plans p WHERE p.task_id = k.id ORDER BY p.proposed_at DESC LIMIT 1) AS parameters
      FROM tasks k WHERE k.id = ${taskId}`
    if (task === undefined) return yield* new NotFound({ kind: 'task', id: taskId })
    const parameters = JSON.parse(task.parameters ?? '{"steps":[]}') as Parameters<typeof partsOfPlan>[0]
    const projectEnd = yield* projectEndOf(task.projectId)
    return { projectId: task.projectId, title: task.title, parts: partsOfPlan(parameters, task.shelf, task.description, projectEnd) }
  })

/** Removes one of the person's presets; a built-in one stays. */
export const removePreset = (id: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`DELETE FROM presets WHERE id = ${id} AND builtin = 0`
  })

/**
 * Offers a preset, on a card in the coordinator's thread, once the person
 * has set up the same parts for two tasks running that no preset has: a
 * name, and what it holds, which Save keeps. Each set of parts is offered
 * once.
 */
export const offerPreset = (projectId: ProjectId, actorId: ActorId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const recent = yield* sql<{ taskId: string; parameters: string; shelf: string | null; description: string; title: string }>`
      SELECT p.task_id, p.parameters, k.shelf, k.description, k.title FROM task_plans p JOIN tasks k ON k.id = p.task_id
      WHERE p.project_id = ${projectId} AND p.state IN ('accepted', 'proposed')
      ORDER BY p.proposed_at DESC LIMIT 2`
    if (recent.length < 2) return
    const projectEnd = yield* projectEndOf(projectId)
    const [a, b] = recent.map((row) =>
      partsOfPlan(JSON.parse(row.parameters) as Parameters<typeof partsOfPlan>[0], row.shelf, '', projectEnd),
    )
    if (a === undefined || b === undefined || !alike(a, b) || a.lead === null || a.lead !== b.lead) return
    const presets = yield* presetsIn(projectId)
    if (presets.some((one) => !one.builtin && alike(one.parts, a) && one.parts.lead === a.lead)) return
    const signature = JSON.stringify(a)
    const [offered] = yield* sql<{ id: string }>`
      SELECT id FROM record_events WHERE aggregate_type = 'project' AND aggregate_id = ${projectId} AND type = 'project.preset_offered'
        AND json_extract(payload, '$.signature') = ${signature} LIMIT 1`
    if (offered !== undefined) return
    const [thread] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE project_id = ${projectId} AND kind = 'coordinator' LIMIT 1`
    if (thread === undefined) return
    const name = `${a.lead.split('/').at(-1) ?? 'My'} ${a.workspace === 'local' ? 'Local ' : ''}${a.checked === 'none' ? 'unchecked' : 'change'}`
    const [project] = yield* sql<{ revision: number }>`SELECT revision FROM projects WHERE id = ${projectId}`
    yield* fact({
      projectId,
      aggregateType: 'project',
      aggregateId: projectId,
      revision: project?.revision ?? 1,
      type: 'project.preset_offered',
      payload: { signature, name },
      actorId,
    })
    yield* addItem({ projectId, threadId: thread.id }, 'notice', {
      source: 'runtime',
      severity: 'info',
      title: 'You set up these parts twice. Keep them as a preset?',
      description: `${name}: ${describe(a)}.`,
      offer: { kind: 'preset', name, parts: a },
    })
  })

/**
 * What a preset holds, in words: where it works, how it's checked, how it ends, and who leads, its model as people know it
 * where `models` knows it (Claude Opus 5.5), else as its id.
 */
export const describe = (parts: PresetParts, models?: Omit<PresetModels, 'named' | 'reviewerFor'>) =>
  [
    parts.workspace === 'copy' ? 'a copy' : parts.workspace === 'local' ? 'Local' : 'a worktree',
    parts.checked === 'none' ? 'no review' : parts.checked === 'after' ? 'reviewed after it merges' : 'reviewed before it ships',
    parts.end === undefined
      ? 'ends as the project says'
      : parts.end === 'none'
        ? 'ends here'
        : parts.end === 'ready'
          ? 'a pull request ready for review'
          : 'a draft pull request',
    parts.lead === null
      ? 'the coordinator picks its lead'
      : `led by ${models?.nameOf(pickOf(parts.lead)) ?? parts.lead.split('/').at(-1) ?? parts.lead}`,
  ].join(', ')

/** A plan's parameters, as a preset rewrites them: its steps, how it ends, where it works, and how it's checked. */
export interface PresetPlan {
  readonly steps: ReadonlyArray<{
    readonly key: 'implement' | 'review'
    readonly agentId: string
    readonly model: string | null
    readonly effort?: string | null | undefined
    readonly skipped: boolean
  }>
  readonly end?: 'draft' | 'ready' | 'none' | null | undefined
  readonly here?: boolean | undefined
  readonly reads?: boolean | undefined
  readonly reviewAfterMerge?: boolean | undefined
  readonly worksIn?: 'worktree' | 'checkout' | undefined
}

/** A preset's `agent/model` as a step names its agent and model: `default`, the agent's own. */
const pickOf = (named: string) => {
  const at = named.indexOf('/')
  const agentId = at < 0 ? named : named.slice(0, at)
  const model = at < 0 ? null : named.slice(at + 1)
  return { agentId, model: model === null || model === '' || model === 'default' ? null : model }
}

/**
 * The reviewer a preset's plan takes: none where nothing checks the work; the preset's own, else the plan's where it is
 * another maker's than the lead's, else one picked as the coordinator picks one. Null where a review is needed and nobody
 * but the lead's own model can give it: `planFromPreset` then leaves its row skipped, and applying the preset refuses.
 */
export const reviewerOfPreset = (before: PresetPlan, parts: PresetParts, models?: PresetModels): ModelPick | null => {
  const lead = before.steps.find((step) => step.key === 'implement')
  const review = before.steps.find((step) => step.key === 'review')
  const named = models?.named ?? ((pick: ModelPick) => pick)
  const implement = lead === undefined ? undefined : { ...lead, ...(parts.lead === null ? {} : named(pickOf(parts.lead))) }
  return parts.checked === 'none'
    ? null
    : parts.reviewer !== null
      ? named(pickOf(parts.reviewer))
      : implement === undefined || models === undefined
        ? review === undefined
          ? null
          : { agentId: review.agentId, model: review.model }
        : models.reviewerFor(implement, review === undefined ? undefined : { agentId: review.agentId, model: review.model })
}

/**
 * A plan with a preset's parts (a task is a conversation plus parts, "How a task starts": picking another preset on the
 * plan card changes the plan's parts to match): its lead and reviewer where the preset names them, its review kept, run
 * after the merge or skipped as Checked by says, its ending (the preset's own where it has one, else `projectEnd`, the project's), and where it works, a copy being a quick task's place. A
 * review it needs and the preset doesn't name goes to the plan's own reviewer where that is another maker's than the lead's,
 * else to one picked as the coordinator picks one (`models`), never the lead's own model. A preset that checks nothing leaves no review step.
 */
export const planFromPreset = <P extends PresetPlan>(
  before: P,
  parts: PresetParts,
  models?: PresetModels,
  projectEnd?: PresetPlan['end'],
): P => {
  const lead = before.steps.find((step) => step.key === 'implement')
  const review = before.steps.find((step) => step.key === 'review')
  const named = models?.named ?? ((pick: ModelPick) => pick)
  const implement = lead === undefined ? undefined : { ...lead, ...(parts.lead === null ? {} : named(pickOf(parts.lead))), skipped: false }
  const reviewer = reviewerOfPreset(before, parts, models)
  const reviewing =
    parts.checked === 'none'
      ? // Nothing checks the work, so no review row to add back; a review of a pull request keeps its own second row, skipped.
        parts.reviews === true && review !== undefined
        ? { ...review, skipped: true }
        : undefined
      : reviewer === null
        ? // Nobody to review it: its row is there to add back.
          { ...(review ?? { agentId: 'claude-code', model: null }), key: 'review' as const, skipped: true }
        : {
            // Its effort was for the model it had.
            ...(review !== undefined && review.agentId === reviewer.agentId && review.model === reviewer.model ? review : {}),
            ...reviewer,
            key: 'review' as const,
            // After the merge, nothing waits on it before: skipped in the run, read once the work merged.
            skipped: parts.checked === 'after',
          }
  const { reviewAfterMerge: _after, here: _here, worksIn: _worksIn, ...rest } = before
  return {
    ...rest,
    steps: [...(implement === undefined ? [] : [implement]), ...(reviewing === undefined ? [] : [reviewing])],
    // An ending the preset has is the person's own; without one, the project's, else the plan's as it was.
    end: parts.end ?? (projectEnd === undefined ? before.end : projectEnd),
    ...(parts.checked === 'after' ? { reviewAfterMerge: true } : {}),
    ...(parts.workspace === 'copy' ? { here: true } : { worksIn: parts.workspace === 'local' ? 'checkout' : 'worktree' }),
  } as unknown as P
}
