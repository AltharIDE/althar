import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, it } from '@effect/vitest'
import { Effect, Fiber, Layer, Option } from 'effect'

import { Behind } from '../../src/Api'
import { Connections } from '../../src/Connections'
import { failuresLayer } from '../../src/Failures'
import { Folders } from '../../src/Folders'
import { Instance } from '../../src/Instance'
import { Nudges } from '../../src/Nudges'
import { Projects } from '../../src/Projects'
import { Queries } from '../../src/Queries'
import * as Runtime from '../../src/Runtime'
import { Sessions } from '../../src/Sessions'
import { UsageData } from '../../src/UsageData'
import { fakeConnectors, HOST, runtime, until } from '../support'
import { follows } from './follow'
import { lag, stress, summary } from './load'
import { history, idle, lengthen, lengthenCoordinator, onGitHub, ready, settled } from './seed'
import { stormingAgents } from './storm'
import { openWindows } from './windows'

// With this one file copied into the base checkout, both sides run the same
// workload. Earlier servers decode the additive search/snapshot fields away.
const AGENTS = 8
const REPEATS = 12
const id = () => `cmd_${randomBytes(16).toString('hex')}`

it.live('measures interactive calls beside search, agent output and disk activity', () => {
  const folder = mkdtempSync(join(tmpdir(), 'althar-interactive-'))
  const { working: checkout, github } = onGitHub(() => 0)
  const layer = Layer.mergeAll(Nudges.layer, UsageData.layer, Folders.layer, Behind.layer).pipe(
    Layer.provideMerge(Queries.layer),
    Layer.provideMerge(
      runtime(
        join(folder, 'profile.sqlite'),
        {},
        {
          connectors: fakeConnectors({ github }),
          agents: stormingAgents({ calls: 8, chunks: 30, size: 40, every: 15 }),
        },
      ),
    ),
    Layer.provideMerge(failuresLayer),
  )

  return Effect.scoped(
    Effect.gen(function* () {
      const instance = yield* Instance
      const projects = yield* Projects
      const sessions = yield* Sessions
      yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
      const { projectId } = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: checkout })
      const [pressed, ...agents] = yield* ready(projectId, AGENTS + 1)
      assert.isDefined(pressed)
      const threadId = pressed!.threadId
      yield* lengthen(threadId, 5_000, 500)
      const old = yield* settled(pressed!, 400 - AGENTS - 1)
      yield* lengthenCoordinator(projectId, 2_000, [...old, pressed!.taskId, ...agents.map((agent) => agent.taskId)])
      yield* history(1_000_000)

      const { follows: following } = follows()
      const windows = yield* openWindows([
        { name: 'commands', kind: 'window', projectId, follows: following },
        { name: 'search', kind: 'window', projectId, follows: following },
      ])
      const call = (at: number, method: string, payload: object) =>
        Effect.map(windows.call(at, method, payload, true), (answer) => {
          assert.isTrue(answer.ok, `${method}: ${answer.error ?? 'no reply'}`)
          return answer
        })
      const search = call(1, 'GetSearchDocuments', { search: { text: 'retry' } })
      const board = call(0, 'GetBoard', { projectId, cached: true })
      const home = call(0, 'GetHome', { cached: true })
      // Start the read workers and populate the same visible cards before timing.
      yield* board
      yield* home
      const supported = ((yield* search).value as { indexed?: boolean }).indexed === true
      yield* Effect.sleep('2 seconds')
      process.stdout.write(`fixture ready, indexed search ${supported}\n`)

      const working = Effect.forever(
        Effect.gen(function* () {
          for (const agent of agents) {
            if (yield* sessions.busy(agent.threadId)) continue
            const live = Option.isSome(yield* sessions.running(agent.threadId))
            const body = 'Keep working. [storm]'
            yield* Effect.ignore(
              sessions.send({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId: agent.threadId, body }),
            )
            if (!live) yield* Effect.ignore(sessions.startLast(agent.threadId))
          }
          yield* Effect.sleep('500 millis')
        }),
      )
      const timings = new Map<string, number[]>()
      const keep = (key: string, answer: { ms?: number | undefined }) => {
        assert.isDefined(answer.ms)
        const values = timings.get(key) ?? []
        values.push(answer.ms!)
        timings.set(key, values)
      }

      yield* Effect.acquireUseRelease(
        Effect.sync(() => stress('normal', 2, 1)),
        () =>
          Effect.gen(function* () {
            const active = yield* Effect.forkChild(working)
            const loop = lag()
            try {
              for (let repeat = 0; repeat < REPEATS; repeat += 1) {
                yield* idle(threadId)
                const find = yield* Effect.forkChild(search)
                yield* Effect.yieldNow
                const send = yield* call(0, 'Send', {
                  commandId: id(),
                  threadId,
                  body: '[storm:until-stopped]',
                  disposition: 'after_current',
                })
                keep('send during search', send)
                yield* until(sessions.busy(threadId), Boolean, 'the lead to start its held turn')
                const next = yield* Effect.forkChild(search)
                yield* Effect.yieldNow
                keep('interrupt during search', yield* call(0, 'Interrupt', { commandId: id(), threadId }))
                keep('search', yield* Fiber.join(find))
                keep('search', yield* Fiber.join(next))
                keep('board', yield* board)
                keep('home', yield* home)
              }
            } finally {
              const results = {
                indexedSearch: supported,
                calls: Object.fromEntries([...timings].map(([key, values]) => [key, summary(values)])),
                loop: loop.read(),
              }
              process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
              const output = process.env.ALTHAR_INTERACTIVE_OUT
              if (output !== undefined) writeFileSync(output, JSON.stringify(results, null, 2))
              yield* Fiber.interrupt(active)
            }
          }),
        (load) => Effect.sync(load.stop),
      )
    }).pipe(Effect.provide(layer)),
  ).pipe(Effect.ensuring(Effect.sync(() => rmSync(folder, { recursive: true, force: true }))))
})
