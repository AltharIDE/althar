import { existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import type { CheckoutAnswer, CheckoutAsk, OtherTask, WorksIn } from '@althar/contracts'
import type { ProjectId } from '@althar/domain'
import { removeFully } from '@althar/provider-adapters'
import { Effect, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { type Checkout, giveBack, holdupOf, isClean, readCheckout, takeCheckout } from './checkouts'
import { RuntimeConfig } from './Config'
import { makeScratch } from './firstWrite'
import { makeKeyedLock } from './keyedLock'
import { branchExists, commitOf, git, gitOutcome, uncommittedFiles } from './git'
import { Instance } from './Instance'
import { branchName, prepareWorktree, startCommitOf, startOf, towardHere } from './Projects'
import { onRemote } from './forks'
import { change, fact, timestamp } from './records'
import { addItem } from './threads'

/*
 * Local tasks (ADR-091). A task works either in worktrees of its own, as
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
  /** Where it started from, as git names it: origin/main, upstream/release/0.8.0. */
  readonly baseRef: string
  /** The branch its work goes into (ADR-093); null for the default branch. */
  readonly toward: string | null
  /** Where a running task is moving, while something holds the move: a worktree, or the checkout. */
  readonly movingTo: 'worktree' | 'checkout' | null
  /** The change it is, by name, where the task has several; null for its first. */
  readonly change: string | null
}

const SPOT = `
  SELECT w.id, w.project_id, w.task_id, h.id AS thread_id, w.binding_id, b.display_name AS name, b.slug AS binding_slug,
    p.slug AS project_slug, k.slug AS task_slug, k.title, k.state AS task_state, p.archived_at IS NOT NULL AS removed, w.kind, w.state, w.path, w.branch, w.branched_at IS NOT NULL AS branched,
    w.base_commit, w.returns_to, w.returned_at, l.path AS repository, b.default_base_ref AS base, b.change_target, w.base_ref, w.toward,
    w.moving_to, w.name AS change
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
    if (spot.toward !== null) yield* towardHere(spot.repository, spot.toward, remote)
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

/**
 * A worktree made with a draft whose branch to work toward changed on its
 * plan card (ADR-093): unused, it moves to where the task starts now, the
 * branch with it, keeping the files its setup made, which git ignores.
 */
export const retarget = (spot: Spot) =>
  Effect.gen(function* () {
    const { remote, base } = yield* startOf(spot)
    if (branchName(spot.baseRef, [remote]) === base) return
    const { baseRef, baseCommit } = yield* startCommitOf(spot.repository, base, remote)
    yield* git(spot.path, 'reset', '-q', '--keep', baseCommit)
    if (spot.toward !== null) yield* towardHere(spot.repository, spot.toward, remote)
    yield* record(spot, { baseRef, baseCommit }, 'workspace.retargeted', { baseRef, baseCommit, toward: spot.toward })
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
    const returnsTo = yield* returnsToOf(spot)
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

/** Where a checkout goes back to: where it was, or its default branch where that branch was deleted meanwhile. */
const returnsToOf = (spot: Spot) =>
  Effect.gen(function* () {
    const was = spot.returnsTo ?? spot.base ?? 'main'
    const there = (yield* gitOutcome(spot.repository, 'rev-parse', '--verify', '-q', `${was}^{commit}`)).code === 0
    return there ? was : (spot.base ?? 'main')
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
 * Places a task where its plan says, as its first step begins (ADR-091).
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
      for (const spot of spots)
        if (spot.kind === 'checkout' && spot.state === 'preparing') yield* toWorktree(spot)
        else if (spot.kind === null && spot.state === 'ready' && !(yield* begun(spot))) yield* retarget(spot)
      return { kind: 'ready' } as Placed
    }
    for (const spot of spots)
      if (spot.kind === null && spot.state === 'ready' && spot.returnedAt === null && !(yield* begun(spot))) yield* toCheckout(spot)
    const waiting = (yield* spotsOf(taskId)).filter((spot) => spot.kind === 'checkout' && spot.state === 'preparing')
    // First, whether each can be taken, changing nothing.
    const taking: Array<{
      readonly spot: Spot
      readonly start: string
      readonly baseRef: string
      readonly remote: string
      readonly was: Checkout
    }> = []
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
      const holdup = holdupOf(was, base, baseCommit, spot.base === null ? [] : [spot.base])
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
      taking.push({ spot, start: onBranch === 'from_branch' ? was.head : baseCommit, baseRef, remote, was })
    }
    // Then each is taken: its branch made where the task starts, and checked out.
    for (const { spot, start, baseRef, remote, was } of taking) {
      const taken = yield* takeCheckout(spot.repository, spot.branch, start)
      if (spot.toward !== null) yield* towardHere(spot.repository, spot.toward, onRemote(baseRef, [remote])?.remote ?? 'origin')
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

/** Whether any task holds a checkout here, or is taking one: what the checkouts are looked at again for, every few seconds (Runs). */
export const checkoutsHeld = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const instance = yield* Instance
  const [one] = yield* sql<{ id: string }>`
    SELECT id FROM workspaces WHERE device_id = ${instance.deviceId} AND kind = 'checkout' AND returned_at IS NULL LIMIT 1`
  return one !== undefined
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

/* ---- Moving a running task between a worktree and Local ---- */

/*
 * A running task moves between a worktree and Local between its lead's turns,
 * with its branch and its conversation (a task is a conversation plus parts,
 * "Moving between a worktree and Local"; the Handoff ADR-091 left unbuilt).
 * One change at a time is Local: the one moved, the task's first unless said.
 * Every Local rule stays: Althar never switches a checkout with changes not
 * committed, never switches it off a branch of the person's own without
 * asking, and never stashes, resets or cleans it. What holds a move is kept
 * on the workspace (`moving_to`), said once, and tried again as the task's
 * lead finishes each turn, until the person calls it off.
 */

/** What a move did: moved; waiting, and why, in words; or a question for the person about their checkout, as it is now. */
export type Moved =
  | { readonly kind: 'moved' }
  | { readonly kind: 'waits'; readonly why: string }
  | { readonly kind: 'asks'; readonly ask: CheckoutAsk; readonly seen: { readonly branch: string | null; readonly head: string } }

/** The person's word to switch their checkout off a branch of their own, for the checkout as it was when they were asked. */
export interface MoveConsent {
  readonly branch: string | null
  readonly head: string
}

/** The workspaces of one change of a task: the one named, else its first. */
const changeSpots = (taskId: string, change: string | null) =>
  Effect.map(spotsOf(taskId), (spots) =>
    spots.filter((spot) => spot.state !== 'away' && spot.state !== 'cleaned' && (spot.change ?? null) === change),
  )

/** Keeps where a change is moving while something holds it, or clears it, said once in its thread when it starts to wait. */
const holdMove = (spot: Spot, to: 'worktree' | 'checkout' | null, why?: string, seen?: MoveConsent) =>
  Effect.gen(function* () {
    if (spot.movingTo === to) {
      // Waiting as it was, for the same reason: nothing new to keep or say.
      if (to === null) return
      const sql = yield* SqlClient.SqlClient
      const [last] = yield* sql<{ why: string | null; head: string | null }>`
        SELECT json_extract(payload, '$.why') AS why, json_extract(payload, '$.seen.head') AS head FROM record_events
        WHERE aggregate_type = 'workspace' AND aggregate_id = ${spot.id} AND type = 'workspace.move_waits'
        ORDER BY rowid DESC LIMIT 1`
      if (last !== undefined && last.why === (why ?? null) && last.head === (seen?.head ?? null)) return
    }
    yield* record(
      spot,
      { movingTo: to },
      to === null ? 'workspace.move_dropped' : 'workspace.move_waits',
      to === null ? {} : { to, why, ...(seen === undefined ? {} : { seen }) },
    )
    if (to !== null && why !== undefined && seen === undefined) yield* say(spot, why)
  })

/** Commits what a worktree has that isn't committed, on the task's branch, before it moves: nothing is left behind. */
const commitLeft = (spot: Spot) =>
  Effect.gen(function* () {
    if ((yield* uncommittedFiles(spot.path)).length === 0) return
    yield* git(spot.path, 'add', '-A')
    const message = 'Work in progress, as the task moved to Local'
    yield* git(spot.path, 'commit', '-q', '-m', message).pipe(
      Effect.catch(() => git(spot.path, '-c', 'user.name=Althar', '-c', 'user.email=althar@localhost', 'commit', '-q', '-m', message)),
    )
  })

/**
 * Moves a running change from its worktree to Local: what the worktree hasn't
 * committed is committed first; then, once the person's checkout is free and
 * clean, it switches to the task's branch, remembering where it was, and the
 * worktree folder goes. On a branch of the person's own, it asks first, and
 * their word holds while the checkout is as it was when they were asked.
 */
export const moveToLocal = (taskId: string, change: string | null = null, consent?: MoveConsent) =>
  Effect.flatMap(changeSpots(taskId, change), (before) =>
    lockingCheckouts(
      before.map((spot) => spot.repository),
      Effect.gen(function* () {
        // Read again once the checkouts are held: a move that waited may have gone through since, from the loop that retries it.
        const spots = yield* changeSpots(taskId, change)
        const others = (yield* spotsOf(taskId)).filter((one) => one.kind === 'checkout' && (one.change ?? null) !== change)
        if (others.length > 0) return { kind: 'waits', why: 'Another change of this task works Local: one change at a time can.' } as Moved
        const moving = spots.filter((spot) => spot.kind === null && spot.state === 'ready')
        if (moving.length === 0) return { kind: 'moved' } as Moved
        for (const spot of moving) yield* commitLeft(spot)
        // First, whether each checkout can be taken, changing nothing: a task never takes one while it waits for another.
        const taking: Array<{ readonly spot: Spot; readonly was: Checkout }> = []
        for (const spot of moving) {
          const holder = yield* holderOf(spot.repository, taskId)
          if (holder !== null) {
            const why = `Moves to Local once “${holder.title}” is done with ${spot.name}’s checkout.`
            yield* holdMove(spot, 'checkout', why)
            return { kind: 'waits', why } as Moved
          }
          const was = yield* readCheckout(spot.repository)
          if (!isClean(was)) {
            const why = `Moves to Local once ${listed(was.uncommitted)} ${was.uncommitted.length === 1 ? 'is' : 'are'} committed in ${spot.name}’s checkout.`
            yield* holdMove(spot, 'checkout', why)
            return { kind: 'waits', why } as Moved
          }
          const base = spot.toward ?? spot.base ?? 'main'
          const own = was.branch !== null && was.branch !== base && was.branch !== spot.base && was.branch !== spot.branch
          if (own && !(consent !== undefined && consent.branch === was.branch && consent.head === was.head)) {
            // Kept, so the task's header asks too: switch it, or stay in the worktree.
            const seen = { branch: was.branch, head: was.head }
            yield* holdMove(
              spot,
              'checkout',
              `${spot.name}’s checkout is on ${was.branch ?? ''}, a branch of yours: switch it to ${spot.branch}, or stay in the worktree?`,
              seen,
            )
            return {
              kind: 'asks',
              ask: { repository: spot.name, holdup: 'branch', files: [], branch: was.branch ?? '', base },
              seen,
            } as Moved
          }
          taking.push({ spot, was })
        }
        // Then each moves: the worktree lets go of the branch, and the checkout takes it.
        for (const { spot, was } of taking) {
          yield* git(spot.repository, 'worktree', 'remove', spot.path).pipe(
            Effect.catch(() => git(spot.repository, 'worktree', 'remove', '--force', spot.path)),
          )
          yield* git(spot.repository, 'switch', '--quiet', spot.branch)
          const returnsTo = was.branch ?? was.head
          yield* record(
            spot,
            { kind: 'checkout', path: spot.repository, returnsTo, returnedAt: null, movingTo: null, setup: null },
            'workspace.moved',
            { to: 'checkout', from: spot.path, returnsTo },
          )
          yield* say(spot, `${spot.name}: checked out ${spot.branch}`, `It was on ${onOf(was)}, and goes back when you settle this task.`)
        }
        return { kind: 'moved' } as Moved
      }),
    ),
  )

/**
 * Moves a running change from Local to a worktree of its own. The checkout
 * lets go of the task's branch first, since git lets one folder have it:
 * clean and still on it, it goes back to where it was; already on another,
 * the branch is free. With changes not committed, which are the person's,
 * the move waits and the task carries on in Local.
 */
export const moveToWorktree = (taskId: string, change: string | null = null) =>
  Effect.flatMap(changeSpots(taskId, change), (before) =>
    lockingCheckouts(
      before.map((spot) => spot.repository),
      Effect.gen(function* () {
        // Read again once the checkouts are held, as a move to Local is.
        const spots = yield* changeSpots(taskId, change)
        const config = yield* RuntimeConfig
        const moving = spots.filter((spot) => spot.kind === 'checkout' && spot.state === 'ready' && spot.returnedAt === null)
        for (const spot of moving) {
          const now = yield* readCheckout(spot.repository)
          if (now.branch === spot.branch && !isClean(now)) {
            const why = `Moves to a worktree once ${listed(now.uncommitted)} ${now.uncommitted.length === 1 ? 'is' : 'are'} committed.`
            yield* holdMove(spot, 'worktree', why)
            return { kind: 'waits', why } as Moved
          }
        }
        for (const spot of moving) {
          const returnsTo = yield* returnsToOf(spot)
          // Changed since it was read, as by an agent still writing there: git refuses the switch, and the move waits.
          const gave = yield* giveBack(spot.repository, spot.branch, returnsTo).pipe(
            Effect.catchTag('GitFailed', () => Effect.succeed({ kind: 'changes', files: [] } as const)),
          )
          if (gave.kind === 'changes') {
            const why = 'Moves to a worktree once the checkout’s changes are committed.'
            yield* holdMove(spot, 'worktree', why)
            return { kind: 'waits', why } as Moved
          }
          const root = join(config.worktreeRoot, spot.projectSlug, spot.taskSlug, spot.bindingSlug)
          let worktree = spot.change === null ? root : `${root}-${spot.branch.replaceAll('/', '-')}`
          for (let n = 2; existsSync(worktree); n += 1) worktree = `${root}-${n}`
          yield* git(spot.repository, 'worktree', 'prune')
          yield* git(spot.repository, 'worktree', 'add', worktree, spot.branch)
          yield* record(
            spot,
            { kind: null, path: worktree, returnsTo: null, returnedAt: null, movingTo: null, setup: null },
            'workspace.moved',
            { to: 'worktree', path: worktree, gave: gave.kind },
          )
          yield* say(
            spot,
            `${spot.name}: carries on in a worktree`,
            gave.kind === 'back' ? `On ${spot.branch}; your checkout is back on ${shortRef(returnsTo)}.` : `On ${spot.branch}.`,
          )
        }
        return { kind: 'moved' } as Moved
      }),
    ),
  )

/** Keeps a move that waits for something other than the checkout, such as the lead's turn, said once. */
export const waitMove = (taskId: string, change: string | null, to: 'worktree' | 'checkout', why: string) =>
  Effect.gen(function* () {
    for (const spot of yield* changeSpots(taskId, change)) yield* holdMove(spot, to, why)
  })

/** Calls off a move that waits: the change stays where it is. */
export const dropMove = (taskId: string) =>
  Effect.gen(function* () {
    for (const spot of yield* spotsOf(taskId)) if (spot.movingTo !== null) yield* holdMove(spot, null)
  })

/** The tasks here with a move that waits, and where to: tried again as their leads finish each turn. */
export const movesWaiting = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const instance = yield* Instance
  return yield* sql<{ taskId: string; movingTo: 'worktree' | 'checkout'; change: string | null }>`
    SELECT DISTINCT w.task_id, w.moving_to, w.name AS change FROM workspaces w JOIN tasks k ON k.id = w.task_id
    WHERE w.device_id = ${instance.deviceId} AND w.moving_to IS NOT NULL AND k.state IN ('open', 'done')`
})
