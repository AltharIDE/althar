import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

import { assert, describe, it } from '@effect/vitest'
import { Deferred, Duration, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes, FIX_ROUNDS, OFF_FOR_PROJECT, OFF_FOR_TASK } from '../src/Changes'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Policies } from '../src/Policies'
import { gaveUpLine, unreachedLine } from '../src/pullRequestWords'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, hosted, notices, until } from './support'
import {
  asked,
  cards,
  type Checks,
  connect,
  FAILED,
  given,
  holdsFix,
  holdsMain,
  holdsTestsFix,
  hostOf,
  moveHostMainOn,
  opened,
  PASSED,
  RUNNING,
  rounds,
  runtimeWith,
  taskSays,
  titled,
  worktreeOf,
} from './conflictsSupport'

/*
 * A task whose pull request conflicts with the branch it goes into, or whose
 * checks fail, goes back to work on its own: its lead is asked, once for
 * both where both come at once, and its card is under way, not in Needs
 * you. Unless the person turned resolving conflicts off, or stopped the
 * task: then its card says why it waits for them. And a round the lead
 * couldn't see through comes back to the person, with why, rather than
 * going round again.
 */

/** The task's card, as the board has it. */
const cardOf = (projectId: string) => Effect.map(cards(projectId), ([card]) => card)

/** The task stopped, as the person's Stop leaves it: its lead stopped and taken from Althar's hands, its run suspended. */
const stopped = (taskId: string, threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* (yield* Sessions).stop(threadId)
    yield* (yield* Changes).leadStopped({ threadId })
    yield* sql`UPDATE runs SET state = 'suspended' WHERE task_id = ${taskId}`
  })

/** The task's pull request: its link's id, and its address. */
const linkOf = (taskId: string) =>
  Effect.flatMap(SqlClient.SqlClient, (sql) =>
    Effect.map(
      sql<{ id: string; projectId: string; url: string }>`
        SELECT id, project_id, url FROM external_links WHERE task_id = ${taskId} AND kind = 'change'`,
      ([one]) => one,
    ),
  )

/**
 * The task's pull request as PR #1007 was left: its checks heard failing on its head, by a look that ended before it told the
 * lead. The host's next read of it is held (`hold`), so no look tells the lead until the test lets it go.
 */
const untoldFailure = (github: { readonly calls: ReadonlyArray<string> }, taskId: string, hold: () => void) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const reads = () => github.calls.filter((method) => method === 'change').length
    const before = reads()
    hold()
    yield* until(
      Effect.sync(() => [reads()]),
      ([now]) => (now ?? 0) > before,
    )
    const link = yield* linkOf(taskId)
    const [row] = yield* sql<{
      head: string
    }>`SELECT json_extract(snapshot, '$.headSha') AS head FROM external_links WHERE id = ${link?.id ?? ''}`
    const sum = {
      sha: row?.head ?? '',
      outcome: 'failed',
      passed: 0,
      failed: 1,
      running: 0,
      total: 1,
      failing: ['test'],
      list: [{ name: 'test', state: 'failed', summary: null }],
    }
    yield* sql`UPDATE external_links SET snapshot = json_set(snapshot, '$.checks', json(${JSON.stringify(sum)})) WHERE id = ${link?.id ?? ''}`
    yield* sql`INSERT INTO observations ${sql.insert({
      id: `obs_${randomBytes(16).toString('hex')}`,
      projectId: link?.projectId ?? '',
      subjectType: 'external_link',
      subjectId: link?.id ?? '',
      kind: 'checks',
      payload: JSON.stringify({ ...sum, id: `checks:${sum.sha}:failed:1` }),
      source: 'github',
      observedAt: new Date().toISOString(),
    })}`
  })

