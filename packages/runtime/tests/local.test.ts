import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import type { ActorId, ProjectId, WorksIn } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { holds } from '@althar/provider-adapters/testing'
import { Duration, Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { LeftBehind } from '../src/LeftBehind'
import { type CheckoutConsent, checkoutKey, giveBackSpot, localTakenFor, place, type Placed, spotsOf } from '../src/local'
import { Policies } from '../src/Policies'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { callTool, notices, repository, runtime, until } from './support'
import type { ToolAccess } from '../src/ToolServer'

/*
 * Local tasks (ADR-090): a task that works in the person's own checkout
 * rather than a worktree of its own. It takes the checkout as its first step
 * begins, on a branch of its own; one task holds it at a time; Althar asks
 * before it switches a checkout with uncommitted changes or on a branch of
 * the person's, and never stashes, resets or cleans; settled, the checkout
 * goes back to the branch it was on.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', ...args], { cwd })
    .toString()
    .trim()

const withQueries = () => Queries.layer.pipe(Layer.provideMerge(runtime()))
/** Plans that wait to be started, rather than starting on their own as the test goes on. */
const planning = () =>
  Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { localEvery: Duration.hours(1), countdown: Duration.hours(1) })))
/** As above, with what waits for a checkout looked at only when something wakes it: the test gives checkouts back itself. */
const byHand = () => Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { localEvery: Duration.hours(1) })))

const opened = (root: string) =>
  Effect.gen(function* () {
    const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: root })
    return project.projectId as ProjectId
  })

const drafted = (projectId: ProjectId, title: string, worksIn: WorksIn = 'checkout', repositories?: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    return yield* (yield* Projects).createTask({
      envelope: yield* Runtime.envelope('task.create', { title }),
      projectId,
      title,
      draft: true,
      worksIn,
      ...(repositories === undefined ? {} : { repositories }),
    })
  })

/** The person's answer to what placing a task asked: for that checkout, as it was then (Runs keeps it so). */
const answered = (asked: Placed, answer: CheckoutConsent['answer']): ReadonlyArray<CheckoutConsent> =>
  asked.kind === 'asks' ? [{ ...asked.seen, holdup: asked.ask.holdup, answer }] : []

/** The task's one workspace, as Local reads it. */
const spotOf = (taskId: string) =>
  Effect.map(spotsOf(taskId), ([one]) => {
    if (one === undefined) throw new Error('No workspace')
    return one
  })

/** Settles a task as merging it would: done, now, without stopping its agents (`merged` does that too). */
const settle = (taskId: string) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql`UPDATE tasks SET state = 'done', settled_at = ${new Date().toISOString()} WHERE id = ${taskId}`,
  )

const branchOf = (root: string) => git(root, 'branch', '--show-current')
const titles = (threadId: string) => Effect.map(notices(threadId), (said) => said.map((one) => one.title))

