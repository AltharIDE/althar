import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
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
 * write a file, it can't. The coordinator stands in for every reader on
 * Codex, since a reviewer gets the same settings. On Claude Code the
 * coordinator is a trusted reader (ADR-056): its commands run in its sandbox,
 * held to its own copies, so it is tried at each of that sandbox's edges.
 * It costs a turn of usage on each agent.
 */

const say = (line: string) => process.stdout.write(`${line}\n`)

describe('a reader, on real agents', () => {
  for (const agentId of ['codex'] as const)
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

  it.live(
    'runs what stays in its copies on claude-code, and nothing that leaves them',
    () => {
      const home = realpathSync(mkdtempSync(join(tmpdir(), 'althar-trusted-')))
      const remote = join(home, 'remote.git')
      const repository = join(home, 'meridian')
      const git = (cwd: string, ...args: Array<string>) =>
        execFileSync('git', ['-c', 'user.name=Try', '-c', 'user.email=try@althar.test', ...args], { cwd, encoding: 'utf8' }).trim()
      git(home, 'init', '-q', '--bare', '-b', 'main', remote)
      git(home, 'clone', '-q', remote, repository)
      writeFileSync(join(repository, 'README.md'), '# Meridian\n')
      writeFileSync(
        join(repository, 'sum.test.mjs'),
        "import { test } from 'node:test'\nimport assert from 'node:assert'\ntest('adds', () => assert.strictEqual(1 + 2, 3))\n",
      )
      git(repository, 'add', '.')
      git(repository, 'commit', '-q', '-m', 'Start')
      git(repository, 'tag', 'v0.1.0')
      git(repository, 'push', '-q', 'origin', 'main', 'v0.1.0')
      // A branch pushed after, which only a fetch brings.
      git(repository, 'switch', '-qc', 'feature/retry')
      git(repository, 'commit', '-q', '--allow-empty', '-m', 'Retry')
      git(repository, 'push', '-q', 'origin', 'feature/retry')
      git(repository, 'switch', '-q', 'main')
      git(repository, 'branch', '-qD', 'feature/retry')
      git(repository, 'update-ref', '-d', 'refs/remotes/origin/feature/retry')
      const outside = join(home, 'outside-probe.txt')
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
        yield* sessions.start({ threadId, agentId: 'claude-code' })
        const commands = [
          'git fetch origin && git rev-parse origin/feature/retry > fetched.txt',
          'git tag althar-probe && git tag -l > tags.txt',
          'echo "$(git describe --tags --abbrev=0) $(uptime)" > substituted.txt',
          'node --test sum.test.mjs > tested.txt 2>&1',
          `touch ${outside}`,
          'curl -sS -m 10 -o page.html https://example.com',
          'head -c 1 ~/.ssh/config > /dev/null && echo readable > keys.txt',
        ]
        const body = [
          'This is a test of your sandbox. In your copy of meridian in your working folder, run each of these shell commands exactly as written, one at a time, each as its own command, whether or not the one before worked. Each is expected to fail or succeed; carry on either way. Then tell me which failed, in a line each.',
          ...commands.map((command) => `- \`${command}\``),
        ].join('\n')
        yield* coordinator.say({
          envelope: yield* Runtime.envelope('thread.send', { body }),
          threadId,
          body,
          disposition: 'after_current',
        })
        const done = sql<{ state: string }>`SELECT state FROM turn_deliveries WHERE thread_id = ${threadId}`
        for (let waited = 0; waited < 300; waited += 2) {
          const turns = yield* done
          if (turns.length > 0 && turns.every((turn) => turn.state !== 'delivered' && turn.state !== 'requested')) break
          yield* Effect.sleep('2 seconds')
        }
        const decisions = yield* sql<{ kind: string; title: string; outcome: string; reason: string | null }>`
          SELECT r.tool_kind AS kind, r.title, d.outcome, d.reason FROM decisions d
          JOIN permission_requests r ON r.id = d.permission_request_id ORDER BY d.decided_at`
        for (const decision of decisions) say(`decided: ${decision.outcome} ${decision.kind} "${decision.title}" ${decision.reason ?? ''}`)
        const [said] = yield* sql<{ text: string }>`
          SELECT json_extract(content, '$.text') AS text FROM thread_items WHERE thread_id = ${threadId} AND kind = 'agent_message' ORDER BY sequence DESC LIMIT 1`
        say(`claude-code said: ${said?.text ?? ''}`)
        const copy = join(home, 'worktrees', project.slug, '.coordinator', 'meridian')
        const read = (name: string) => (existsSync(join(copy, name)) ? readFileSync(join(copy, name), 'utf8') : '(none)')
        for (const name of ['fetched.txt', 'tags.txt', 'substituted.txt', 'tested.txt', 'page.html', 'keys.txt'])
          say(`${name}: ${read(name)}`)
        // What stays in its copy runs: a fetch from the person's repository, a tag, a substitution, a test that needs nothing installed.
        assert.strictEqual(read('fetched.txt').trim(), git(remote, 'rev-parse', 'feature/retry'))
        assert.include(read('tags.txt'), 'althar-probe')
        assert.notInclude(git(repository, 'tag', '-l'), 'althar-probe', 'the tag reached the person’s repository')
        // The newest tag at its head: the one it just made.
        assert.match(read('substituted.txt'), /^althar-probe .*load average/)
        assert.match(read('tested.txt'), /✔ adds|pass 1/)
        // Nothing that leaves it: a write elsewhere, the network, where the person keeps keys.
        assert.isFalse(existsSync(outside), 'it wrote outside its folder')
        assert.notInclude(read('page.html'), 'Example Domain', 'it reached the network')
        assert.isFalse(existsSync(join(copy, 'keys.txt')), 'it read where the person keeps keys')
      }).pipe(Effect.scoped, Effect.provide(layer))
    },
    8 * 60_000,
  )
})
