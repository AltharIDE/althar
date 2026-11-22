import { Worker } from 'node:worker_threads'

import { Context, Effect, Layer } from 'effect'
import { SqlError, Statement } from 'effect/sql'
import { snakeToCamel } from 'effect/String'

const MAX_WAITING = 32

// Shared by the desktop, host and CLI bundles. The worker opens a read-only
// connection and never borrows the writer connection or its transaction.
const READER = `
const { parentPort, workerData } = require('node:worker_threads')
const { DatabaseSync } = require('node:sqlite')
const db = new DatabaseSync(workerData, { readOnly: true })
db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 100')
const prepared = new Map()
parentPort.on('message', ({ id, query, params }) => {
  try {
    let statement = prepared.get(query)
    if (statement === undefined) {
      statement = db.prepare(query)
      if (prepared.size >= 64) prepared.delete(prepared.keys().next().value)
      prepared.set(query, statement)
    }
    parentPort.postMessage({ id, rows: statement.all(...params) })
  } catch (error) {
    parentPort.postMessage({ id, failed: { message: error.message, errcode: error.errcode } })
  }
})`

type Reply =
  | { readonly id: number; readonly rows: ReadonlyArray<Record<string, unknown>> }
  | { readonly id: number; readonly failed: { readonly message: string; readonly errcode?: number } }

interface Job {
  readonly id: number
  readonly query: string
  readonly params: ReadonlyArray<unknown>
  readonly finish: (result: Effect.Effect<ReadonlyArray<unknown>, SqlError.SqlError>) => void
}

const errorOf = (cause: unknown) =>
  new SqlError.SqlError({ reason: SqlError.classifySqliteError(cause, { message: 'Could not read the store', operation: 'execute' }) })
const camel = Statement.defaultTransforms(snakeToCamel).array

const lane = (filename: string) => {
  let worker: Worker | undefined
  let running: Job | undefined
  let next = 0
  const waiting: Job[] = []
  let closed = false

  const failed = (source: Worker | undefined, error: unknown) => {
    if (source !== worker) return
    worker = undefined
    const cause = Effect.fail(errorOf(error))
    const jobs = waiting.splice(0)
    if (running !== undefined) jobs.unshift(running)
    running = undefined
    for (const job of jobs) job.finish(cause)
    return source?.terminate()
  }

  const send = () => {
    if (closed || running !== undefined) return
    const job = waiting.shift()
    if (job === undefined) return
    running = job
    try {
      if (worker === undefined) {
        const started = new Worker(READER, { eval: true, workerData: filename, execArgv: [] })
        worker = started
        started.on('error', (error) => void failed(started, error))
        started.on('exit', () => void failed(started, new Error('The database reader stopped.')))
        started.on('message', (reply: Reply) => {
          const current = running
          if (worker !== started || current?.id !== reply.id) return
          running = undefined
          current.finish('failed' in reply ? Effect.fail(errorOf(reply.failed)) : Effect.succeed(camel(reply.rows)))
          if (waiting.length === 0) started.unref()
          send()
        })
      }
      worker.ref()
      worker.postMessage({ id: job.id, query: job.query, params: job.params })
    } catch (error) {
      void failed(worker, error)
    }
  }

  return {
    read: <A>(statement: Statement.Statement<A>) =>
      Effect.callback<ReadonlyArray<A>, SqlError.SqlError>((resume) => {
        if (closed || waiting.length >= MAX_WAITING) {
          resume(Effect.fail(errorOf(new Error('The database reader is busy.'))))
          return
        }
        const [query, params] = statement.compile()
        const id = (next += 1)
        waiting.push({ id, query, params, finish: (result) => resume(result as Effect.Effect<ReadonlyArray<A>, SqlError.SqlError>) })
        send()
        return Effect.sync(() => {
          const index = waiting.findIndex((job) => job.id === id)
          if (index >= 0) waiting.splice(index, 1)
        })
      }),
    close: () => {
      closed = true
      return failed(worker, new Error('The database reader closed.'))
    },
  }
}

interface Reader {
  readonly read: <A>(
    statement: Statement.Statement<A>,
    mode?: 'background' | 'interactive',
  ) => Effect.Effect<ReadonlyArray<A>, SqlError.SqlError>
}

export const ReadPriority = Context.Reference<'background' | 'interactive'>('@althar/persistence-sqlite/ReadPriority', {
  defaultValue: () => 'background',
})

export class ReadLane extends Context.Service<ReadLane, Reader>()('@althar/persistence-sqlite/ReadLane') {
  static layer(filename: string | null) {
    return Layer.effect(
      ReadLane,
      filename === null
        ? Effect.succeed({ read: (statement) => statement } satisfies Reader)
        : Effect.acquireRelease(
            Effect.sync(() => ({ foreground: lane(filename), background: lane(filename) })),
            ({ foreground, background }) => Effect.promise(() => Promise.all([foreground.close(), background.close()])),
          ).pipe(
            Effect.map(({ foreground, background }): Reader => ({
              read: (statement, mode) =>
                Effect.flatMap(ReadPriority, (current) => ((mode ?? current) === 'interactive' ? foreground : background).read(statement)),
            })),
          ),
    )
  }
}
