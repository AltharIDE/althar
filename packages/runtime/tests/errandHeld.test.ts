import { type FakeService, type FakeServiceOptions, makeFakeService } from '@althar/connectors/testing'
import { Ids, newId } from '@althar/domain'
import { readClock } from '@althar/testing/effect'
import { assert, describe, it } from '@effect/vitest'
import { Deferred, Effect, Fiber } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Errands } from '../src/Errands'
import { errandWaitKinds } from '../src/errandWaits'
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

type Step = Record<string, unknown> & { readonly key: string; readonly waits: ReadonlyArray<{ kind: string; target: string }> }

/** A fake GitHub with the project's repository, its pull requests' links on the test host. */
const github = (options: FakeServiceOptions = {}) => {
  const raw = makeFakeService(options)
  const host: FakeService = {
    ...raw,
    change: (...args) => Effect.map(raw.change(...args), (change) => ({ ...change, url: change.url.replace('https://github.com', HOST) })),
  }
  const repository = host.addRepository(PATH)
  return { host, repository }
}
const setup = Effect.sync(() => github())

/** A coordinator's project on that host, the person's word in a live turn, and a task with a branch of its own. */
const inProject = (on: FakeService) =>
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
        const pull = on.addPullRequest({ path: PATH, title: 'Release prep: 0.9.0', author: 'you', draft, source: `althar/${row!.slug}` })
        const at = yield* timestamp
        yield* sql`INSERT INTO external_links ${sql.insert({ id: yield* newId(Ids.externalLink), projectId: opened.projectId, taskId: task.taskId, product: 'github', kind: 'change', externalId: pull.id, ref: String(pull.number), key: String(pull.number), url: pull.url.replace('https://github.com', HOST), snapshot: JSON.stringify({ ...pull, repository: PATH }), listening: 1, createdAt: at, updatedAt: at })}`
        return pull
      })
    const lines = Effect.map(
      sql<{ content: string }>`SELECT content FROM thread_items WHERE thread_id = ${threadId} AND kind = 'notice' ORDER BY rowid`,
      (rows) => rows.map((one) => (JSON.parse(one.content) as { title: string }).title),
    )
    const state = (id: string) => Effect.map(sql<{ state: string }>`SELECT state FROM errands WHERE id = ${id}`, ([one]) => one?.state)
    /** The merge line's sweep, as it runs every half minute; held errands are read at most once an hour. */
    const tick = Effect.flatMap(MergeLine, (line) => line.tick(opened.projectId))
    /** The next hour's sweep, as though an hour had passed since the last read. */
    const sweep = Effect.gen(function* () {
      yield* sql`DELETE FROM observations WHERE subject_type = 'errand_settle'`
      yield* tick
    })
    /** An errand as a version before 15 Nov's afternoon kept it: its steps' waits as they were, and held on the next sweep. */
    const legacy = (step: Record<string, unknown>, waits: ReadonlyArray<{ kind: string; target: string }>, ...more: Array<Step>) =>
      Effect.gen(function* () {
        const errands = yield* Errands
        const steps = [{ key: 'step', ...step, waits }, ...more]
        const id = yield* errands.keep(
          access,
          yield* say('Once 0.9.0 is ready and on prs, merge for me then tag'),
          // Kept with waits keep takes, then given the ones it had: an older version took any.
          steps.map((one) => ({
            ...one,
            waits: one.waits.every((wait) => errandWaitKinds.includes(wait.kind)) ? one.waits : [{ kind: 'checks', target: 'head' }],
          })) as never,
        )
        for (const one of steps)
          yield* sql`UPDATE errand_steps SET waits = ${JSON.stringify(one.waits)} WHERE errand_id = ${id} AND step_key = ${one.key}`
        yield* errands.remind(opened.projectId)
        assert.strictEqual(yield* state(id), 'paused')
        return id
      })
    return { sql, access, say, slug: row!.slug, open, lines, state, tick, sweep, legacy }
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
        // A concrete merge by its link, head and branch, but not as merge_pull_request binds it: the merge line would drop it.
        refusals.push(
          yield* keep([
            {
              ...merge,
              target: `${HOST}/meridian/api/pull/7`,
              head: 'abc',
              branch: 'main',
              request: { repository: 'github:meridian/api', number: 7 },
              waits: [{ kind: 'checks', target: 'abc' }],
            },
          ]),
        )
        assert.include(refusals[4], 'call merge_pull_request on the person’s message')
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