describe('a task working Local', () => {
  it.live('makes no worktree as a draft, takes the checkout on a branch of its own, and gives it back once settled', () => {
    const root = repository()
    return Effect.gen(function* () {
      const projectId = yield* opened(root)
      const task = yield* drafted(projectId, 'Fix the login')
      const planned = yield* spotOf(task.taskId)
      assert.deepInclude(planned, { kind: 'checkout', state: 'preparing', path: planned.repository })
      assert.strictEqual(branchOf(root), 'main')

      assert.deepStrictEqual(yield* place(task.taskId, 'checkout'), { kind: 'ready' })
      const taken = yield* spotOf(task.taskId)
      assert.deepInclude(taken, { state: 'ready', returnsTo: 'main' })
      assert.strictEqual(branchOf(root), taken.branch)
      assert.strictEqual(git(root, 'rev-parse', 'HEAD'), git(root, 'rev-parse', 'main'))

      yield* settle(task.taskId)
      assert.strictEqual(yield* giveBackSpot(yield* spotOf(task.taskId)), 'back')
      assert.strictEqual(branchOf(root), 'main')
      assert.notStrictEqual((yield* spotOf(task.taskId)).returnedAt, null)
      // Its branch stays, with whatever it committed.
      assert.include(git(root, 'branch', '--list', taken.branch), taken.branch)
      assert.deepStrictEqual(yield* titles(task.threadId), [`${taken.name}: checked out ${taken.branch}`, `${taken.name} is back on main`])
    }).pipe(Effect.provide(byHand()))
  })

  it.live('waits while another task holds the checkout, and takes it once that one is settled and gone back', () => {
    const root = repository()
    return Effect.gen(function* () {
      const projectId = yield* opened(root)
      const first = yield* drafted(projectId, 'Dark mode')
      const second = yield* drafted(projectId, 'Fix the login')
      yield* place(first.taskId, 'checkout')
      assert.deepStrictEqual(yield* place(second.taskId, 'checkout'), {
        kind: 'taken',
        by: { taskId: first.taskId, title: 'Dark mode' },
      })
      assert.strictEqual((yield* spotOf(second.taskId)).state, 'preparing')

      // Settled, its checkout goes back as the next one asks for it.
      yield* settle(first.taskId)
      assert.deepStrictEqual(yield* place(second.taskId, 'checkout'), { kind: 'ready' })
      assert.strictEqual(branchOf(root), (yield* spotOf(second.taskId)).branch)
      assert.strictEqual((yield* spotOf(second.taskId)).returnsTo, 'main')
    }).pipe(Effect.provide(byHand()))
  })

  it.live('asks about uncommitted changes, never switching under them, and waits until they are committed', () => {
    const root = repository()
    return Effect.gen(function* () {
      const projectId = yield* opened(root)
      const task = yield* drafted(projectId, 'Fix the login')
      writeFileSync(join(root, 'README.md'), '# Mine\n')
      writeFileSync(join(root, 'notes.txt'), 'todo\n')
      const asked = yield* place(task.taskId, 'checkout')
      assert.deepInclude(asked, { kind: 'asks' })
      if (asked.kind !== 'asks') return
      assert.deepInclude(asked.ask, { holdup: 'changes', files: ['README.md', 'notes.txt'], branch: 'main', base: 'main' })
      assert.strictEqual(branchOf(root), 'main')
      assert.strictEqual(git(root, 'stash', 'list'), '')

      // Waiting, as the person answered: nothing switches until they commit.
      const waiting = answered(asked, 'wait')
      assert.deepInclude(yield* place(task.taskId, 'checkout', waiting), { kind: 'changes' })
      assert.strictEqual(git(root, 'diff', '--name-only'), 'README.md')
      assert.strictEqual(git(root, 'ls-files', '--others', '--exclude-standard'), 'notes.txt')
      git(root, 'add', '.')
      git(root, 'commit', '-q', '-m', 'Mine')
      assert.deepStrictEqual(yield* place(task.taskId, 'checkout', waiting), { kind: 'ready' })
      assert.strictEqual(branchOf(root), (yield* spotOf(task.taskId)).branch)
    }).pipe(Effect.provide(byHand()))
  })

  it.live('asks about a branch of the person’s own, and goes back to it; or starts from it', () => {
    const root = repository()
    return Effect.gen(function* () {
      const projectId = yield* opened(root)
      git(root, 'switch', '-q', '-c', 'feature/onboarding')
      writeFileSync(join(root, 'onboarding.ts'), 'export {}\n')
      git(root, 'add', '.')
      git(root, 'commit', '-q', '-m', 'Onboarding')
      const feature = git(root, 'rev-parse', 'HEAD')
      const switched = yield* drafted(projectId, 'Fix the login')
      const asked = yield* place(switched.taskId, 'checkout')
      assert.deepInclude(asked, { kind: 'asks' })
      if (asked.kind === 'asks') assert.deepInclude(asked.ask, { holdup: 'branch', branch: 'feature/onboarding', base: 'main' })
      assert.strictEqual(branchOf(root), 'feature/onboarding')

      // Checked out from main, as answered; back on the person's branch once settled.
      assert.deepStrictEqual(yield* place(switched.taskId, 'checkout', answered(asked, 'switch')), { kind: 'ready' })
      assert.strictEqual(git(root, 'rev-parse', 'HEAD'), git(root, 'rev-parse', 'main'))
      yield* settle(switched.taskId)
      assert.strictEqual(yield* giveBackSpot(yield* spotOf(switched.taskId)), 'back')
      assert.strictEqual(branchOf(root), 'feature/onboarding')

      // Started from the person's branch: its branch begins at that branch's head.
      const built = yield* drafted(projectId, 'Onboarding copy')
      const again = yield* place(built.taskId, 'checkout')
      assert.deepStrictEqual(yield* place(built.taskId, 'checkout', answered(again, 'from_branch')), { kind: 'ready' })
      assert.strictEqual(git(root, 'rev-parse', 'HEAD'), feature)
      assert.strictEqual((yield* spotOf(built.taskId)).baseCommit, feature)
    }).pipe(Effect.provide(byHand()))
  })

  it.live('settled with changes left in it, stays on its branch and says so once; switched by the person, is left there', () => {
    const root = repository()
    return Effect.gen(function* () {
      const projectId = yield* opened(root)
      const task = yield* drafted(projectId, 'Fix the login')
      yield* place(task.taskId, 'checkout')
      const taken = yield* spotOf(task.taskId)
      writeFileSync(join(root, 'README.md'), '# Edited\n')
      yield* settle(task.taskId)
      const told = new Set<string>()
      const once = (spot: { readonly id: string }) => (told.has(spot.id) ? true : (told.add(spot.id), false))
      assert.strictEqual(yield* giveBackSpot(yield* spotOf(task.taskId), once), 'changes')
      assert.strictEqual(yield* giveBackSpot(yield* spotOf(task.taskId), once), 'changes')
      assert.strictEqual(branchOf(root), taken.branch)
      assert.strictEqual(git(root, 'diff', '--name-only'), 'README.md')
      const stays = (yield* notices(task.threadId)).filter((one) => one.title === `${taken.name} stays on ${taken.branch}`)
      assert.strictEqual(stays.length, 1)
      assert.include(stays[0]?.description ?? '', 'README.md has uncommitted changes. It goes back to main once they’re committed.')

      // The person moves it themselves: it stays where they put it, and the task holds it no longer.
      git(root, 'switch', '-q', '-c', 'mine')
      assert.strictEqual(yield* giveBackSpot(yield* spotOf(task.taskId), once), 'back')
      assert.strictEqual(branchOf(root), 'mine')
      assert.notStrictEqual((yield* spotOf(task.taskId)).returnedAt, null)
    }).pipe(Effect.provide(byHand()))
  })

  it.live('moves a draft that hasn’t started between its worktree and the checkout, as its plan says', () => {
    const root = repository()
    return Effect.gen(function* () {
      const projectId = yield* opened(root)
      // Drafted in a worktree, started Local: the worktree goes, unused, with its branch.
      const task = yield* drafted(projectId, 'Fix the login', 'worktree')
      const worktree = yield* spotOf(task.taskId)
      assert.isTrue(existsSync(worktree.path))
      assert.deepStrictEqual(yield* place(task.taskId, 'checkout'), { kind: 'ready' })
      assert.isFalse(existsSync(worktree.path))
      assert.deepInclude(yield* spotOf(task.taskId), { kind: 'checkout', state: 'ready', path: worktree.repository })

      // Drafted Local, started in a worktree: one is made now, and the checkout is left alone.
      const other = yield* drafted(projectId, 'Dark mode')
      const on = branchOf(root)
      assert.deepStrictEqual(yield* place(other.taskId, 'worktree'), { kind: 'ready' })
      const made = yield* spotOf(other.taskId)
      assert.deepInclude(made, { kind: null, state: 'ready' })
      assert.notStrictEqual(made.path, made.repository)
      assert.strictEqual(git(made.path, 'branch', '--show-current'), made.branch)
      assert.strictEqual(branchOf(root), on)
    }).pipe(Effect.provide(byHand()))
  })

  it.live('holds the checkout against a task of another project that added the same folder, and says who is there', () => {
    const root = repository()
    const other = repository()
    return Effect.gen(function* () {
      // One folder, whatever names it.
      const link = join(mkdtempSync(join(tmpdir(), 'althar-link-')), 'checkout')
      symlinkSync(root, link)
      assert.strictEqual(checkoutKey(link), checkoutKey(root))

      const mine = yield* opened(root)
      const theirs = yield* opened(other)
      yield* (yield* Projects).addRepositories(theirs, link)
      const first = yield* drafted(mine, 'Dark mode')
      const second = yield* drafted(theirs, 'Fix the login', 'checkout', [basename(other), basename(root)])
      assert.deepStrictEqual(yield* place(first.taskId, 'checkout'), { kind: 'ready' })
      const by = { taskId: first.taskId, title: 'Dark mode' }
      assert.deepStrictEqual(yield* place(second.taskId, 'checkout'), { kind: 'taken', by })
      assert.deepStrictEqual(yield* localTakenFor(second.taskId), by)
      // It waits for all of them: its other repository's checkout isn't taken meanwhile.
      assert.strictEqual(branchOf(other), 'main')
      assert.strictEqual(branchOf(root), (yield* spotOf(first.taskId)).branch)

      yield* settle(first.taskId)
      assert.deepStrictEqual(yield* place(second.taskId, 'checkout'), { kind: 'ready' })
      const [own, shared] = yield* spotsOf(second.taskId)
      assert.strictEqual(branchOf(other), own?.branch)
      assert.strictEqual(branchOf(root), shared?.branch)
    }).pipe(Effect.provide(byHand()))
  })

  it.live('keeps a settled task’s checkout while anything of it is still at work, and gives it back once all of it has stopped', () => {
    const root = repository()
    return Effect.gen(function* () {
      const projectId = yield* opened(root)
      const first = yield* drafted(projectId, 'Dark mode')
      const second = yield* drafted(projectId, 'Fix the login')
      yield* place(first.taskId, 'checkout')
      const held = (yield* spotOf(first.taskId)).branch
      // Not settled, or opened again: its checkout is its own.
      assert.strictEqual(yield* giveBackSpot(yield* spotOf(first.taskId)), 'held')

      yield* settle(first.taskId)
      const working = new Set([first.taskId])
      const atWork = Effect.sync(() => working)
      const by = { taskId: first.taskId, title: 'Dark mode' }
      assert.deepStrictEqual(yield* place(second.taskId, 'checkout', [], undefined, atWork), { kind: 'taken', by })
      assert.strictEqual(yield* giveBackSpot(yield* spotOf(first.taskId), undefined, atWork), 'held')
      assert.strictEqual(branchOf(root), held)
      assert.isNull((yield* spotOf(first.taskId)).returnedAt)

      working.delete(first.taskId)
      assert.deepStrictEqual(yield* place(second.taskId, 'checkout', [], undefined, atWork), { kind: 'ready' })
      assert.strictEqual(branchOf(root), (yield* spotOf(second.taskId)).branch)
    }).pipe(Effect.provide(byHand()))
  })

  it.live('holds a removed project’s checkout until its task has stopped, then gives it back, for the folder added again', () => {
    const root = repository()
    return Effect.gen(function* () {
      const removed = yield* opened(root)
      const first = yield* drafted(removed, 'Dark mode')
      assert.deepStrictEqual(yield* place(first.taskId, 'checkout'), { kind: 'ready' })
      const held = (yield* spotOf(first.taskId)).branch
      yield* (yield* Projects).remove(removed)

      // The same folder, added again: what the removed project's task still runs there keeps it.
      const again = yield* opened(root)
      assert.notStrictEqual(again, removed)
      const second = yield* drafted(again, 'Fix the login')
      const working = new Set([first.taskId])
      const atWork = Effect.sync(() => working)
      const by = { taskId: first.taskId, title: 'Dark mode' }
      assert.deepStrictEqual(yield* place(second.taskId, 'checkout', [], undefined, atWork), { kind: 'taken', by })
      assert.deepStrictEqual(yield* localTakenFor(second.taskId), by)
      assert.strictEqual(yield* giveBackSpot(yield* spotOf(first.taskId), undefined, atWork), 'held')
      assert.strictEqual(branchOf(root), held)

      // Stopped: it goes back, and the next task takes it.
      working.delete(first.taskId)
      assert.deepStrictEqual(yield* place(second.taskId, 'checkout', [], undefined, atWork), { kind: 'ready' })
      assert.isNotNull((yield* spotOf(first.taskId)).returnedAt)
      assert.strictEqual(branchOf(root), (yield* spotOf(second.taskId)).branch)
      assert.strictEqual(git(root, 'rev-parse', `${(yield* spotOf(second.taskId)).branch}`), git(root, 'rev-parse', 'main'))
    }).pipe(Effect.provide(byHand()))
  })

  it.live('lets a removed project’s checkout go as it is where it has changes, and the next task asks about them', () => {
    const root = repository()
    return Effect.gen(function* () {
      const removed = yield* opened(root)
      const first = yield* drafted(removed, 'Dark mode')
      yield* place(first.taskId, 'checkout')
      const held = (yield* spotOf(first.taskId)).branch
      writeFileSync(join(root, 'README.md'), '# Its last edit\n')
      yield* (yield* Projects).remove(removed)

      // Nothing switches under the changes, and nothing is left holding it with no thread to say why.
      assert.strictEqual(yield* giveBackSpot(yield* spotOf(first.taskId)), 'left')
      assert.isNotNull((yield* spotOf(first.taskId)).returnedAt)
      assert.strictEqual(branchOf(root), held)
      assert.include(git(root, 'status', '--porcelain'), 'README.md')
      // Looked at again, it is left alone.
      assert.strictEqual(yield* giveBackSpot(yield* spotOf(first.taskId)), 'back')
      assert.strictEqual(branchOf(root), held)

      const second = yield* drafted(yield* opened(root), 'Fix the login')
      assert.isNull(yield* localTakenFor(second.taskId))
      const asked = yield* place(second.taskId, 'checkout')
      assert.deepInclude(asked.kind === 'asks' ? asked.ask : {}, { holdup: 'changes', branch: held, files: ['README.md'] })
      assert.strictEqual(branchOf(root), held)
    }).pipe(Effect.provide(byHand()))
  })

  it.live('asks about each repository’s checkout in turn, and again about one that changed since the person answered', () => {
    const app = repository()
    const api = repository()
    return Effect.gen(function* () {
      const projectId = yield* opened(app)
      yield* (yield* Projects).addRepositories(projectId, api)
      for (const root of [app, api]) git(root, 'switch', '-q', '-c', 'feature/mine')
      const task = yield* drafted(projectId, 'Fix the login', 'checkout', [basename(app), basename(api)])
      const [inApp, inApi] = yield* spotsOf(task.taskId)
      const about = (placed: Placed) => (placed.kind === 'asks' ? `${placed.ask.repository} on ${placed.ask.branch}` : placed.kind)

      const first = yield* place(task.taskId, 'checkout')
      assert.strictEqual(about(first), `${inApp?.name} on feature/mine`)
      const one = answered(first, 'from_branch')
      // The answer was for the first only: the second is asked about, and nothing is taken until it is answered.
      const second = yield* place(task.taskId, 'checkout', one)
      assert.strictEqual(about(second), `${inApi?.name} on feature/mine`)
      assert.deepStrictEqual([branchOf(app), branchOf(api)], ['feature/mine', 'feature/mine'])
      const both = [...one, ...answered(second, 'switch')]

      // The person moves the first meanwhile: they answered for the branch they saw, so it is asked about again.
      git(app, 'switch', '-q', '-c', 'feature/other')
      assert.strictEqual(about(yield* place(task.taskId, 'checkout', both)), `${inApp?.name} on feature/other`)
      assert.strictEqual(branchOf(app), 'feature/other')
      // Back on it, with a commit since: starting from it was for the commit they saw.
      git(app, 'switch', '-q', 'feature/mine')
      git(app, 'commit', '-q', '--allow-empty', '-m', 'More')
      const now = yield* place(task.taskId, 'checkout', both)
      assert.strictEqual(about(now), `${inApp?.name} on feature/mine`)
      assert.deepStrictEqual([branchOf(app), branchOf(api)], ['feature/mine', 'feature/mine'])

      // Answered as it is now: both are taken, the first from its branch as it is, the second from main.
      const fresh = [...answered(now, 'from_branch'), ...answered(second, 'switch')]
      assert.deepStrictEqual(yield* place(task.taskId, 'checkout', fresh), { kind: 'ready' })
      assert.deepStrictEqual([branchOf(app), branchOf(api)], [inApp?.branch, inApi?.branch])
      assert.strictEqual(git(app, 'rev-parse', 'HEAD'), git(app, 'rev-parse', 'feature/mine'))
      assert.strictEqual(git(api, 'rev-parse', 'HEAD'), git(api, 'rev-parse', 'main'))
    }).pipe(Effect.provide(byHand()))
  })
})

