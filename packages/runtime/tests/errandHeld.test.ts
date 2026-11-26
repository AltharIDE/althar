import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { Ids, newId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Errands } from '../src/Errands'
import { Instance } from '../src/Instance'
import { MergeLine } from '../src/MergeLine'
import { Projects } from '../src/Projects'
import { timestamp } from '../src/records'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, HOST, hosted, runtime } from './support'

/*
 * Errands Althar can't watch, and held errands whose wait has come: the two of 15 Nov ("tag v0.9.0 once merged", "merge the
 * pull request once it's open") were kept with waits nothing watched, held, and said "still on hold" long after v0.9.0 was
 * tagged. keep_errand now refuses such a step with why; a held errand whose step is done already, or whose unwatched wait has
 * come, closes with a line. Every host here is a fake.
 */

const PATH = ['meridian', 'api']

/** A fake GitHub with the project's repository, its pull requests' links on the test host. */
const setup = Effect.sync(() => {
  const raw = makeFakeService()
  const host: FakeService = {
    ...raw,
    change: (...args) => Effect.map(raw.change(...args), (change) => ({ ...change, url: change.url.replace('https://github.com', HOST) })),
  }
  const repository = host.addRepository(PATH)
  return { host, repository }
})

/** A coordinator's project on that host, the person's word in a live turn, and a task with a branch of its own. */
const inProject = (host: FakeService) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const opened = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: hosted(PATH).working })
    const threadId = yield* (yield* Coordinator).thread(opened.projectId)
    const sessionId = yield* newId(Ids.providerSession)
    yield* sql`INSERT INTO provider_sessions ${sql.insert({ id: sessionId, projectId: opened.projectId, threadId, agentId: 'codex', state: 'active', startedAt: yield* timestamp })}`
    const access = { role: 'coordinator', projectId: opened.projectId, threadId, taskId: null, sessionId } satisfies ToolAccess
    const say = (body: string) =>
      Effect.gen(function* () {
        yield* sql`UPDATE turn_deliveries SET state = 'completed', ended_at = ${yield* timestamp} WHERE thread_id = ${threadId} AND state = 'delivered'`
        const accepted = yield* (yield* Sessions).send({
          envelope: yield* Runtime.envelope('thread.send', {}),
          threadId,
          body,
          sender: { kind: 'window' },
          origin: 'system',
        })
        const turnId = yield* newId(Ids.turnDelivery)
        yield* sql`INSERT INTO turn_deliveries ${sql.insert({ id: turnId, projectId: opened.projectId, threadId, providerSessionId: sessionId, controllerGeneration: 1, state: 'delivered', origin: 'person', requestedAt: yield* timestamp, deliveredAt: yield* timestamp })}`
        yield* sql`INSERT INTO turn_delivery_inputs ${sql.insert({ projectId: opened.projectId, deliveryId: turnId, userInputId: accepted.inputId, position: 1 })}`
        return accepted.inputId
      })
    const task = yield* (yield* Projects).createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId: opened.projectId,
      title: 'Release prep',
      draft: true,
    })
    const [row] = yield* sql<{ slug: string }>`SELECT slug FROM tasks WHERE id = ${task.taskId}`
    /** The task's pull request, opened on the host and listened to, as Althar records one it opened. */
    const open = (draft = false) =>
      Effect.gen(function* () {
        const pull = host.addPullRequest({ path: PATH, title: 'Release prep: 0.9.0', author: 'you', draft, source: `althar/${row!.slug}` })
        const at = yield* timestamp
        yield* sql`INSERT INTO external_links ${sql.insert({ id: yield* newId(Ids.externalLink), projectId: opened.projectId, taskId: task.taskId, product: 'github', kind: 'change', externalId: pull.id, ref: String(pull.number), key: String(pull.number), url: pull.url.replace('https://github.com', HOST), snapshot: JSON.stringify({ ...pull, repository: PATH }), listening: 1, createdAt: at, updatedAt: at })}`
        return pull
      })
    const lines = Effect.map(
      sql<{ content: string }>`SELECT content FROM thread_items WHERE thread_id = ${threadId} AND kind = 'notice' ORDER BY rowid`,
      (rows) => rows.map((one) => (JSON.parse(one.content) as { title: string }).title),
    )
    const state = (id: string) => Effect.map(sql<{ state: string }>`SELECT state FROM errands WHERE id = ${id}`, ([one]) => one?.state)
    /** The next hour's sweep: each held errand is read at most once an hour. */
    const sweep = Effect.gen(function* () {
      yield* sql`DELETE FROM observations WHERE subject_type = 'errand_settle'`
      yield* (yield* MergeLine).tick(opened.projectId)
    })
    /** An errand as a version before 15 Nov's afternoon kept it: its waits as they were, and held on the next sweep. */
    const legacy = (step: Record<string, unknown>, waits: ReadonlyArray<{ kind: string; target: string }>) =>
      Effect.gen(function* () {
        const errands = yield* Errands
        const id = yield* errands.keep(access, yield* say('Once 0.9.0 is ready and on prs, merge for me then tag'), [
          { key: 'step', ...step, waits: [{ kind: 'checks', target: 'head' }] } as never,
        ])
        yield* sql`UPDATE errand_steps SET waits = ${JSON.stringify(waits)} WHERE errand_id = ${id}`
        yield* errands.remind(opened.projectId)
        assert.strictEqual(yield* state(id), 'paused')
        return id
      })
    return { sql, access, say, slug: row!.slug, open, lines, state, sweep, legacy }
  })

