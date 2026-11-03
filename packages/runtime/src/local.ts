import { existsSync } from 'node:fs'
import { join } from 'node:path'

import type { CheckoutAnswer, CheckoutAsk, OtherTask, WorksIn } from '@althar/contracts'
import type { ProjectId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { removeFully } from '@althar/provider-adapters'
import { type Crypto, Effect, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { type Checkout, giveBack, holdupOf, readCheckout, takeCheckout } from './checkouts'
import { RuntimeConfig } from './Config'
import { makeScratch } from './firstWrite'
import { makeKeyedLock } from './keyedLock'
import { branchExists, commitOf, git } from './git'
import { Instance } from './Instance'
import { prepareWorktree, startCommitOf, startOf } from './Projects'
import { change, fact, timestamp } from './records'
import { addItem } from './threads'

/*
 * Local tasks (ADR-086). A task works either in worktrees of its own, as
 * before, or Local, in each of its repositories' own checkouts here, where
 * the person works. A Local task's workspace is the checkout itself
 * (`workspaces.kind = 'checkout'`): planned, it waits there, `preparing`,
 * until its plan starts; then it takes the checkout, which makes its branch
 * there and checks it out, and it holds it until it is settled, when the
 * checkout goes back to the branch it was on. One task holds a checkout at a
 * time. Althar never switches a checkout with changes not committed: it asks
 * the person (`checkout` calls), and never stashes, resets or cleans.
 *
 * Where it works can change until it starts: a plan's choice moves its
 * workspace between a worktree and the checkout as its first step begins, so
 * nothing waits on git while the person decides, and a worktree made for a
 * draft that then starts Local goes, unused.
 */

type Store = SqlClient.SqlClient | Ledger | Crypto.Crypto | Instance | RuntimeConfig

/** A task's workspace in one of its repositories, as Local reads it. */
export interface Spot {
  readonly id: string
  readonly projectId: ProjectId
  readonly taskId: string
  readonly threadId: string
  readonly bindingId: string
  readonly name: string
  readonly bindingSlug: string
  readonly projectSlug: string
  readonly taskSlug: string
  readonly title: string
  readonly taskState: string
  /** The checkout, Local; null for a worktree. */
  readonly kind: 'checkout' | null
  readonly state: string
  readonly path: string
  readonly branch: string
  /** Whether it has its branch already: a quick task's worktree has none until its lead first changes the repository. */
  readonly branched: number
  readonly baseCommit: string | null
  readonly returnsTo: string | null
  readonly returnedAt: string | null
  /** The repository's own checkout here. */
  readonly repository: string
  readonly base: string | null
  readonly changeTarget: string | null
}

const SPOT = `
  SELECT w.id, w.project_id, w.task_id, h.id AS thread_id, w.binding_id, b.display_name AS name, b.slug AS binding_slug,
    p.slug AS project_slug, k.slug AS task_slug, k.title, k.state AS task_state, w.kind, w.state, w.path, w.branch, w.branched_at IS NOT NULL AS branched,
    w.base_commit, w.returns_to, w.returned_at, l.path AS repository, b.default_base_ref AS base, b.change_target
  FROM workspaces w
  JOIN repository_bindings b ON b.id = w.binding_id
  JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = w.device_id
  JOIN tasks k ON k.id = w.task_id
  JOIN projects p ON p.id = w.project_id
  JOIN threads h ON h.task_id = w.task_id AND h.kind = 'task'`

/** A task's workspaces here that it writes in, in its project's order of repositories. */
export const spotsOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    return yield* sql<Spot>`${sql.unsafe(SPOT)}
      WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} AND w.access = 'write'
      ORDER BY b.created_at, b.rowid`
  })

/** A workspace as it stands now, by its id. */
const spotById = (id: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [spot] = yield* sql<Spot>`${sql.unsafe(SPOT)} WHERE w.id = ${id}`
    return spot ?? null
  })

/**
 * One at a time for each checkout: taking it, and giving it back, read
 * again under the lock, so the loop that gives settled tasks' checkouts back
 * and a task that asks for one never both act on what they read before.
 */
