import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { COMPACT, contextFull } from '../src/compact'
import { Coordinator } from '../src/Coordinator'
import { Errands } from '../src/Errands'
import { handoverRecord, openTasks, RECENT_BUDGET, RECENT_MESSAGES } from '../src/handover'
import { editNote, keepNote, NOTES_KEPT, notesOf } from '../src/notes'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { piecesOf } from '../src/threads'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, notices, repository, runtime, until } from './support'
import { knownModels } from './knownModels'

const withQueries = (...args: Parameters<typeof runtime>) => Queries.layer.pipe(Layer.provideMerge(runtime(...args)))

const opened = Effect.gen(function* () {
  yield* knownModels
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
    yield* coordinator.say({
      envelope: yield* Runtime.envelope('thread.send', { body }),
      threadId,
      body,
      disposition: 'after_current',
      sender: { kind: 'window' },
    })
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

describe('compacting the coordinator', () => {
  it('is due at 80% of a known window', () => {
    assert.isFalse(contextFull(null, false))
    assert.isFalse(contextFull({ used: 0, size: 0 }, false))
    assert.isFalse(contextFull({ used: 159_999, size: 200_000 }, false))
    assert.isTrue(contextFull({ used: 160_000, size: 200_000 }, false))
    assert.isFalse(contextFull({ used: 250_000, size: 1_000_000 }, false))
  })

  it.live('compacts repeatedly on the same session, model and effort, and refreshes current records', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const errands = yield* Errands
      const sql = yield* SqlClient.SqlClient
      const { access, threadId } = yield* opened
      yield* say(threadId, 'hello')
      const first = yield* answered(threadId, 1)
      yield* sessions.setModel({ threadId, model: 'large' })
      yield* sessions.setEffort({ threadId, effort: 'high' })

      // Keep the turn open while the errand is recorded against the person's actual delivery.
      yield* say(threadId, 'slow [context:85]')
      yield* until(
        Effect.map(
          sessions.running(threadId),
          (running) => Option.isSome(running) && running.value.turnRunning && contextFull(running.value.context, false),
        ),
        Boolean,
      )
      const current = { ...access, sessionId: first }
      const [message] = yield* until(
        Effect.map(errands.turn(current), (turn) => turn.messages),
        (messages) => messages.length === 1,
      )
      const errand = yield* errands.keep(current, message!, [
        { key: 'after-checks', tool: 'test_asked', target: 'repo/#17', request: {}, waits: [{ kind: 'checks', target: 'head-a' }] },
      ])
      yield* sessions.interrupt(threadId)
      yield* answered(threadId, 2)
      yield* callTool(access, 'keep_note', { note: 'Ship on Thursdays.' })
      yield* say(threadId, 'And now? [context:95]')
      yield* answered(threadId, 4)
      yield* say(threadId, 'Go on.')
      yield* answered(threadId, 6)

      const turns = yield* prompts(threadId)
      assert.deepStrictEqual(
        turns.flatMap((turn, index) => (turn.prompt === COMPACT ? [index] : [])),
        [2, 4],
      )
      const maintenance = yield* sql<{ origin: string; inputs: number }>`
        SELECT d.origin, (SELECT count(*) FROM turn_delivery_inputs i WHERE i.delivery_id = d.id) AS inputs
        FROM turn_deliveries d WHERE d.thread_id = ${threadId} AND d.prompt = ${COMPACT}`
      assert.deepStrictEqual(maintenance, [
        { origin: 'system', inputs: 0 },
        { origin: 'system', inputs: 0 },
      ])
      const next = turns[5]?.prompt ?? ''
      assert.include(next, 'Ship on Thursdays.')
      assert.include(next, errand)
      assert.include(next, 'Open errands (only their recorded next steps may act in a news turn)')
      assert.notInclude(next, 'The last messages of the conversation')
      assert.match(next, /\n\nGo on\.$/)
      assert.isTrue(turns.every((turn) => turn.providerSessionId === first))
      const rows = yield* sessionsOn(threadId)
      assert.deepStrictEqual(
        rows.map((session) => [session.id, session.model, session.effort, session.state]),
        [[first, 'large', 'high', 'active']],
      )
      assert.isFalse((yield* notices(threadId)).some((notice) => /afresh|fresh session/.test(String(notice.title))))
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('waits for an interrupted turn to end and then compacts before the queued message', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { threadId } = yield* opened
      yield* say(threadId, 'hello')
      const first = yield* answered(threadId, 1)
      yield* say(threadId, 'slow [context:90]')
      yield* until(
        Effect.map(sessions.running(threadId), (running) =>
          Option.isSome(running) && running.value.turnRunning && contextFull(running.value.context, false) ? [running] : [],
        ),
        (rows) => rows.length === 1,
      )
      yield* say(threadId, 'Meanwhile, one more thing.')
      assert.lengthOf(yield* prompts(threadId), 2)
      yield* sessions.interrupt(threadId)
      yield* answered(threadId, 4)
      const turns = yield* prompts(threadId)
      assert.strictEqual(turns[1]?.state, 'interrupted')
      assert.strictEqual(turns[2]?.prompt, COMPACT)
      assert.match(turns[3]?.prompt ?? '', /\n\nMeanwhile, one more thing\.$/)
      assert.strictEqual((turns[3]?.prompt ?? '').split('Meanwhile, one more thing.').length - 1, 1)
      assert.isTrue(turns.every((turn) => turn.providerSessionId === first))
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('uses late usage and lets an agent’s own compaction satisfy the threshold', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { threadId } = yield* opened
      yield* say(threadId, 'Fill up. [context-later:95]')
      const first = yield* answered(threadId, 1)
      yield* until(
        Effect.map(sessions.running(threadId), (running) => Option.isSome(running) && contextFull(running.value.context, false)),
        Boolean,
      )
      assert.lengthOf(yield* prompts(threadId), 1)
      yield* say(threadId, 'To the next subject. [context:85]')
      yield* answered(threadId, 3)
      yield* say(threadId, 'Go on.')
      yield* answered(threadId, 5)
      yield* say(threadId, 'Agent summarizes on its own. [context-compacted] [context:95]')
      yield* answered(threadId, 6)
      yield* say(threadId, 'What now?')
      yield* answered(threadId, 7)
      const turns = yield* prompts(threadId)
      assert.strictEqual(turns[1]?.prompt, COMPACT)
      assert.strictEqual(turns[3]?.prompt, COMPACT)
      assert.include(turns[6]?.prompt, 'Current Althar records after compaction.')
      assert.isTrue(turns.every((turn) => turn.providerSessionId === first))
    }).pipe(Effect.provide(withQueries())),
  )
})

describe('recovering a lost coordinator session', () => {
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
        // On the board: start_task leaves what it starts on Scratch, an aside, until it takes a worktree, and asides aren't tasks.
        yield* sql`UPDATE tasks SET shelf = NULL WHERE slug = 'pick-a-cache'`
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
        yield* say(threadId, 'Carry on. [coordinator:lost-once]')
        const { fresh } = yield* handedOver(threadId)
        assert.deepInclude(yield* notices(threadId), {
          source: 'runtime',
          severity: 'info',
          title: 'Fake claude-code had lost this conversation. Started it afresh.',
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
        assert.include(brief, '[person] hello')
        assert.include(brief, 'Carry on. [coordinator:lost-once]')
      }).pipe(Effect.provide(withQueries(undefined, undefined, { countdown: Duration.seconds(5) }))),
  )

  it.live('briefs from a bounded record: the last messages only, and older ones through read_thread', () =>
    Effect.gen(function* () {
      const { threadId, access } = yield* opened
      for (let index = 1; index <= 9; index += 1) {
        yield* say(threadId, `Message ${index}`)
        yield* answered(threadId, index)
      }
      yield* say(threadId, 'Last one.')
      yield* answered(threadId, 10)
      yield* say(threadId, 'Go on. [coordinator:lost-once]')
      const { fresh } = yield* handedOver(threadId)
      const turns = yield* until(prompts(threadId), (rows) => rows.some((row) => row.providerSessionId === fresh.id))
      const brief = turns.find((row) => row.providerSessionId === fresh.id)?.prompt ?? ''
      const recent = brief.slice(brief.indexOf('The last messages of the conversation'))
      // Twenty messages so far, of which the last few are carried, word for word. The fake's first answer echoes the whole
      // brief, which counts as as many pieces as it is cut into where it is longer than the record holds.
      const sql = yield* SqlClient.SqlClient
      const [first] = yield* sql<{ content: string }>`
        SELECT content FROM thread_items WHERE thread_id = ${threadId} AND kind = 'agent_message' ORDER BY sequence LIMIT 1`
      const echoed = (JSON.parse(first?.content ?? '{}') as { text?: string }).text ?? ''
      const cut = piecesOf(`[you] ${echoed}`, RECENT_BUDGET).length - 1
      assert.match(
        recent,
        new RegExp(
          `^The last messages of the conversation, oldest first \\(the ${20 + cut - RECENT_MESSAGES} before them are in short above\\):\n`,
        ),
      )
      assert.notInclude(recent, '[person] Message 3\n')
      assert.include(recent, '[person] Message 5\n[you] echo: Message 5')
      // Those before them are there in short, from the first: what the person said whole, each reply's start.
      const earlier = brief.slice(
        brief.indexOf('Earlier in the conversation, in short'),
        brief.indexOf('The last messages of the conversation'),
      )
      assert.match(earlier, /^Earlier in the conversation, in short, oldest first: [^\n]+ read_thread has each of them whole:\n/)
      assert.include(earlier, '[person] Message 1\n')
      assert.include(earlier, '[person] Message 3\n[you] echo: Message 3\n')
      // The fake's first answer, the whole brief echoed, is only its start.
      assert.match(earlier, /\n\[you\] echo: You are the coordinator of the project [^\n]{100,200}…\n/)
      // The older ones are read through the tools, as far back as they go: a page at a time, each saying where the one before it starts.
      const latest = yield* callTool({ ...access, sessionId: fresh.id }, 'read_thread', {})
      let own = latest
      for (let page = latest; ;) {
        const before = /^\(The (\d+) earliest items are left out: read_thread with before \1 reads back from there\.\)\n/.exec(page)?.[1]
        if (before === undefined) break
        page = yield* callTool({ ...access, sessionId: fresh.id }, 'read_thread', { before: Number(before) })
        own = `${page}\n${own}`
      }
      assert.include(own, '[person] Last one.')
      assert.include(own, '[person] Message 1\n[you] echo: ')
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
      // On the board: start_task leaves what it starts on Scratch, an aside, until it takes a worktree, and asides aren't tasks.
      yield* sql`UPDATE tasks SET shelf = NULL`
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

  it.live('leaves what start_task started on Scratch out of the task brief, including its calls and reports', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const projects = yield* Projects
      const { projectId, access } = yield* opened
      // Three asides, as start_task starts them: one that asks the person, one done, and one whose run then stopped.
      const start = (title: string, description: string) =>
        callTool(access, 'start_task', { title, description, lead: { agent: 'claude-code', model: 'small' } })
      yield* start('Pick a cache', 'Ask which database the cache should use. [lead:ask]')
      yield* start('Which partners call v1', 'Look, and say. [lead:finish]')
      yield* start('Count the callers', 'Count them. [lead:finish]')
      yield* until(
        sql<{ n: number }>`
          SELECT (SELECT count(*) FROM attention_requests WHERE kind = 'question' AND state = 'open')
            + (SELECT count(*) FROM runs WHERE state = 'succeeded') AS n`,
        (rows) => rows[0]?.n === 3,
      )
      yield* sql`UPDATE runs SET state = 'failed' WHERE task_id = (SELECT id FROM tasks WHERE slug = 'count-the-callers')`
      const tasks = yield* openTasks(
        projectId,
        (step) => step.model ?? step.agentId,
        () => false,
      )
      assert.strictEqual(tasks.count, 0)
      assert.strictEqual(tasks.text, 'The project has no open tasks.')
      // More asides never add a list or a count to the brief.
      for (let index = 1; index <= 9; index += 1) {
        const made = yield* projects.createTask({
          envelope: yield* Runtime.envelope('task.create', {}),
          projectId,
          title: `Chat ${index}`,
          draft: true,
        })
        yield* sql`UPDATE tasks SET shelf = 'scratch' WHERE id = ${made.taskId}`
      }
      const more = yield* openTasks(
        projectId,
        (step) => step.agentId,
        () => false,
      )
      assert.deepStrictEqual(more, { count: 0, text: 'The project has no open tasks.' })
      assert.strictEqual(yield* callTool(access, 'list_tasks'), 'The project has no tasks yet.')
    }).pipe(Effect.provide(withQueries())),
  )
})