describe('errands Althar can’t watch', () => {
  it.live('keep_errand refuses both of 15 Nov’s errands, and any step nothing watches, saying why and keeping nothing', () =>
    Effect.gen(function* () {
      const { host } = yield* setup
      return yield* Effect.gen(function* () {
        const s = yield* inProject(host)
        const message = yield* s.say('Once 0.9.0 is ready and on prs, merge for me then tag')
        const keep = (steps: ReadonlyArray<Record<string, unknown>>) => callTool(s.access, 'keep_errand', { message, steps })
        const tag = { key: 'tag', tool: 'push_tag', target: 'meridian/api tag v0.9.0', request: { tag: 'v0.9.0' } }
        const merge = {
          key: 'merge',
          tool: 'merge_pull_request',
          target: `meridian/api pull request from althar/${s.slug}`,
          request: { pull_request: `the one opened from althar/${s.slug}` },
        }
        // As they were kept on 15 Nov.
        assert.include(yield* keep([{ ...tag, waits: [{ kind: 'merged', target: s.slug }] }]), 'cannot watch wait kind "merged"')
        assert.include(
          yield* keep([
            {
              ...merge,
              waits: [
                { kind: 'pull_request_opened', target: `althar/${s.slug}` },
                { kind: 'checks_passed', target: `althar/${s.slug}` },
              ],
            },
          ]),
          // Named by its branch, no merge watcher would find it, whatever it waited on.
          'Step merge: Althar can’t find a pull request by its title or branch to watch',
        )
        // With kinds Althar knows, but nothing that would watch them: a pull request named by its branch, a tag with no
        // repository, and another tool's step waiting on checks.
        const refusals = [
          yield* keep([{ ...merge, waits: [{ kind: 'checks_passed', target: s.slug }] }]),
          yield* keep([{ ...tag, target: 'v0.9.0', waits: [{ kind: 'task_merged', target: s.slug }] }]),
          yield* keep([{ ...tag, request: {}, waits: [{ kind: 'post-merge', target: 'head' }] }]),
          yield* keep([
            { key: 'close', tool: 'close_pull_request', target: '#7', request: {}, waits: [{ kind: 'checks', target: 'head' }] },
          ]),
        ]
        assert.include(refusals[0], 'Step merge: Althar can’t find a pull request by its title or branch to watch')
        assert.include(refusals[0], 'target task:<slug>, wait task_pull_request')
        assert.include(refusals[1], 'A push_tag step targets <owner/repo> tag <tag> with request {tag, …}')
        assert.include(refusals[2], 'A push_tag step targets <owner/repo> tag <tag>')
        assert.include(refusals[3], 'Althar watches checks only for merge_pull_request and release steps')
        assert.include(refusals[3], 'review_settled, checks_passed, lead_done')
        for (const refusal of refusals) assert.include(refusal, 'Nothing was kept.')
        assert.lengthOf(yield* s.sql`SELECT id FROM errands`, 0)
        // Kept as the tool says, the same errand is watched, and kept.
        const kept = yield* keep([
          {
            key: 'merge',
            tool: 'merge_pull_request',
            taskId: s.slug,
            target: `task:${s.slug}`,
            request: {},
            waits: [{ kind: 'task_pull_request', target: s.slug }],
          },
          {
            ...tag,
            taskId: s.slug,
            request: { tag: 'v0.9.0', commit: `task:${s.slug}` },
            waits: [{ kind: 'task_merged', target: s.slug }],
          },
        ])
        assert.match(kept, /^errand_/)
      }).pipe(Effect.provide(runtime(':memory:', {}, { connectors: fakeConnectors({ github: host }) })))
    }),
  )
})

