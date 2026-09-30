import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Coordinator } from '../../src/Coordinator'
import { Projects } from '../../src/Projects'
import { Queries } from '../../src/Queries'
import * as Runtime from '../../src/Runtime'

/*
 * The coordinator loop on the real agents installed and signed in on this
 * machine (docs/plans/mvp.md): a small repository, one request to the
 * coordinator, and what follows, printed as it happens: the coordinator's
 * plan, the lead's steps, the review and its findings, and every permission
 * request and what Charrette decided. The plan starts on its own; the
 * coordinator picks the lead and the reviewer. It costs a few turns of usage
 * on each agent it picks, and never runs in CI: `bun run test:agents`, with
 * CHARRETTE_ASK to ask something else.
 */

const ask =
  process.env.CHARRETTE_ASK ?? 'index.js has addDays. Add subtractDays beside it, and a test for both that runs with `node --test`.'

const say = (line: string) => process.stdout.write(`${line}\n`)
const clip = (text: string, length = 300) => (text.length > length ? `${text.slice(0, length)}…` : text).replaceAll('\n', ' ⏎ ')

describe('the coordinator loop, on real agents', () => {
  it.live(
    'plans what it is asked, and the plan runs until the task is ready',
    () => {
      const home = mkdtempSync(join(tmpdir(), 'charrette-loop-'))
      const repository = join(home, 'meridian')
      mkdirSync(repository)
      const git = (...args: Array<string>) =>
        execFileSync('git', ['-c', 'user.name=Try', '-c', 'user.email=try@charrette.test', ...args], { cwd: repository })
      git('init', '-q', '-b', 'main')
      writeFileSync(join(repository, 'README.md'), '# Meridian\n\nA small library for dates.\n\nRun the tests with `node --test`.\n')
      writeFileSync(join(repository, 'index.js'), 'export const addDays = (date, days) => new Date(date.getTime() + days * 86_400_000)\n')
      git('add', '.')
      git('commit', '-q', '-m', 'Start')
      const layer = Queries.layer.pipe(
        Layer.provideMerge(
          Runtime.layer({
            database: join(home, 'charrette.sqlite'),
            worktreeRoot: join(home, 'worktrees'),
            appVersion: '0.0.0-agents',
            deviceName: 'Agents',
          }),
        ),
      )
      return Effect.gen(function* () {
        const projects = yield* Projects
        const coordinator = yield* Coordinator
        const queries = yield* Queries
        const sql = yield* SqlClient.SqlClient
        const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository })
        const threadId = yield* coordinator.thread(project.projectId)
        say(`Repository: ${repository}`)
        say(`Coordinator starts on: ${JSON.stringify(yield* coordinator.suggested(project.projectId))}`)
        say(`> ${ask}`)
        yield* coordinator.say({
          envelope: yield* Runtime.envelope('thread.send', { ask }),
          threadId,
          body: ask,
          disposition: 'after_current',
        })

        const seen = new Set<string>()
        const started = Date.now()
        let phase = ''
        for (;;) {
          // Everything new, in every thread: what each agent said and did, and what each step reported.
          const items = yield* sql<{ id: string; thread: string; kind: string; content: string; agentId: string | null }>`
            SELECT i.id, t.kind || coalesce(':' || t.node_key, '') AS thread, i.kind, i.content, s.agent_id
            FROM thread_items i JOIN threads t ON t.id = i.thread_id LEFT JOIN provider_sessions s ON s.id = i.provider_session_id
            ORDER BY i.created_at, i.sequence`
          for (const item of items) {
            const key = `${item.id}:${item.content.length}`
            if (seen.has(item.id) || item.kind === 'agent_thought') continue
            const content = JSON.parse(item.content) as { readonly title?: string; readonly status?: string }
            // A message is written as it grows; print it once it has stopped growing.
            if (item.kind === 'agent_message' && !seen.has(key)) {
              seen.add(key)
              continue
            }
            seen.add(item.id)
            const who = `[${item.thread}${item.agentId === null ? '' : ` ${item.agentId}`}]`
            if (item.kind === 'tool_call') say(`${who} tool: ${clip(content.title ?? '', 160)} (${content.status ?? ''})`)
            else if (item.kind === 'task') continue
            else say(`${who} ${item.kind}: ${clip(JSON.stringify(content), 600)}`)
          }
          const snapshot = yield* queries.coordinator(project.projectId)
          const card = snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : [])).at(-1)
          if (card !== undefined && card.phase !== phase) {
            phase = card.phase
            say(
              `— card: ${card.slug} is ${card.phase}${card.step === null ? '' : ` (${card.step})`}; plan ${JSON.stringify(card.plan?.steps ?? [])}`,
            )
          }
          const waiting = yield* sql<{
            title: string
            reason: string
          }>`SELECT r.title, json_extract(a.payload, '$.reason') AS reason FROM attention_requests a JOIN permission_requests r ON r.id = a.permission_request_id WHERE a.state = 'open'`
          for (const call of waiting) say(`!! waiting on you: ${call.title} (${call.reason})`)
          if (phase === 'ready' || phase === 'stopped' || waiting.length > 0 || Date.now() - started > 15 * 60_000) break
          yield* Effect.sleep('2 seconds')
        }

        const decisions = yield* sql<{ kind: string; title: string; outcome: string; reason: string | null }>`
          SELECT r.tool_kind AS kind, r.title, d.outcome, d.reason FROM decisions d JOIN permission_requests r ON r.id = d.permission_request_id ORDER BY d.decided_at`
        say(`\nPermission requests (${decisions.length}):`)
        for (const decision of decisions)
          say(`  ${decision.outcome} ${decision.kind} "${clip(decision.title, 120)}"${decision.reason ? ` — ${decision.reason}` : ''}`)
        const nodes = yield* sql<{
          nodeKey: string
          iteration: number
          state: string
        }>`SELECT node_key, iteration, state FROM nodes ORDER BY created_at`
        say(`Nodes: ${nodes.map((node) => `${node.nodeKey}#${node.iteration} ${node.state}`).join(', ')}`)
        const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces`
        if (workspace !== undefined)
          say(
            `Worktree: ${workspace.path}\n${execFileSync('git', ['status', '--short'], { cwd: workspace.path }).toString()}${execFileSync('git', ['diff'], { cwd: workspace.path }).toString()}`,
          )
        say(`Took ${Math.round((Date.now() - started) / 1000)}s.`)
        assert.strictEqual(phase, 'ready')
      }).pipe(Effect.scoped, Effect.provide(layer))
    },
    20 * 60_000,
  )
})