const checkoutLocks = makeKeyedLock()
const lockingCheckouts = <A, E, R>(paths: ReadonlyArray<string>, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  [...new Set(paths)].toSorted().reduceRight<Effect.Effect<A, E, R>>((inner, path) => checkoutLocks.withLock(path, inner), effect)

/** Whether a task works Local: any of its workspaces here is its repository's checkout. */
export const worksLocal = (taskId: string) => Effect.map(spotsOf(taskId), (spots) => spots.some((spot) => spot.kind === 'checkout'))

/**
 * The task that holds a repository's checkout here, other than `taskId`:
 * one that took it and hasn't given it back, settled or not. A settled one
 * whose checkout stays on its branch, for changes the person hasn't
 * committed, holds it until they are.
 */
export const holderOf = (bindingId: string, taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    const [holder] = yield* sql<Spot>`${sql.unsafe(SPOT)}
      WHERE w.binding_id = ${bindingId} AND w.device_id = ${instance.deviceId} AND w.kind = 'checkout' AND w.state = 'ready'
        AND w.returned_at IS NULL AND w.task_id <> ${taskId}
      LIMIT 1`
    return holder ?? null
  })

/** Who works Local now in any of a project's repositories, other than `taskId`: what a task planned there would wait for. */
export const localTakenFor = (projectId: string, taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    const [holder] = yield* sql<OtherTask>`
      SELECT k.id AS task_id, k.title FROM workspaces w JOIN tasks k ON k.id = w.task_id
      WHERE w.project_id = ${projectId} AND w.device_id = ${instance.deviceId} AND w.kind = 'checkout' AND w.state = 'ready'
        AND w.returned_at IS NULL AND w.task_id <> ${taskId}
        AND w.binding_id IN (SELECT binding_id FROM workspaces WHERE task_id = ${taskId} AND access = 'write')
      ORDER BY w.created_at LIMIT 1`
    return holder ?? null
  })

/* ---- Moving a task that hasn't started between a worktree and the checkout ---- */

/** Says a line across a task's thread about its checkout, as a folder's going and coming back is said (ADR-056). */
const say = (spot: Pick<Spot, 'projectId' | 'threadId'>, title: string, description: string | null = null) =>
  addItem({ projectId: spot.projectId, threadId: spot.threadId }, 'notice', {
    source: 'runtime',
    severity: 'info',
    title,
    description,
    role: 'folder',
  })

const record = (spot: Spot, set: Readonly<Record<string, unknown>>, type: string, payload?: unknown) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    yield* sql.withTransaction(
      Effect.gen(function* () {
        const revision = yield* change('workspaces', spot.id, set)
        yield* fact({
          projectId: spot.projectId,
          aggregateType: 'workspace',
          aggregateId: spot.id,
          revision,
          type,
          ...(payload === undefined ? {} : { payload }),
          actorId: instance.systemId,
        })
      }),
    )
  })

/**
 * A planned Local workspace becomes a worktree of its own, made now from
 * where the task starts, as one made with the task would be. Set up before
 * its lead's first turn, as any worktree is (Setups.ready).
 */
export const toWorktree = (spot: Spot) =>
  Effect.gen(function* () {
    const config = yield* RuntimeConfig
    const { remote, base } = yield* startOf(spot)
    const worktree = join(config.worktreeRoot, spot.projectSlug, spot.taskSlug, spot.bindingSlug)
    const made = yield* prepareWorktree(spot.repository, base, { worktree, branch: spot.branch }, remote, spot.branched === 0)
    yield* record(
      spot,
      {
        kind: null,
        state: 'ready',
        path: made.worktree,
        branch: made.branch,
        baseRef: made.baseRef,
        baseCommit: made.baseCommit,
        returnsTo: null,
        returnedAt: null,
        setup: null,
      },
      'workspace.ready',
      { ...made, worksIn: 'worktree' },
    )
  })

/**
 * A worktree made with a draft that starts Local goes, unused: its folder,
 * and its branch where nothing was committed on it. The workspace is the
 * checkout from now on, waiting to be taken.
 */
export const toCheckout = (spot: Spot) =>
  Effect.gen(function* () {
    if (existsSync(spot.path))
      yield* git(spot.repository, 'worktree', 'remove', '--force', '--force', spot.path).pipe(
        Effect.catch(() => removeFully(spot.path)),
        Effect.ignore,
      )
    if (spot.branched === 1 && spot.baseCommit !== null && (yield* branchExists(spot.repository, spot.branch))) {
      const tip = yield* commitOf(spot.repository, spot.branch).pipe(Effect.option)
      if (Option.isSome(tip) && tip.value === spot.baseCommit) yield* git(spot.repository, 'branch', '-D', spot.branch).pipe(Effect.ignore)
    }
    yield* record(spot, { kind: 'checkout', state: 'preparing', path: spot.repository, setup: null }, 'workspace.planned', {
      worksIn: 'checkout',
    })
  })

/* ---- Taking a checkout, and giving it back ---- */

