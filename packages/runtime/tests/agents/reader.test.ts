import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Coordinator } from '../../src/Coordinator'
import { Projects } from '../../src/Projects'
import * as Runtime from '../../src/Runtime'
import { Sessions } from '../../src/Sessions'

/*
 * A role that only reads, on the real agents (docs/architecture/04): asked to
 * write a file, it can't. The coordinator stands in for every reader, since a
 * reviewer gets the same settings. It costs a turn of usage on each agent.
 */

const say = (line: string) => process.stdout.write(`${line}\n`)

describe('a reader, on real agents', () => {
  for (const agentId of ['claude-code', 'codex'] as const)
    it.live(
      `can't write a file on ${agentId}`,
      () => {
        const home = mkdtempSync(join(tmpdir(), 'althar-reader-'))
        const repository = join(home, 'meridian')
        mkdirSync(repository)
        const git = (...args: Array<string>) =>
          execFileSync('git', ['-c', 'user.name=Try', '-c', 'user.email=try@althar.test', ...args], { cwd: repository })
        git('init', '-q', '-b', 'main')
        writeFileSync(join(repository, 'README.md'), '# Meridian\n')
        git('add', '.')
        git('commit', '-q', '-m', 'Start')
        const layer = Runtime.layer({
          database: join(home, 'althar.sqlite'),
          worktreeRoot: join(home, 'worktrees'),
          appVersion: '0.0.0-agents',
          deviceName: 'Agents',
        })
        return Effect.gen(function* () {
          const projects = yield* Projects
          const coordinator = yield* Coordinator
          const sessions = yield* Sessions
          const sql = yield* SqlClient.SqlClient
          const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository })
          const threadId = yield* coordinator.thread(project.projectId)
          yield* sessions.start({ threadId, agentId })
          const body =
            'Run exactly this shell command in your working folder: `touch althar-probe.txt`. Then tell me whether the file now exists.'
          yield* coordinator.say({
            envelope: yield* Runtime.envelope('thread.send', { body }),
            threadId,
            body,
            disposition: 'after_current',
          })
          const done = sql<{ state: string }>`SELECT state FROM turn_deliveries WHERE thread_id = ${threadId}`
          for (let waited = 0; waited < 180; waited += 2) {
            const turns = yield* done
            if (turns.length > 0 && turns.every((turn) => turn.state !== 'delivered' && turn.state !== 'requested')) break
            yield* Effect.sleep('2 seconds')
          }
          const decisions = yield* sql<{ kind: string; title: string; outcome: string; reason: string | null }>`
            SELECT r.tool_kind AS kind, r.title, d.outcome, d.reason FROM decisions d
            JOIN permission_requests r ON r.id = d.permission_request_id ORDER BY d.decided_at`
          for (const decision of decisions)
            say(`${agentId}: ${decision.outcome} ${decision.kind} "${decision.title}" ${decision.reason ?? ''}`)
          const [said] = yield* sql<{ text: string }>`
            SELECT json_extract(content, '$.text') AS text FROM thread_items WHERE thread_id = ${threadId} AND kind = 'agent_message' ORDER BY sequence DESC LIMIT 1`
          say(`${agentId} said: ${said?.text ?? ''}`)
          const folder = join(home, 'worktrees', project.slug, '.coordinator', 'meridian')
          assert.isFalse(existsSync(join(folder, 'althar-probe.txt')), 'the reader wrote the file')
        }).pipe(Effect.scoped, Effect.provide(layer))
      },
      5 * 60_000,
    )
})
