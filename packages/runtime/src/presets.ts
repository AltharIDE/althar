import { Ids, newId, type ActorId, type ProjectId } from '@althar/domain'
import { Effect, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { ChangeRefused, NotFound } from './errors'
import { type ModelPick, type PresetModels } from './presetModels'
import { fact, timestamp } from './records'
import { touchCard } from './cards'

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

/**
 * The parts of a plan, as a preset holds them. Its ending goes in only where the person chose it (`endChosen`); a plan that
 * took the project's leaves the preset's unset, so it follows the project later.
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
    readonly endChosen?: boolean | undefined
    readonly here?: boolean | undefined
    readonly reads?: boolean | undefined
    readonly reviewAfterMerge?: boolean | undefined
    readonly worksIn?: string | undefined
  },
  shelf: string | null,
  brief: string,
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
    ...(parameters.endChosen === true
      ? { end: parameters.end === 'draft' || parameters.end === 'ready' ? parameters.end : ('none' as const) }
      : {}),
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
    // Kept from a task, its card, which may have offered it, says so.
    if (input.fromTaskId !== null) yield* touchCard(input.fromTaskId)
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
    return { projectId: task.projectId, title: task.title, parts: partsOfPlan(parameters, task.shelf, task.description) }
  })

/** Removes one of the person's presets; a built-in one stays. */
export const removePreset = (id: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [from] = yield* sql<{ fromTaskId: string | null }>`SELECT from_task_id FROM presets WHERE id = ${id} AND builtin = 0`
    yield* sql`DELETE FROM presets WHERE id = ${id} AND builtin = 0`
    // Kept from a task's offer, its card offers it again.
    if (from?.fromTaskId != null) yield* touchCard(from.fromTaskId)
  })

/** How many plans of the person's own, among their last few, must be alike before a preset is offered for them. */
export const OFFER_AFTER = 3
const OFFER_WITHIN = 6

/** A name for parts in plain words: how they differ from Change, the plain task, two things at most. */
export const plainName = (parts: PresetParts) => {
  const said = [
    parts.workspace === 'local' ? 'Local' : parts.workspace === 'copy' ? 'In a copy' : null,
    parts.checked === 'none' ? 'no review' : parts.checked === 'after' ? 'reviewed after merge' : null,
    parts.end === 'ready' ? 'ready PR' : parts.end === 'none' ? 'no PR' : null,
  ].filter((one) => one !== null)
  const name = said.slice(0, 2).join(', ')
  return name === '' ? 'My change' : name.charAt(0).toUpperCase() + name.slice(1)
}

/** How parts differ from a built-in preset, in words, where only how it's checked or how it ends does; null otherwise. */
const nearly = (preset: Preset, parts: PresetParts) => {
  const q = preset.parts
  if (
    q.workspace !== parts.workspace ||
    q.shelf !== parts.shelf ||
    (q.reviews ?? false) !== (parts.reviews ?? false) ||
    (q.lead !== null && parts.lead !== null && q.lead !== parts.lead)
  )
    return null
  const differs = [
    q.checked === parts.checked
      ? null
      : parts.checked === 'none'
        ? `without its review ${q.checked === 'after' ? 'after merge' : 'before it ships'}`
        : parts.checked === 'after'
          ? 'reviewed after merge'
          : 'reviewed before it ships',
    // An ending left to the project's setting differs from none.
    q.end === undefined || parts.end === undefined || q.end === parts.end
      ? null
      : parts.end === 'none'
        ? 'ending on its branch'
        : parts.end === 'ready'
          ? 'ending in a pull request ready for review'
          : 'ending in a draft pull request',
  ].filter((one) => one !== null)
  return differs.length === 1 ? (differs[0] ?? null) : null
}

/**
 * Offers to keep a task's parts as a preset, on its card in the coordinator's
 * thread, as its plan starts (a task is a conversation plus parts). Only
 * plans the person set up themselves count: one the coordinator or a lead
 * proposed counts not, however the person changed it, since changing it
 * teaches the coordinator rather than sets something up. It needs
 * `OFFER_AFTER` alike, with the same lead, among their last `OFFER_WITHIN`,
 * and no preset of theirs or built in with those parts; where a built-in one
 * is a step away, it names that one instead of a new one. Each set of parts
 * is offered once.
 */