/** Where a task stands as its first step would begin: placed where it works, or waiting, and why. */
export type Placed =
  | { readonly kind: 'ready' }
  /** Another task works in the checkout. */
  | { readonly kind: 'taken'; readonly by: OtherTask }
  /** The person is asked first: the checkout has changes not committed, or is on a branch of their own. */
  | { readonly kind: 'asks'; readonly ask: CheckoutAsk }
  /** The person chose to wait until the checkout's changes are committed, and they aren't yet. */
  | { readonly kind: 'changes'; readonly repository: string }

/**
 * Gives a checkout back: to the branch it was on, where it is clean and
 * still on the task's branch. With changes not committed it stays, said in
 * the task's thread the first time (`told`). One the person switched
 * themselves is left where they put it.
 */
export const giveBackSpot = (spot: Spot, told: (spot: Spot) => boolean = () => false) =>
  lockingCheckouts([spot.repository], givingBack(spot, told))

const givingBack = (was: Spot, told: (spot: Spot) => boolean) =>
  Effect.gen(function* () {
    const spot = yield* spotById(was.id)
    if (spot === null || spot.kind !== 'checkout' || spot.state !== 'ready' || spot.returnedAt !== null) return 'back' as const
    const returnsTo = spot.returnsTo ?? spot.base ?? 'main'
    const gave = yield* giveBack(spot.repository, spot.branch, returnsTo)
    if (gave.kind === 'changes') {
      if (!told(spot))
        yield* say(
          spot,
          `${spot.name} stays on ${spot.branch}`,
          `${listed(gave.files)} ${gave.files.length === 1 ? 'has' : 'have'} uncommitted changes. It goes back to ${shortRef(returnsTo)} once they’re committed.`,
        )
      return 'changes' as const
    }
    yield* record(spot, { returnedAt: yield* timestamp }, 'workspace.returned', { to: returnsTo, moved: gave.kind === 'moved' })
    if (gave.kind === 'back') yield* say(spot, `${spot.name} is back on ${shortRef(returnsTo)}`)
    return 'back' as const
  })

/** A commit, as a branch it went back to may be, short; a branch as it is. */
const shortRef = (ref: string) => (/^[0-9a-f]{40,64}$/.test(ref) ? ref.slice(0, 7) : ref)

/** Files in a sentence: the first three, and how many more. */
const listed = (files: ReadonlyArray<string>) => {
  const shown = files.slice(0, 3)
  const more = files.length - shown.length
  if (more > 0) return `${shown.join(', ')} and ${more} more`
  return shown.length <= 1 ? (shown[0] ?? 'Files') : `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`
}

/** What a checkout is on, in words: its branch, or the commit it is detached at. */
const onOf = (checkout: Checkout) => checkout.branch ?? checkout.head.slice(0, 7)

/**
 * Places a task where its plan says, as its first step begins (ADR-086).
 * A worktree: a planned Local workspace becomes one now. Local: a worktree
 * made with its draft goes, and it takes each of its repositories' checkouts,
 * unless another task holds one (`taken`), or one has changes not committed
 * or is on a branch of the person's own, which the person is asked about
 * (`asks`) or answered (`answer`). Nothing is taken until every checkout can
 * be: a task never holds one while it waits for another.
 */
export const place = (taskId: string, worksIn: WorksIn, answer: CheckoutAnswer | null = null, told?: (spot: Spot) => boolean) =>
  Effect.flatMap(spotsOf(taskId), (spots) =>
    lockingCheckouts(
      spots.map((spot) => spot.repository),
      placing(taskId, worksIn, answer, told ?? (() => false)),
    ),
  )

