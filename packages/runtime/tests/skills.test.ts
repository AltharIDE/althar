import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { installLocalCatalog, setActive } from '@althar/skills'
import { writeCatalog } from '../../skills/tests/support'
import { Effect, Layer, Stream } from 'effect'
import type { RuntimeOptions } from '../src/Config'
import { SqlClient } from 'effect/sql'

import { type Failure, Failures, failuresLayer } from '../src/Failures'
import { Sessions } from '../src/Sessions'
import { runSkills } from '../src/Skills'
import { launches, notices, runtime, sessionMetas, task } from './support'

/*
 * Althar-selected skills reach a task's lead on every agent the registry says how to give them to, from Althar's own
 * folder, for that session alone (docs/plans/skills-across-harnesses.md): never in the worktree, never another role.
 */

const skill = (name: string) => ({
  'SKILL.md': `---\nname: ${name}\ndescription: Use when testing ${name}.\n---\nDo ${name}.\n`,
})

const makeStore = async (skills: Record<string, Record<string, string>>, needs: Record<string, Array<string>> = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'althar-skills-store-'))
  const catalog = mkdtempSync(join(tmpdir(), 'althar-skills-catalog-'))
  await writeCatalog(catalog, skills, needs)
  // The catalog's skills are off until the person turns them on: here, all of them.
  await Effect.runPromise(installLocalCatalog(root, catalog))
  for (const id of Object.keys(skills)) await Effect.runPromise(setActive(root, id, true))
  return { root, catalog }
}

/** The skills a thread's last session was given, as its record of becoming active says. */
const givenTo = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ payload: string }>`
      SELECT e.payload FROM record_events e JOIN provider_sessions s ON s.id = e.aggregate_id
      WHERE s.thread_id = ${threadId} AND e.type = 'provider_session.active' ORDER BY e.sequence DESC LIMIT 1`
    return (JSON.parse(row?.payload ?? '{}') as { skills?: Array<{ id: string; treeHash: string }> }).skills ?? []
  })

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
    // With failures said to a listener, as the app's are, so a test hears what is reported.
    (store) => body(store).pipe(Effect.provide(runtime(':memory:', {}, { skills: store }).pipe(Layer.provideMerge(failuresLayer)))),
  )

