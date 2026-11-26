import type { ChangeRequest } from '@althar/connectors'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { placeOf, repositoryOf, viaHost } from './coordinatorPullRequests'
import { type Happened, labelOf, type SaidStep, UNWATCHED_REASON } from './errandNotes'
import { errandTaskPull } from './errandTask'
import { taskForWait } from './errandTaskWaits'
import { errandWaitKinds } from './errandWaits'
import { onceAnHour } from './errandWake'
import type { Errands } from './Errands'

interface Wait {
  readonly kind: string
  readonly target: string
}

/**
 * What has become of a step, read now: done already; every one of its waits met, by what was seen (the step not taken); or
 * neither, which is all a read that proves less, or fails, can say.
 */
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

const waitsOf = (step: Held) => JSON.parse(step.waits) as ReadonlyArray<Wait>
const kindOf = (wait: Wait) => wait.kind.toLowerCase().replace(/[-\s]+/g, '_')

/** A pull request as people say it, linked: #957. */
const pullSaid = (change: { readonly url: string; readonly number: number }) =>
  labelOf(change.url) ?? { label: `#${change.number}`, url: change.url }

/**
 * The task a name means: a task:<slug>, a slug or id, or (in a record kept before steps were bound) a branch's last part,
 * as "… pull request from althar/release-prep".
 */
const taskOf = (projectId: string, name: string | null | undefined) =>
  Effect.gen(function* () {
    if (name === null || name === undefined) return undefined
    const bare = name.startsWith('task:') ? name.slice(5) : name
    const slug = /([a-z0-9-]+)\s*$/.exec(bare.split('/').pop() ?? '')?.[1] ?? bare
    return ((yield* taskForWait(projectId, bare)) ?? (yield* taskForWait(projectId, slug)))?.id
  })

/** Its task's pull request, as the host has it now; null where there is none, or none to tell from another. */
const taskPull = (projectId: string, taskId: string, errandId: string) =>
  errandTaskPull(projectId, taskId, errandId).pipe(Effect.orElseSucceed(() => null))

/**
 * The kinds of wait, as older versions kept them, a pull request read now proves: by name, never by a word inside one
 * ("not_merged" is not a merge). A kind of today's is its watcher's to read, and never one of these.
 */
const OPENED = ['pull_request_opened', 'pr_opened', 'pull_request_open', 'opened', 'open']
const MERGED = ['merged', 'pr_merged', 'pull_request_merged', 'task_merged']

/**
 * A merge: done where its pull request merged. Met where it is open, not a draft, and every wait of the step is an opening
 * of that same pull request: named by its link, number or branch, or by the task it is of. A wait on its checks, its review,
 * or another pull request, an open one doesn't prove.
 */
const mergeNow = (projectId: string, errandId: string, step: Held) =>
  Effect.gen(function* () {
    let change: ChangeRequest | null = null
    let task: string | undefined
    if (/^https?:\/\//.test(step.target)) {
      const place = yield* placeOf(projectId, step.target)
      change = yield* viaHost(place.host.change(place.repository, place.number))
    } else {
      task = (yield* taskOf(projectId, step.taskId)) ?? (yield* taskOf(projectId, step.target))
      if (task !== undefined) change = (yield* taskPull(projectId, task, errandId))?.change ?? null
    }
    if (change === null) return NOT
    const link = pullSaid(change)
    if (change.state === 'merged') return { state: 'done', happened: { said: `${link.label} merged already`, links: [link] } } as const
    if (change.state !== 'open' || change.draft) return NOT
    const names = new Set([change.url, `#${change.number}`, String(change.number), change.source].map((one) => one.toLowerCase()))
    const waits = waitsOf(step)
    for (const wait of waits) {
      if (!OPENED.includes(kindOf(wait))) return NOT
      const target = wait.target.trim().toLowerCase()
      if (names.has(target)) continue
      if (task === undefined || (yield* taskOf(projectId, wait.target)) !== task) return NOT
    }
    return waits.length === 0 ? NOT : ({ state: 'met', happened: { said: `${link.label} is open`, links: [link] } } as const)
  })

/**
 * A tag: done only where the tag is on the commit the step asks for, as push_tag proves it: a task's landed merge commit,
 * once the host says which; a commit or branch named; or, named none, the default branch's head. An errand kept by an older
 * version as "tag it once <task> merged", naming no commit, asks for that merge's commit. Met where it isn't tagged and every
 * wait is a merge of a task whose pull request merged.
 */
