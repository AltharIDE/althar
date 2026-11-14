import { removeTreeSync } from '@althar/testing'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { type FakeAgentOptions, holds } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Fiber, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { FastLane } from '../src/fastLane'
import { Instance } from '../src/Instance'
import { Live } from '../src/Live'
import { MergeReviews } from '../src/MergeReviews'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Runs } from '../src/Runs'
import { mergeCopyOf } from '../src/reviewCopy'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, HOST, hosted, items, runtime, turns, until } from './support'

/*
 * The edges of the review after a merge, in the same task (a task is a
 * conversation plus parts, "After merge, in the same task"): what it reads
 * when the task's worktree is gone or elsewhere, or the host names a head
 * Althar hasn't got; a merge its last review read whole, which owes nothing;
 * Merge now's owing it, and a pull request that closes instead; one review
 * at a time; a reviewer whose turn fails, that ends without its report, or
 * reports twice; and Fix it and Leave it as the person reads them, each
 * finding numbered with where it is. Then Merge, with commits not shipped:
 * Merge now of the pull request named, and Review and merge where its host
 * refuses the merge or the lead set what its review found aside.
 */

const git = (cwd: string, ...args: Array<string>) => execFileSync('git', args, { cwd }).toString().trim()

const runtimeWith = (github: FakeService, options: FakeAgentOptions = {}, each: Readonly<Record<string, FakeAgentOptions>> = {}) =>
  Queries.layer.pipe(
    Layer.provideMerge(runtime(':memory:', options, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1), each })),
  )

const BRANCH = 'althar/add-a-retry'

/** A review that couldn't start was tried long ago: its wait before the next try is over. */
const aged = (url: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`UPDATE merge_reviews SET updated_at = '2000-01-01T00:00:00.000Z' WHERE url = ${url}`
  })

/** The host merges a pull request by squashing it: main gets one commit with its branch's change, and the branch stays as it was. */
const squashMerge = (bare: string, branch: string) => {
  const clone = mkdtempSync(join(tmpdir(), 'althar-merge-'))
  execFileSync('git', ['clone', '-q', bare, clone])
  const as = ['-c', 'user.name=Host', '-c', 'user.email=host@althar.test']
  git(clone, ...as, 'merge', '-q', '--squash', `origin/${branch}`)
  git(clone, ...as, 'commit', '-q', '-m', `Squashed ${branch}`)
  git(clone, 'push', '-q', 'origin', 'main')
}

/** Someone pushes a commit to the branch on the host, outside Althar: its sha, which no checkout here has. */
const pushOnHost = (bare: string) => {
  const clone = mkdtempSync(join(tmpdir(), 'althar-elsewhere-'))
  execFileSync('git', ['clone', '-q', '-b', BRANCH, bare, clone])
  writeFileSync(join(clone, 'elsewhere.txt'), 'from the host\n')
  const as = ['-c', 'user.name=Dana', '-c', 'user.email=dana@althar.test']
  git(clone, 'add', '.')
  git(clone, ...as, 'commit', '-q', '-m', 'On the host')
  git(clone, 'push', '-q', 'origin', BRANCH)
  return git(clone, 'rev-parse', 'HEAD')
}

/** Where the bare repository has the task's branch, as the host reads its head; null before it is pushed. */
const tipOf = (bare: string) => () => {
  try {
    return git(bare, 'rev-parse', BRANCH)
  } catch {
    return null
  }
}

/** A repository on the fake GitHub, which reads a pull request's head as the branch on the host has it where `heads` says. */
const onGitHub = (heads = false) => {
  const { working, bare } = hosted()
  const github = makeFakeService({ pushUrl: () => bare, ...(heads ? { headOf: tipOf(bare) } : {}) })
  github.addRepository(['meridian', 'api'])
  git(working, 'config', 'user.name', 'Fake')
  git(working, 'config', 'user.email', 'fake@althar.test')
  return { working, bare, github }
}

const cards = (projectId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const snapshot = yield* Effect.orDie(queries.coordinator(projectId))
    return snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  })

/**
 * A change whose lead did its part and whose pull request opened: a small one, its reviewer reading it only once it merges,
 * unless `small` says not, when its plan's reviewer read it before it shipped.
 */