export const offerPreset = (input: {
  readonly projectId: ProjectId
  readonly taskId: string
  readonly personId: ActorId
  readonly actorId: ActorId
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const own = yield* sql<{ taskId: string; parameters: string; shelf: string | null }>`
      SELECT p.task_id, p.parameters, k.shelf FROM task_plans p JOIN tasks k ON k.id = p.task_id
      WHERE p.project_id = ${input.projectId} AND p.state = 'accepted'
        AND EXISTS (SELECT 1 FROM record_events e WHERE e.aggregate_type = 'task_plan' AND e.aggregate_id = p.id
          AND e.type = 'task_plan.proposed' AND e.actor_id = ${input.personId})
      ORDER BY p.proposed_at DESC, p.rowid DESC LIMIT ${OFFER_WITHIN}`
    // The plan that starts is the person's own, the newest of them.
    if (own[0]?.taskId !== input.taskId) return
    const [parts, ...earlier] = own.map((row) =>
      partsOfPlan(JSON.parse(row.parameters) as Parameters<typeof partsOfPlan>[0], row.shelf, ''),
    )
    if (parts === undefined || parts.lead === null) return
    if (1 + earlier.filter((one) => alike(one, parts) && one.lead === parts.lead).length < OFFER_AFTER) return
    const presets = yield* presetsIn(input.projectId)
    if (presets.some((one) => alike(one.parts, parts) && (one.builtin || one.parts.lead === parts.lead))) return
    const signature = JSON.stringify(parts)
    const [offered] = yield* sql<{ id: string }>`
      SELECT id FROM record_events WHERE aggregate_type = 'project' AND aggregate_id = ${input.projectId}
        AND type = 'project.preset_offered' AND json_extract(payload, '$.signature') = ${signature} LIMIT 1`
    if (offered !== undefined) return
    // One step from a built-in preset; one that names the same lead fits closer than one that names none.
    const near = presets
      .filter((one) => one.builtin)
      .toSorted((a, b) => Number(b.parts.lead === parts.lead) - Number(a.parts.lead === parts.lead))
      .flatMap((one) => {
        const differs = nearly(one, parts)
        return differs === null ? [] : [{ preset: one.name, differs }]
      })[0]
    const [project] = yield* sql<{ revision: number }>`SELECT revision FROM projects WHERE id = ${input.projectId}`
    yield* fact({
      projectId: input.projectId,
      aggregateType: 'project',
      aggregateId: input.projectId,
      revision: project?.revision ?? 1,
      type: 'project.preset_offered',
      payload: { signature, name: plainName(parts), taskId: input.taskId, ...(near === undefined ? {} : near) },
      actorId: input.actorId,
    })
    yield* touchCard(input.taskId)
  })

/** The person said not to offer a task's parts as a preset: its card stops offering, and they aren't offered again. */
export const declinePresetOffer = (taskId: string, actorId: ActorId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [task] = yield* sql<{ projectId: ProjectId; revision: number }>`
      SELECT k.project_id, p.revision FROM tasks k JOIN projects p ON p.id = k.project_id WHERE k.id = ${taskId}`
    if (task === undefined) return yield* new NotFound({ kind: 'task', id: taskId })
    yield* fact({
      projectId: task.projectId,
      aggregateType: 'project',
      aggregateId: task.projectId,
      revision: task.revision,
      type: 'project.preset_declined',
      payload: { taskId },
      actorId,
    })
    yield* touchCard(taskId)
  })

const OfferPayload = Schema.Struct({
  signature: Schema.String,
  name: Schema.String,
  taskId: Schema.String,
  preset: Schema.optional(Schema.String),
  differs: Schema.optional(Schema.String),
})
const decodeOffer = Schema.decodeUnknownOption(Schema.fromJsonString(OfferPayload))

/**
 * What a task's card offers to keep as a preset, while it does: the name and
 * parts, the built-in preset they nearly are, and, once kept from it, the
 * preset kept, for Undo. Undefined where nothing was offered on it, or the
 * person said not to.
 */
export const presetOfferOn = (projectId: string, taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const events = yield* sql<{ type: string; payload: string }>`
      SELECT type, payload FROM record_events WHERE aggregate_type = 'project' AND aggregate_id = ${projectId}
        AND type IN ('project.preset_offered', 'project.preset_declined') AND json_extract(payload, '$.taskId') = ${taskId}`
    if (events.some((one) => one.type === 'project.preset_declined')) return undefined
    const offered = events.find((one) => one.type === 'project.preset_offered')
    const payload = offered === undefined ? undefined : decodeOffer(offered.payload)
    if (payload === undefined || payload._tag === 'None') return undefined
    const parts = decodeParts(payload.value.signature)
    if (parts._tag === 'None') return undefined
    const [kept] = yield* sql<{ id: string; name: string }>`
      SELECT id, name FROM presets WHERE from_task_id = ${taskId} AND builtin = 0 ORDER BY created_at DESC, rowid DESC LIMIT 1`
    return {
      name: payload.value.name,
      parts: parts.value,
      ...(payload.value.preset === undefined ? {} : { near: { preset: payload.value.preset, differs: payload.value.differs ?? '' } }),
      ...(kept === undefined ? {} : { kept }),
    }
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
  readonly endChosen?: boolean | undefined
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
  const { reviewAfterMerge: _after, here: _here, worksIn: _worksIn, endChosen: _chosen, ...rest } = before
  return {
    ...rest,
    steps: [...(implement === undefined ? [] : [implement]), ...(reviewing === undefined ? [] : [reviewing])],
    // An ending the preset has is the person's own; without one, the project's, else the plan's as it was.
    end: parts.end ?? (projectEnd === undefined ? before.end : projectEnd),
    // Only a preset's own ending is chosen; one taken from the project follows it again when saved.
    ...(parts.end === undefined ? {} : { endChosen: true }),
    ...(parts.checked === 'after' ? { reviewAfterMerge: true } : {}),
    ...(parts.workspace === 'copy' ? { here: true } : { worksIn: parts.workspace === 'local' ? 'checkout' : 'worktree' }),
  } as unknown as P
}
