import { AutomationDefinition } from '@althar/contracts'
import type { ActorId, ProjectId } from '@althar/domain'
import { Effect, Option, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { change, fact } from './records'
import type { ProjectRuleSet } from './rules'

/*
 * What every part knows of an automation's run (docs/plans/automations.md):
 * the automation a task's run came from and the definition it ran with, read
 * from the occurrence that names the task; and naming the task, in the
 * transaction that makes it, so a restart in between finds the task and
 * never makes a second. The rules, the places among the agents at work, the
 * review's posting and the signature read it here.
 */

/** A definition's parts as the store keeps them: all of it but its name and its prompt, which are columns. */
export const DefinitionParts = AutomationDefinition.mapFields(({ name: _name, prompt: _prompt, ...rest }) => rest)

const decodeParts = Schema.decodeUnknownOption(Schema.fromJsonString(DefinitionParts))

/** A definition from its row: its name, its prompt and its parts; none where its parts don't read. */
export const definitionOf = (row: { readonly name: string; readonly prompt: string; readonly parts: string }) =>
  Option.map(decodeParts(row.parts), (parts): AutomationDefinition => ({ name: row.name, prompt: row.prompt, ...parts }))

/** The parts of a definition, as the store keeps them. */
export const partsOf = ({ name: _name, prompt: _prompt, ...parts }: AutomationDefinition) => JSON.stringify(parts)

/** The automation a task's run came from. */
export interface RunOf {
  readonly automationId: string
  readonly projectId: ProjectId
  readonly occurrenceId: string
  readonly name: string
  readonly definition: AutomationDefinition
  /** Its reviews post themselves once drafted, as the person said on its first. */
  readonly postsReviews: boolean
}

/** The automation whose run a task is; null where no automation started it, or its definition doesn't read. */
export const automationOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{
      automationId: string
      projectId: ProjectId
      occurrenceId: string
      name: string
      prompt: string
      parts: string
      postsReviews: number
    }>`
      SELECT o.automation_id, o.project_id, o.id AS occurrence_id, d.name, d.prompt, d.parts, a.posts_reviews
      FROM automation_occurrences o JOIN automations a ON a.id = o.automation_id
      JOIN automation_definitions d ON d.automation_id = o.automation_id AND d.number = o.definition
      WHERE o.task_id = ${taskId} LIMIT 1`
    if (row === undefined) return null
    return Option.match(definitionOf(row), {
      onNone: () => null,
      onSome: (definition): RunOf => ({
        automationId: row.automationId,
        projectId: row.projectId,
        occurrenceId: row.occurrenceId,
        name: row.name,
        definition,
        postsReviews: row.postsReviews === 1,
      }),
    })
  })

/**
 * Names an occurrence's task, inside the transaction that makes the task:
 * the occurrence is running from then, its task with it.
 */
export const linkTask = (occurrenceId: string, taskId: string, actorId: ActorId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ projectId: ProjectId; state: string }>`
      SELECT project_id, state FROM automation_occurrences WHERE id = ${occurrenceId}`
    if (row === undefined || row.state !== 'starting') return
    const revision = yield* change('automation_occurrences', occurrenceId, { taskId, state: 'running' })
    yield* fact({
      projectId: row.projectId,
      aggregateType: 'automation_occurrence',
      aggregateId: occurrenceId,
      revision,
      type: 'automation_occurrence.started',
      payload: { taskId },
      actorId,
    })
  })

/**
 * The rules an automation's run is decided by: its project's, everything
 * allowed where it allows everything, and pushing to the default branch never
 * allowed, which allowing everything doesn't go past.
 */
export const runRules = (project: ProjectRuleSet, allowsEverything: boolean): ProjectRuleSet => ({
  ...project,
  mode: allowsEverything ? 'allow' : project.mode,
  never: project.never.includes('default-branch') ? project.never : [...project.never, 'default-branch'],
})

/** The tasks automations' runs started that are still under way: their work waits after everything else, and one at a time. */
export const automatedTasks = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<{ taskId: string }>`
    SELECT DISTINCT task_id FROM automation_occurrences WHERE task_id IS NOT NULL AND state = 'running'`
  return new Set(rows.map((row) => row.taskId))
})