describe('a held errand whose wait has come', () => {
  it.live('15 Nov’s tag errand closes once v0.9.0 is tagged, as done, with a line', () =>
    Effect.gen(function* () {
      const { host, repository } = yield* setup
      return yield* Effect.gen(function* () {
        const s = yield* inProject(host)
        const id = yield* s.legacy({ tool: 'push_tag', target: 'meridian/api tag v0.9.0', request: { tag: 'v0.9.0' } }, [
          { kind: 'merged', target: 'release-prep' },
        ])
        // Nothing has happened yet: it stays held.
        yield* s.sweep
        assert.strictEqual(yield* s.state(id), 'paused')
        host.tagByHand(PATH, 'v0.9.0', yield* host.commitOf(repository, 'main'))
        yield* s.sweep
        assert.strictEqual(yield* s.state(id), 'done')
        assert.strictEqual((yield* s.lines).at(-1), 'Errand done: v0.9.0 is tagged already')
        assert.lengthOf(yield* s.sql`SELECT 1 FROM errand_steps WHERE errand_id = ${id} AND state = 'done'`, 1)
        // Done, it reminds no one.
        yield* s.sql`UPDATE errands SET news_at = '2000-01-01T00:00:00.000Z'`
        const said = (yield* s.lines).length
        yield* (yield* Errands).remind(s.access.projectId)
        assert.lengthOf(yield* s.lines, said)
      }).pipe(Effect.provide(runtime(':memory:', {}, { connectors: fakeConnectors({ github: host }) })))
    }),
  )

  it.live('the tag errand whose merge came, though v0.9.0 isn’t tagged, closes and says to ask again', () =>
    Effect.gen(function* () {
      const { host, repository } = yield* setup
      return yield* Effect.gen(function* () {
        const s = yield* inProject(host)
        const id = yield* s.legacy({ tool: 'push_tag', target: 'meridian/api tag v0.9.0', request: { tag: 'v0.9.0' } }, [
          { kind: 'merged', target: s.slug },
        ])
        const pull = yield* s.open()
        yield* s.sweep
        assert.strictEqual(yield* s.state(id), 'paused', 'an open pull request is not the merge it waits for')
        yield* host.merge(repository, pull)
        yield* s.sweep
        assert.strictEqual(yield* s.state(id), 'cancelled')
        assert.strictEqual(
          (yield* s.lines).at(-1),
          `Errand closed: #${pull.number} merged, which Althar couldn’t watch for. Ask again to tag v0.9.0.`,
        )
        assert.lengthOf(host.tagsPushed, 0)
      }).pipe(Effect.provide(runtime(':memory:', {}, { connectors: fakeConnectors({ github: host }) })))
    }),
  )

  it.live('15 Nov’s merge errand closes once its pull request is open, and as done once it merged', () =>
    Effect.gen(function* () {
      const { host, repository } = yield* setup
      return yield* Effect.gen(function* () {
        const s = yield* inProject(host)
        const step = {
          tool: 'merge_pull_request',
          target: `meridian/api pull request from althar/${s.slug}`,
          request: { pull_request: `the one opened from althar/${s.slug}` },
        }
        const waits = [{ kind: 'pull_request_opened', target: `althar/${s.slug}` }]
        const opened = yield* s.legacy(step, waits)
        yield* s.sweep
        assert.strictEqual(yield* s.state(opened), 'paused', 'no pull request yet')
        const pull = yield* s.open(true)
        yield* s.sweep
        assert.strictEqual(yield* s.state(opened), 'paused', 'a draft is not open for its merge')
        yield* host.markReady(repository, pull)
        yield* s.sweep
        assert.strictEqual(yield* s.state(opened), 'cancelled')
        assert.strictEqual(
          (yield* s.lines).at(-1),
          `Errand closed: #${pull.number} is open, which Althar couldn’t watch for. Ask again to merge the pull request.`,
        )
        assert.lengthOf(host.merged, 0)
        // Kept again, the same errand finds the pull request merged already: done.
        const merged = yield* s.legacy({ ...step, says: 'Merge the 0.9.0 pull request' }, waits)
        yield* host.merge(repository, pull)
        yield* s.sweep
        assert.strictEqual(yield* s.state(merged), 'done')
        assert.strictEqual((yield* s.lines).at(-1), `Errand done: #${pull.number} merged already`)
      }).pipe(Effect.provide(runtime(':memory:', {}, { connectors: fakeConnectors({ github: host }) })))
    }),
  )

  it.live('an errand the person held stays held when its wait comes, and closes only once its step is done', () =>
    Effect.gen(function* () {
      const { host, repository } = yield* setup
      return yield* Effect.gen(function* () {
        const s = yield* inProject(host)
        const message = yield* s.say('merge the release PR once it’s open, but wait if I say so')
        const id = yield* callTool(s.access, 'keep_errand', {
          message,
          steps: [
            {
              key: 'merge',
              tool: 'merge_pull_request',
              taskId: s.slug,
              target: `task:${s.slug}`,
              request: {},
              waits: [{ kind: 'task_pull_request', target: s.slug }],
            },
          ],
        })
        assert.match(id, /^errand_/)
        yield* callTool(s.access, 'pause_errand', { errand: id, reason: 'The person said to wait.' })
        const pull = yield* s.open()
        yield* s.sweep
        assert.strictEqual(yield* s.state(id), 'paused', 'their hold is theirs to lift')
        assert.lengthOf(host.merged, 0)
        yield* host.merge(repository, pull)
        yield* s.sweep
        assert.strictEqual(yield* s.state(id), 'done')
        assert.strictEqual((yield* s.lines).at(-1), `Errand done: #${pull.number} merged already`)
      }).pipe(Effect.provide(runtime(':memory:', {}, { connectors: fakeConnectors({ github: host }) })))
    }),
  )
})