describe('a Local plan', () => {
  const person = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ id: string }>`SELECT id FROM actors WHERE kind = 'person'`
    return (row?.id ?? '') as ActorId
  })

  /** A task planned Local, its lead Codex with no review, started now: whether it runs or waits. */
  const started = (projectId: ProjectId, title: string) =>
    Effect.gen(function* () {
      const plans = yield* Plans
      const task = yield* drafted(projectId, title)
      const actor = yield* person
      const planId = yield* plans.propose({
        projectId,
        taskId: task.taskId,
        steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
        reason: null,
        actorId: actor,
        end: null,
        held: true,
        worksIn: 'checkout',
      })
      return { ...task, planId, outcome: yield* plans.start(planId, actor) }
    })

  /** Settled as merging it would: done, then its agents and what they ran stopped, in the background (LeftBehind.ts). */
  const merged = (taskId: string) =>
    Effect.andThen(
      settle(taskId),
      Effect.flatMap(LeftBehind, (left) => left.settled(taskId)),
    )

  const cardOf = (projectId: string, taskId: string) =>
    Effect.gen(function* () {
      const board = yield* Effect.orDie((yield* Queries).board(projectId))
      return board.tasks.find((task) => task.taskId === taskId)
    })

  it.live('waits on its card for the task in the checkout, and starts once that one is settled', () => {
    const root = repository()
    return Effect.gen(function* () {
      const projectId = yield* opened(root)
      const first = yield* started(projectId, 'Dark mode')
      assert.strictEqual(first.outcome, 'running')
      const second = yield* started(projectId, 'Fix the login')
      assert.strictEqual(second.outcome, 'waiting')
      const waiting = yield* until(
        cardOf(projectId, second.taskId),
        (card) => card?.waitsForCheckout != null,
        'the second task waits for the checkout',
      )
      assert.deepStrictEqual(waiting?.waitsForCheckout, { why: 'taken', by: { taskId: first.taskId, title: 'Dark mode' } })
      assert.deepInclude(waiting, { phase: 'running', local: true, continues: true })
      assert.deepInclude(waiting?.plan, { worksIn: 'checkout', localTaken: { taskId: first.taskId, title: 'Dark mode' } })

      yield* merged(first.taskId)
      yield* until(spotOf(second.taskId), (spot) => spot.state === 'ready', 'the second task takes the checkout')
      assert.strictEqual(branchOf(root), (yield* spotOf(second.taskId)).branch)
      const after = yield* until(cardOf(projectId, second.taskId), (card) => card?.waitsForCheckout == null, 'it no longer waits')
      assert.isTrue(after?.local)
    }).pipe(Effect.provide(withQueries()))
  })

  it.live('keeps the checkout from the next task while a settled one’s lead is still in its turn, until it has stopped', () => {
    const lead = holds()
    const root = repository()
    return Effect.gen(function* () {
      const sessions = yield* Sessions
      const projectId = yield* opened(root)
      const first = yield* started(projectId, 'Dark mode [lead:slowly]')
      yield* until(
        Effect.map(sessions.running(first.threadId), (one) => Option.exists(one, (on) => on.turnRunning)),
        (seen) => seen,
        'its lead is in its turn',
      )
      const second = yield* started(projectId, 'Fix the login')
      assert.strictEqual(second.outcome, 'waiting')
      const held = (yield* spotOf(first.taskId)).branch

      // Merged while its lead is still at it: what waits for the checkout is looked at many times, and it stays the first's.
      yield* merged(first.taskId)
      yield* Effect.sleep(Duration.millis(800))
      assert.strictEqual((yield* spotOf(second.taskId)).state, 'preparing')
      assert.strictEqual(branchOf(root), held)
      assert.isNull((yield* spotOf(first.taskId)).returnedAt)

      // Its turn over, settling stops it: then the checkout goes back, and the next task takes it.
      lead.open('[lead:slowly]')
      yield* until(spotOf(second.taskId), (spot) => spot.state === 'ready', 'the second task takes the checkout')
      assert.isTrue(Option.isNone(yield* sessions.running(first.threadId)))
      assert.strictEqual(branchOf(root), (yield* spotOf(second.taskId)).branch)
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', { holds: lead })))))
  })

  it.live('waits, as answered, for the changes in the checkout it asked about, and takes it once they are committed', () => {
    const root = repository()
    return Effect.gen(function* () {
      const projectId = yield* opened(root)
      writeFileSync(join(root, 'README.md'), '# Mine\n')
      const task = yield* started(projectId, 'Fix the login')
      const sql = yield* SqlClient.SqlClient
      const [call] = yield* until(
        sql<{ id: string; payload: string }>`
          SELECT id, payload FROM attention_requests WHERE task_id = ${task.taskId} AND kind = 'checkout' AND state = 'open'`,
        (rows) => rows.length === 1,
        'Althar asks about the checkout',
      )
      // What the person saw is kept with the ask: their answer holds for that checkout only.
      const spot = yield* spotOf(task.taskId)
      assert.deepStrictEqual((JSON.parse(call?.payload ?? '{}') as { seen?: unknown }).seen, {
        spotId: spot.id,
        branch: 'main',
        head: git(root, 'rev-parse', 'HEAD'),
      })
      yield* (yield* Runs).answerCheckout({
        envelope: yield* Runtime.envelope('attention.answer_checkout', {}),
        attentionId: call?.id ?? '',
        answer: 'wait',
      })
      const waiting = yield* until(cardOf(projectId, task.taskId), (card) => card?.waitsForCheckout != null, 'it waits for the commit')
      assert.deepStrictEqual(waiting?.waitsForCheckout, { why: 'changes', repository: spot.name })
      assert.strictEqual(branchOf(root), 'main')

      git(root, 'commit', '-q', '-am', 'Mine')
      yield* until(spotOf(task.taskId), (one) => one.state === 'ready', 'it takes the checkout')
      assert.strictEqual(branchOf(root), (yield* spotOf(task.taskId)).branch)
    }).pipe(Effect.provide(withQueries()))
  })

  it.live('asks about uncommitted changes as it starts, and starts in a worktree as answered', () => {
    const root = repository()
    return Effect.gen(function* () {
      const projectId = yield* opened(root)
      writeFileSync(join(root, 'README.md'), '# Mine\n')
      const task = yield* started(projectId, 'Fix the login')
      assert.strictEqual(task.outcome, 'waiting')
      const sql = yield* SqlClient.SqlClient
      const [call] = yield* until(
        sql<{ id: string; payload: string }>`
          SELECT id, payload FROM attention_requests WHERE task_id = ${task.taskId} AND kind = 'checkout' AND state = 'open'`,
        (rows) => rows.length === 1,
        'Althar asks about the checkout',
      )
      assert.deepInclude(JSON.parse(call?.payload ?? '{}'), { holdup: 'changes', files: ['README.md'] })
      const card = yield* cardOf(projectId, task.taskId)
      assert.strictEqual(card?.phase, 'waiting')

      yield* (yield* Runs).answerCheckout({
        envelope: yield* Runtime.envelope('attention.answer_checkout', {}),
        attentionId: call?.id ?? '',
        answer: 'worktree',
      })
      const spot = yield* until(spotOf(task.taskId), (one) => one.kind === null && one.state === 'ready', 'it works in a worktree')
      assert.notStrictEqual(spot.path, spot.repository)
      // The person's checkout is as they left it.
      assert.strictEqual(branchOf(root), 'main')
      assert.strictEqual(git(root, 'diff', '--name-only'), 'README.md')
      const moved = yield* until(cardOf(projectId, task.taskId), (one) => one?.plan?.worksIn === 'worktree', 'its plan says so')
      assert.isUndefined(moved?.local)
    }).pipe(Effect.provide(withQueries()))
  })
})

