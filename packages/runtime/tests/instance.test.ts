import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Ids, newId, now } from '@althar/domain'
import { osStartTime } from '@althar/provider-adapters'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Instance } from '../src/Instance'
import * as Runtime from '../src/Runtime'
import { runtime, task } from './support'

const database = () => join(mkdtempSync(join(tmpdir(), 'althar-profile-')), 'althar.sqlite')

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** A process in its own group, as the runtime starts agents. */
const detached = (command: string, args: Array<string>) =>
  Effect.gen(function* () {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.unref()
    // Listened for at once: a process that exits straight away must not be missed.
    const exit = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    const pid = yield* Effect.callback<number>((resume) => {
      child.once('spawn', () => resume(Effect.succeed(child.pid ?? 0)))
    })
    return { pid, exited: Effect.promise(() => exit) }
  })

describe('the runtime instance', () => {
  it.live('records each launch, keeping the device and the person across launches', () =>
    Effect.gen(function* () {
      const file = database()
      const launch = Effect.gen(function* () {
        const instance = yield* Instance
        return instance
      }).pipe(Effect.provide(runtime(file)))
      const first = yield* launch
      const second = yield* launch
      assert.strictEqual(first.deviceId, second.deviceId)
      assert.strictEqual(first.personId, second.personId)
      assert.notStrictEqual(first.id, second.id)
      const ended = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{ id: string; endedAt: string | null }>`SELECT id, ended_at FROM runtime_instances ORDER BY started_at, id`
      }).pipe(Effect.provide(runtime(file)))
      assert.isTrue(ended.slice(0, 2).every((row) => row.endedAt !== null))
    }),
  )

  it.live('reconciles what an earlier launch left: stops its processes, and marks its sessions, turns and requests', () =>
    Effect.gen(function* () {
      const file = database()
      const sleeper = yield* detached('sleep', ['30'])
      // A leader that exits at once, leaving what it started running in its group.
      const leaderPidFile = join(mkdtempSync(join(tmpdir(), 'althar-orphan-')), 'pid')
      const leader = yield* detached('/bin/sh', ['-c', 'sleep 30 & echo $! > "$0"; sleep 0.2; exit 0', leaderPidFile])
      const leaderStarted = yield* osStartTime(leader.pid)
      yield* leader.exited
      const gone = yield* detached('true', [])
      yield* gone.exited
      const sleeperStarted = yield* osStartTime(sleeper.pid)

      // The first launch leaves rows behind as if it had crashed.
      const seeded = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const instance = yield* Instance
        const at = yield* now
        const crashed = yield* newId(Ids.runtimeInstance)
        yield* sql`INSERT INTO runtime_instances ${sql.insert({ id: crashed, deviceId: instance.deviceId, pid: 4242, appVersion: '0.0.0', startedAt: at })}`
        const tasks = [yield* task('One'), yield* task('Two'), yield* task('Three'), yield* task('Four')]
        const sessions: Array<string> = []
        for (const [index, state] of ['active', 'waiting_approval', 'starting', 'cancelling'].entries()) {
          const { project, task: created } = tasks[index] as (typeof tasks)[number]
          const id = yield* newId(Ids.providerSession)
          sessions.push(id)
          yield* sql`INSERT INTO provider_sessions ${sql.insert({ id, projectId: project.projectId, threadId: created.threadId, agentId: 'codex', state, startedAt: at })}`
        }
        const [one, two] = tasks as [(typeof tasks)[number], (typeof tasks)[number]]
        const processes = {
          live: yield* newId(Ids.process),
          dead: yield* newId(Ids.process),
          launching: yield* newId(Ids.process),
          leaderless: yield* newId(Ids.process),
        }
        const process = (id: string, fields: Record<string, unknown>) =>
          sql`INSERT INTO processes ${sql.insert({ id, projectId: one.project.projectId, deviceId: instance.deviceId, runtimeInstanceId: crashed, providerSessionId: sessions[0], purpose: 'agent', executable: 'node', launchedAt: at, ...fields })}`
        yield* process(processes.live, { pid: sleeper.pid, osStartedAt: sleeperStarted, state: 'running' })
        yield* process(processes.dead, { pid: gone.pid, osStartedAt: at, state: 'running' })
        yield* process(processes.launching, { state: 'launching' })
        yield* process(processes.leaderless, { pid: leader.pid, osStartedAt: leaderStarted ?? at, state: 'running' })
        // One worktree git finished adding before the crash, one it never started.
        const [ready, never] = [tasks[2], tasks[3]] as [(typeof tasks)[number], (typeof tasks)[number]]
        yield* sql`UPDATE workspaces SET state = 'preparing' WHERE task_id IN (${ready.task.taskId}, ${never.task.taskId})`
        yield* sql`UPDATE workspaces SET path = '/nowhere/at/all' WHERE task_id = ${never.task.taskId}`
        const turns = { delivered: yield* newId(Ids.turnDelivery), pending: yield* newId(Ids.turnDelivery) }
        yield* sql`INSERT INTO turn_deliveries ${sql.insert({ id: turns.delivered, projectId: one.project.projectId, threadId: one.task.threadId, providerSessionId: sessions[0], controllerGeneration: 1, state: 'delivered', requestedAt: at })}`
        yield* sql`INSERT INTO turn_deliveries ${sql.insert({ id: turns.pending, projectId: two.project.projectId, threadId: two.task.threadId, providerSessionId: sessions[1], controllerGeneration: 1, state: 'pending', requestedAt: at })}`
        const request = yield* newId(Ids.permissionRequest)
        yield* sql`INSERT INTO permission_requests ${sql.insert({ id: request, projectId: one.project.projectId, providerSessionId: sessions[0], toolCallId: 'call-1', toolKind: 'execute', title: 'make deploy', actionDigest: 'x', state: 'open', receivedAt: at })}`
        const attention = yield* newId(Ids.attentionRequest)
        yield* sql`INSERT INTO attention_requests ${sql.insert({ id: attention, projectId: one.project.projectId, permissionRequestId: request, kind: 'permission', state: 'open', createdAt: at })}`
        return {
          crashed,
          sessions,
          processes,
          turns,
          request,
          attention,
          workspaces: [tasks[2]?.task.workspaceId ?? '', tasks[3]?.task.workspaceId ?? ''],
        }
      }).pipe(Effect.provide(runtime(file)))

      // The next launch finds and settles them.
      const after = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const state = (table: string, id: string) =>
          Effect.map(sql<{ state: string }>`SELECT state FROM ${sql(table)} WHERE id = ${id}`, ([row]) => row?.state)
        const [crashed] = yield* sql<{ endedAt: string | null }>`SELECT ended_at FROM runtime_instances WHERE id = ${seeded.crashed}`
        return {
          crashedEnded: crashed?.endedAt !== null,
          sessions: yield* Effect.forEach(seeded.sessions, (id) => state('provider_sessions', id)),
          workspaces: yield* Effect.forEach(seeded.workspaces, (id) => state('workspaces', id)),
          processes: [
            yield* state('processes', seeded.processes.live),
            yield* state('processes', seeded.processes.dead),
            yield* state('processes', seeded.processes.launching),
            yield* state('processes', seeded.processes.leaderless),
          ],
          turns: [yield* state('turn_deliveries', seeded.turns.delivered), yield* state('turn_deliveries', seeded.turns.pending)],
          request: yield* state('permission_requests', seeded.request),
          attention: yield* state('attention_requests', seeded.attention),
        }
      }).pipe(Effect.provide(runtime(file)))

      // No thread says the restart stopped its lead: that is Althar's business, and the lead starts again when it is written to.
      const said = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{ content: string }>`SELECT content FROM thread_items WHERE kind = 'notice' ORDER BY sequence`
      }).pipe(Effect.provide(runtime(file)))
      assert.deepStrictEqual(said, [])
      assert.deepStrictEqual(after, {
        crashedEnded: true,
        sessions: ['lost', 'lost', 'failed', 'uncertain'],
        processes: ['killed', 'unknown', 'unknown', 'killed'],
        workspaces: ['ready', 'failed'],
        turns: ['interruption_uncertain', 'failed'],
        request: 'cancelled',
        attention: 'withdrawn',
      })
      yield* Effect.sleep('100 millis')
      assert.isFalse(alive(sleeper.pid))
      // What the leaderless group's leader left running was stopped with it.
      assert.isFalse(alive(Number(readFileSync(leaderPidFile, 'utf8').trim())))
    }),
  )

  it.live('uses the registry agents unless told otherwise', () =>
    Effect.gen(function* () {
      const instance = yield* Instance
      assert.match(instance.id, /^rt_/)
    }).pipe(Effect.provide(Runtime.layer({ database: ':memory:', worktreeRoot: tmpdir(), appVersion: '0.0.0', deviceName: 'Test Mac' }))),
  )
})