describe('skills for a task’s lead', () => {
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
        const plugin = meta?.options?.skills ?? ''
        assert.isTrue(plugin.startsWith(join(skills.root, 'runs')), plugin)
        assert.include(readFileSync(join(plugin, 'skills', 'alpha', 'SKILL.md'), 'utf8'), 'name: alpha')
        assert.include(readFileSync(join(plugin, '.claude-plugin', 'plugin.json'), 'utf8'), '"name": "althar"')
        // Beta needs subagents, which Claude Code has.
        assert.isTrue(existsSync(join(plugin, 'skills', 'beta', 'SKILL.md')))
        // Never in the worktree: no skill root, no copy of a skill file in it.
        const worktree = yield* worktreeOf(created.threadId)
        assert.isFalse(plugin.startsWith(worktree))
        // The session's record says which skills it was given, each at the version it got.
        const given = yield* givenTo(created.threadId)
        assert.deepStrictEqual(
          given.map(({ id }) => id),
          ['alpha', 'beta'],
        )
        for (const { treeHash } of given) assert.match(treeHash, /^[0-9a-f]{64}$/)
        for (const root of ['.claude', '.agents', '.opencode', 'openspec']) assert.isFalse(existsSync(join(worktree, root)), root)
        yield* sessions.stop(created.threadId)
        assert.isFalse(existsSync(plugin))
      }),
    ),
  )

  it.live('gives a Codex lead the same skills as an added directory, less one it cannot use, and says so', () =>
    withStore({ alpha: skill('alpha'), beta: skill('beta') }, { beta: ['subagents'] }, (skills) =>
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const { task: created } = yield* task()
        yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
        const [run = ''] = readdirSync(join(skills.root, 'runs'))
        const folder = join(skills.root, 'runs', run, 'codex')
        assert.include(readFileSync(join(folder, '.agents', 'skills', 'alpha', 'SKILL.md'), 'utf8'), 'name: alpha')
        // Beta needs subagents, which Codex isn't counted on for: left out, and the thread says so.
        assert.isFalse(existsSync(join(folder, '.agents', 'skills', 'beta')))
        const said = yield* notices(created.threadId)
        assert.isTrue(
          said.some((notice) => notice.description === 'beta needs subagents'),
          JSON.stringify(said),
        )
        // Recorded as given: what it got, not what it couldn't use.
        assert.deepStrictEqual(
          (yield* givenTo(created.threadId)).map(({ id }) => id),
          ['alpha'],
        )
        const worktree = yield* worktreeOf(created.threadId)
        for (const root of ['.claude', '.agents', '.opencode', 'openspec']) assert.isFalse(existsSync(join(worktree, root)), root)
        yield* sessions.stop(created.threadId)
        assert.isFalse(existsSync(folder))
      }),
    ),
  )

  it.live('gives an OpenCode lead the same skills through its environment', () =>
    withStore({ alpha: skill('alpha'), beta: skill('beta') }, { beta: ['subagents'] }, (skills) =>
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const { task: created } = yield* task()
        yield* sessions.start({ threadId: created.threadId, agentId: 'opencode' })
        const folder = launches.at(-1)?.options?.skills ?? ''
        assert.isTrue(folder.startsWith(join(skills.root, 'runs')), folder)
        assert.deepStrictEqual(readdirSync(folder).toSorted(), ['alpha', 'beta'])
        yield* sessions.stop(created.threadId)
        assert.isFalse(existsSync(folder))
      }),
    ),
  )

  it.live('gives a Claude Code lead none without a skills store', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task: created } = yield* task()
      yield* sessions.start({ threadId: created.threadId, agentId: 'claude-code' })
      assert.isUndefined(sessionMetas.at(-1)?.options?.skills)
      yield* sessions.stop(created.threadId)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('gives the lead the skills that read when one install in the store does not', () =>
    withStore({ alpha: skill('alpha'), beta: skill('beta') }, {}, (skills) =>
      Effect.gen(function* () {
        const path = join(skills.root, 'installs.json')
        const file = JSON.parse(readFileSync(path, 'utf8')) as { installs: Array<unknown> }
        writeFileSync(path, JSON.stringify({ ...file, installs: [...file.installs, { id: 'gamma', active: 'yes' }] }))
        const sessions = yield* Sessions
        const { task: created } = yield* task()
        yield* sessions.start({ threadId: created.threadId, agentId: 'claude-code' })
        assert.deepStrictEqual(
          (yield* givenTo(created.threadId)).map(({ id }) => id),
          ['alpha', 'beta'],
        )
        // The store is not written over a record it couldn't read.
        assert.include(readFileSync(path, 'utf8'), '"gamma"')
        yield* sessions.stop(created.threadId)
      }),
    ),
  )

  it.live('still starts the session, without skills, when the catalog is damaged, and the thread and a report say so', () =>
    withStore({ alpha: skill('alpha') }, {}, (skills) =>
      Effect.gen(function* () {
        writeFileSync(join(skills.catalog, 'catalog.json'), '{}')
        const heard: Array<Failure> = []
        yield* Effect.forkChild(Stream.runForEach((yield* Failures).events, (failure) => Effect.sync(() => void heard.push(failure))))
        yield* Effect.sleep('20 millis')
        const sessions = yield* Sessions
        const { task: created } = yield* task()
        yield* sessions.start({ threadId: created.threadId, agentId: 'claude-code' })
        assert.isUndefined(sessionMetas.at(-1)?.options?.skills)
        const said = yield* notices(created.threadId)
        const notice = said.find((one) => one.title?.endsWith('started without its skills.'))
        assert.deepInclude(notice, { severity: 'warning', description: "Althar couldn't lay them out. Its log has the details." })
        // Althar's own catalog not loading is not the person's to put right: it is reported, by the agent.
        yield* Effect.sleep('20 millis')
        assert.deepInclude(
          heard.find((one) => one.where === 'skills'),
          { agent: 'claude-code', name: 'SkillStoreFailed' },
        )
        yield* sessions.stop(created.threadId)
      }),
    ),
  )
})

describe('setting skills up for several leads at once', () => {
  it.live('keeps the store consistent and gives each its own run', () =>
    Effect.gen(function* () {
      const skills = yield* Effect.promise(() => makeStore({ alpha: skill('alpha'), beta: skill('beta') }, {}))
      const claude = { id: 'claude-code', skills: { layout: 'claude-plugin', capabilities: [], via: { kind: 'meta' } } } as const
      const runs = (yield* Effect.forEach(
        Array.from({ length: 8 }, (_, at) => at),
        (at) => runSkills(skills, claude, `run-${at}`, []),
        { concurrency: 'unbounded' },
      )).flatMap((run) => (run === undefined ? [] : [run]))
      for (const run of runs) {
        assert.isTrue(existsSync(join(run.folder, 'skills', 'alpha', 'SKILL.md')))
        assert.isTrue(existsSync(join(run.folder, 'skills', 'beta', 'SKILL.md')))
      }
      assert.strictEqual(new Set(runs.map((run) => run.folder)).size, 8)
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
      yield* Effect.forEach(runs, (run) => run.release, { concurrency: 'unbounded' })
    }),
  )
})
