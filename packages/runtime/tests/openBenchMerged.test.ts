import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { makeFakeService } from '@althar/connectors/testing'
import { describe, it } from '@effect/vitest'
import { Duration, Effect, Fiber, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { fakeConnectors, HOST, hosted, runtime, until } from './support'

const say = (line: string) => void process.stderr.write(`BENCH ${line}\n`)

// Every git the runtime runs, counted: a shim ahead of git on the PATH logs each call, then runs it.
const shim = mkdtempSync(join(tmpdir(), 'althar-git-shim-'))
const log = join(shim, 'calls')
const real = execFileSync('sh', ['-c', 'command -v git']).toString().trim()
writeFileSync(join(shim, 'git'), `#!/bin/sh\necho "$*" >> ${log}\nexec ${real} "$@"\n`)
chmodSync(join(shim, 'git'), 0o755)
const calls = () => {
  try {
    return readFileSync(log, 'utf8').split('\n').filter(Boolean)
  } catch {
    return []
  }
}

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync(real, ['-c', 'user.name=Fake', '-c', 'user.email=fake@althar.test', ...args], { cwd })
    .toString()
    .trim()

const cards = (projectId: string) =>
  Effect.gen(function* () {
    const snapshot = yield* Effect.orDie((yield* Queries).coordinator(projectId))
    return snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  })

/*
 * A benchmark, run by hand: `BENCH_MERGED=40 vp test run tests/openBenchMerged.test.ts`
 * (`BENCH_GIT=1` names the git each read runs). How long the reads that open a
 * task and the coordinator take, and how much git they run, with that many tasks
 * whose pull requests merged and whose worktrees are still here: each one's card
 * is read by the coordinator's thread, the board and the home, again as any task
 * changes. Then a task's thread, read while those are read over and over.
 */
describe('opening with tasks whose pull requests merged (bench)', () => {
  it.live.skipIf(process.env.BENCH_MERGED === undefined)(
    'counts the git a read runs',
    () => {
      const { working, bare } = hosted()
      const github = makeFakeService({ pushUrl: () => bare })
      github.addRepository(['meridian', 'api'])
      git(working, 'config', 'user.name', 'Fake')
      git(working, 'config', 'user.email', 'fake@althar.test')
      const many = Number(process.env.BENCH_MERGED)
      return Effect.gen(function* () {
        const instance = yield* Instance
        yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
        const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
        const coordinator = yield* Coordinator
        const threadId = yield* coordinator.thread(project.projectId)
        const sql = yield* SqlClient.SqlClient
        const from = performance.now()
        // Tasks whose draft pull requests opened and merged by squashing, their worktrees kept, as before folders were cleaned up.
        for (let n = 1; n <= many; n++) {
          const body = `Add retry ${n}. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]`
          yield* coordinator.say({
            envelope: yield* Runtime.envelope('thread.send', { body }),
            threadId,
            body,
            disposition: 'after_current',
          })
          const all = yield* until(
            cards(project.projectId),
            (shown) => shown.some((card) => card.phase === 'ready' && card.change?.number === n),
            Duration.seconds(60),
          )
          const card = all.find((one) => one.phase === 'ready' && one.change?.number === n)
          if (card === undefined) continue
          github.mergeByHand(n)
          yield* (yield* Changes).refresh(card.taskId)
        }
        yield* until(
          cards(project.projectId),
          (shown) => shown.find((card) => card.change?.number === many)?.phase === 'settled',
          Duration.seconds(60),
        )
        // Main moves on, as it does: a hundred commits since the tasks branched.
        const clone = mkdtempSync(join(tmpdir(), 'althar-main-'))
        execFileSync(real, ['clone', '-q', bare, clone])
        for (let n = 0; n < 100; n++) {
          writeFileSync(join(clone, `later-${n % 10}.txt`), `${n}\n`.repeat(n + 1))
          git(clone, 'add', '-A')
          git(clone, 'commit', '-q', '-m', `Later ${n}`)
        }
        git(clone, 'push', '-q', 'origin', 'main')
        git(working, 'fetch', '-q', bare, 'main')
        git(working, 'merge', '-q', '--no-edit', 'FETCH_HEAD')
        const [kept] = yield* sql<{ n: number }>`SELECT count(*) AS n FROM workspaces WHERE state = 'ready'`
        say(`seeded ${many} merged tasks in ${(performance.now() - from).toFixed(0)} ms, worktrees ready ${kept?.n ?? 0}`)
        const [task] = yield* sql<{ threadId: string }>`SELECT t.id AS thread_id FROM threads t WHERE t.kind = 'task' LIMIT 1`
        const queries = yield* Queries
        process.env.PATH = `${shim}:${process.env.PATH ?? ''}`
        for (let round = 0; round < 3; round++) {
          const reads = [
            ['coordinator', queries.coordinator(project.projectId)],
            ['board', queries.board(project.projectId)],
            ['home', queries.home()],
            ['thread limit 0', queries.thread(task?.threadId ?? '', { limit: 0 })],
            ['thread fresh', queries.thread(task?.threadId ?? '', { limit: 0, fresh: true })],
          ] as const
          for (const [label, read] of reads) {
            const before = calls().length
            const at = performance.now()
            yield* read as Effect.Effect<unknown, unknown>
            const ran = calls().slice(before)
            say(`${label} #${round}: ${(performance.now() - at).toFixed(1)} ms, ${ran.length} git`)
            if (round === 0 && process.env.BENCH_GIT !== undefined) {
              const kinds = new Map<string, number>()
              for (const call of ran) {
                const words = call.split(' ').filter((word) => !word.startsWith('-') && !word.includes('='))
                const key = words.slice(0, 2).join(' ')
                kinds.set(key, (kinds.get(key) ?? 0) + 1)
              }
              say(
                `  ${[...kinds]
                  .sort((a, b) => b[1] - a[1])
                  .map(([key, count]) => `${count}× ${key}`)
                  .join(', ')}`,
              )
            }
          }
        }
        // While agents work, each change has the window read the coordinator's thread, the board and the home again; a task opens meanwhile.
        const churn = yield* Effect.forkChild(
          Effect.forever(
            Effect.all([queries.coordinator(project.projectId), queries.board(project.projectId), queries.home()], {
              concurrency: 'unbounded',
            }),
          ),
        )
        yield* Effect.sleep('300 millis')
        for (let round = 0; round < 4; round++) {
          for (const [label, read] of [
            ['thread limit 0, cards read meanwhile', queries.thread(task?.threadId ?? '', { limit: 0 })],
            ['thread fresh, cards read meanwhile', queries.thread(task?.threadId ?? '', { limit: 0, fresh: true })],
          ] as const) {
            const at = performance.now()
            yield* read as Effect.Effect<unknown, unknown>
            say(`${label} #${round}: ${(performance.now() - at).toFixed(1)} ms`)
          }
        }
        yield* Fiber.interrupt(churn)
      }).pipe(
        Effect.provide(
          Queries.layer.pipe(
            Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }), listenEvery: Duration.millis(100) })),
          ),
        ),
      )
    },
    600_000,
  )
})
