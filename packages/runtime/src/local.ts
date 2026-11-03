import { existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import type { CheckoutAnswer, CheckoutAsk, OtherTask, WorksIn } from '@althar/contracts'
import type { ProjectId } from '@althar/domain'
import { removeFully } from '@althar/provider-adapters'
import { Effect, Option } from 'effect'
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
 *
 * A checkout is the folder it is, whatever names it (`checkoutKey`): two
 * projects may add the same one, and still only one task holds it. A settled
 * task holds it until everything of it has stopped (`atWork`), and the
 * person's answer holds for the one checkout they were asked about, as it was
 * then (`CheckoutConsent`).
 */

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
  /** Whether its project was removed: its task is over here, as a settled one is. */
  readonly removed: number
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
    p.slug AS project_slug, k.slug AS task_slug, k.title, k.state AS task_state, p.archived_at IS NOT NULL AS removed, w.kind, w.state, w.path, w.branch, w.branched_at IS NOT NULL AS branched,
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
 * A checkout as the folder it is, whatever path names it: its device and
 * inode, so the same folder added to two projects, or by a link or in
 * another case, is one checkout; its resolved path where those can't be read.
 */
export const checkoutKey = (path: string) => {
  try {
    const { dev, ino } = statSync(path, { bigint: true })
    return ino === 0n ? resolve(path) : `${dev}:${ino}`
  } catch {
    return resolve(path)
  }
}

/**
 * One at a time for each checkout: taking it, and giving it back, read
 * again under the lock, so the loop that gives settled tasks' checkouts back
 * and a task that asks for one never both act on what they read before.
 */
const checkoutLocks = makeKeyedLock()
const lockingCheckouts = <A, E, R>(paths: ReadonlyArray<string>, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  [...new Set(paths.map(checkoutKey))]
    .toSorted()
    .reduceRight<Effect.Effect<A, E, R>>((inner, key) => checkoutLocks.withLock(key, inner), effect)

/**
 * The tasks with something of theirs still at work here: an agent, in a turn
 * or not, or a settling that hasn't finished stopping what they ran. A
 * settled task's checkout is its own until it has none (Runs passes it).
 */
export type AtWork = Effect.Effect<ReadonlySet<string>>
const nobodyAtWork: AtWork = Effect.succeed(new Set())

const settledState = (state: string) => state === 'done' || state === 'abandoned'
/** Whether a workspace's task is over: settled, or its project removed. */
const overHere = (spot: Spot) => settledState(spot.taskState) || spot.removed === 1

/** Whether a task works Local: any of its workspaces here is its repository's checkout. */
export const worksLocal = (taskId: string) => Effect.map(spotsOf(taskId), (spots) => spots.some((spot) => spot.kind === 'checkout'))

/**
 * Checkouts here that tasks other than `taskId` hold, in any project, a
 * removed one too: taken and not given back, settled or not, oldest first.
 * A removed project's task holds its checkout until all of it has stopped,
 * as a settled one does; then it goes back, or is let go as it is.
 */
const holding = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    return yield* sql<Spot>`${sql.unsafe(SPOT)}
      WHERE w.device_id = ${instance.deviceId} AND w.kind = 'checkout' AND w.state = 'ready' AND w.returned_at IS NULL
        AND w.task_id <> ${taskId}
      ORDER BY w.created_at, w.rowid`
  })

/** The tasks of a project that have its repositories' checkouts here, or are to take them: what removing it stops first (Api's RemoveProject). */
export const localTasksIn = (projectId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    const rows = yield* sql<{ taskId: string }>`
      SELECT DISTINCT task_id FROM workspaces
      WHERE project_id = ${projectId} AND device_id = ${instance.deviceId} AND kind = 'checkout' AND returned_at IS NULL`
    return rows.map((row) => row.taskId)
  })

/**
 * The task that holds a repository's checkout here, other than `taskId`, in
 * whichever project added it: one that took it and hasn't given it back,
 * settled or not. A settled one whose checkout stays on its branch, for
 * changes the person hasn't committed, holds it until they are.
 */
export const holderOf = (repository: string, taskId: string) =>
  Effect.gen(function* () {
    const key = checkoutKey(repository)
    return (yield* holding(taskId)).find((one) => checkoutKey(one.repository) === key) ?? null
  })