const tagNow = (projectId: string, errandId: string, step: Held) =>
  Effect.gen(function* () {
    const request = JSON.parse(step.request) as { tag?: unknown; commit?: unknown; move?: unknown; delete?: unknown }
    // Moving or deleting a tag can't be told from the tag being there.
    if (typeof request.tag !== 'string' || request.move === true || request.delete === true) return NOT
    const { host, repository } = yield* repositoryOf(projectId, step.target.split(' tag ')[0])
    const where = repository.path.join('/')
    const named = typeof request.commit === 'string' && request.commit.trim() !== '' ? request.commit.trim() : null
    const waits = waitsOf(step)
    const landed = (taskId: string) =>
      Effect.gen(function* () {
        const pull = yield* taskPull(projectId, taskId, errandId)
        if (pull?.change.state !== 'merged' || pull.host.product !== host.product || pull.repository.path.join('/') !== where) return null
        return pull
      })
    /** The commit a task's merge landed: undefined until the host says which, as push_tag refuses to guess. */
    const landedCommit = (name: string) =>
      Effect.gen(function* () {
        const task = yield* taskOf(projectId, name)
        return task === undefined ? undefined : ((yield* landed(task))?.change.mergeCommit ?? undefined)
      })
    const tag = yield* viaHost(host.tag(repository, request.tag))
    if (tag !== null) {
      const legacy =
        named === null ? waits.find((wait) => MERGED.includes(kindOf(wait)) && !errandWaitKinds.includes(wait.kind)) : undefined
      const wanted =
        named?.startsWith('task:') === true
          ? yield* landedCommit(named)
          : named !== null
            ? yield* viaHost(host.commitOf(repository, named))
            : legacy !== undefined
              ? yield* landedCommit(legacy.target)
              : yield* viaHost(host.commitOf(repository, repository.defaultBranch))
      // On another commit, or one Althar can't tell yet: not what was asked for, and the step stays.
      if (wanted === undefined || tag.commit !== wanted) return NOT
      return {
        state: 'done',
        happened: { said: `${request.tag} is tagged already`, links: tag.url === null ? [] : [{ label: request.tag, url: tag.url }] },
      } as const
    }
    if (waits.length === 0 || !waits.every((wait) => MERGED.includes(kindOf(wait)))) return NOT
    let seen: Happened | undefined
    for (const wait of waits) {
      const task = yield* taskOf(projectId, wait.target)
      const pull = task === undefined ? null : yield* landed(task)
      if (pull === null) return NOT
      const link = pullSaid(pull.change)
      seen = { said: `${link.label} merged`, links: [link] }
    }
    return seen === undefined ? NOT : ({ state: 'met', happened: seen } as const)
  })

/** Only a merge or a tag can be read as done by someone else; a read that fails tells nothing, and is tried the next hour. */
const stepNow = (projectId: string, errandId: string, step: Held) =>
  step.tool === 'merge_pull_request'
    ? mergeNow(projectId, errandId, step).pipe(Effect.orElseSucceed((): Now => NOT))
    : step.tool === 'push_tag'
      ? tagNow(projectId, errandId, step).pipe(Effect.orElseSucceed((): Now => NOT))
      : Effect.succeed(NOT)

const saidOf = (step: Held): SaidStep => ({
  tool: step.tool,
  target: step.target,
  says: step.says,
  request: JSON.parse(step.request) as Record<string, unknown>,
  waits: JSON.parse(step.waits) as SaidStep['waits'],
})

/**
 * A held errand whose wait has already happened closes by itself, with a line, rather than stay on hold: done, where each step
 * left was done already (the tag is on its commit, the pull request merged); closed, where it was held for a wait Althar
 * couldn't watch, on the step that has that wait, and every wait of that step has come since (the pull request opened, the
 * merge landed), so that step and those after it are the person's to ask for again. An errand held for any other reason waits
 * for the person, unless what it would do is done already. Each is read at most once an hour, and closed only where nothing
 * moved it while it was read.
 */
export const settleHeldErrands = (projectId: string, errands: typeof Errands.Service) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const held = yield* sql<{ id: string; reason: string | null; revision: number }>`
      SELECT id, reason, revision FROM errands WHERE project_id = ${projectId} AND state = 'paused' ORDER BY created_at, rowid`
    for (const errand of held) {
      if (!(yield* onceAnHour(projectId, 'errand_settle', errand.id))) continue
      yield* Effect.gen(function* () {
        const steps = yield* sql<Held>`SELECT step_key, tool, target, task_id, says, request, waits FROM errand_steps
          WHERE errand_id = ${errand.id} AND state = 'waiting' ORDER BY position`
        const done: Array<{ readonly key: string; readonly happened: Happened }> = []
        let at = 0
        let next: Now = NOT
        for (; at < steps.length; at++) {
          next = yield* stepNow(projectId, errand.id, steps[at]!)
          if (next.state !== 'done') break
          done.push({ key: steps[at]!.stepKey, happened: next.happened })
        }
        const closing = { revision: errand.revision, done: done.map((one) => one.key), happened: done.map((one) => one.happened) }
        if (at === steps.length) {
          if (done.length > 0) yield* errands.settle(errand.id, { ...closing, left: undefined })
          return
        }
        const step = steps[at]!
        const unwatched = waitsOf(step).some((wait) => !errandWaitKinds.includes(wait.kind))
        if (next.state === 'met' && unwatched && errand.reason?.startsWith(UNWATCHED_REASON) === true)
          yield* errands.settle(errand.id, {
            ...closing,
            left: { steps: steps.slice(at).map(saidOf), happened: next.happened },
          })
      }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not read a held errand’s steps', cause)))
    }
  })