describe('a held errand closes only on what proves it', () => {
  it.live('a merge waiting on its checks too stays held when its pull request opens, and closes once it merged', () =>
    Effect.gen(function* () {
      const { host, repository } = yield* setup
      return yield* Effect.gen(function* () {
        const s = yield* inProject(host)
        // 15 Nov's merge errand, as kept: once it's open, and once its checks pass.
        const id = yield* s.legacy(
          {
            tool: 'merge_pull_request',
            target: `meridian/api pull request from althar/${s.slug}`,
            request: { pull_request: `the one opened from althar/${s.slug}` },
          },
          [
            { kind: 'pull_request_opened', target: `althar/${s.slug}` },
            { kind: 'checks_passed', target: `althar/${s.slug}` },
          ],
        )
        const pull = yield* s.open()
        yield* s.sweep
        assert.strictEqual(yield* s.state(id), 'paused', 'an open pull request proves nothing of its checks')
        yield* host.merge(repository, pull)
        yield* s.sweep
        assert.strictEqual(yield* s.state(id), 'done')
        assert.strictEqual((yield* s.lines).at(-1), `Errand done: #${pull.number} merged already`)
      }).pipe(Effect.provide(runtime(':memory:', {}, { connectors: fakeConnectors({ github: host }) })))
    }),
  )

  it.live('a later step’s unwatched wait closes nothing on an earlier step’s open pull request, only once it is that step’s turn', () =>
    Effect.gen(function* () {
      const { host, repository } = yield* setup
      return yield* Effect.gen(function* () {
        const s = yield* inProject(host)
        const id = yield* s.legacy(
          { tool: 'merge_pull_request', taskId: s.slug, target: `task:${s.slug}`, request: {} },
          [{ kind: 'task_pull_request', target: s.slug }],
          {
            key: 'tag',
            tool: 'push_tag',
            target: 'meridian/api tag v0.9.0',
            request: { tag: 'v0.9.0' },
            waits: [{ kind: 'merged', target: s.slug }],
          },
        )
        const pull = yield* s.open()
        yield* s.sweep
        assert.strictEqual(yield* s.state(id), 'paused', 'the merge waits on its own watched wait, not on being open')
        yield* host.merge(repository, pull)
        yield* s.sweep
        assert.strictEqual(yield* s.state(id), 'cancelled')
        assert.strictEqual(
          (yield* s.lines).at(-1),
          `Errand closed: #${pull.number} merged already, which Althar couldn’t watch for. Ask again to tag v0.9.0.`,
        )
        assert.lengthOf(yield* s.sql`SELECT 1 FROM errand_steps WHERE errand_id = ${id} AND state = 'done'`, 1)
      }).pipe(Effect.provide(runtime(':memory:', {}, { connectors: fakeConnectors({ github: host }) })))
    }),
  )

  it.live('a tag of its name on another commit than the one asked for is not the step done', () =>
    Effect.gen(function* () {
      const { host, repository } = yield* setup
      return yield* Effect.gen(function* () {
        const s = yield* inProject(host)
        const asked = yield* host.commitOf(repository, 'main')
        const id = yield* s.legacy({ tool: 'push_tag', target: 'meridian/api tag v0.9.0', request: { tag: 'v0.9.0', commit: asked } }, [
          { kind: 'merged', target: 'release-prep' },
        ])
        host.tagByHand(PATH, 'v0.9.0', 'abcdef0123456789abcdef0123456789abcdef01')
        yield* s.sweep
        assert.strictEqual(yield* s.state(id), 'paused')
        host.tagByHand(PATH, 'v0.9.0', asked)
        yield* s.sweep
        assert.strictEqual(yield* s.state(id), 'done')
        // Asked for a task's landed commit: a tag before that merge is known is not it either.
        const task = yield* s.legacy(
          { tool: 'push_tag', target: 'meridian/api tag v1.0.0', request: { tag: 'v1.0.0', commit: `task:${s.slug}` } },
          [{ kind: 'merged', target: s.slug }],
        )
        host.tagByHand(PATH, 'v1.0.0', asked)
        const pull = yield* s.open()
        yield* s.sweep
        assert.strictEqual(yield* s.state(task), 'paused')
        yield* host.merge(repository, pull)
        yield* s.sweep
        assert.strictEqual(yield* s.state(task), 'paused', 'v1.0.0 is on another commit than the merge')
        host.tagByHand(PATH, 'v1.0.0', (yield* host.change(repository, pull.number)).mergeCommit!)
        yield* s.sweep
        assert.strictEqual(yield* s.state(task), 'done')
        assert.strictEqual((yield* s.lines).at(-1), 'Errand done: v1.0.0 is tagged already')
      }).pipe(Effect.provide(runtime(':memory:', {}, { connectors: fakeConnectors({ github: host }) })))
    }),
  )

  it.live('a held merge bound to its pull request’s link closes as done once that merged, though the person held it', () =>
    Effect.gen(function* () {
      const { host, repository } = yield* setup
      return yield* Effect.gen(function* () {
        const s = yield* inProject(host)
        const pull = host.addPullRequest({ path: PATH, title: 'Someone’s fix', author: 'you' })
        const url = pull.url.replace('https://github.com', HOST)
        const errands = yield* Errands
        // As merge_pull_request keeps one for a pull request open already: by its link, head and branch.
        const id = yield* errands.keep(s.access, yield* s.say('merge that fix once it’s green'), [
          {
            key: 'merge',
            tool: 'merge_pull_request',
            target: url,
            head: pull.headSha ?? 'head',
            branch: 'main',
            request: { repository: 'github:meridian/api', number: pull.number, method: 'merge', now: false },
            waits: [{ kind: 'merge_line', target: 'meridian/api main' }],
          },
        ])
        yield* errands.pause(s.access, id, 'The person said to wait.')
        yield* s.sweep
        assert.strictEqual(yield* s.state(id), 'paused')
        yield* host.merge(repository, pull)
        yield* s.sweep
        assert.strictEqual(yield* s.state(id), 'done')
        assert.strictEqual((yield* s.lines).at(-1), `Errand done: #${pull.number} merged already`)
      }).pipe(Effect.provide(runtime(':memory:', {}, { connectors: fakeConnectors({ github: host }) })))
    }),
  )

  it.live('a hold the person makes while its read is out is theirs: what was read of the old hold closes nothing', () =>
    Effect.gen(function* () {
      let gate: Effect.Effect<void> = Effect.void
      const { host, repository } = github({ waitsFor: (method) => (method === 'tag' ? gate : Effect.void) })
      return yield* Effect.gen(function* () {
        const s = yield* inProject(host)
        const errands = yield* Errands
        const id = yield* s.legacy({ tool: 'push_tag', target: 'meridian/api tag v0.9.0', request: { tag: 'v0.9.0' } }, [
          { kind: 'merged', target: s.slug },
        ])
        yield* host.merge(repository, yield* s.open())
        const reading = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        gate = Effect.andThen(Deferred.succeed(reading, undefined), Deferred.await(release))
        const swept = yield* Effect.forkChild(s.sweep)
        yield* Deferred.await(reading)
        // While the host is read: the person sets it going, then holds it themselves.
        yield* errands.resume(s.access, id, yield* s.say('Go ahead'))
        yield* errands.pause(s.access, id, 'The person said to wait for the changelog.')
        gate = Effect.void
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(swept)
        assert.strictEqual(yield* s.state(id), 'paused')
        // Read again of their hold, the merge it waited for closes nothing: it is theirs to lift.
        yield* s.sweep
        assert.strictEqual(yield* s.state(id), 'paused')
        assert.lengthOf(host.tagsPushed, 0)
      }).pipe(Effect.provide(runtime(':memory:', {}, { connectors: fakeConnectors({ github: host }) })))
    }),
  )

  it.live('a held errand is read once an hour, however often the merge line sweeps, and again the next hour', () =>
    Effect.gen(function* () {
      const { host, repository } = yield* setup
      const clock = yield* readClock
      return yield* clock.run(
        Effect.gen(function* () {
          const s = yield* inProject(host)
          const id = yield* s.legacy({ tool: 'push_tag', target: 'meridian/api tag v0.9.0', request: { tag: 'v0.9.0' } }, [
            { kind: 'merged', target: 'release-prep' },
          ])
          const reads = () => host.calls.filter((call) => call === 'tag').length
          yield* s.tick
          const first = reads()
          assert.isAbove(first, 0)
          host.tagByHand(PATH, 'v0.9.0', yield* host.commitOf(repository, 'main'))
          for (let sweep = 0; sweep < 5; sweep++) yield* s.tick
          assert.strictEqual(reads(), first, 'not read again within the hour')
          assert.strictEqual(yield* s.state(id), 'paused')
          yield* clock.advance('1 hour')
          yield* s.tick
          assert.isAbove(reads(), first)
          assert.strictEqual(yield* s.state(id), 'done')
        }).pipe(Effect.provide(runtime(':memory:', {}, { connectors: fakeConnectors({ github: host }) }))),
      )
    }),
  )
})