describe('the coordinator planning where a task works', () => {
  it.live('drafts and plans Local as asked, else as the project starts tasks, and says who works there now', () => {
    const root = repository()
    return Effect.gen(function* () {
      const projectId = yield* opened(root)
      const threadId = yield* (yield* Coordinator).thread(projectId)
      const access: ToolAccess = { role: 'coordinator', projectId, threadId, sessionId: 'none', taskId: null }
      const sql = yield* SqlClient.SqlClient
      const kindOf = (slug: string) =>
        Effect.map(
          sql<{ kind: string | null }>`SELECT w.kind FROM workspaces w JOIN tasks k ON k.id = w.task_id WHERE k.slug = ${slug}`,
          ([row]) => row?.kind ?? null,
        )
      const planOf = (slug: string) =>
        Effect.map(
          sql<{ parameters: string }>`
            SELECT p.parameters FROM task_plans p JOIN tasks k ON k.id = p.task_id WHERE k.slug = ${slug} AND p.state = 'proposed'`,
          ([row]) => JSON.parse(row?.parameters ?? '{}') as { worksIn?: string; worksInWhy?: string },
        )

      // A worktree, as projects start tasks unless the person chose otherwise.
      yield* callTool(access, 'draft_task', { title: 'Tidy the README' })
      assert.strictEqual(yield* kindOf('tidy-the-readme'), null)
      // Local, as the coordinator said; its plan stays so without saying it again.
      yield* callTool(access, 'draft_task', { title: 'Fix the login', works_in: 'local' })
      assert.strictEqual(yield* kindOf('fix-the-login'), 'checkout')
      assert.match(
        yield* callTool(access, 'propose_plan', { task: 'fix-the-login', lead: { agent: 'codex' } }),
        /^Planned fix-the-login\. It works Local, in the person’s checkout\./,
      )
      assert.strictEqual((yield* planOf('fix-the-login')).worksIn, 'checkout')

      // The person starts new tasks Local: a task drafted with nothing said works there.
      const actor = (yield* Instance).personId
      yield* (yield* Policies).set(projectId, { worksIn: 'checkout' }, actor)
      yield* callTool(access, 'draft_task', { title: 'Dark mode' })
      assert.strictEqual(yield* kindOf('dark-mode'), 'checkout')

      // Another task works Local: planning Local says it waits for it; a worktree with why says why on its card.
      yield* place((yield* sql<{ id: string }>`SELECT id FROM tasks WHERE slug = 'fix-the-login'`)[0]?.id ?? '', 'checkout')
      assert.match(
        yield* callTool(access, 'propose_plan', { task: 'dark-mode', lead: { agent: 'codex' } }),
        /It works Local, so it waits for Fix the login, which works there now/,
      )
      yield* callTool(access, 'propose_plan', {
        task: 'dark-mode',
        lead: { agent: 'codex' },
        works_in: 'worktree',
        works_in_why: 'Fix the login is in your checkout',
      })
      assert.deepInclude(yield* planOf('dark-mode'), { worksIn: 'worktree', worksInWhy: 'Fix the login is in your checkout' })
    }).pipe(Effect.provide(planning()))
  })
})
