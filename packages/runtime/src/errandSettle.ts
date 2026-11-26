import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { placeOf, repositoryOf, viaHost } from './coordinatorPullRequests'
import { type Happened, labelOf, type SaidStep, UNWATCHED_REASON } from './errandNotes'
import { errandTaskPull } from './errandTask'
import { taskForWait } from './errandTaskWaits'
import { onceAnHour } from './errandWake'
import type { Errands } from './Errands'

/** What has become of a step, read now: done already, its wait met (and the step not taken), or neither. */
type Now = { readonly state: 'done' | 'met'; readonly happened: Happened } | { readonly state: 'not' }

interface Held {
  readonly stepKey: string
  readonly tool: string
  readonly target: string
  readonly taskId: string | null
  readonly says: string | null
  readonly request: string
  readonly waits: string
}

const NOT: Now = { state: 'not' }

/** A pull request as people say it, linked: #957. */
const pullSaid = (change: { readonly url: string; readonly number: number }) =>
  labelOf(change.url) ?? { label: `#${change.number}`, url: change.url }

/**
 * The task a step names: its own, the target's task:<slug>, or (in a record kept before steps were bound) a branch's last part,
 * as "… pull request from althar/release-prep".
 */
const taskNamed = (projectId: string, names: ReadonlyArray<string | null | undefined>) =>
  Effect.gen(function* () {
    for (const name of names) {
      if (name === null || name === undefined) continue
      const slug = name.startsWith('task:') ? name.slice(5) : (/([a-z0-9-]+)\s*$/.exec(name.split('/').pop() ?? '')?.[1] ?? name)
      const task = (yield* taskForWait(projectId, name)) ?? (yield* taskForWait(projectId, slug))
      if (task !== undefined) return task.id
    }
    return undefined
  })

/** Its task's pull request, as the host has it now; null where there is none, or none to tell from another. */
const taskPull = (projectId: string, taskId: string, errandId: string) =>
  errandTaskPull(projectId, taskId, errandId).pipe(Effect.orElseSucceed(() => null))

const mergeNow = (projectId: string, errandId: string, step: Held) =>
  Effect.gen(function* () {
    let change: { readonly url: string; readonly number: number; readonly state: string; readonly draft: boolean } | null = null
    if (/^https?:\/\//.test(step.target)) {
      const place = yield* placeOf(projectId, step.target)
      change = yield* viaHost(place.host.change(place.repository, place.number))
    } else {
      const task = yield* taskNamed(projectId, [step.taskId, step.target])
      if (task !== undefined) change = (yield* taskPull(projectId, task, errandId))?.change ?? null
    }
    if (change === null) return NOT
    const link = pullSaid(change)
    if (change.state === 'merged') return { state: 'done', happened: { said: `${link.label} merged already`, links: [link] } } as const
    if (change.state === 'open' && !change.draft)
      return { state: 'met', happened: { said: `${link.label} is open`, links: [link] } } as const
    return NOT
  })

const tagNow = (projectId: string, errandId: string, step: Held) =>
  Effect.gen(function* () {
    const request = JSON.parse(step.request) as { tag?: unknown; commit?: unknown; move?: unknown; delete?: unknown }
    // Moving or deleting a tag can't be told from the tag being there.
    if (typeof request.tag !== 'string' || request.move === true || request.delete === true) return NOT
    const { host, repository } = yield* repositoryOf(projectId, step.target.split(' tag ')[0])
    const tag = yield* viaHost(host.tag(repository, request.tag))
    if (tag !== null)
      return {
        state: 'done',
        happened: { said: `${request.tag} is tagged already`, links: tag.url === null ? [] : [{ label: request.tag, url: tag.url }] },
      } as const
    // What it waited for: the merge of the task its commit or its waits name.
    const waits = JSON.parse(step.waits) as Array<{ target?: string }>
    const task = yield* taskNamed(projectId, [
      typeof request.commit === 'string' && request.commit.startsWith('task:') ? request.commit : null,
      step.taskId,
      ...waits.map((wait) => wait.target),
    ])
    if (task === undefined) return NOT
    const pull = yield* taskPull(projectId, task, errandId)
    if (pull?.change.state !== 'merged') return NOT
    const link = pullSaid(pull.change)
    return { state: 'met', happened: { said: `${link.label} merged`, links: [link] } } as const
  })

/** Only a merge or a tag can be read as done by someone else; a read that fails tells nothing, and is tried the next hour. */
const stepNow = (projectId: string, errandId: string, step: Held) =>
  step.tool === 'merge_pull_request'
    ? mergeNow(projectId, errandId, step).pipe(Effect.orElseSucceed((): Now => NOT))
    : step.tool === 'push_tag'
      ? tagNow(projectId, errandId, step).pipe(Effect.orElseSucceed((): Now => NOT))
      : Effect.succeed(NOT)

/**
 * A held errand whose wait has already happened closes by itself, with a line, rather than stay on hold: done, where each step
 * left was done already (the tag is there, the pull request merged); closed, where it was held for a wait Althar couldn't watch
 * and that wait has come since (the pull request opened or merged), so its step is the person's to ask for again. An errand
 * held for an objection waits for the person, unless what it would do is done already. Read at most once an hour each.
 */
export const settleHeldErrands = (projectId: string, errands: typeof Errands.Service) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const held = yield* sql<{ id: string; reason: string | null }>`
      SELECT id, reason FROM errands WHERE project_id = ${projectId} AND state = 'paused' ORDER BY created_at, rowid`
    for (const errand of held) {
      if (!(yield* onceAnHour(projectId, 'errand_settle', errand.id))) continue
      yield* Effect.gen(function* () {
        const steps = yield* sql<Held>`SELECT step_key, tool, target, task_id, says, request, waits FROM errand_steps
          WHERE errand_id = ${errand.id} AND state = 'waiting' ORDER BY position`
        const done: Array<{ readonly key: string; readonly happened: Happened }> = []
        let next: { readonly step: Held; readonly now: Now } | undefined
        for (const step of steps) {
          const now = yield* stepNow(projectId, errand.id, step)
          if (now.state !== 'done') {
            next = { step, now }
            break
          }
          done.push({ key: step.stepKey, happened: now.happened })
        }
        if (next === undefined) {
          if (done.length > 0)
            yield* errands.settle(errand.id, {
              done: done.map((one) => one.key),
              left: undefined,
              happened: done.map((one) => one.happened),
            })
          return
        }
        if (next.now.state === 'met' && errand.reason?.startsWith(UNWATCHED_REASON) === true) {
          const step: SaidStep = {
            tool: next.step.tool,
            target: next.step.target,
            says: next.step.says,
            request: JSON.parse(next.step.request) as Record<string, unknown>,
            waits: JSON.parse(next.step.waits) as SaidStep['waits'],
          }
          yield* errands.settle(errand.id, {
            done: done.map((one) => one.key),
            left: { step, happened: next.now.happened },
            happened: done.map((one) => one.happened),
          })
        }
      }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not read a held errand’s steps', cause)))
    }
  })