const opened = (working: string, markers: string, small = true) =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const instance = yield* Instance
    yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const projects = yield* Projects
    const coordinator = yield* Coordinator
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    const threadId = yield* coordinator.thread(project.projectId)
    const body = `Add a retry. [coordinator:plan]${small ? ' [coordinator:plan-small] [coordinator:plan-no-review]' : ''} [lead:finish] [lead:edit] ${markers}`
    yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
    const [ready] = yield* until(
      cards(project.projectId),
      (all) => all[0]?.change != null && all[0].change.state === 'open' && (small || all[0].phase === 'ready'),
    )
    const card = ready ?? assert.fail('no card')
    // The after-merge cases explicitly defer their reviewer; normal cases retain their real before-Ship pass.
    if (small)
      yield* (yield* Runs).reshape({
        taskId: card.taskId,
        afterMerge: { key: 'review', agentId: 'codex', model: null, skipped: true },
        actorId: instance.personId,
      })
    yield* until(
      Effect.flatMap(Sessions, (sessions) => sessions.busy(card.threadId)),
      (busy) => !busy,
    )
    const sql = yield* SqlClient.SqlClient
    const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${card.taskId}`
    return {
      projectId: project.projectId,
      taskId: card.taskId,
      threadId: card.threadId,
      url: card.change?.url ?? '',
      path: workspace?.path ?? assert.fail('no worktree'),
    }
  })

/** The host merges the task's pull request, and Althar hears it. */
const mergeIt = (bare: string, github: FakeService, taskId: string) =>
  Effect.gen(function* () {
    squashMerge(bare, BRANCH)
    github.mergeByHand(1)
    yield* (yield* Changes).refresh(taskId)
  })

const reviewOf = (url: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{
      state: string
      findings: string
      base: string | null
      head: string | null
      attempts: number
      message: string | null
    }>`SELECT state, findings, base, head, attempts, message FROM merge_reviews WHERE url = ${url}`
    return row
  })

const reviewerThread = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{
      id: string
    }>`SELECT id FROM threads WHERE task_id = ${taskId} AND kind = 'step' AND node_key = 'merge_review'`
    return row?.id ?? assert.fail('no reviewer thread')
  })

/** Waits until the thread's reviewer is at work in a turn. */
const reviewing = (threadId: string) =>
  until(
    Effect.flatMap(Sessions, (sessions) => sessions.running(threadId)),
    (live) => Option.isSome(live) && live.value.turnRunning,
  )

/** Waits until the thread has no session. */
const gone = (threadId: string) =>
  until(
    Effect.flatMap(Sessions, (sessions) => sessions.running(threadId)),
    (live) => Option.isNone(live),
  )

const noticesOf = (threadId: string) =>
  Effect.map(items(threadId), (all) => all.flatMap((item) => (item.kind === 'notice' ? [String(item.content.title)] : [])))

/** How the task's pull request stands, as Althar last heard it from its host. */
const snapshotOf = (url: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{
      state: string | null
    }>`SELECT json_extract(snapshot, '$.state') AS state FROM external_links WHERE url = ${url} AND kind = 'change'`
    return row?.state ?? null
  })

const tasksOwed = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ n: number }>`SELECT count(*) AS n FROM merge_reviews WHERE task_id = ${taskId}`
    return row?.n ?? 0
  })

/** A merged task whose review found one thing, waiting on the person. */
const found = (working: string, bare: string, github: FakeService) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const task = yield* opened(working, '[review:wait]')
    yield* mergeIt(bare, github, task.taskId)
    yield* until(reviewOf(task.url), (row) => row?.state === 'running')
    const reviewer = yield* reviewerThread(task.taskId)
    yield* reviewing(reviewer)
    const [session] = yield* sql<{ id: string }>`
      SELECT id FROM provider_sessions WHERE thread_id = ${reviewer} ORDER BY started_at DESC LIMIT 1`
    const access: ToolAccess = {
      role: 'reviewer',
      projectId: task.projectId,
      threadId: reviewer,
      sessionId: session?.id ?? '',
      taskId: task.taskId,
    }
    yield* callTool(access, 'report_review', {
      verdict: 'changes_requested',
      summary: 'One thing to tidy.',
      findings: [{ severity: 'major', title: 'Name the retry', claim: 'Name it for what it retries.' }],
    })
    yield* until(cards(task.projectId), (all) => all[0]?.afterMerge?.state === 'found')
    return task
  })

/** What the task's view says of where it stands, as its header and its card both read it. */
const standingOf = (threadId: string) =>
  Effect.gen(function* () {
    const snapshot = yield* Effect.orDie((yield* Queries).thread(threadId))
    return {
      phase: snapshot.task.phase,
      step: snapshot.task.step,
      followUp: snapshot.task.followUp,
      afterMerge: snapshot.task.afterMerge?.state,
      held: snapshot.session?.held,
    }
  })

/** Reads the task's phase over and over, as a window that watches would, until stopped: each phase it was in, in order. */
const watching = (threadId: string) =>
  Effect.gen(function* () {
    const phases: Array<string> = []
    const reading = yield* Effect.forkChild(
      Effect.forever(
        Effect.gen(function* () {
          const { phase } = yield* standingOf(threadId)
          if (phase !== null && phases.at(-1) !== phase) phases.push(phase)
          yield* Effect.sleep(Duration.millis(1))
        }),
      ),
    )
    return { stop: Effect.as(Fiber.interrupt(reading), phases), seen: Effect.sync(() => [...phases]) }
  })

describe('the review after a merge, at its edges', () => {
  it.live('keeps a finding as its reviewer wrote it, refuses a second report, and Fix it numbers each for the lead still there', () => {
    const { working, bare, github } = onGitHub()
    const place = holds()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const sessions = yield* Sessions
      const mergeReviews = yield* MergeReviews
      const task = yield* opened(working, '[review:wait]')
      // The project brings every finding back, so a minor and a nit wait on the person as a major one would.
      yield* (yield* Policies).set(task.projectId, { afterMergeReview: 'all' }, (yield* Instance).personId)
      yield* mergeIt(bare, github, task.taskId)
      yield* until(reviewOf(task.url), (row) => row?.state === 'running')
      const reviewer = yield* reviewerThread(task.taskId)
      yield* reviewing(reviewer)

      // Its report: one finding with a title and nowhere, one in a file with no line.
      const [session] = yield* sql<{ id: string }>`
        SELECT id FROM provider_sessions WHERE thread_id = ${reviewer} ORDER BY started_at DESC LIMIT 1`
      const access: ToolAccess = {
        role: 'reviewer',
        projectId: task.projectId,
        threadId: reviewer,
        sessionId: session?.id ?? '',
        taskId: task.taskId,
      }
      const report = {
        verdict: 'changes_requested',
        summary: 'Two things to tidy.',
        findings: [
          { severity: 'minor', title: 'Name the retry', claim: 'Name it for what it retries.' },
          { severity: 'nit', file: 'README.md', claim: 'A typo in the heading.' },
        ],
      }
      assert.strictEqual(
        yield* callTool(access, 'report_review', report),
        'Althar has your review. The change merged already: the person decides whether the lead fixes what you found.',
      )
      // Reported once, it waits on the person: a second report is refused.
      assert.strictEqual(yield* callTool(access, 'report_review', report), 'No review is waiting on you.')
      const found = yield* reviewOf(task.url)
      assert.strictEqual(found?.state, 'found')
      assert.deepStrictEqual(JSON.parse(found?.findings ?? '[]'), [
        {
          severity: 'minor',
          title: 'Name the retry',
          claim: 'Name it for what it retries.',
          file: null,
          line: null,
        },
        { severity: 'nit', file: 'README.md', claim: 'A typo in the heading.', line: null },
      ])
      // Its report in the task's thread names the reviewer it came from.
      const result = (yield* items(task.threadId)).filter((item) => item.kind === 'step_result').at(-1)?.content
      assert.deepInclude(result, { agentId: 'codex', model: 'small', summary: 'Two things to tidy.' })
      const [card] = yield* until(cards(task.projectId), (all) => all[0]?.afterMerge?.state === 'found')
      assert.strictEqual(card?.afterMerge?.findings, 2)

      // The lead is back on the task before the person says Fix it: the findings go to it, and nothing starts it again.
      yield* gone(task.threadId)
      yield* sessions.startLast(task.threadId)
      const lead = Option.getOrThrow(yield* until(sessions.running(task.threadId), (live) => Option.isSome(live))).sessionId
      const sent = yield* mergeReviews.fix(task.taskId, task.url)
      assert.strictEqual(Option.getOrThrow(yield* sessions.running(task.threadId)).sessionId, lead)
      const [input] = yield* sql<{ body: string }>`SELECT body FROM user_inputs WHERE id = ${sent.inputId ?? ''}`
      assert.include(
        input?.body ?? '',
        '1. [minor] Name the retry\n   Name it for what it retries.\n2. [nit] (README.md)\n   A typo in the heading.',
      )
      assert.include(
        yield* noticesOf(task.threadId),
        'Fix it: the lead takes the 2 findings after #1 merged, and its fix goes out after it.',
      )
      // Once the turn that takes them is over, waiting for it again, or for no turn at all, is over at once.
      yield* mergeReviews.afterTurnOf(sent.threadId, sent.inputId)
      yield* mergeReviews.afterTurnOf(sent.threadId, sent.inputId)
      yield* mergeReviews.afterTurnOf(sent.threadId, null)
      const [delivered] = yield* sql<{ endedAt: string | null }>`
        SELECT d.ended_at FROM turn_delivery_inputs di JOIN turn_deliveries d ON d.id = di.delivery_id WHERE di.user_input_id = ${sent.inputId ?? ''}`
      assert.isNotNull(delivered?.endedAt)
      place.open('[review:wait]')
    }).pipe(Effect.provide(runtimeWith(github, { holds: place })))
  })

  it.live('is under way from Fix it to the end of its lead’s turn: never Done, nor Stopped, in between', () => {
    const { working, bare, github } = onGitHub()
    const place = holds()
    let holdStartup: Promise<void> | undefined
    let start = () => {}
    return Effect.gen(function* () {
      const task = yield* found(working, bare, github)
      const mergeReviews = yield* MergeReviews
      const sql = yield* SqlClient.SqlClient
      // Found, its lead gone as a merged task's is: the person's, Fix it and Leave it beside it.
      yield* gone(task.threadId)
      assert.deepInclude(yield* standingOf(task.threadId), { phase: 'ready', afterMerge: 'found' })

      const watched = yield* watching(task.threadId)
      holdStartup = new Promise<void>((resolve) => (start = resolve))
      const fixing = yield* Effect.forkChild(mergeReviews.fix(task.taskId, task.url))
      // Read the actual dispatch window, with startup held. A fake that answers immediately can finish before fix() returns.
      yield* until(sql<{ state: string }>`SELECT state FROM merge_reviews WHERE url = ${task.url}`, (rows) => rows[0]?.state === 'fixing')
      assert.strictEqual((yield* standingOf(task.threadId)).phase, 'running')
      yield* until(watched.seen, (phases) => phases.includes('running'))
      start()
      const sent = yield* Fiber.join(fixing)
      yield* mergeReviews.afterTurnOf(sent.threadId, sent.inputId)
      const phases = yield* watched.stop
      assert.notInclude(phases, 'settled', `Done showed while Fix it was taken: ${phases.join(' > ')}`)
      assert.notInclude(phases, 'stopped', `Stopped showed while Fix it was taken: ${phases.join(' > ')}`)
      assert.include(phases, 'running')
      // Its lead answered the person since they last had the task open: that is theirs, as a reply is.
      assert.strictEqual((yield* until(standingOf(task.threadId), (now) => now.phase !== 'running')).phase, 'ready')
      place.open('[review:wait]')
    }).pipe(
      Effect.ensuring(Effect.sync(() => start())),
      Effect.provide(
        runtimeWith(github, { holds: place }, { 'claude-code': { beforeNewSession: () => holdStartup ?? Promise.resolve() } }),
      ),
    )
  })

  it.live('is under way in the moment Fix it is answered, before its lead is back, and not for ever where it never is', () => {
    const { working, bare, github } = onGitHub()
    const place = holds()
    return Effect.gen(function* () {
      const task = yield* found(working, bare, github)
      const sql = yield* SqlClient.SqlClient
      yield* gone(task.threadId)
      assert.strictEqual((yield* standingOf(task.threadId)).phase, 'ready')
      // Answered, the review says so and nothing else yet: no session, nothing delivered, its folder perhaps still away.
      yield* sql`UPDATE merge_reviews SET state = 'fixing', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE url = ${task.url}`
      const asked = yield* standingOf(task.threadId)
      assert.deepInclude(asked, { phase: 'running', step: 'implement', followUp: true, held: undefined, afterMerge: undefined })
      // A lead that never starts doesn't leave the task under way for ever.
      yield* sql`UPDATE merge_reviews SET updated_at = '2000-01-01T00:00:00.000Z' WHERE url = ${task.url}`
      assert.notStrictEqual((yield* standingOf(task.threadId)).phase, 'running')
      place.open('[review:wait]')
    }).pipe(Effect.provide(runtimeWith(github, { holds: place })))
  })

  it.live('is under way as the person writes to a merged task’s lead, its turn not begun', () => {
    const { working, bare, github } = onGitHub()
    const place = holds()
    return Effect.gen(function* () {
      const sessions = yield* Sessions
      const task = yield* found(working, bare, github)
      yield* (yield* MergeReviews).leave(task.taskId, task.url)
      // Merged and left as it is, the task is settled; the person writes to its lead, which the window has back by then.
      yield* gone(task.threadId)
      assert.strictEqual((yield* standingOf(task.threadId)).phase, 'settled')
      yield* sessions.startLast(task.threadId)
      yield* until(sessions.running(task.threadId), (live) => Option.isSome(live))
      const watched = yield* watching(task.threadId)
      yield* sessions.send({
        envelope: yield* Runtime.envelope('thread.send', { threadId: task.threadId }),
        threadId: task.threadId,
        body: 'One more thing: rename it. [answers-after:5s]',
        sender: { kind: 'window' },
      })
      assert.strictEqual((yield* standingOf(task.threadId)).phase, 'running')
      yield* until(watched.seen, (phases) => phases.includes('running'))
      place.open('[answers-after:5s]')
      yield* until(standingOf(task.threadId), (now) => now.phase !== 'running')
      const phases = yield* watched.stop
      assert.notInclude(
        phases.slice(0, phases.indexOf('running') + 1),
        'settled',
        `Done showed as it was written to: ${phases.join(' > ')}`,
      )
      assert.notInclude(phases, 'stopped', `Stopped showed as it was written to: ${phases.join(' > ')}`)
      place.open('[review:wait]')
    }).pipe(Effect.provide(runtimeWith(github, { holds: place })))
  })

  it.live(
    'is under way across the turn’s claim and its delivery, before its lead is busy: its input no longer queued, its turn not yet running',
    () => {
      const { working, bare, github } = onGitHub()
      const place = holds()
      return Effect.gen(function* () {
        const sessions = yield* Sessions
        const sql = yield* SqlClient.SqlClient
        const task = yield* found(working, bare, github)
        yield* (yield* MergeReviews).leave(task.taskId, task.url)
        yield* gone(task.threadId)
        yield* until(standingOf(task.threadId), (now) => now.phase === 'settled')
        yield* sessions.startLast(task.threadId)
        const live = yield* until(sessions.running(task.threadId), (now) => Option.isSome(now))
        const sessionId = Option.getOrThrow(live).sessionId
        // The moment a controlled pause stands for: the turn recorded as delivered with its input, the session not yet marked busy.
        const turn = `turn_${'a'.repeat(32)}`
        const at = new Date().toISOString()
        yield* sql`INSERT INTO turn_deliveries (id, project_id, thread_id, provider_session_id, controller_generation, state, requested_at, delivered_at, origin)
        VALUES (${turn}, ${task.projectId}, ${task.threadId}, ${sessionId}, 1, 'pending', ${at}, NULL, 'person')`
        const claimed = yield* standingOf(task.threadId)
        assert.strictEqual(
          claimed.phase,
          'running',
          `claimed: ${JSON.stringify([claimed, Option.isSome(yield* sessions.running(task.threadId))])}`,
        )
        yield* sql`UPDATE turn_deliveries SET state = 'delivered', delivered_at = ${at} WHERE id = ${turn}`
        assert.strictEqual(Option.getOrThrow(yield* sessions.running(task.threadId)).turnRunning, false)
        assert.deepInclude(yield* standingOf(task.threadId), { phase: 'running', step: 'implement', followUp: true })
        // Its turn over, the person's: not under way any more.
        yield* sql`UPDATE turn_deliveries SET state = 'completed', ended_at = ${at} WHERE id = ${turn}`
        assert.notStrictEqual((yield* standingOf(task.threadId)).phase, 'running')
        place.open('[review:wait]')
      }).pipe(Effect.provide(runtimeWith(github, { holds: place })))
    },
  )

  it.live('names the pull request by its link where its number isn’t known, and its reviewer reads it as the pull request', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const mergeReviews = yield* MergeReviews
      const task = yield* opened(working, '[review:findings]')
      // Its copy can't be made at first: the folder it goes in is a file.
      const blocker = join(mergeCopyOf(task.path, 1), '..')
      execFileSync('mkdir', ['-p', join(blocker, '..')])
      execFileSync('touch', [blocker])
      yield* mergeIt(bare, github, task.taskId)
      yield* until(reviewOf(task.url), (row) => (row?.attempts ?? 0) > 0)
      // As a host whose snapshot gave no number: the pull request is the end of its link, its copy named for the merge.
      yield* sql`UPDATE merge_reviews SET number = NULL WHERE url = ${task.url}`
      yield* aged(task.url)
      yield* (yield* FastLane).retryPendingReviews()
      yield* until(reviewOf(task.url), (row) => row?.state === 'found')
      const reviewer = yield* reviewerThread(task.taskId)
      const [first] = yield* turns(reviewer)
      assert.include(first?.prompt ?? '', 'You are reviewing a change that merged already, as the pull request, in Althar.')
      assert.include(first?.prompt ?? '', `What merged is in ${mergeCopyOf(task.path, null)}`)
      const words = task.url.split('/').at(-1) ?? ''
      assert.strictEqual((yield* mergeReviews.ofTask(task.taskId))[0]?.words, words)
      yield* mergeReviews.leave(task.taskId, task.url)
      assert.include(yield* noticesOf(task.threadId), `Left the 1 finding after ${words} merged.`)
      assert.strictEqual((yield* reviewOf(task.url))?.state, 'left')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('reminds a reviewer that ends its turn without its report once, then stops its review, said in the task', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working, '[review:pass]')
      yield* mergeIt(bare, github, task.taskId)
      const stopped = yield* until(reviewOf(task.url), (row) => row?.state === 'stopped')
      assert.strictEqual(stopped?.message, 'Its reviewer ended without saying what it found.')
      // Told once, quietly, in its own thread, before it stopped.
      const reviewer = yield* reviewerThread(task.taskId)
      const reminders = yield* sql<{ body: string }>`
        SELECT body FROM user_inputs WHERE thread_id = ${reviewer} AND body LIKE 'Your review isn''t done until you call%'`
      assert.lengthOf(reminders, 1)
      assert.include(
        yield* noticesOf(task.threadId),
        'The review after #1 merged stopped: its reviewer ended without saying what it found.',
      )
      assert.deepInclude((yield* (yield* MergeReviews).ofTask(task.taskId))[0], {
        state: 'stopped',
        message: 'Its reviewer ended without saying what it found.',
      })
      yield* gone(reviewer)
      // Hearing the merge again starts nothing: what stopped is the person's to try again.
      yield* (yield* FastLane).reviewMerged(task.taskId, task.url)
      assert.strictEqual((yield* reviewOf(task.url))?.state, 'stopped')
      assert.isTrue(Option.isNone(yield* (yield* Sessions).running(reviewer)))
    }).pipe(Effect.provide(runtimeWith(github, {}, { codex: { noReport: true } })))
  })

  it.live('starts its reviewer on the model and effort the plan names', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working, '[review:pass]')
      // The person put the plan's reviewer on its large model, thinking hard, before it merged.
      const [plan] = yield* sql<{ id: string; parameters: string }>`SELECT id, parameters FROM task_plans WHERE task_id = ${task.taskId}`
      const parameters = JSON.parse(plan?.parameters ?? '{}') as { steps: Array<Record<string, unknown>> }
      for (const step of parameters.steps) if (step.key === 'review') Object.assign(step, { model: 'large', effort: 'high' })
      yield* sql`UPDATE task_plans SET parameters = ${JSON.stringify(parameters)} WHERE id = ${plan?.id ?? ''}`
      yield* mergeIt(bare, github, task.taskId)
      yield* until(reviewOf(task.url), (row) => row?.state === 'clear')
      const reviewer = yield* reviewerThread(task.taskId)
      const [session] = yield* sql<{ agentId: string; model: string | null; effort: string | null }>`
        SELECT agent_id, model, effort FROM provider_sessions WHERE thread_id = ${reviewer} ORDER BY started_at LIMIT 1`
      assert.deepStrictEqual(session, { agentId: 'codex', model: 'large', effort: 'high' })
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('starts its reviewer on the model its agent offers by the name the plan gives it, as list_models writes it', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working, '[review:pass]')
      // The plan names it as people know it, not by the agent's own id.
      const [plan] = yield* sql<{ id: string; parameters: string }>`SELECT id, parameters FROM task_plans WHERE task_id = ${task.taskId}`
      const parameters = JSON.parse(plan?.parameters ?? '{}') as { steps: Array<Record<string, unknown>> }
      for (const step of parameters.steps) if (step.key === 'review') Object.assign(step, { model: 'Large' })
      yield* sql`UPDATE task_plans SET parameters = ${JSON.stringify(parameters)} WHERE id = ${plan?.id ?? ''}`
      yield* mergeIt(bare, github, task.taskId)
      yield* until(reviewOf(task.url), (row) => row?.state === 'clear')
      const [session] = yield* sql<{ model: string | null }>`
        SELECT model FROM provider_sessions WHERE thread_id = ${yield* reviewerThread(task.taskId)} ORDER BY started_at LIMIT 1`
      assert.strictEqual(session?.model, 'large')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('is owed where the task’s worktree is on another computer, says why it hasn’t started, and starts once it is here', () => {
    const { working, bare, github } = onGitHub()
    const place = holds()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working, '[review:slowly]')
      const [here] = yield* sql<{ deviceId: string }>`SELECT device_id FROM workspaces WHERE task_id = ${task.taskId}`
      const elsewhere = `dev_${'e'.repeat(32)}`
      yield* sql`INSERT INTO devices (id, name, created_at) VALUES (${elsewhere}, 'Other Mac', '2026-01-01T00:00:00.000Z')`
      const onDevice = (device: string) => sql`UPDATE workspaces SET device_id = ${device} WHERE task_id = ${task.taskId}`
      yield* onDevice(elsewhere)
      yield* mergeIt(bare, github, task.taskId)
      const owed = yield* until(reviewOf(task.url), (row) => (row?.attempts ?? 0) > 0)
      // Owed from nothing it knows, as nothing of the worktree is here to read where the branch started.
      assert.deepInclude(owed, { state: 'owed', base: null, message: 'Its worktree’s repository isn’t on this computer.' })
      assert.include(
        yield* noticesOf(task.threadId),
        'The review after #1 merged didn’t start: Its worktree’s repository isn’t on this computer. Althar tries again.',
      )
      // Merge now while it is owed keeps it owed, still from nothing it knows: no mark of its worktree is here.
      yield* (yield* MergeReviews).owe(task.taskId, task.url, { [task.path]: git(working, 'rev-parse', 'main') })
      assert.deepInclude(yield* reviewOf(task.url), { state: 'owed', base: null, head: null })
      // Back on this computer, it starts, and reads.
      yield* onDevice(here?.deviceId ?? '')
      yield* aged(task.url)
      yield* (yield* FastLane).retryPendingReviews()
      const reviewer = yield* reviewerThread(task.taskId)
      yield* reviewing(reviewer)
      // Gone elsewhere again while its reviewer reads: once it reports, the copy Althar can no longer place is left as it is.
      yield* onDevice(elsewhere)
      place.open('[review:slowly]')
      yield* until(reviewOf(task.url), (row) => row?.state === 'clear')
      yield* gone(reviewer)
      assert.isTrue(existsSync(mergeCopyOf(task.path, 1)))
    }).pipe(Effect.provide(runtimeWith(github, { holds: place })))
  })

  it.live('reads what merged from the repository’s own checkout once the task’s worktree is gone', () => {
    const { working, bare, github } = onGitHub()
    const place = holds()
    return Effect.gen(function* () {
      const task = yield* opened(working, '[review:wait]')
      const pushed = git(bare, 'rev-parse', BRANCH)
      // Its lead stopped first: on Windows no folder an agent works in can be removed.
      yield* Effect.ignore((yield* Sessions).stop(task.threadId))
      yield* gone(task.threadId)
      removeTreeSync(task.path)
      yield* mergeIt(bare, github, task.taskId)
      yield* until(reviewOf(task.url), (row) => row?.state === 'running')
      yield* reviewing(yield* reviewerThread(task.taskId))
      // Its copy is made from the repository's checkout, at what Althar pushed of the branch.
      const copy = mergeCopyOf(task.path, 1)
      assert.isTrue(existsSync(copy))
      assert.strictEqual(git(copy, 'rev-parse', 'HEAD'), pushed)
      place.open('[review:wait]')
    }).pipe(Effect.provide(runtimeWith(github, { holds: place })))
  })

  it.live('fetches the merged head the host names where no checkout here has it, and reads that', () => {
    const { working, bare, github } = onGitHub(true)
    const place = holds()
    return Effect.gen(function* () {
      const task = yield* opened(working, '[review:wait]')
      const outside = pushOnHost(bare)
      // Its origin answers, as a host that can be fetched from does.
      git(working, 'config', `url.${bare}.insteadOf`, `${HOST}/meridian/api.git`)
      yield* mergeIt(bare, github, task.taskId)
      const running = yield* until(reviewOf(task.url), (row) => row?.state === 'running')
      assert.strictEqual(running?.head, outside)
      yield* reviewing(yield* reviewerThread(task.taskId))
      assert.strictEqual(git(mergeCopyOf(task.path, 1), 'rev-parse', 'HEAD'), outside)
      place.open('[review:wait]')
    }).pipe(Effect.provide(runtimeWith(github, { holds: place })))
  })

  it.live('reads what Althar pushed where the merged head the host names can’t be fetched', () => {
    const { working, bare, github } = onGitHub(true)
    const place = holds()
    return Effect.gen(function* () {
      const task = yield* opened(working, '[review:wait]')
      const pushed = git(bare, 'rev-parse', BRANCH)
      const outside = pushOnHost(bare)
      yield* mergeIt(bare, github, task.taskId)
      const running = yield* until(reviewOf(task.url), (row) => row?.state === 'running')
      assert.strictEqual(running?.head, outside)
      yield* reviewing(yield* reviewerThread(task.taskId))
      assert.strictEqual(git(mergeCopyOf(task.path, 1), 'rev-parse', 'HEAD'), pushed)
      place.open('[review:wait]')
    }).pipe(Effect.provide(runtimeWith(github, { holds: place })))
  })

  it.live('owes nothing after a merge its last review read whole, though the plan now reads only once it merged', () => {
    const { working, bare, github } = onGitHub(true)
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working, '[review:pass]', false)
      // The person moved Checked by to after the merge, once its review had read all of it.
      yield* sql`UPDATE task_plans SET parameters = json_set(parameters, '$.reviewAfterMerge', json('true')) WHERE task_id = ${task.taskId}`
      // Before it merges, nothing is owed for it.
      yield* (yield* FastLane).reviewMerged(task.taskId, task.url)
      assert.strictEqual(yield* tasksOwed(task.taskId), 0)
      yield* mergeIt(bare, github, task.taskId)
      yield* until(snapshotOf(task.url), (state) => state === 'merged')
      yield* (yield* FastLane).reviewMerged(task.taskId, task.url)
      assert.strictEqual(yield* tasksOwed(task.taskId), 0)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('Merge now owes a review only where the plan names a reviewer, and only of the task’s own pull request', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const mergeReviews = yield* MergeReviews
      const task = yield* opened(working, '[review:pass]')
      const [plan] = yield* sql<{ parameters: string }>`SELECT parameters FROM task_plans WHERE task_id = ${task.taskId}`
      // A plan that names no steps names no reviewer: nothing is owed, by Merge now or by the merge.
      yield* sql`UPDATE task_plans SET parameters = json_remove(parameters, '$.steps') WHERE task_id = ${task.taskId}`
      yield* mergeReviews.owe(task.taskId, task.url, {})
      assert.strictEqual(yield* tasksOwed(task.taskId), 0)
      yield* sql`UPDATE task_plans SET parameters = ${plan?.parameters ?? ''} WHERE task_id = ${task.taskId}`
      // A pull request that isn't the task's own is owed nothing.
      yield* mergeReviews.owe(task.taskId, `${HOST}/meridian/api/pull/9`, {})
      assert.strictEqual(yield* tasksOwed(task.taskId), 0)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('owed by Merge now, it waits for the merge, and stops once its pull request closes unmerged', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const mergeReviews = yield* MergeReviews
      const task = yield* opened(working, '[review:pass]')
      // Owed with no mark of what a review read: from nothing it knows.
      yield* mergeReviews.owe(task.taskId, task.url, {})
      assert.deepInclude(yield* reviewOf(task.url), { state: 'owed', base: null, head: null })
      // Still open, it waits.
      yield* (yield* FastLane).retryPendingReviews()
      assert.strictEqual((yield* reviewOf(task.url))?.state, 'owed')
      github.close(1)
      yield* (yield* Changes).refresh(task.taskId)
      yield* until(snapshotOf(task.url), (state) => state === 'closed')
      yield* (yield* FastLane).retryPendingReviews()
      assert.deepInclude(yield* reviewOf(task.url), { state: 'stopped', message: 'It closed without merging.' })
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live(
    'waits longer after each try that couldn’t start, and keeps a review whose model its agent doesn’t offer owed, without starting it',
    () => {
      const { working, bare, github } = onGitHub()
      return Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const task = yield* opened(working, '[review:pass]')
        const blocker = join(mergeCopyOf(task.path, 1), '..')
        execFileSync('mkdir', ['-p', join(blocker, '..')])
        execFileSync('touch', [blocker])
        yield* mergeIt(bare, github, task.taskId)
        const first = yield* until(reviewOf(task.url), (row) => (row?.attempts ?? 0) > 0)
        // Listened to again at once, it isn't tried again: each try is a session starting on the task, which shows it at work.
        yield* (yield* FastLane).retryPendingReviews()
        yield* (yield* FastLane).retryPendingReviews()
        assert.strictEqual((yield* reviewOf(task.url))?.attempts, first?.attempts)
        // Its wait over, it is.
        yield* aged(task.url)
        yield* (yield* FastLane).retryPendingReviews()
        assert.strictEqual((yield* reviewOf(task.url))?.attempts, (first?.attempts ?? 0) + 1)
        // A model its agent doesn't offer (as far as what it last said goes) starts no session: owed, saying so, and looked at again
        // after its wait, not stopped, as the agent may offer it once asked again.
        const sessionsOf = () => sql<{ n: number }>`SELECT count(*) AS n FROM provider_sessions`
        const before = (yield* sessionsOf())[0]?.n
        yield* sql`UPDATE merge_reviews SET reviewer = ${JSON.stringify({ agentId: 'claude-code', model: 'no-such-model-9', effort: null })} WHERE url = ${task.url}`
        yield* aged(task.url)
        yield* (yield* FastLane).retryPendingReviews()
        const owed = yield* reviewOf(task.url)
        assert.strictEqual(owed?.state, 'owed')
        assert.include(owed?.message ?? '', 'no-such-model-9')
        assert.strictEqual((yield* sessionsOf())[0]?.n, before)
        yield* (yield* FastLane).retryPendingReviews()
        assert.strictEqual((yield* reviewOf(task.url))?.attempts, owed?.attempts)
        // The agent offers it now (here, a model it does offer): the next try starts it.
        rmSync(blocker, { force: true })
        yield* sql`UPDATE merge_reviews SET reviewer = ${JSON.stringify({ agentId: 'claude-code', model: 'Large', effort: null })} WHERE url = ${task.url}`
        yield* aged(task.url)
        yield* (yield* FastLane).retryPendingReviews()
        yield* until(reviewOf(task.url), (row) => row?.state === 'clear')
      }).pipe(Effect.provide(runtimeWith(github)))
    },
  )

  it.live('waits longer after each turn of its reviewer that failed, as it does after a start that failed', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working, '[review:wait]')
      yield* mergeIt(bare, github, task.taskId)
      yield* until(reviewOf(task.url), (row) => row?.state === 'running')
      const reviewer = yield* reviewerThread(task.taskId)
      yield* reviewing(reviewer)
      // Its first turn fails, out of reach: owed, once, with a wait before the next try.
      yield* (yield* Live).publish({ _tag: 'TurnEnded', threadId: reviewer, turnId: 'turn', state: 'failed', errorClass: 'unreachable' })
      const failed = yield* until(reviewOf(task.url), (row) => row?.state === 'owed')
      assert.strictEqual(failed?.attempts, 1)
      // Listened to again at once, it isn't started again, whatever the number of listening turns.
      yield* (yield* FastLane).retryPendingReviews()
      yield* (yield* FastLane).retryPendingReviews()
      assert.deepInclude(yield* reviewOf(task.url), { state: 'owed', attempts: 1 })
      // Its wait over, it is.
      yield* aged(task.url)
      yield* (yield* FastLane).retryPendingReviews()
      assert.strictEqual((yield* reviewOf(task.url))?.state, 'running')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('keeps the latest reason it can’t start, says it once, and stops a review whose reviewer isn’t known', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working, '[review:pass]')
      // Its copy can't be made where it goes: the folder is a file.
      const blocker = join(mergeCopyOf(task.path, 1), '..')
      execFileSync('mkdir', ['-p', join(blocker, '..')])
      execFileSync('touch', [blocker])
      yield* mergeIt(bare, github, task.taskId)
      yield* until(reviewOf(task.url), (row) => (row?.attempts ?? 0) > 0)
      // Its worktree gone and its repository moved: what merged isn't anywhere here. Said in the records, as Althar would find
      // them: on Windows a folder something still works in can't be removed or moved under it.
      yield* sql`UPDATE workspaces SET path = path || '-gone' WHERE task_id = ${task.taskId}`
      yield* sql`UPDATE repository_locations SET path = path || '-moved'`
      yield* aged(task.url)
      yield* (yield* FastLane).retryPendingReviews()
      assert.deepInclude(yield* reviewOf(task.url), {
        state: 'owed',
        attempts: 2,
        message: 'Althar can’t find what merged on this computer.',
      })
      // Nor once its repository is known only on another computer.
      const elsewhere = `dev_${'e'.repeat(32)}`
      yield* sql`INSERT INTO devices (id, name, created_at) VALUES (${elsewhere}, 'Other Mac', '2026-01-01T00:00:00.000Z')`
      yield* sql`UPDATE repository_locations SET device_id = ${elsewhere}`
      yield* aged(task.url)
      yield* (yield* FastLane).retryPendingReviews()
      assert.deepInclude(yield* reviewOf(task.url), {
        state: 'owed',
        attempts: 3,
        message: 'Althar can’t find what merged on this computer.',
      })
      assert.lengthOf(
        (yield* noticesOf(task.threadId)).filter((title) => title.includes('didn’t start')),
        1,
      )
      // A review whose reviewer can't be read is stopped, saying so.
      yield* sql`UPDATE merge_reviews SET reviewer = NULL WHERE url = ${task.url}`
      yield* aged(task.url)
      yield* (yield* FastLane).retryPendingReviews()
      assert.deepInclude(yield* reviewOf(task.url), { state: 'stopped', message: 'Its plan names no reviewer.' })
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('owes the whole of a branch rewritten on the host after its review read it', () => {
    const { working, bare, github } = onGitHub(true)
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working, '[review:pass]', false)
      yield* sql`UPDATE task_plans SET parameters = json_set(parameters, '$.reviewAfterMerge', json('true')) WHERE task_id = ${task.taskId}`
      // Someone rewrites its commit on the host: nothing on the branch it merges from is what the review read.
      const clone = mkdtempSync(join(tmpdir(), 'althar-rewrite-'))
      execFileSync('git', ['clone', '-q', '-b', BRANCH, bare, clone])
      writeFileSync(join(clone, 'change.txt'), 'rewritten on the host\n')
      git(clone, 'add', '.')
      git(clone, '-c', 'user.name=Dana', '-c', 'user.email=dana@althar.test', 'commit', '-q', '--amend', '-m', 'Rewritten')
      git(clone, 'push', '-q', '--force', 'origin', BRANCH)
      const rewritten = git(clone, 'rev-parse', 'HEAD')
      git(working, 'config', `url.${bare}.insteadOf`, `${HOST}/meridian/api.git`)
      yield* mergeIt(bare, github, task.taskId)
      // Owed from where the branch started, to the head that merged.
      const [workspace] = yield* sql<{ baseCommit: string }>`SELECT base_commit FROM workspaces WHERE task_id = ${task.taskId}`
      const owed = yield* until(reviewOf(task.url), (row) => row !== undefined)
      assert.deepStrictEqual([owed?.base, owed?.head], [workspace?.baseCommit, rewritten])
      yield* until(reviewOf(task.url), (row) => row?.state === 'clear')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('runs one review at a time in a task: another owed waits for the one at work, and starts once it reports', () => {
    const { working, bare, github } = onGitHub()
    const place = holds()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working, '[review:wait]')
      yield* mergeIt(bare, github, task.taskId)
      yield* until(reviewOf(task.url), (row) => row?.state === 'running')
      const reviewer = yield* reviewerThread(task.taskId)
      yield* reviewing(reviewer)
      // Two more of the task's pull requests merged meanwhile: one Althar has its head for, one it hasn't heard merged.
      const second = `${HOST}/meridian/api/pull/2`
      const third = `${HOST}/meridian/api/pull/3`
      const pushed = git(bare, 'rev-parse', BRANCH)
      for (const [url, number, head] of [
        [second, 2, pushed],
        [third, 3, null],
      ] as const)
        yield* sql`
          INSERT INTO merge_reviews (url, task_id, project_id, number, base, head, state, reviewer, findings, attempts, created_at, updated_at)
          SELECT ${url}, task_id, project_id, ${number}, base, ${head}, 'owed', reviewer, '[]', 0, created_at, updated_at
          FROM merge_reviews WHERE url = ${task.url}`
      yield* (yield* FastLane).retryPendingReviews()
      assert.deepInclude(yield* reviewOf(second), { state: 'owed', attempts: 0 })
      assert.deepInclude(yield* reviewOf(third), { state: 'owed', attempts: 0 })
      // The first reports, and its reviewer goes: the next owed with a head starts.
      const [session] = yield* sql<{ id: string }>`
        SELECT id FROM provider_sessions WHERE thread_id = ${reviewer} ORDER BY started_at DESC LIMIT 1`
      const access: ToolAccess = {
        role: 'reviewer',
        projectId: task.projectId,
        threadId: reviewer,
        sessionId: session?.id ?? '',
        taskId: task.taskId,
      }
      assert.strictEqual(
        yield* callTool(access, 'report_review', { verdict: 'pass', summary: 'It holds.' }),
        'Althar has your review. The merged change passes.',
      )
      place.open('[review:wait]')
      yield* until(reviewOf(second), (row) => row?.state !== 'owed')
      // The one never heard merged still waits for its merge.
      assert.strictEqual((yield* reviewOf(third))?.state, 'owed')
    }).pipe(Effect.provide(runtimeWith(github, { holds: place })))
  })

  it.live('owes again a review whose reviewer’s turn failed, which starts over once it is tried again', () => {
    const { working, bare, github } = onGitHub()
    let down = true
    return Effect.gen(function* () {
      const task = yield* opened(working, '[review:pass]')
      yield* mergeIt(bare, github, task.taskId)
      const reviewer = yield* until(
        Effect.flatMap(
          SqlClient.SqlClient,
          (sql) =>
            sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${task.taskId} AND kind = 'step' AND node_key = 'merge_review'`,
        ),
        (rows) => rows.length > 0,
      )
      const thread = reviewer[0]?.id ?? ''
      yield* until(
        Effect.flatMap(SqlClient.SqlClient, (sql) => sql<{ state: string }>`SELECT state FROM turn_deliveries WHERE thread_id = ${thread}`),
        (rows) => rows.some((row) => row.state === 'failed'),
      )
      yield* until(reviewOf(task.url), (row) => row?.state === 'owed')
      // Its service answers again: tried again once its wait is over, it reads.
      down = false
      yield* aged(task.url)
      yield* (yield* FastLane).retryPendingReviews()
      yield* until(reviewOf(task.url), (row) => row?.state === 'clear')
    }).pipe(Effect.provide(runtimeWith(github, {}, { codex: { connection: () => (down ? 'server' : undefined) } })))
  })
})

