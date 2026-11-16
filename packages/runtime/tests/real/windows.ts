import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel, Worker } from 'node:worker_threads'

import { emitterPort } from '@althar/contracts'
import { Effect, Layer } from 'effect'

import { connection } from '../../src/Api'
import type { Answer, Asked, Features, WindowSetup, WindowStats } from './window'

/*
 * The app's windows, as the responsiveness run has them: each a thread of
 * its own (windowWorker.ts) with a connection of its own to the runtime's
 * API, served here as the app serves each window's port. The run asks a
 * window to make a call, as the person's press does, and reads what each
 * read of its own and heard.
 */

export interface Windows {
  readonly names: ReadonlyArray<string>
  /** What the first window's connection offers, as this commit has it. */
  readonly features: Features
  /** A call made by window `at`, as a press makes it, timed there from the call to its answer. */
  readonly call: (at: number, method: string, payload?: unknown, want?: boolean) => Effect.Effect<Answer>
  /** Calls made at once by window `at`, each timed, and all of them together. */
  readonly burst: (at: number, method: string, payloads: ReadonlyArray<unknown>) => Effect.Effect<Answer>
  /** What each window read and heard since it was last reset, and reset, where asked. */
  readonly stats: (reset: boolean) => Effect.Effect<ReadonlyArray<WindowStats>>
}

/** The window's code, bundled as one file a worker can run: Bun builds it as the run starts. */
const bundled = () => {
  const folder = mkdtempSync(join(tmpdir(), 'althar-window-'))
  const out = join(folder, 'window.mjs')
  execFileSync('bun', ['build', join(import.meta.dirname, 'windowWorker.ts'), '--target=node', '--format=esm', `--outfile=${out}`], {
    stdio: 'ignore',
  })
  return { out, folder }
}

/** Opens a window for each setup, each with its connection to the runtime, until the scope closes. */
export const openWindows = (setups: ReadonlyArray<WindowSetup>) =>
  Effect.gen(function* () {
    const { out, folder } = bundled()
    yield* Effect.addFinalizer(() => Effect.sync(() => rmSync(folder, { recursive: true, force: true })))
    const made: Array<{ readonly worker: Worker; readonly ask: (asked: Asked) => Promise<Answer> }> = []
    let features: Features | undefined
    for (const setup of setups) {
      const channel = new MessageChannel()
      // Its connection, served on a fiber of its own, as the app serves each window's: it ends when its window goes.
      yield* Effect.forkScoped(
        Layer.launch(
          connection(
            emitterPort(channel.port1, (data) => data),
            { kind: 'window' },
          ),
        ),
      )
      const worker = new Worker(out, { workerData: { port: channel.port2, setup }, transferList: [channel.port2] })
      const pending = new Map<number, (answer: Answer) => void>()
      let ids = 0
      const started = new Promise<Features | undefined>((resolve, reject) => {
        worker.once('error', reject)
        pending.set(0, (answer) => resolve(answer.features))
      })
      worker.on('message', (answer: Answer) => {
        const resolve = pending.get(answer.id)
        pending.delete(answer.id)
        resolve?.(answer)
      })
      const ask = (asked: Asked) =>
        new Promise<Answer>((resolve) => {
          pending.set(asked.id, resolve)
          worker.postMessage(asked)
        })
      features ??= yield* Effect.promise(() => started)
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          await Promise.race([ask({ op: 'stop', id: (ids += 1) }), new Promise((resolve) => setTimeout(resolve, 500))])
          await worker.terminate()
          channel.port1.close()
        }),
      )
      made.push({ worker, ask: (asked) => ask({ ...asked, id: (ids += 1) }) })
    }
    const at = (index: number) => made[index] ?? made[0]!
    return {
      names: setups.map((setup) => setup.name),
      features: features ?? { items: false, lane: false },
      call: (index, method, payload, want) =>
        Effect.promise(() => at(index).ask({ op: 'call', id: 0, method, payload, ...(want === undefined ? {} : { want }) })),
      burst: (index, method, payloads) => Effect.promise(() => at(index).ask({ op: 'burst', id: 0, method, payloads })),
      stats: (reset) => Effect.promise(() => Promise.all(made.map(async (one) => (await one.ask({ op: 'stats', id: 0, reset })).stats!))),
    } satisfies Windows
  })
