import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { writeCatalog } from '../../skills/tests/support'
import { Effect } from 'effect'
import type { RuntimeOptions } from '../src/Config'
import { SqlClient } from 'effect/sql'

import { Sessions } from '../src/Sessions'
import { claudeRunSkills } from '../src/Skills'
import { launches, runtime, sessionMetas, task } from './support'

/*
 * Althar-selected skills reach a Claude Code lead as a plugin in Althar's own folder, for that session alone
 * (docs/plans/skills-across-harnesses.md): never in the worktree, never for another agent or role.
 */

const skill = (name: string) => ({
  'SKILL.md': `---\nname: ${name}\ndescription: Use when testing ${name}.\n---\nDo ${name}.\n`,
})

const makeStore = async (skills: Record<string, Record<string, string>>, needs: Record<string, Array<string>> = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'althar-skills-store-'))
  const catalog = mkdtempSync(join(tmpdir(), 'althar-skills-catalog-'))
  await writeCatalog(catalog, skills, needs)
  return { root, catalog }
}

const worktreeOf = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ path: string }>`
      SELECT w.path FROM workspaces w JOIN threads t ON t.task_id = w.task_id WHERE t.id = ${threadId} LIMIT 1`
    return row?.path ?? ''
  })

/** Runs a test against a runtime with a skills store seeded from a local catalog of the given skills. */
const withStore = <A, E, R>(
  skills: Record<string, Record<string, string>>,
  needs: Record<string, Array<string>>,
  body: (store: NonNullable<RuntimeOptions['skills']>) => Effect.Effect<A, E, R>,
) =>
  Effect.flatMap(
    Effect.promise(() => makeStore(skills, needs)),
    (store) => body(store).pipe(Effect.provide(runtime(':memory:', {}, { skills: store }))),
  )

describe('skills for a Claude Code lead', () => {
  it.live('gives the lead the active skills as a plugin in the store, outside the worktree, and removes it when the session ends', () =>
    withStore({ alpha: skill('alpha'), beta: skill('beta') }, { beta: ['subagents'] }, (skills) =>
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const { task: created } = yield* task()
        const before = sessionMetas.length
        yield* sessions.start({ threadId: created.threadId, agentId: 'claude-code' })
        assert.isTrue(sessionMetas.length > before)
        const meta = sessionMetas.at(-1)
        assert.strictEqual(meta?.role, 'lead')
        const plugin = meta?.options?.skillsPlugin ?? ''
        assert.isTrue(plugin.startsWith(join(skills.root, 'runs')), plugin)
        assert.include(readFileSync(join(plugin, 'skills', 'alpha', 'SKILL.md'), 'utf8'), 'name: alpha')
        assert.include(readFileSync(join(plugin, '.claude-plugin', 'plugin.json'), 'utf8'), '"name": "althar"')
        // Beta needs subagents, which Claude Code has.
        assert.isTrue(existsSync(join(plugin, 'skills', 'beta', 'SKILL.md')))
        // Never in the worktree: no skill root, no copy of a skill file in it.
        const worktree = yield* worktreeOf(created.threadId)
        assert.isFalse(plugin.startsWith(worktree))
        for (const root of ['.claude', '.agents', '.opencode', 'openspec']) assert.isFalse(existsSync(join(worktree, root)), root)
        yield* sessions.stop(created.threadId)
        assert.isFalse(existsSync(plugin))
      }),
    ),
  )

  it.live('gives another agent none', () =>
    withStore({ alpha: skill('alpha') }, {}, (skills) =>
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const { task: created } = yield* task()
        const seen = launches.length
        yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
        assert.isTrue(launches.length > seen)
        assert.isFalse(existsSync(join(skills.root, 'runs')))
        yield* sessions.stop(created.threadId)
      }),
    ),
  )

  it.live('gives a Claude Code lead none without a skills store', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task: created } = yield* task()
      yield* sessions.start({ threadId: created.threadId, agentId: 'claude-code' })
      assert.isUndefined(sessionMetas.at(-1)?.options?.skillsPlugin)
      yield* sessions.stop(created.threadId)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('still starts the session, without skills, when the catalog is damaged', () =>
    withStore({ alpha: skill('alpha') }, {}, (skills) =>
      Effect.gen(function* () {
        writeFileSync(join(skills.catalog, 'catalog.json'), '{}')
        const sessions = yield* Sessions
        const { task: created } = yield* task()
        yield* sessions.start({ threadId: created.threadId, agentId: 'claude-code' })
        assert.isUndefined(sessionMetas.at(-1)?.options?.skillsPlugin)
        yield* sessions.stop(created.threadId)
      }),
    ),
  )
})

describe('setting skills up for several leads at once', () => {
  it.live('keeps the store consistent and gives each its own run', () =>
    Effect.promise(async () => {
      const skills = await makeStore({ alpha: skill('alpha'), beta: skill('beta') }, {})
      const runs = await Promise.all(Array.from({ length: 8 }, (_, at) => claudeRunSkills(skills, `run-${at}`, [])))
      for (const run of runs) {
        assert.isTrue(existsSync(join(run.plugin, 'skills', 'alpha', 'SKILL.md')))
        assert.isTrue(existsSync(join(run.plugin, 'skills', 'beta', 'SKILL.md')))
      }
      assert.strictEqual(new Set(runs.map((run) => run.plugin)).size, 8)
      const installs = JSON.parse(readFileSync(join(skills.root, 'installs.json'), 'utf8')) as {
        installs: Array<{ id: string; active: boolean }>
      }
      assert.deepStrictEqual(
        installs.installs.map(({ id, active }) => [id, active]),
        [
          ['alpha', true],
          ['beta', true],
        ],
      )
      await Promise.all(runs.map((run) => run.release()))
    }),
  )
})