/** What the person says to the task's lead, as the task's screen says it; a lead stopped since, as by settling, starts again. */
const say = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    const live = Option.isSome(yield* sessions.running(threadId))
    yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', { threadId, body }), threadId, body })
    if (!live) yield* Effect.ignore(sessions.startLast(threadId))
  })

/** Waits until what the task's lead committed waits for Ship, and its turn is over: Ship is refused while it is at work. */
const held = (task: { readonly taskId: string; readonly threadId: string }) =>
  Effect.gen(function* () {
    yield* until(
      Effect.flatMap(
        SqlClient.SqlClient,
        (sql) => sql<{ heldAt: string | null }>`SELECT held_at FROM workspaces WHERE task_id = ${task.taskId}`,
      ),
      (rows) => rows[0]?.heldAt != null,
    )
    yield* until(
      Effect.flatMap(Sessions, (sessions) => sessions.busy(task.threadId)),
      (busy) => !busy,
    )
  })

describe('Merge, with commits not shipped, at its edges', () => {
  it.live('Merge now of the pull request named sends what waits up, merges it, and owes it a review after', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working, '[review:pass]', false)
      yield* say(task.threadId, 'Make it retry twice. tidy pls [lead:commit]')
      yield* held(task)
      const tweak = git(task.path, 'rev-parse', 'HEAD^{tree}')
      yield* (yield* Runs).mergeWaiting({
        envelope: yield* Runtime.envelope('task.merge', { taskId: task.taskId, how: 'now', url: task.url }),
        taskId: task.taskId,
        how: 'now',
        url: task.url,
      })
      assert.deepStrictEqual(
        github.merged.map((one) => [one.number, one.how]),
        [[1, 'merge']],
      )
      // What went up holds the tweak, as Althar wrote it with its credit.
      assert.strictEqual(git(bare, 'rev-parse', `${BRANCH}^{tree}`), tweak)
      yield* until(reviewOf(task.url), (row) => row?.state === 'clear')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('Review and merge after the first merged ships the next pull request, and says so where its host refuses the merge', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working, '[review:pass]', false)
      yield* mergeIt(bare, github, task.taskId)
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'settled')
      yield* say(task.threadId, 'Make it retry twice. tidy pls [lead:commit]')
      yield* held(task)
      github.failNext('merge', 'rejected')
      yield* (yield* Runs).mergeWaiting({
        envelope: yield* Runtime.envelope('task.merge', { taskId: task.taskId, how: 'review' }),
        taskId: task.taskId,
        how: 'review',
      })
      // Reviewed, the tweak goes up as the next pull request; the merged one stays as it was, and the host says no to the new one.
      yield* until(noticesOf(task.threadId), (titles) => titles.some((title) => title.startsWith('Shipped, but not merged:')))
      assert.include(yield* noticesOf(task.threadId), 'Shipped, but not merged: GitHub said no: The fake merge failed (rejected).')
      assert.deepStrictEqual(
        github.changes.map((one) => [one.number, one.state]),
        [
          [1, 'merged'],
          [2, 'open'],
        ],
      )
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('Review and merge leaves the merge to the person where the lead set what its review found aside', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working, '[review:always] [lead:set-aside]', false)
      yield* say(task.threadId, 'Make it retry twice. tidy pls [lead:commit]')
      yield* held(task)
      yield* (yield* Runs).mergeWaiting({
        envelope: yield* Runtime.envelope('task.merge', { taskId: task.taskId, how: 'review' }),
        taskId: task.taskId,
        how: 'review',
      })
      const said = 'Not merged: the lead set 2 findings of the review aside. Read why, then merge it yourself.'
      yield* until(noticesOf(task.threadId), (titles) => titles.includes(said))
      assert.lengthOf(github.merged, 0)
      assert.strictEqual(github.changes[0]?.state, 'open')
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})