describe('a conflict alone', () => {
  it.live('is the lead’s by default, and the card is under way while the checks on its merge run', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, (sha) => (holdsMain(bare, sha) ? RUNNING : PASSED))
    return Effect.gen(function* () {
      // Nothing set: the project's rules say nothing of conflicts, and the task neither.
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:resolve]')
      assert.isUndefined((yield* (yield* Policies).current(projectId as never)).rules.resolveConflicts)
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and pushed the merge to PR #1.')
      assert.strictEqual((yield* rounds(taskId))[0]?.state, 'checking')
      // Waiting on the merge's checks, it is under way, not the person's to ask anything of.
      const card = yield* until(
        Effect.map(cardOf(projectId), (one) => [one]),
        ([one]) => one?.phase === 'running',
      )
      assert.strictEqual(card[0]?.step, 'checks_running')
      assert.isNull(card[0]?.conflictUnsent ?? null)
      assert.strictEqual((yield* asked(threadId)).length, 1)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('that comes back while the checks on the merge run is a round of its own, asked of the lead at once', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, (sha) => (holdsMain(bare, sha) ? RUNNING : PASSED))
    return Effect.gen(function* () {
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:resolve]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and pushed the merge to PR #1.')
      assert.strictEqual((yield* rounds(taskId))[0]?.state, 'checking')
      // Main moves on again just after the push, conflicting with the merge, as it did for PR #563.
      moveHostMainOn(working, bare, 'rate limits, again\n')
      const all = yield* until(rounds(taskId), (now) => now.length === 2)
      assert.strictEqual(all[0]?.state, 'resolved')
      yield* until(asked(threadId), (now) => now.length === 2)
      // Under way again, never left in Needs you with a button and no word.
      const [card] = yield* until(
        Effect.map(cardOf(projectId), (one) => [one]),
        ([one]) => one?.phase === 'running',
      )
      assert.isNull(card?.conflictUnsent ?? null)
      assert.isNull(card?.handedBack ?? null)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('that comes back while the checks on the merge run is found by Althar’s own look, its host silent', () => {
    const { working, bare } = hosted()
    let silent = false
    const github = hostOf(bare, (sha) => (holdsMain(bare, sha) ? RUNNING : PASSED), undefined, {
      says: () => (silent ? false : undefined),
    })
    return Effect.gen(function* () {
      const { taskId, threadId } = yield* opened(working, '[lead:resolve]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and pushed the merge to PR #1.')
      assert.strictEqual((yield* rounds(taskId))[0]?.state, 'checking')
      // Its host hasn't worked out that the merge conflicts with main moved on again, and says it merges cleanly.
      silent = true
      moveHostMainOn(working, bare, 'rate limits, again\n')
      const all = yield* until(rounds(taskId), (now) => now.length === 2)
      assert.strictEqual(all[0]?.state, 'resolved')
      yield* until(asked(threadId), (now) => now.length === 2)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('its host says before Althar has asked anything is on its way to the lead, or says why not', () => {
    const { working, bare } = hosted()
    let held = false
    const gate = Effect.runSync(Deferred.make<void>())
    const github = hostOf(bare, undefined, undefined, {
      waitsFor: (method) => (held && method === 'change' ? Deferred.await(gate) : Effect.void),
    })
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId, taskId } = yield* opened(working, '[lead:resolve]')
      // Its next read of the pull request held, as the first poll after a restart not yet come: listened to all the same.
      const reads = () => github.calls.filter((method) => method === 'change').length
      const before = reads()
      held = true
      yield* until(
        Effect.sync(() => [reads()]),
        ([now]) => (now ?? 0) > before,
      )
      // The host said it conflicts as Althar last read it, and no round has started.
      yield* sql`UPDATE external_links SET snapshot = json_set(snapshot, '$.conflicts', json('true'))
        WHERE task_id = ${taskId} AND kind = 'change'`
      assert.lengthOf(yield* rounds(taskId), 0)
      assert.deepStrictEqual(yield* (yield* Changes).conflictStanding(taskId), { state: 'due' })
      const card = yield* cardOf(projectId)
      assert.strictEqual(card?.change?.conflicts, true)
      assert.strictEqual(card?.phase, 'running')
      assert.strictEqual(card?.step, 'conflict')
      // Turned off, it waits for the person, and the card says why, with nothing Althar remembers from looking.
      yield* (yield* Policies).set(projectId as never, { resolveConflicts: false }, (yield* Instance).personId)
      const off = yield* cardOf(projectId)
      assert.strictEqual(off?.phase, 'ready')
      assert.strictEqual(off?.conflictUnsent, OFF_FOR_PROJECT)
      // On again, but a pull request Althar stopped following will never be looked at: nothing is on its way.
      yield* (yield* Policies).set(projectId as never, { resolveConflicts: true }, (yield* Instance).personId)
      yield* sql`UPDATE external_links SET listening = 0 WHERE task_id = ${taskId} AND kind = 'change'`
      assert.isNull(yield* (yield* Changes).conflictStanding(taskId))
      assert.strictEqual((yield* cardOf(projectId))?.phase, 'ready')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('its host says, where the branch here merges cleanly, isn’t on its way to the lead', () => {
    const { working, bare } = hosted()
    let stale = false
    const github = hostOf(bare, undefined, undefined, { says: () => (stale ? true : undefined) })
    return Effect.gen(function* () {
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:resolve]')
      // The host says it conflicts, out of date: main hasn't moved, and the branch here merges with it cleanly.
      stale = true
      yield* until(
        Effect.map(cardOf(projectId), (one) => [one]),
        ([one]) => one?.change?.conflicts === true,
      )
      yield* until(
        Effect.map((yield* Changes).conflictStanding(taskId), (one) => [one]),
        ([one]) => one === null,
      )
      yield* Effect.sleep('800 millis')
      // Looked at again and again, it stays waiting on nothing: no round, no ask, no card on its way back.
      assert.isNull(yield* (yield* Changes).conflictStanding(taskId))
      assert.lengthOf(yield* rounds(taskId), 0)
      assert.lengthOf(yield* asked(threadId), 0)
      const card = yield* cardOf(projectId)
      assert.strictEqual(card?.phase, 'ready')
      assert.isNull(card?.conflictUnsent ?? null)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})

describe('failed checks alone', () => {
  it.live('are run again once, then go to the lead, whose fix goes up, with no button pressed', () => {
    const { working, bare } = hosted()
    let broken = false
    const github = hostOf(bare, (sha) => (broken && !holdsFix(bare, sha) ? FAILED : PASSED))
    return Effect.gen(function* () {
      const { projectId, threadId } = yield* opened(working, '[lead:fix]')
      broken = true
      // Run again first, as one may have failed by chance; failing again, the lead is told and fixes it.
      yield* until(
        Effect.sync(() => [github.reruns.length]),
        ([n]) => (n ?? 0) >= 1,
      )
      yield* until(given(threadId), (all) => all.some((body) => body.startsWith('Checks failed on PR #1: test.')))
      yield* until(
        Effect.sync(() => [holdsFix(bare, 'althar/add-a-retry')]),
        ([fixed]) => fixed === true,
      )
      yield* until(cardOf(projectId).pipe(Effect.map((one) => [one])), ([one]) => one?.change?.checks?.outcome === 'passed')
      assert.strictEqual((yield* given(threadId)).filter((body) => body.startsWith('Checks failed')).length, 1)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('reach the lead though the look that heard them failed before it told the lead', () => {
    const { working, bare } = hosted()
    let broken = false
    let tripped = false
    const github = hostOf(bare, (sha) => {
      if (!broken || holdsFix(bare, sha)) return PASSED
      // The look that first reads them failing can't run them again, and its host goes away before it reads the rest of the
      // pull request, as PR #1007's did: it kept that they failed, and that it told the lead, and ended before it did.
      if (!tripped) {
        tripped = true
        github.failNext('rerun', 'unreachable')
        github.failNext('activity', 'unreachable')
      }
      return FAILED
    })
    return Effect.gen(function* () {
      const { projectId, threadId } = yield* opened(working, '[lead:fix]')
      const sql = yield* SqlClient.SqlClient
      broken = true
      // The next look hears nothing new of the checks, but finds the lead never told: told now, it fixes them, and the fix goes up.
      yield* until(given(threadId), (all) => all.some((body) => body.startsWith('Checks failed on PR #1: test.')))
      const [failedAt] = yield* sql<{ at: string }>`
        SELECT observed_at AS at FROM observations WHERE kind = 'checks' AND json_extract(payload, '$.outcome') = 'failed' LIMIT 1`
      const [toldAt] = yield* sql<{ at: string }>`
        SELECT min(accepted_at) AS at FROM user_inputs WHERE thread_id = ${threadId} AND body LIKE 'Checks failed on PR #1%'`
      // Told on a later look than the one that heard them failing: the one that heard them ended before it told the lead.
      assert.isTrue(github.calls.filter((method) => method === 'activity').length > 0)
      assert.isTrue((toldAt?.at ?? '') > (failedAt?.at ?? ''))
      yield* until(
        Effect.sync(() => [holdsFix(bare, 'althar/add-a-retry')]),
        ([fixed]) => fixed === true,
      )
      yield* until(cardOf(projectId).pipe(Effect.map((one) => [one])), ([one]) => one?.change?.checks?.outcome === 'passed')
      assert.strictEqual((yield* given(threadId)).filter((body) => body.startsWith('Checks failed')).length, 1)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('aren’t being fixed on the card while its lead hasn’t been told them, and are once it is', () => {
    const { working, bare } = hosted()
    let broken = false
    let held = false
    const gate = Effect.runSync(Deferred.make<void>())
    const github = hostOf(bare, (sha) => (broken && !holdsFix(bare, sha) ? FAILED : PASSED), undefined, {
      waitsFor: (method) => (held && method === 'change' ? Deferred.await(gate) : Effect.void),
    })
    return Effect.gen(function* () {
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:fix]')
      yield* untoldFailure(github, taskId, () => {
        held = true
        broken = true
      })
      yield* Effect.sleep('600 millis')
      // Past the moment a look had to tell the lead, nobody is on them: not Fixing the checks, nor under way.
      const untold = yield* cardOf(projectId)
      assert.strictEqual(untold?.change?.checks?.outcome, 'failed')
      assert.notStrictEqual(untold?.step, 'checks')
      assert.strictEqual(untold?.phase, 'ready')
      assert.lengthOf(
        (yield* given(threadId)).filter((body) => body.startsWith('Checks failed')),
        0,
      )
      // Something else reaching its lead meanwhile, such as a comment on the pull request, doesn't tell it the checks failed.
      const body = 'meridian commented on PR #1: Looks fine.'
      yield* (yield* Sessions).send({ envelope: yield* Runtime.envelope('thread.send', { threadId, body }), threadId, body, quiet: true })
      yield* until(
        Effect.flatMap(SqlClient.SqlClient, (sql) => sql<{ state: string }>`SELECT state FROM user_inputs WHERE body = ${body}`),
        ([one]) => one?.state === 'delivered',
      )
      // Nor does the same words for another of its repositories' PR #1, which its lead has: as a note marked taken, so the
      // fake lead doesn't fix anything for it.
      const other = 'Checks failed on PR #1: test. Their checks are yours to see through, in meridian/web.'
      yield* (yield* Sessions).send({
        envelope: yield* Runtime.envelope('thread.send', { threadId, body: other }),
        threadId,
        body: other,
        quiet: true,
        note: true,
      })
      yield* Effect.flatMap(SqlClient.SqlClient, (sql) => sql`UPDATE user_inputs SET state = 'delivered' WHERE body = ${other}`)
      yield* Effect.sleep('400 millis')
      assert.notStrictEqual((yield* cardOf(projectId))?.step, 'checks')
      assert.notStrictEqual((yield* cardOf(projectId))?.step, 'checks')
      // The next look tells the lead: Fixing the checks, under way, while it is at them.
      const seen: Array<{ readonly step: string | null; readonly phase: string }> = []
      held = false
      yield* Deferred.succeed(gate, undefined)
      yield* until(
        cardOf(projectId).pipe(
          Effect.tap((one) => Effect.sync(() => seen.push({ step: one?.step ?? null, phase: one?.phase ?? '' }))),
          Effect.map((one) => [one]),
        ),
        ([one]) => one?.change?.checks?.outcome === 'passed',
      )
      assert.isTrue(seen.some((one) => one.step === 'checks' && one.phase === 'running'))
      assert.strictEqual(
        (yield* given(threadId)).filter((body) => body.startsWith('Checks failed') && !body.includes('meridian/web')).length,
        1,
      )
    }).pipe(Effect.provide(runtimeWith({ github }, {}, undefined, {}, Duration.millis(300))))
  })

  it.live('go to the person with a line where the lead can’t be started to be told them', () => {
    const { working, bare } = hosted()
    let held = false
    // Only the head the failure is staged on fails: none before it, nor what the lead commits after, so no fix of its own,
    // nor its turns ending with them failing, race the hand-off.
    let failing: string | undefined
    const gate = Effect.runSync(Deferred.make<void>())
    const github = hostOf(
      bare,
      (sha) => {
        if (held && failing === undefined) failing = sha
        return sha === failing ? FAILED : PASSED
      },
      undefined,
      { waitsFor: (method) => (held && method === 'change' ? Deferred.await(gate) : Effect.void) },
    )
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:fix]')
      yield* untoldFailure(github, taskId, () => {
        held = true
      })
      const [mark] = yield* sql<{
        sequence: number
      }>`SELECT coalesce(max(sequence), 0) AS sequence FROM user_inputs WHERE thread_id = ${threadId}`
      // Its lead has nothing to start again from.
      const [lead] = yield* sql<{ agentId: string }>`SELECT agent_id FROM provider_sessions WHERE thread_id = ${threadId} LIMIT 1`
      yield* (yield* Sessions).stop(threadId)
      yield* sql`PRAGMA foreign_keys = OFF`
      yield* sql`DELETE FROM provider_sessions WHERE thread_id = ${threadId}`
      yield* sql`PRAGMA foreign_keys = ON`
      yield* Deferred.succeed(gate, undefined)
      const [card] = yield* until(
        Effect.map(cardOf(projectId), (one) => [one]),
        ([one]) => one?.checksBack != null,
      )
      assert.strictEqual(card?.checksBack, unreachedLine(['test']))
      assert.strictEqual(card?.phase, 'ready')
      assert.include(
        (yield* notices(threadId)).map((one) => one.title),
        unreachedLine(['test']),
      )
      // The message that would have told it to fix them is withdrawn: a lead started later for something else never takes it up.
      const told = yield* sql<{
        state: string
      }>`SELECT state FROM user_inputs WHERE thread_id = ${threadId} AND body LIKE 'Checks failed%' AND sequence > ${mark?.sequence ?? 0}`
      assert.deepStrictEqual(
        told.map((one) => one.state),
        ['withdrawn'],
      )
      const { path } = yield* worktreeOf(taskId)
      const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path, encoding: 'utf8' }).trim()
      const body = 'Anything else to look at?'
      const sessions = yield* Sessions
      yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', { threadId, body }), threadId, body })
      yield* sessions.start({ threadId, agentId: lead?.agentId ?? '' })
      yield* until(sql<{ state: string }>`SELECT state FROM user_inputs WHERE body = ${body}`, ([one]) => one?.state === 'delivered')
      // Taken up, it would have gone with the person's message, and the fake lead would commit a fix for it.
      yield* Effect.sleep('1 second')
      assert.deepStrictEqual(
        (yield* sql<{
          state: string
        }>`SELECT state FROM user_inputs WHERE thread_id = ${threadId} AND body LIKE 'Checks failed%' AND sequence > ${mark?.sequence ?? 0}`).map(
          (one) => one.state,
        ),
        ['withdrawn'],
      )
      // It answers the person (`[lead:edit]` commits what it was asked), and commits no fix for the checks of its own.
      assert.notInclude(
        execFileSync('git', ['log', '--format=%s', `${head}..HEAD`], { cwd: path, encoding: 'utf8' }),
        'Fix the failing check',
      )
    }).pipe(Effect.provide(runtimeWith({ github }, {}, undefined, {}, Duration.millis(300))))
  })

  it.live('keep the card under way while the rest still run, some failed already', () => {
    const { working, bare } = hosted()
    let checks: Checks = PASSED
    const github = hostOf(bare, () => checks)
    return Effect.gen(function* () {
      const { projectId } = yield* opened(working, '[lead:fix]')
      checks = [
        { name: 'test', state: 'failed', log: 'FAIL limit.test.ts' },
        { name: 'lint', state: 'running' },
      ]
      // Read with one failed and one running: on its way to the lead, not the person's.
      const [now] = yield* until(
        Effect.map(cardOf(projectId), (one) => [one]),
        ([one]) => one?.change?.checks?.failed === 1 && one.change.checks.running === 1 && one.phase === 'running',
      )
      assert.strictEqual(now?.step, 'checks_running')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('go to the lead while a round is under way on another of the task’s pull requests', () => {
    const { working, bare } = hosted()
    let broken = false
    const github = hostOf(bare, (sha) => (broken && !holdsFix(bare, sha) ? FAILED : PASSED))
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:fix]')
      // A round waiting on its merge's checks in another repository of the task, as a plan across two has.
      const at = new Date().toISOString()
      yield* sql`INSERT INTO conflict_resolutions ${sql.insert({
        id: `cres_${randomBytes(16).toString('hex')}`,
        projectId,
        taskId,
        pullRequestUrl: 'https://github.com/meridian/web/pull/7',
        conflicts: '[]',
        attempt: 1,
        state: 'checking',
        pushedHead: randomBytes(20).toString('hex'),
        createdAt: at,
        updatedAt: at,
      })}`
      broken = true
      // This one's failure is its lead's all the same, not held for the other's round.
      yield* until(given(threadId), (all) => all.some((body) => body.startsWith('Checks failed on PR #1: test.')))
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})

describe('a conflict and failed checks at once', () => {
  it.live('are one ask of the lead, and the merge goes up with its fix for them', () => {
    const { working, bare } = hosted()
    let broken = false
    let held = false
    const reading = Effect.runSync(Deferred.make<void>())
    const updated = Effect.runSync(Deferred.make<void>())
    // The checks fail until the fix the lead makes on top of the merge.
    const github = hostOf(bare, (sha) => (broken && !holdsTestsFix(bare, sha) ? FAILED : PASSED), undefined, {
      waitsFor: (method) =>
        held && method === 'change' ? Effect.andThen(Deferred.succeed(reading, undefined), Deferred.await(updated)) : Effect.void,
    })
    return Effect.gen(function* () {
      const { taskId, threadId } = yield* opened(working, '[lead:resolve-fix]')
      // Both at once, as PR #563 had them: its checks fail, and main moves on, conflicting.
      // Hold the next poll before it reads either, so a read in flight can't see just half the update.
      held = true
      yield* Deferred.await(reading)
      broken = true
      moveHostMainOn(working, bare)
      held = false
      yield* Deferred.succeed(updated, undefined)
      yield* titled(threadId, 'PR #1 conflicts with main, in change.txt, and test failed.')
      const asks = yield* until(given(threadId), (all) => all.some((body) => body.includes('Bring the branch up to date')))
      const both = asks.filter((body) => body.includes('Bring the branch up to date'))
      assert.strictEqual(both.length, 1)
      assert.include(both[0], "PR #1's checks failed too: test.")
      assert.include(both[0], 'FAIL limit.test.ts')
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and pushed the merge and its fix to PR #1.')
      yield* titled(threadId, 'The checks passed on PR #1.')
      assert.isTrue(holdsTestsFix(bare, 'althar/add-a-retry'))
      // Never told the checks apart, nor run again while the conflict was the lead's.
      assert.isFalse((yield* given(threadId)).some((body) => body.startsWith('Checks failed')))
      assert.lengthOf(github.reruns, 0)
      assert.deepStrictEqual(
        (yield* rounds(taskId)).map((round) => round.state),
        ['resolved'],
      )
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})

describe('a quick task made a change', () => {
  it.live('goes back to work on a conflict as a drafted task does', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => PASSED)
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* connect
      const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      const coordinator = yield* (yield* Coordinator).thread(project.projectId)
      const access: ToolAccess = {
        role: 'coordinator',
        projectId: project.projectId,
        threadId: coordinator,
        sessionId: 'none',
        taskId: null,
      }
      // Started as a quick task, as the coordinator's start_task does, then made a change by its lead when the person asks.
      assert.match(
        yield* callTool(access, 'start_task', {
          title: 'Sketch the settings',
          description: 'Sketch it. [lead:commit] [lead:finish] [review:pass] [lead:resolve]',
          lead: { agent: 'claude-code' },
        }),
        /^Started /,
      )
      const [task] = yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready' && all[0]?.kind === 'plain')
      const threadId = task?.threadId ?? ''
      const taskId = task?.taskId ?? ''
      const body = 'Make it real. [lead:make-change] [lead:finish]'
      yield* (yield* Sessions).send({ envelope: yield* Runtime.envelope('thread.send', { threadId, body }), threadId, body })
      yield* until(cards(project.projectId), (all) => all[0]?.kind === 'change' && all[0]?.change !== null && all[0]?.phase === 'ready')
      // Made a change, it says nothing of conflicts of its own, and its pull request is listened to.
      const [row] = yield* sql<{ resolveConflicts: number | null; listening: number }>`
        SELECT k.resolve_conflicts, l.listening FROM tasks k JOIN external_links l ON l.task_id = k.id AND l.kind = 'change'
        WHERE k.id = ${taskId}`
      assert.deepStrictEqual([row?.resolveConflicts, row?.listening], [null, 1])
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and pushed the merge to PR #1.')
      assert.strictEqual((yield* asked(threadId)).length, 1)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})

describe('a task the person stopped', () => {
  it.live('stays stopped through a conflict and failed checks, and its card says why', () => {
    const { working, bare } = hosted()
    let broken = false
    let held = false
    const gate = Effect.runSync(Deferred.make<void>())
    const github = hostOf(bare, () => (broken ? FAILED : PASSED), undefined, {
      waitsFor: (method) => (held && method === 'change' ? Deferred.await(gate) : Effect.void),
    })
    const reads = () => github.calls.filter((method) => method === 'change').length
    return Effect.gen(function* () {
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:resolve] [lead:fix]')
      // A look at its pull request under way as the person stops it, holding the task's lock as every look does: what it
      // hears once they have, the conflict and the checks failing, is theirs all the same.
      held = true
      const read = reads()
      yield* (yield* Changes).refresh(taskId)
      yield* until(Effect.sync(reads), (now) => now > read)
      yield* stopped(taskId, threadId)
      const before = (yield* given(threadId)).length
      broken = true
      moveHostMainOn(working, bare)
      held = false
      yield* Deferred.succeed(gate, undefined)
      const [why] = yield* until(
        Effect.map(cardOf(projectId), (one) => [one?.conflictUnsent ?? null]),
        ([one]) => one !== null,
      )
      assert.strictEqual(why, 'It’s stopped.')
      yield* until(cardOf(projectId).pipe(Effect.map((one) => [one])), ([one]) => one?.change?.checks?.outcome === 'failed')
      yield* Effect.sleep('600 millis')
      // Nothing asked of its lead, nor a round begun.
      assert.deepStrictEqual(yield* rounds(taskId), [])
      assert.deepStrictEqual((yield* given(threadId)).slice(before), [])
      assert.strictEqual((yield* cardOf(projectId))?.phase, 'stopped')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})

describe('resolving conflicts turned off', () => {
  it.live('leaves a conflict to the person, the card saying it is off for the project, or for the task', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => PASSED)
    return Effect.gen(function* () {
      const { projectId, taskId } = yield* opened(working, '[lead:resolve]', false)
      moveHostMainOn(working, bare)
      const [project] = yield* until(
        Effect.map(cardOf(projectId), (one) => [one?.conflictUnsent ?? null]),
        ([one]) => one !== null,
      )
      assert.strictEqual(project, OFF_FOR_PROJECT)
      // The project's on again, the task's own say off.
      yield* taskSays(taskId, false)
      yield* (yield* Policies).set(projectId as never, { resolveConflicts: true }, (yield* Instance).personId)
      const [task] = yield* until(
        Effect.map(cardOf(projectId), (one) => [one?.conflictUnsent ?? null]),
        ([one]) => one === OFF_FOR_TASK,
      )
      assert.strictEqual(task, OFF_FOR_TASK)
      assert.deepStrictEqual(yield* rounds(taskId), [])
      assert.strictEqual((yield* cardOf(projectId))?.phase, 'ready')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})

describe('checks that keep failing on the merge', () => {
  it.live('come back to the person with why once the lead’s tries are spent, rather than going round again', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, (sha) => (holdsMain(bare, sha) ? FAILED : PASSED))
    return Effect.gen(function* () {
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:resolve] [lead:fix]')
      moveHostMainOn(working, bare)
      yield* until(rounds(taskId), (all) => all[0]?.state === 'failed')
      const [card] = yield* until(
        Effect.map(cardOf(projectId), (one) => [one]),
        ([one]) => one?.phase === 'ready' && one.handedBack != null,
      )
      assert.match(card?.handedBack ?? '', /^The lead couldn’t fix the checks on the merge\. The checks failed on it: test\./)
      // Each failure run again once first, then asked once to fix them; spent, nothing more.
      yield* Effect.sleep('800 millis')
      assert.strictEqual((yield* given(threadId)).filter((body) => body.startsWith('Checks failed')).length, 1)
      assert.lengthOf(yield* rounds(taskId), 1)
      assert.strictEqual(github.reruns.length, 2)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('come back to the person at once where the change’s tries were spent in earlier rounds', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, (sha) => (holdsMain(bare, sha) ? FAILED : PASSED))
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:resolve] [lead:fix]')
      // Its checks failed on as many commits as its lead may fix, and once more, as main kept moving: its tries are spent.
      const link = yield* linkOf(taskId)
      for (let n = 0; n <= FIX_ROUNDS; n++) {
        const sha = randomBytes(20).toString('hex')
        yield* sql`INSERT INTO observations ${sql.insert({
          id: `obs_${randomBytes(16).toString('hex')}`,
          projectId: link?.projectId ?? '',
          subjectType: 'external_link',
          subjectId: link?.id ?? '',
          kind: 'checks',
          payload: JSON.stringify({ id: `checks:${sha}:failed:0`, sha, outcome: 'failed', failing: ['test'] }),
          source: 'althar',
          observedAt: new Date().toISOString(),
        })}`
      }
      moveHostMainOn(working, bare)
      // The merge's checks fail: run again once, then the person's, though the round asked its lead only the once.
      const [round] = yield* until(rounds(taskId), (all) => all[0]?.state === 'failed')
      assert.strictEqual(round?.attempt, 1)
      const [card] = yield* until(
        Effect.map(cardOf(projectId), (one) => [one]),
        ([one]) => one?.phase === 'ready' && one.handedBack != null,
      )
      assert.match(card?.handedBack ?? '', /The checks failed on it: test\./)
      yield* Effect.sleep('800 millis')
      // Never asked to fix them, and the same failure, heard again, doesn't wake it.
      assert.isFalse((yield* given(threadId)).some((body) => body.startsWith('Checks failed')))
      assert.lengthOf(yield* asked(threadId), 1)
      assert.lengthOf(yield* rounds(taskId), 1)
      assert.strictEqual(github.reruns.length, 1)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})

describe('checks on the merge that run too long', () => {
  it.live('end the round, and are the person’s, not under way for ever', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, (sha) => (holdsMain(bare, sha) ? RUNNING : PASSED))
    return Effect.gen(function* () {
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:resolve]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and pushed the merge to PR #1.')
      yield* until(rounds(taskId), (all) => all[0]?.state === 'resolved')
      yield* titled(threadId, 'The checks on what was pushed to PR #1 are still running after')
      const [card] = yield* until(
        Effect.map(cardOf(projectId), (one) => [one]),
        ([one]) => one?.phase === 'ready',
      )
      assert.strictEqual(card?.change?.checks?.outcome, 'running')
      // Its card says why it waits on the person, not only that its checks run.
      assert.strictEqual(card?.checksBack, gaveUpLine('stuck'))
    }).pipe(Effect.provide(runtimeWith({ github }, {}, Duration.seconds(3))))
  })
})