/** Who works Local now in any of a task's repositories' checkouts, other than it, from any project: what it would wait for there. */
export const localTakenFor = (taskId: string) =>
  Effect.gen(function* () {
    const keys = new Set((yield* spotsOf(taskId)).map((spot) => checkoutKey(spot.repository)))
    if (keys.size === 0) return null
    const holder = (yield* holding(taskId)).find((one) => keys.has(checkoutKey(one.repository)))
    return holder === undefined ? null : ({ taskId: holder.taskId, title: holder.title } satisfies OtherTask)
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

/** A repository's checkout as the person was asked about it: the workspace, and what it was on and at. */
export interface CheckoutSeen {
  readonly spotId: string
  readonly branch: string | null
  readonly head: string
}

/**
 * The person's answer about one repository's checkout, as it was when they
 * were asked. It holds for that checkout only: waiting, while it still has
 * changes not committed; switching it, or starting from its branch, while it
 * is still on that branch at that commit. Anything else is asked again.
 */
export interface CheckoutConsent extends CheckoutSeen {
  readonly holdup: CheckoutAsk['holdup']
  readonly answer: Exclude<CheckoutAnswer, 'worktree'>
}

/** Where a task stands as its first step would begin: placed where it works, or waiting, and why. */
export type Placed =
  | { readonly kind: 'ready' }
  /** Another task works in the checkout. */
  | { readonly kind: 'taken'; readonly by: OtherTask }
  /** The person is asked first: the checkout has changes not committed, or is on a branch of their own; `seen` is what their answer holds for. */
  | { readonly kind: 'asks'; readonly ask: CheckoutAsk; readonly seen: CheckoutSeen }
  /** The person chose to wait until the checkout's changes are committed, and they aren't yet. */
  | { readonly kind: 'changes'; readonly repository: string }

/**
 * Gives a settled task's checkout back: to the branch it was on, where it is
 * clean and still on the task's branch. Not while anything of the task is
 * still at work (`held`): settling stops its agents and what they ran first.
 * With changes not committed it stays, said in the task's thread the first
 * time (`told`). One the person switched themselves is left where they put it.
 * A removed project's task gives its checkout back as a settled one does;
 * with changes, there is no thread left to say so in, so it is let go as it
 * is (`left`), and the next task that wants it asks the person about them.
 */
export const giveBackSpot = (spot: Spot, told: (spot: Spot) => boolean = () => false, atWork: AtWork = nobodyAtWork) =>
  lockingCheckouts([spot.repository], givingBack(spot, told, atWork))

const givingBack = (was: Spot, told: (spot: Spot) => boolean, atWork: AtWork) =>
  Effect.gen(function* () {
    const spot = yield* spotById(was.id)
    if (spot === null || spot.kind !== 'checkout' || spot.state !== 'ready' || spot.returnedAt !== null) return 'back' as const
    // Opened again, or still stopping: it is the task's yet. Read under the lock, as nothing starts a settled task's agent.
    if (!overHere(spot) || (yield* atWork).has(spot.taskId)) return 'held' as const
    const returnsTo = spot.returnsTo ?? spot.base ?? 'main'
    const gave = yield* giveBack(spot.repository, spot.branch, returnsTo)
    if (gave.kind === 'changes' && spot.removed === 1) {
      yield* record(spot, { returnedAt: yield* timestamp }, 'workspace.returned', { to: returnsTo, moved: false, left: true })
      return 'left' as const
    }
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
 * unless another task holds one (`taken`; a settled one only until all of it
 * has stopped, `atWork`), or one has changes not committed or is on a branch
 * of the person's own, which the person is asked about (`asks`), one
 * repository at a time, or answered for that checkout as it still is
 * (`consents`). Nothing is taken until every checkout can be: a task never
 * holds one while it waits for another.
 */
export const place = (
  taskId: string,
  worksIn: WorksIn,
  consents: ReadonlyArray<CheckoutConsent> = [],
  told?: (spot: Spot) => boolean,
  atWork: AtWork = nobodyAtWork,
) =>
  Effect.flatMap(spotsOf(taskId), (spots) =>
    lockingCheckouts(
      spots.map((spot) => spot.repository),
      placing(taskId, worksIn, consents, told ?? (() => false), atWork),
    ),
  )

const placing = (
  taskId: string,
  worksIn: WorksIn,
  consents: ReadonlyArray<CheckoutConsent>,
  told: (spot: Spot) => boolean,
  atWork: AtWork,
) =>
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
      const holder = yield* holderOf(spot.repository, taskId)
      // One settled, or of a removed project, all of it stopped: given back now where it can be, or let go as it is.
      const gave = holder !== null && overHere(holder) ? yield* givingBack(holder, told, atWork) : null
      const freed = gave === 'back' || gave === 'left'
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
      const seen: CheckoutSeen = { spotId: spot.id, branch: was.branch, head: was.head }
      // What the person answered about this checkout, while it is as it was when they were asked.
      const agreed = (about: CheckoutConsent['holdup']) =>
        consents.find(
          (one) =>
            one.spotId === spot.id && one.holdup === about && (about === 'changes' || (one.branch === was.branch && one.head === was.head)),
        )?.answer
      if (holdup?.kind === 'changes') {
        if (agreed('changes') === 'wait') return { kind: 'changes', repository: spot.name } as Placed
        return {
          kind: 'asks',
          ask: { repository: spot.name, holdup: 'changes', files: holdup.files, branch: was.branch, base },
          seen,
        } as Placed
      }
      const onBranch = holdup?.kind === 'branch' ? agreed('branch') : undefined
      if (holdup?.kind === 'branch' && onBranch !== 'switch' && onBranch !== 'from_branch')
        return { kind: 'asks', ask: { repository: spot.name, holdup: 'branch', files: [], branch: holdup.branch, base }, seen } as Placed
      taking.push({ spot, start: onBranch === 'from_branch' ? was.head : baseCommit, baseRef, was })
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

/** Checkouts settled tasks still hold, a removed project's tasks too, to give back: as they settle, or whose changes kept them on their task's branch. */
export const settledHolding = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const instance = yield* Instance
  return yield* sql<Spot>`${sql.unsafe(SPOT)}
    WHERE w.device_id = ${instance.deviceId} AND w.kind = 'checkout' AND w.state = 'ready' AND w.returned_at IS NULL
      AND (k.state IN ('done', 'abandoned') OR p.archived_at IS NOT NULL)`
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
