import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Coordinator } from '../src/Coordinator'
import { dueForHandover, FRESH_ROOM, HANDOVER_AT, handoverRecord, openTasks, RECENT_MESSAGES, roomFor } from '../src/handover'
import { editNote, keepNote, NOTES_KEPT, notesOf } from '../src/notes'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, items, notices, repository, runtime, until } from './support'

/*
 * Althar hands the coordinator to a fresh session before its context fills
 * (ADR-031): between turns, on the same agent, model and effort, briefed
 * from its records. The fake agent says its context is as full as a prompt
 * ending `[context:85]` says.
 */

const withQueries = (...args: Parameters<typeof runtime>) => Queries.layer.pipe(Layer.provideMerge(runtime(...args)))

const opened = Effect.gen(function* () {
  const projects = yield* Projects
  const coordinator = yield* Coordinator
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  const threadId = yield* coordinator.thread(project.projectId)
  const access: ToolAccess = { role: 'coordinator', projectId: project.projectId, threadId, sessionId: 'none', taskId: null }
  return { projectId: project.projectId, threadId, access }
})

const say = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const coordinator = yield* Coordinator
    yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
  })

/** The thread's sessions, oldest first. */
const sessionsOn = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{
      id: string
      agentId: string
      accountId: string
      model: string | null
      effort: string | null
      state: string
      supersededBySessionId: string | null
    }>`
      SELECT id, agent_id, account_id, model, effort, state, superseded_by_session_id FROM provider_sessions
      WHERE thread_id = ${threadId} ORDER BY started_at, rowid`
  })

/** Waits until the thread's session is there with no turn running, and gives its id. */
const idleOn = (threadId: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    const [idle] = yield* until(
      Effect.map(sessions.running(threadId), (running) =>
        Option.isSome(running) && !running.value.turnRunning && !running.value.stopping ? [running.value.sessionId] : [],
      ),
      (rows) => rows.length === 1,
    )
    return idle ?? ''
  })

/** Waits until the coordinator has been handed to a second session, which is the thread's session now, and gives both. */
const handedOver = (threadId: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    const [found] = yield* until(
      Effect.gen(function* () {
        const rows = yield* sessionsOn(threadId)
        const running = Option.getOrUndefined(yield* sessions.running(threadId))
        const [old, fresh] = rows
        return rows.length === 2 && old !== undefined && fresh?.state === 'active' && running?.sessionId === fresh.id
          ? [{ old, fresh }]
          : []
      }),
      (rows) => rows.length === 1,
    )
    if (found === undefined) return yield* Effect.die(new Error('Not handed over'))
    return found
  })

/** What the thread's turns were prompted with, oldest first, and which session each went to. */
const prompts = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ prompt: string; providerSessionId: string; state: string }>`
      SELECT prompt, provider_session_id, state FROM turn_deliveries WHERE thread_id = ${threadId} ORDER BY requested_at, rowid`
  })

/** Waits until the thread has had this many turns, each over, and its session waits for the next. */
const answered = (threadId: string, count: number) =>
  Effect.gen(function* () {
    yield* until(
      prompts(threadId),
      (rows) => rows.length === count && rows.every((row) => row.state !== 'pending' && row.state !== 'delivered'),
    )
    return yield* idleOn(threadId)
  })