const placing = (taskId: string, worksIn: WorksIn, answer: CheckoutAnswer | null, told: (spot: Spot) => boolean) =>
  Effect.gen(function* () {
    const spots = yield* spotsOf(taskId)
    if (worksIn === 'worktree') {
      for (const spot of spots) if (spot.kind === 'checkout' && spot.state === 'preparing') yield* toWorktree(spot)
      return { kind: 'ready' } as Placed
    }
    for (const spot of spots)
      if (spot.kind === null && spot.state === 'ready' && spot.returnedAt === null && !(yield* begun(spot))) yield* toCheckout(spot)
    const waiting = (yield* spotsOf(taskId)).filter((spot) => spot.kind === 'checkout' && spot.state === 'preparing')
    // First, whether each can be taken, changing nothing.
    const taking: Array<{ readonly spot: Spot; readonly start: string; readonly baseRef: string; readonly was: Checkout }> = []
    for (const spot of waiting) {
      const holder = yield* holderOf(spot.bindingId, taskId)
      // One settled whose checkout stayed for changes not committed then: given back now, if they are.
      const freed =
        holder !== null && (holder.taskState === 'done' || holder.taskState === 'abandoned')
          ? (yield* givingBack(holder, told)) === 'back'
          : false
      if (holder !== null && !freed) return { kind: 'taken', by: { taskId: holder.taskId, title: holder.title } } as Placed
      const was = yield* readCheckout(spot.repository)
      // Taken already, by this task, as Althar stopped before it said so: it is the task's.
      if (was.branch === spot.branch && (yield* branchExists(spot.repository, spot.branch))) {
        yield* record(spot, { state: 'ready', returnsTo: spot.base ?? 'main', branchedAt: yield* timestamp }, 'workspace.taken')
        continue
      }
      const { remote, base } = yield* startOf(spot)
      const { baseRef, baseCommit } = yield* startCommitOf(spot.repository, base, remote)
      const holdup = holdupOf(was, base, baseCommit)
      if (holdup?.kind === 'changes') {
        if (answer === 'wait') return { kind: 'changes', repository: spot.name } as Placed
        return {
          kind: 'asks',
          ask: { repository: spot.name, holdup: 'changes', files: holdup.files, branch: was.branch, base },
        } as Placed
      }
      if (holdup?.kind === 'branch' && answer !== 'switch' && answer !== 'from_branch')
        return { kind: 'asks', ask: { repository: spot.name, holdup: 'branch', files: [], branch: holdup.branch, base } } as Placed
      taking.push({ spot, start: holdup?.kind === 'branch' && answer === 'from_branch' ? was.head : baseCommit, baseRef, was })
    }
    // Then each is taken: its branch made where the task starts, and checked out.
    for (const { spot, start, baseRef, was } of taking) {
      const taken = yield* takeCheckout(spot.repository, spot.branch, start)
      yield* record(
        spot,
        { state: 'ready', branch: taken.branch, baseRef, baseCommit: start, returnsTo: taken.returnsTo, branchedAt: yield* timestamp },
        'workspace.taken',
        { branch: taken.branch, returnsTo: taken.returnsTo },
      )
      // A quick task's throwaway work goes where git ignores it, as in its own worktree.
      if (spot.branched === 0) yield* makeScratch(spot.repository)
      yield* say(spot, `${spot.name}: checked out ${taken.branch}`, `It was on ${onOf(was)}, and goes back when you settle this task.`)
    }
    return { kind: 'ready' } as Placed
  })

/** Whether a task's worktree has seen work: anything committed on its branch past where it started. */
const begun = (spot: Spot) =>
  Effect.gen(function* () {
    if (spot.branched === 0 || spot.baseCommit === null) return false
    const tip = yield* commitOf(spot.repository, spot.branch).pipe(Effect.option)
    return Option.isSome(tip) && tip.value !== spot.baseCommit
  })

/** Checkouts settled tasks still hold, to give back: those whose changes kept them on their task's branch. */
export const settledHolding = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const instance = yield* Instance
  return yield* sql<Spot>`${sql.unsafe(SPOT)}
    WHERE w.device_id = ${instance.deviceId} AND w.kind = 'checkout' AND w.state = 'ready' AND w.returned_at IS NULL
      AND k.state IN ('done', 'abandoned') AND p.archived_at IS NULL`
})

/**
 * A settled Local task opened again whose checkout went back: it carries on
 * in a worktree of its own, on its branch, so nothing switches the person's
 * checkout under them again. One whose checkout never went back carries on
 * there.
 */
export const reopenedSpot = (spot: Spot) =>
  Effect.gen(function* () {
    if (spot.kind !== 'checkout' || spot.returnedAt === null) return
    const config = yield* RuntimeConfig
    let worktree = join(config.worktreeRoot, spot.projectSlug, spot.taskSlug, spot.bindingSlug)
    for (let n = 2; existsSync(worktree); n += 1)
      worktree = `${join(config.worktreeRoot, spot.projectSlug, spot.taskSlug, spot.bindingSlug)}-${n}`
    yield* git(spot.repository, 'worktree', 'prune')
    yield* git(spot.repository, 'worktree', 'add', worktree, spot.branch)
    yield* record(spot, { kind: null, path: worktree, returnsTo: null, returnedAt: null, setup: null }, 'workspace.restored', {
      worksIn: 'worktree',
    })
    yield* say(spot, `${spot.name}: carries on in a worktree`, `On ${spot.branch}, as your checkout went back when it was settled.`)
  })