/** An open task with a pull request on the host, and this many commits on its branch the pull request doesn't have. */
const withPullRequest = (projectId: string, title: string, commits: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const projects = yield* Projects
    const made = yield* projects.createTask({ envelope: yield* Runtime.envelope('task.create', { title }), projectId, title })
    yield* sql`UPDATE tasks SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = ${made.taskId}`
    const [worktree] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${made.taskId}`
    const git = (...args: Array<string>) =>
      execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test', ...args], { cwd: worktree?.path ?? '' })
        .toString()
        .trim()
    const pushed = git('rev-parse', 'HEAD')
    for (let commit = 1; commit <= commits; commit += 1) git('commit', '-q', '--allow-empty', '-m', `Commit ${commit}`)
    yield* sql`INSERT INTO external_links ${sql.insert({
      id: `xlink_${'0'.repeat(32)}`,
      projectId,
      taskId: made.taskId,
      product: 'github',
      kind: 'change',
      externalId: '12',
      ref: 'meridian/api#12',
      key: '#12',
      url: 'https://github.test/meridian/api/pull/12',
      snapshot: JSON.stringify({ state: 'open', number: 12, url: 'https://github.test/meridian/api/pull/12', headSha: pushed }),
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    })}`
    return made.taskId
  })

describe('when to hand the coordinator over', () => {
  it('is once its agent says its context is at the threshold or past it', () => {
    assert.strictEqual(HANDOVER_AT, 0.8)
    assert.isFalse(dueForHandover(null))
    assert.isFalse(dueForHandover({ used: 0, size: 0 }))
    assert.isFalse(dueForHandover({ used: 159_999, size: 200_000 }))
    assert.isTrue(dueForHandover({ used: 160_000, size: 200_000 }))
    assert.isTrue(dueForHandover({ used: 199_000, size: 200_000 }))
  })

  it('is only to a fresh session its brief leaves room in', () => {
    assert.strictEqual(FRESH_ROOM, 0.4)
    // About four characters a token: 1,000 tokens of a 200,000-token context, or 80,000 of them.
    assert.isTrue(roomFor('x'.repeat(4_000), { size: 200_000 }))
    assert.isFalse(roomFor('x'.repeat(320_000), { size: 200_000 }))
    assert.isTrue(roomFor('x'.repeat(10), null))
    assert.isTrue(roomFor('x'.repeat(10), { size: 0 }))
  })
})

describe('handing the coordinator to a fresh session', () => {
  it.live('hands it over after a turn that fills its context, on the same agent, account, model and effort', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { threadId } = yield* opened
      yield* say(threadId, 'hello')
      yield* answered(threadId, 1)
      yield* sessions.setModel({ threadId, model: 'large' })
      yield* sessions.setEffort({ threadId, effort: 'high' })

      // Half full, it carries on as it is.
      yield* say(threadId, 'What is the project about? [context:50]')
      yield* answered(threadId, 2)
      yield* Effect.sleep('200 millis')
      assert.lengthOf(yield* sessionsOn(threadId), 1)

      // Past the threshold, it is handed over once its turn is done.
      yield* say(threadId, 'Where are we? [context:85]')
      const { old, fresh } = yield* handedOver(threadId)
      assert.strictEqual(old.state, 'superseded')
      assert.strictEqual(old.supersededBySessionId, fresh.id)
      assert.deepStrictEqual([fresh.agentId, fresh.accountId, fresh.model, fresh.effort], [old.agentId, old.accountId, 'large', 'high'])
      // The person sees a quiet line, and the whole conversation is still there.
      const said = yield* notices(threadId)
      assert.deepInclude(said, { source: 'runtime', severity: 'info', title: 'Started a fresh session.' })
      const kept = (yield* items(threadId)).flatMap((item) => (item.kind === 'user_message' ? [item.content.text] : []))
      assert.deepStrictEqual(kept, ['hello', 'What is the project about? [context:50]', 'Where are we? [context:85]'])

      // Its first turn, when the person next speaks, is its brief from the records, then what they said.
      yield* say(threadId, 'And now?')
      const [, , , first] = yield* until(prompts(threadId), (rows) => rows.length === 4 && rows[3]?.state === 'completed')
      assert.strictEqual(first?.providerSessionId, fresh.id)
      assert.match(first?.prompt ?? '', /^You are the coordinator of the project /)
      assert.include(first?.prompt, 'You are taking over this conversation from an earlier session of yours')
      assert.include(first?.prompt, 'read_thread (without a task, it reads this conversation)')
      assert.include(first?.prompt, 'The project, as project_overview gives it:\n\nProject: ')
      assert.include(first?.prompt, 'The project has no open tasks.')
      assert.include(first?.prompt, 'The last messages of the conversation, oldest first')
      assert.include(first?.prompt, '[person] Where are we? [context:85]\n[you] echo: Where are we?')
      assert.match(first?.prompt ?? '', /\n\nAnd now\?$/)
      // Its context still says nothing, so it isn't handed over again.
      yield* idleOn(threadId)
      assert.lengthOf(yield* sessionsOn(threadId), 2)
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('never hands it over in the middle of a turn: after the turn, with what the person said meanwhile', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { threadId } = yield* opened
      yield* say(threadId, 'hello')
      const first = yield* answered(threadId, 1)
      // Its context fills while the turn goes on.
      yield* say(threadId, 'slow [context:90]')
      yield* until(
        Effect.map(sessions.running(threadId), (running) =>
          Option.isSome(running) && running.value.turnRunning && dueForHandover(running.value.context) ? [running] : [],
        ),
        (rows) => rows.length === 1,
      )
      yield* say(threadId, 'Meanwhile, one more thing.')
      yield* Effect.sleep('300 millis')
      const during = Option.getOrUndefined(yield* sessions.running(threadId))
      assert.strictEqual(during?.sessionId, first)
      assert.isTrue(during?.turnRunning)
      assert.lengthOf(yield* sessionsOn(threadId), 1)

      // The turn ends, and only then is it handed over; what the person said meanwhile goes to the fresh session, after its brief.
      yield* sessions.interrupt(threadId)
      const { old, fresh } = yield* handedOver(threadId)
      assert.strictEqual(old.id, first)
      const turns = yield* until(prompts(threadId), (rows) => rows.length === 3 && rows[2]?.state === 'completed')
      assert.strictEqual(turns[1]?.state, 'interrupted')
      assert.strictEqual(turns[1]?.providerSessionId, first)
      assert.strictEqual(turns[2]?.providerSessionId, fresh.id)
      assert.include(turns[2]?.prompt, 'You are taking over this conversation')
      assert.match(turns[2]?.prompt ?? '', /\n\nMeanwhile, one more thing\.$/)
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('hands over one whose first turn filled it: the fresh one starts from the records, not the whole thread', () =>
    Effect.gen(function* () {
      const { threadId } = yield* opened
      yield* say(threadId, 'A very long paste. [context:85]')
      const { fresh } = yield* handedOver(threadId)
      yield* say(threadId, 'Go on.')
      const turns = yield* until(prompts(threadId), (rows) => rows.some((row) => row.providerSessionId === fresh.id))
      assert.include(turns.find((row) => row.providerSessionId === fresh.id)?.prompt, 'You are taking over this conversation')
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('leaves one as it is where its brief would fill a fresh session as far, and carries on with it', () =>
    Effect.gen(function* () {
      const { threadId } = yield* opened
      yield* say(threadId, 'hello')
      const first = yield* answered(threadId, 1)
      // A context of 4,000 tokens: the brief alone would take more of it than a fresh session should start with.
      yield* say(threadId, 'Fill up. [context:85/4000]')
      yield* answered(threadId, 2)
      yield* say(threadId, 'And more.')
      assert.strictEqual(yield* answered(threadId, 3), first)
      assert.lengthOf(yield* sessionsOn(threadId), 1)
      assert.notDeepInclude(yield* notices(threadId), { source: 'runtime', severity: 'info', title: 'Started a fresh session.' })
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('leaves the old session carrying on when the fresh one can’t start, and the thread says so', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { threadId } = yield* opened
      yield* say(threadId, 'hello')
      const first = yield* answered(threadId, 1)
      // Each of the fake's processes fails the first time it is put on the large model, as Claude Code does now and then.
      yield* Effect.flip(sessions.setModel({ threadId, model: 'large' }))
      yield* sessions.setModel({ threadId, model: 'large' })
      yield* say(threadId, 'Fill up. [context:85]')
      yield* until(notices(threadId), (said) => said.some((notice) => notice.title === "Fake claude-code couldn't start."))
      // What the person says next goes to the session they had.
      yield* say(threadId, 'And more.')
      assert.strictEqual(yield* answered(threadId, 3), first)
      assert.deepStrictEqual(
        (yield* sessionsOn(threadId)).map((session) => session.state),
        ['active', 'failed'],
      )
    }).pipe(Effect.provide(withQueries(undefined, { failsOnce: ['large'] }))),
  )

  it.live('hands over one whose agent says between turns that its context is filling', () =>
    Effect.gen(function* () {
      const { threadId } = yield* opened
      yield* say(threadId, 'hello')
      yield* answered(threadId, 1)
      // Its turn ends before it says how full it is.
      yield* say(threadId, 'Fill up. [context-later:95]')
      yield* until(prompts(threadId), (rows) => rows.length === 2 && rows[1]?.state === 'completed')
      assert.lengthOf(yield* sessionsOn(threadId), 1)
      yield* handedOver(threadId)
      assert.deepInclude(yield* notices(threadId), { source: 'runtime', severity: 'info', title: 'Started a fresh session.' })
    }).pipe(Effect.provide(withQueries())),
  )

  it.live(
    'briefs the fresh session with the open tasks, what waits on the person and the notes, and leaves what is in flight as it was',
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const plans = yield* Plans
        const sessions = yield* Sessions
        const projects = yield* Projects
        const { projectId, threadId, access } = yield* opened
        const [person] = yield* sql<{ id: string }>`SELECT id FROM actors WHERE kind = 'person'`
        const actor = (person?.id ?? '') as Parameters<typeof plans.hold>[1]
        yield* say(threadId, 'hello')
        yield* answered(threadId, 1)

        // A draft with no plan, a plan the person holds, one counting down, and one running whose lead asked the person something.
        yield* callTool(access, 'draft_task', { title: 'Tidy the README' })
        yield* callTool(access, 'draft_task', { title: 'Bump the version' })
        yield* callTool(access, 'propose_plan', { task: 'bump-the-version', lead: { agent: 'codex', model: 'large' } })
        const [held] = yield* sql<{ id: string }>`
          SELECT p.id FROM task_plans p JOIN tasks k ON k.id = p.task_id WHERE k.slug = 'bump-the-version'`
        yield* plans.hold(held?.id ?? '', actor)
        assert.match(
          yield* callTool(access, 'start_task', {
            title: 'Pick a cache',
            description: 'Ask which database the cache should use. [lead:ask]',
            lead: { agent: 'claude-code', model: 'small' },
          }),
          /^Started pick-a-cache/,
        )
        const asked = yield* until(
          sql<{ taskId: string }>`SELECT task_id FROM attention_requests WHERE kind = 'question' AND state = 'open'`,
          (rows) => rows.length === 1,
        )
        const [leadThread] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${asked[0]?.taskId ?? ''} AND kind = 'task'`
        const lead = Option.getOrUndefined(yield* sessions.running(leadThread?.id ?? ''))
        assert.isDefined(lead)
        // And an older task, open on its own, with a pull request the person has two commits on the branch for that it doesn't have.
        const made = yield* projects.createTask({
          envelope: yield* Runtime.envelope('task.create', { title: 'Old work' }),
          projectId,
          title: 'Old work',
        })
        yield* sql`UPDATE tasks SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = ${made.taskId}`
        const [worktree] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${made.taskId}`
        const git = (...args: Array<string>) =>
          execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test', ...args], { cwd: worktree?.path ?? '' })
            .toString()
            .trim()
        const pushed = git('rev-parse', 'HEAD')
        git('commit', '-q', '--allow-empty', '-m', 'One')
        git('commit', '-q', '--allow-empty', '-m', 'Two')
        yield* sql`INSERT INTO external_links ${sql.insert({
          id: `xlink_${'0'.repeat(32)}`,
          projectId,
          taskId: made.taskId,
          product: 'github',
          kind: 'change',
          externalId: '12',
          ref: 'meridian/api#12',
          key: '#12',
          url: 'https://github.test/meridian/api/pull/12',
          snapshot: JSON.stringify({ state: 'open', number: 12, url: 'https://github.test/meridian/api/pull/12', headSha: pushed }),
          createdAt: '2020-01-01T00:00:00.000Z',
          updatedAt: '2020-01-01T00:00:00.000Z',
        })}`
        // And a decision the person made.
        assert.match(
          yield* callTool(access, 'keep_note', { note: 'Issue drafts need an approval card, on every tracker.' }),
          /^Kept as note_/,
        )

        // Its countdown starts last, so it is still counting when the coordinator is handed over.
        yield* callTool(access, 'draft_task', { title: 'Add a retry' })
        yield* callTool(access, 'propose_plan', {
          task: 'add-a-retry',
          lead: { agent: 'claude-code', model: 'small' },
          review: { agent: 'codex', model: 'small' },
        })
        const before = yield* sql<{ id: string; state: string; startsAt: string | null }>`
          SELECT id, state, starts_at FROM task_plans ORDER BY proposed_at`
        yield* say(threadId, 'Where are we? [context:85]')
        const { fresh } = yield* handedOver(threadId)
        assert.deepInclude(yield* notices(threadId), {
          source: 'runtime',
          severity: 'info',
          title: 'Started a fresh session.',
        })

        // Nothing in flight moved: the draft, the held plan, the countdown, the running lead and its question.
        assert.deepStrictEqual(
          yield* sql<{
            id: string
            state: string
            startsAt: string | null
          }>`SELECT id, state, starts_at FROM task_plans ORDER BY proposed_at`,
          before,
        )
        const [draft] = yield* sql<{ state: string; plans: number }>`
          SELECT k.state, (SELECT count(*) FROM task_plans p WHERE p.task_id = k.id) AS plans FROM tasks k WHERE k.slug = 'tidy-the-readme'`
        assert.deepStrictEqual({ ...draft }, { state: 'draft', plans: 0 })
        assert.strictEqual(Option.getOrUndefined(yield* sessions.running(leadThread?.id ?? ''))?.sessionId, lead?.sessionId)
        assert.lengthOf(yield* sql`SELECT id FROM attention_requests WHERE kind = 'question' AND state = 'open'`, 1)
        // The countdown runs out as it would have, and its plan starts.
        yield* until(
          sql<{ state: string }>`
            SELECT p.state FROM task_plans p JOIN tasks k ON k.id = p.task_id WHERE k.slug = 'add-a-retry' AND p.state = 'accepted'`,
          (rows) => rows.length === 1,
        )
        assert.strictEqual((yield* sql<{ state: string }>`SELECT state FROM task_plans WHERE id = ${held?.id ?? ''}`)[0]?.state, 'proposed')

        // Its brief: the open tasks as they stood, what waits on the person, the notes, and the last messages.
        yield* say(threadId, 'And now?')
        const turns = yield* until(prompts(threadId), (rows) => rows.some((row) => row.providerSessionId === fresh.id))
        const brief = turns.find((row) => row.providerSessionId === fresh.id)?.prompt ?? ''
        assert.include(brief, 'Tasks: 2 open, 3 planned and not yet started.')
        assert.include(brief, "The project's notes: decisions the person made that the code doesn't show. Go by them.\n- note_")
        assert.include(brief, ': Issue drafts need an approval card, on every tracker.')
        assert.include(brief, 'Open tasks, newest first:\n- add-a-retry: Add a retry. Planned, and counting down: ')
        assert.match(
          brief,
          /\n- pick-a-cache: Pick a cache\. Under way, on its implement step\. Plan: [^\n]+\n {2}Waiting on the person: a question from its lead: /,
        )
        assert.match(brief, /- add-a-retry: [^\n]+ leads, [^\n]+ reviews; it ends /)
        assert.include(brief, '- bump-the-version: Bump the version. Planned, and held by the person: it waits until they start it.')
        assert.include(brief, '- tidy-the-readme: Tidy the README. Drafted, with no plan yet.')
        assert.include(
          brief,
          "- old-work: Old work. Open, with nothing running.\n  Waiting on the person: its pull request https://github.test/meridian/api/pull/12 is open, with 2 commits on the branch they haven't pushed to it.",
        )
        assert.include(brief, '[person] Where are we? [context:85]')
        assert.match(brief, /\n\nAnd now\?$/)
      }).pipe(Effect.provide(withQueries(undefined, undefined, { countdown: Duration.seconds(5) }))),
  )

  it.live('briefs from a bounded record: the last messages only, and older ones through read_thread', () =>
    Effect.gen(function* () {
      const { threadId, access } = yield* opened
      for (let index = 1; index <= 9; index += 1) {
        yield* say(threadId, `Message ${index}`)
        yield* answered(threadId, index)
      }
      yield* say(threadId, 'Last one. [context:85]')
      const { fresh } = yield* handedOver(threadId)
      yield* say(threadId, 'Go on.')
      const turns = yield* until(prompts(threadId), (rows) => rows.some((row) => row.providerSessionId === fresh.id))
      const brief = turns.find((row) => row.providerSessionId === fresh.id)?.prompt ?? ''
      const recent = brief.slice(brief.indexOf('The last messages of the conversation'))
      // Twenty messages so far, of which the last few are carried, word for word.
      assert.match(
        recent,
        new RegExp(`^The last messages of the conversation, oldest first \\(the ${20 - RECENT_MESSAGES} before them are left out\\):\n`),
      )
      assert.notInclude(recent, '[person] Message 3\n')
      assert.include(recent, '[person] Message 5\n[you] echo: Message 5')
      // The older ones are read through the tools, as far back as they go.
      const own = yield* callTool({ ...access, sessionId: fresh.id }, 'read_thread', {})
      assert.include(own, '[person] Message 1\n[you] echo: ')
      assert.include(own, '[person] Last one. [context:85]')
      // Read back past its start, there is nothing more.
      assert.strictEqual(yield* callTool({ ...access, sessionId: fresh.id }, 'read_thread', { before: 0 }), 'Nothing comes before that.')
    }).pipe(Effect.provide(withQueries())),
  )
})

describe("the coordinator's notes", () => {
  it.live('are kept, listed and dropped with its tools, read with the project, and refused when too long or too many', () =>
    Effect.gen(function* () {
      const { access } = yield* opened
      assert.strictEqual(yield* callTool(access, 'list_notes'), 'The project has no notes yet.')
      const kept = yield* callTool(access, 'keep_note', {
        note: "  Dependency setup runs outside the sandbox; don't widen the lead's sandbox.  ",
      })
      const id = /^Kept as (note_[0-9a-f]{32})\.$/.exec(kept)?.[1] ?? ''
      assert.notStrictEqual(id, '')
      // Kept again, the same decision is the same note.
      assert.strictEqual(
        yield* callTool({ ...access, sessionId: 'another' }, 'keep_note', {
          note: "dependency setup runs outside the sandbox; don't widen the lead's sandbox.",
        }),
        `The project has that note already, as ${id}.`,
      )
      assert.strictEqual(
        yield* callTool(access, 'list_notes'),
        `- ${id}: Dependency setup runs outside the sandbox; don't widen the lead's sandbox.`,
      )
      assert.include(
        yield* callTool(access, 'project_overview'),
        `The project's notes: decisions the person made that the code doesn't show. Go by them.\n- ${id}: Dependency setup`,
      )
      assert.match(yield* callTool(access, 'keep_note', { note: 'x'.repeat(301) }), /^That note is 301 characters\. Keep it to 300/)
      assert.strictEqual(yield* callTool(access, 'keep_note', { note: '   ' }), 'Say what the person decided, in a sentence.')
      assert.match(yield* callTool(access, 'drop_note', { id: 'note_nothing' }), /^The project has no note note_nothing\./)
      assert.strictEqual(yield* callTool(access, 'drop_note', { id }), `Dropped ${id}.`)
      // Dropped twice, as an agent unsure the first worked would, it stays dropped.
      assert.strictEqual(yield* callTool(access, 'drop_note', { id }), `Dropped ${id}.`)
      assert.strictEqual(yield* callTool(access, 'list_notes'), 'The project has no notes yet.')
      // Kept again in the same session once dropped, it is a note again, of its own.
      const again = /^Kept as (note_[0-9a-f]{32})\.$/.exec(
        yield* callTool(access, 'keep_note', { note: "Dependency setup runs outside the sandbox; don't widen the lead's sandbox." }),
      )?.[1]
      assert.isDefined(again)
      assert.notStrictEqual(again, id)
      assert.strictEqual(
        yield* callTool(access, 'list_notes'),
        `- ${again}: Dependency setup runs outside the sandbox; don't widen the lead's sandbox.`,
      )
      yield* callTool(access, 'drop_note', { id: again })
      for (let index = 1; index <= NOTES_KEPT; index += 1) yield* callTool(access, 'keep_note', { note: `Decision ${index}.` })
      assert.match(yield* callTool(access, 'keep_note', { note: 'One too many.' }), /^The project keeps 40 notes at most\./)
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('say who kept each: the coordinator, or the person', () =>
    Effect.gen(function* () {
      const { projectId } = yield* opened
      yield* keepNote({
        envelope: yield* Runtime.envelope('project.note.keep', {}),
        projectId: projectId as Parameters<typeof keepNote>[0]['projectId'],
        body: 'Ship on Thursdays only.',
      })
      assert.deepStrictEqual(
        (yield* notesOf(projectId)).map((note) => [note.body, note.keptBy]),
        [['Ship on Thursdays only.', 'person']],
      )
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('take the person’s words once a command: in turn when two overlap, and a retry answered from its receipt', () =>
    Effect.gen(function* () {
      const { projectId } = yield* opened
      const { noteId } = yield* keepNote({
        envelope: yield* Runtime.envelope('project.note.keep', {}),
        projectId: projectId as Parameters<typeof keepNote>[0]['projectId'],
        body: 'Ship on Thursdays.',
      })
      // As the window sends one: its words in the command, under the window's id for it.
      const edit = (commandId: string, body: string) =>
        Effect.flatMap(Runtime.envelope('project.note.edit', { projectId, noteId, body }, commandId), (envelope) =>
          editNote({ envelope, projectId, noteId, body }),
        )
      const [toFriday, backToThursday, sameAgain, toMonday] = Array.from({ length: 4 }, () => `cmd_${randomBytes(16).toString('hex')}`)
      const said = Effect.map(notesOf(projectId), ([note]) => note?.body)
      // Changed and changed back at once, the second reads what the first said: the words said last hold.
      yield* Effect.all([edit(toFriday!, 'Ship on Fridays.'), edit(backToThursday!, 'Ship on Thursdays.')], { concurrency: 'unbounded' })
      assert.strictEqual(yield* said, 'Ship on Thursdays.')
      // The same words change nothing, but are answered as said: sent again after another change, they don't undo it.
      yield* edit(sameAgain!, 'Ship on Thursdays.')
      yield* edit(toMonday!, 'Ship on Mondays.')
      yield* edit(sameAgain!, 'Ship on Thursdays.')
      assert.strictEqual(yield* said, 'Ship on Mondays.')
      // A command's id with other words is another command, and refused.
      const reused = yield* Effect.flip(edit(toMonday!, 'Ship on Sundays.'))
      assert.strictEqual(reused._tag, 'CommandIdReused')
      assert.strictEqual(yield* said, 'Ship on Mondays.')
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('are in every brief the coordinator starts from', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { threadId, access } = yield* opened
      yield* callTool(access, 'keep_note', { note: 'Issue drafts need an approval card, on every tracker.' })
      yield* say(threadId, 'hello')
      const [first] = yield* until(
        sql<{ prompt: string }>`SELECT prompt FROM turn_deliveries WHERE thread_id = ${threadId}`,
        (rows) => rows.length === 1,
      )
      assert.match(
        first?.prompt ?? '',
        /The project's notes: [^\n]+\n- note_[0-9a-f]{32}: Issue drafts need an approval card, on every tracker\./,
      )
      // And it is told to keep them.
      assert.include(first?.prompt, "- keep_note, list_notes and drop_note, for the project's notes:")
    }).pipe(Effect.provide(withQueries())),
  )
})

describe("a handover brief's open tasks", () => {
  it.live('holds every one, the newest in full and the rest in short, none without what waits on the person', () =>
    Effect.gen(function* () {
      const { projectId, access } = yield* opened
      // The oldest, with a commit the person hasn't pushed to its pull request; then more drafts than are told in full.
      yield* withPullRequest(projectId, 'Old work', 1)
      for (let index = 1; index <= 26; index += 1) yield* callTool(access, 'draft_task', { title: `Draft ${index}` })
      yield* callTool(access, 'propose_plan', { task: 'draft-1', lead: { agent: 'codex', model: 'large' } })
      const tasks = yield* openTasks(
        projectId,
        (step) => step.model ?? step.agentId,
        () => false,
      )
      assert.strictEqual(tasks.count, 27)
      // Its head, then a line for each.
      assert.lengthOf(tasks.text.split('\n- '), 28)
      assert.match(
        tasks.text,
        /^Open tasks, newest first \(past the newest 25, each in short: read_task has the rest\):\n- draft-26: Draft 26\. Drafted, with no plan yet\.\n/,
      )
      assert.include(
        tasks.text,
        "\n- draft-1: Draft 1. Planned, and counting down: it starts on its own unless the person holds or changes it. Led by large.\n- old-work: Old work. Open, with nothing running.\n  Waiting on the person: its pull request https://github.test/meridian/api/pull/12 is open, with 1 commit on the branch they haven't pushed to it.",
      )
    }).pipe(Effect.provide(withQueries(undefined, undefined, { countdown: Duration.minutes(5) }))),
  )

  it.live('says where each stands and what waits on the person, whatever it is', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId, threadId, access } = yield* opened
      // Three done by their leads, with no review: one ready, one whose run then stopped, and one at work again on another model.
      for (const title of ['Ready one', 'Stopped one', 'Again one'])
        yield* callTool(access, 'start_task', {
          title,
          description: 'Do it. [lead:finish]',
          lead: { agent: 'claude-code', model: 'small' },
        })
      const [ready, stopped, again] = yield* until(
        sql<{ slug: string; threadId: string; runId: string; taskId: string }>`
          SELECT k.slug, t.id AS thread_id, r.id AS run_id, k.id AS task_id FROM tasks k
          JOIN threads t ON t.task_id = k.id AND t.kind = 'task' JOIN runs r ON r.task_id = k.id
          WHERE r.state = 'succeeded' ORDER BY k.created_at`,
        (rows) => rows.length === 3,
      )
      if (ready === undefined || stopped === undefined || again === undefined) return yield* Effect.die(new Error('Not done'))
      yield* sql`UPDATE runs SET state = 'failed' WHERE id = ${stopped.runId}`
      yield* sql`UPDATE provider_sessions SET model = 'large' WHERE thread_id = ${again.threadId}`

      // On the stopped one: a permission, a step that can't go on, a question in a line, and a call of another kind.
      const [lead] = yield* sql<{ id: string }>`SELECT id FROM provider_sessions WHERE thread_id = ${stopped.threadId} LIMIT 1`
      const permissionId = `perm_${'1'.repeat(32)}`
      yield* sql`INSERT INTO permission_requests ${sql.insert({
        id: permissionId,
        projectId,
        providerSessionId: lead?.id ?? '',
        toolCallId: 'call-1',
        toolKind: 'execute',
        title: 'Run npm install',
        actionDigest: 'digest',
        state: 'open',
        receivedAt: '2026-10-11T00:00:00.000Z',
      })}`
      const call = (n: number, kind: string, payload: unknown) =>
        sql`INSERT INTO attention_requests ${sql.insert({
          id: `attn_${String(n).repeat(32)}`,
          projectId,
          taskId: stopped.taskId,
          kind,
          payload: JSON.stringify(payload),
          state: 'open',
          createdAt: `2026-10-11T00:00:0${n}.000Z`,
          ...(kind === 'permission' ? { permissionRequestId: permissionId } : {}),
        })}`
      yield* call(1, 'permission', {})
      yield* call(2, 'stuck', { step: 'implement', detail: 'The lead stopped without reporting' })
      yield* call(3, 'question', { message: 'Which database?' })
      yield* call(4, 'usage_limit', {})

      // On the one at work again: a closed pull request, which waits on nobody, an open draft with nothing to push, and one Althar can't count for.
      const [worktree] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${again.taskId}`
      const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktree?.path ?? '' })
        .toString()
        .trim()
      const pull = (n: number, snapshot: Record<string, unknown>) =>
        sql`INSERT INTO external_links ${sql.insert({
          id: `xlink_${String(n).repeat(32)}`,
          projectId,
          taskId: again.taskId,
          product: 'github',
          kind: 'change',
          externalId: String(n),
          ref: `meridian/api#1${n}`,
          key: `#1${n}`,
          url: `https://github.test/meridian/api/pull/1${n}`,
          snapshot: JSON.stringify({ number: 10 + n, url: `https://github.test/meridian/api/pull/1${n}`, ...snapshot }),
          createdAt: `2026-10-11T00:00:0${n}.000Z`,
          updatedAt: `2026-10-11T00:00:0${n}.000Z`,
        })}`
      yield* pull(1, { state: 'closed' })
      yield* pull(2, { state: 'open', draft: true, headSha: head })
      yield* pull(3, { state: 'open' })
      // One whose head this worktree doesn't have: nothing is counted for it.
      yield* pull(4, { state: 'open', headSha: 'f'.repeat(40) })

      const modelOf = (step: { readonly agentId: string; readonly model: string | null }) => step.model ?? step.agentId
      const tasks = yield* openTasks(projectId, modelOf, (thread) => thread === again.threadId)
      const lineOf = (slug: string) => tasks.text.slice(tasks.text.indexOf(`- ${slug}: `)).split('\n- ')[0] ?? ''
      assert.strictEqual(
        lineOf(ready.slug),
        `- ${ready.slug}: Ready one. Ready: its steps are done. Plan: small leads, no review; it ends on its branch, with nothing sent to the host.\n  Waiting on the person: the change, to look over and accept.\n  Its lead last reported: Did the task.`,
      )
      assert.include(lineOf(stopped.slug), 'Stopped one. Stopped. Plan: ')
      assert.include(
        lineOf(stopped.slug),
        "\n  Waiting on the person: a permission request: Run npm install; its implement step can't go on without them: The lead stopped without reporting; a question from its lead: Which database?; a call about usage limit.\n",
      )
      assert.include(lineOf(again.slug), 'Again one. Under way again, after its steps were done. Plan: ')
      assert.include(lineOf(again.slug), ' Its lead now: large.')
      assert.include(
        lineOf(again.slug),
        '\n  Waiting on the person: its pull request https://github.test/meridian/api/pull/12 (a draft) is open; its pull request https://github.test/meridian/api/pull/13 is open; its pull request https://github.test/meridian/api/pull/14 is open.',
      )

      // With nothing said yet and no notes, the brief says so.
      const record = yield* handoverRecord({ projectId, threadId, modelOf, working: () => false })
      assert.strictEqual(record.open, 3)
      assert.include(record.sections, 'The conversation has no messages yet.')
      assert.include(record.sections, 'The project has no notes yet.')
    }).pipe(Effect.provide(withQueries())),
  )
})
