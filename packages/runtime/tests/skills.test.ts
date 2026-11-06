import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ProjectId } from '@althar/domain'
import { agents, type SessionEvent } from '@althar/provider-adapters'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Agents, type AgentEntry } from '../src/Config'
import { Sessions } from '../src/Sessions'
import { recorder, transcript } from '../src/threads'
import { fakeAgents, items, runtime, task, turns, until } from './support'

/*
 * What a lead's agent could see, kept on its session as a line of its thread,
 * and what it loaded, on the call that did (DEV-188): what the agent says,
 * and for one that says nothing, what its folders hold.
 */

const WORKTREE = '/work/meridian'

const place = Effect.gen(function* () {
  const sessions = yield* Sessions
  const { project, task: created } = yield* task()
  const sessionId = yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
  yield* until(turns(created.threadId), (rows) => rows[0]?.state === 'completed')
  return { projectId: project.projectId as ProjectId, threadId: created.threadId, sessionId, folders: [WORKTREE], lead: 'Codex' }
})

const seen = (...names: ReadonlyArray<string>): SessionEvent => ({
  _tag: 'SkillsSeen',
  skills: names.map((name) => ({
    name,
    path: name.startsWith('repo') ? `${WORKTREE}/.agents/skills/${name}/SKILL.md` : `/h/.agents/skills/${name}/SKILL.md`,
  })),
})

const lines = (threadId: string) =>
  Effect.map(items(threadId), (rows) =>
    rows.filter((row) => row.kind === 'notice' && row.content.role === 'skills').map((row) => row.content),
  )

const toolContent = (threadId: string, toolCallId: string) =>
  Effect.map(items(threadId), (rows) => rows.find((row) => row.toolCallId === toolCallId)?.content)

describe('what a lead could see', () => {
  it.live('says it once, whose each skill is, and changes it as the agent says more', () =>
    Effect.gen(function* () {
      const where = yield* place
      const record = recorder(where)
      yield* record.record(seen('mine', 'repo-ours'))
      assert.deepStrictEqual(yield* lines(where.threadId), [
        {
          source: 'runtime',
          severity: 'info',
          role: 'skills',
          title: 'Codex could see 2 skills',
          skills: [
            { name: 'mine', path: '/h/.agents/skills/mine/SKILL.md', from: 'person' },
            { name: 'repo-ours', path: `${WORKTREE}/.agents/skills/repo-ours/SKILL.md`, from: 'repository' },
          ],
        },
      ])
      yield* record.record(seen('mine', 'repo-ours'))
      assert.strictEqual((yield* lines(where.threadId)).length, 1)
      yield* record.record(seen('mine'))
      const [changed, ...rest] = yield* lines(where.threadId)
      assert.strictEqual(changed?.title, 'Codex could see a skill')
      assert.isEmpty(rest)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('knows the repository by its real path too, as an agent may say a skill under it', () =>
    Effect.gen(function* () {
      const where = yield* place
      const real = realpathSync(mkdtempSync(join(tmpdir(), 'althar-skills-real-')))
      const linked = join(mkdtempSync(join(tmpdir(), 'althar-skills-link-')), 'worktree')
      symlinkSync(real, linked)
      yield* recorder({ ...where, folders: [linked] }).record({
        _tag: 'SkillsSeen',
        skills: [{ name: 'ours', path: join(real, '.agents/skills/ours/SKILL.md') }],
      })
      assert.deepInclude((yield* lines(where.threadId))[0], {
        skills: [{ name: 'ours', path: join(real, '.agents/skills/ours/SKILL.md'), from: 'repository' }],
      })
    }).pipe(Effect.provide(runtime())),
  )

  it.live('stays quiet where it could see none, and a later session that could see the same', () =>
    Effect.gen(function* () {
      const where = yield* place
      yield* recorder(where).record(seen())
      assert.isEmpty(yield* lines(where.threadId))
      yield* recorder(where).record(seen('mine'))
      // A restart starts another session on the same thread, which could see what it could.
      const sql = yield* SqlClient.SqlClient
      const another = `sess_${'0'.repeat(32)}`
      yield* sql`INSERT INTO provider_sessions (id, project_id, thread_id, agent_id, account_id, controller_generation, state, started_at)
        SELECT ${another}, project_id, thread_id, agent_id, account_id, controller_generation, 'lost', started_at FROM provider_sessions WHERE id = ${where.sessionId}`
      yield* recorder({ ...where, sessionId: another }).record(seen('mine'))
      assert.strictEqual((yield* lines(where.threadId)).length, 1)
      // Another agent took it over and could see less: that is news, in a line of its own.
      yield* recorder({ ...where, sessionId: another, lead: 'OpenCode' }).record(seen())
      assert.deepStrictEqual(
        (yield* lines(where.threadId)).map((line) => line.title),
        ['Codex could see a skill', 'OpenCode could see no skills'],
      )
    }).pipe(Effect.provide(runtime())),
  )

  it.live("keeps nothing for what isn't a lead, and leaves it out of what a next agent reads", () =>
    Effect.gen(function* () {
      const { lead: _lead, ...notLead } = yield* place
      yield* recorder(notLead).record(seen('mine'))
      assert.isEmpty(yield* lines(notLead.threadId))
      yield* recorder({ ...notLead, lead: 'Codex' }).record(seen('mine'))
      assert.notInclude(JSON.stringify(yield* transcript(notLead.threadId, 100_000)), 'could see')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('reads the folders of an agent that says nothing itself', () =>
    Effect.gen(function* () {
      const folder = mkdtempSync(join(tmpdir(), 'althar-skills-'))
      mkdirSync(join(folder, 'found'))
      writeFileSync(join(folder, 'found', 'SKILL.md'), '---\nname: found\ndescription: A fixture.\n---\n')
      const reading = (entry: AgentEntry): AgentEntry => ({ ...entry, definition: { ...entry.definition, skillFolders: () => [folder] } })
      const agents = Layer.effect(
        Agents,
        Effect.gen(function* () {
          const all = yield* Agents
          return Agents.of({ list: all.list.map(reading), get: (id) => Effect.map(all.get(id), reading) })
        }),
      ).pipe(Layer.provide(fakeAgents()))
      return yield* Effect.gen(function* () {
        const { task: created } = yield* task()
        yield* (yield* Sessions).start({ threadId: created.threadId, agentId: 'opencode' })
        yield* until(lines(created.threadId), (rows) => rows.length > 0)
        assert.deepInclude((yield* lines(created.threadId))[0], {
          title: 'Fake opencode could see a skill',
          skills: [{ name: 'found', path: join(folder, 'found', 'SKILL.md'), from: 'person' }],
        })
      }).pipe(Effect.provide(runtime(':memory:', {}, { agents })))
    }),
  )
})

describe('an OpenCode in a Flatpak', () => {
  const configOf = (out: boolean) => {
    const definition = agents.opencode
    const transport = Agents.fromRegistry((entry) =>
      entry.id !== definition.id
        ? entry
        : { ...entry, launch: (node) => ({ ...entry.launch(node), ...(out ? { onDevice: () => ({ command: 'out', args: [] }) } : {}) }) },
    ).list.find((entry) => entry.definition.id === definition.id)?.transport
    const made = transport?.(tmpdir())
    return made?._tag === 'Process' ? JSON.parse(made.spec.env?.OPENCODE_CONFIG_CONTENT ?? '{}') : undefined
  }

  it.live("has the person's folder read for what it could see, where it runs inside", () => {
    const before = process.env.FLATPAK_ID
    const asked: Array<boolean | undefined> = []
    const reading = (entry: AgentEntry): AgentEntry => ({
      ...entry,
      definition: {
        ...entry.definition,
        skillFolders: ({ inSandbox }) => {
          asked.push(inSandbox)
          return []
        },
      },
    })
    const fake = Layer.effect(
      Agents,
      Effect.gen(function* () {
        const all = yield* Agents
        return Agents.of({ list: all.list.map(reading), get: (id) => Effect.map(all.get(id), reading) })
      }),
    ).pipe(Layer.provide(fakeAgents()))
    return Effect.gen(function* () {
      process.env.FLATPAK_ID = 'dev.althar.app'
      const { task: created } = yield* task()
      yield* (yield* Sessions).start({ threadId: created.threadId, agentId: 'opencode' })
      yield* until(
        Effect.sync(() => asked),
        (seen) => seen.length > 0,
      )
      assert.deepStrictEqual(asked, [true])
    }).pipe(
      Effect.provide(runtime(':memory:', {}, { agents: fake })),
      Effect.ensuring(
        Effect.sync(() => {
          if (before === undefined) delete process.env.FLATPAK_ID
          else process.env.FLATPAK_ID = before
        }),
      ),
    )
  })

  it("is told of the person's folder where it runs inside, and only there", () => {
    const before = process.env.FLATPAK_ID
    process.env.FLATPAK_ID = 'dev.althar.app'
    try {
      assert.deepStrictEqual(configOf(false).skills, { paths: [join(homedir(), '.config', 'opencode', 'skills')] })
      assert.isUndefined(configOf(true).skills)
      delete process.env.FLATPAK_ID
      assert.isUndefined(configOf(false).skills)
    } finally {
      if (before === undefined) delete process.env.FLATPAK_ID
      else process.env.FLATPAK_ID = before
    }
  })
})

describe('a skill loaded', () => {
  it.live('is what the agent said, kept when its name is cut from the input', () =>
    Effect.gen(function* () {
      const where = yield* place
      const record = recorder(where)
      yield* record.record({ _tag: 'ToolCall', toolCallId: 'c', title: 'Load skill', kind: 'other', status: 'pending' })
      yield* record.record({
        _tag: 'ToolCallUpdate',
        toolCallId: 'c',
        title: 'Load skill: mine',
        rawInput: { skill: 'mine' },
        skill: 'mine',
      })
      yield* record.record({ _tag: 'ToolCallUpdate', toolCallId: 'c', status: 'completed' })
      assert.deepInclude(yield* toolContent(where.threadId, 'c'), { status: 'completed', skill: { names: ['mine'], reported: true } })
    }).pipe(Effect.provide(runtime())),
  )

  it.live('is a read of the file of a skill the agent listed, for an agent with no word for it', () =>
    Effect.gen(function* () {
      const where = yield* place
      const record = recorder(where)
      yield* record.record(seen('mine', 'repo-ours'))
      const call = (toolCallId: string, kind: 'read' | 'execute' | 'edit', fields: object): SessionEvent => ({
        _tag: 'ToolCall',
        toolCallId,
        title: toolCallId,
        kind,
        status: 'completed',
        ...fields,
      })
      const onIt = (toolCallId: string) => Effect.map(toolContent(where.threadId, toolCallId), (content) => content?.skill)
      const read = (names: ReadonlyArray<string>) => ({ names, reported: false })

      // As Codex read one: a file read, and shell commands, by the whole path or from the repository.
      yield* record.record(call('file', 'read', { locations: [{ path: '/h/.agents/skills/mine/SKILL.md' }] }))
      assert.deepStrictEqual(yield* onIt('file'), read(['mine']))
      yield* record.record(
        call('two', 'execute', {
          rawInput: { command: `/bin/bash -lc 'cat /h/.agents/skills/mine/SKILL.md && cat .agents/skills/repo-ours/SKILL.md'` },
        }),
      )
      assert.deepStrictEqual(yield* onIt('two'), read(['mine', 'repo-ours']))

      // Under way or failed, it hasn't read it; nor has what only names one, or a skill it never listed.
      yield* record.record({
        ...call('failed', 'read', { locations: [{ path: '/h/.agents/skills/mine/SKILL.md' }] }),
        status: 'failed',
      } as SessionEvent)
      yield* record.record(call('named', 'execute', { rawInput: { command: 'rm /h/.agents/skills/mine/SKILL.md' } }))
      yield* record.record(call('other', 'read', { locations: [{ path: '/elsewhere/SKILL.md' }] }))
      yield* record.record(call('edit', 'edit', { locations: [{ path: '/h/.agents/skills/mine/SKILL.md' }] }))
      for (const id of ['failed', 'named', 'other', 'edit']) assert.isUndefined(yield* onIt(id), id)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('is nothing where nothing was listed: Althar invents none', () =>
    Effect.gen(function* () {
      const where = yield* place
      yield* recorder(where).record({
        _tag: 'ToolCall',
        toolCallId: 'c',
        title: 'c',
        kind: 'read',
        status: 'completed',
        locations: [{ path: join(homedir(), '.agents/skills/mine/SKILL.md') }],
      })
      assert.isUndefined((yield* toolContent(where.threadId, 'c'))?.skill)
    }).pipe(Effect.provide(runtime())),
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { installLocalCatalog, setActive } from '@althar/skills'
import { writeCatalog } from '../../skills/tests/support'
import { Effect, Layer, Stream } from 'effect'
import type { RuntimeOptions } from '../src/Config'
import { SqlClient } from 'effect/sql'

import { type Failure, Failures, failuresLayer } from '../src/Failures'
import { onlyReads, Sessions } from '../src/Sessions'
import { runSkills } from '../src/Skills'
import { items, launches, notices, runtime, sessionMetas, task, until } from './support'

/*
 * Althar-selected skills reach a task's lead on every agent the registry says how to give them to, from Althar's own
 * folder, for that session alone (docs/plans/skills-across-harnesses.md): never in the worktree, never another role.
 */

const skill = (name: string) => ({
  'SKILL.md': `---\nname: ${name}\ndescription: Use when testing ${name}.\n---\nDo ${name}.\n`,
})

const makeStore = async (
  skills: Record<string, Record<string, string>>,
  needs: Record<string, Array<string>> = {},
  off: ReadonlyArray<string> = [],
) => {
  const root = mkdtempSync(join(tmpdir(), 'althar-skills-store-'))
  const catalog = mkdtempSync(join(tmpdir(), 'althar-skills-catalog-'))
  await writeCatalog(catalog, skills, needs)
  // The catalog's skills are off until the person turns them on: here, all of them but those left off.
  await Effect.runPromise(installLocalCatalog(root, catalog))
  for (const id of Object.keys(skills)) if (!off.includes(id)) await Effect.runPromise(setActive(root, id, true))
  return { root, catalog }
}

/** Every SKILL.md under a folder, however deep. */
const skillFilesUnder = (folder: string): Array<string> =>
  existsSync(folder)
    ? readdirSync(folder, { recursive: true, encoding: 'utf8' })
        .filter((path) => path.endsWith('SKILL.md'))
        .map((path) => join(folder, path))
    : []

/** Where the last session of an agent was given its skills, one folder per skill, as the registry lays them out for it. */
const skillsFolderOf = (agentId: string, root: string) => {
  if (agentId === 'claude-code') return join(sessionMetas.at(-1)?.options?.skills ?? '', 'skills')
  if (agentId === 'opencode') return launches.at(-1)?.options?.skills ?? ''
  const [run = ''] = readdirSync(join(root, 'runs'))
  return join(root, 'runs', run, agentId, '.agents', 'skills')
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

/** The brief a lead's session started from, as the fake agent echoes it back. */
const briefOf = (threadId: string) => {
  const echoed = (text: unknown): text is string => typeof text === 'string' && text.startsWith('echo: You are working')
  const brief = (rows: ReadonlyArray<{ readonly content: Record<string, unknown> }>) => rows.map((item) => item.content.text).find(echoed)
  return Effect.map(
    until(items(threadId), (rows) => brief(rows) !== undefined),
    (rows) => brief(rows) ?? '',
  )
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
  off: ReadonlyArray<string> = [],
) =>
  Effect.flatMap(
    Effect.promise(() => makeStore(skills, needs, off)),
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
        // Its brief names them and asks it to load one that fits.
        const brief = yield* briefOf(created.threadId)
        assert.include(brief, 'Althar has given you skills for this task: alpha, beta.')
        assert.include(brief, 'load it and follow it')
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
          said.some(
            (notice) =>
              notice.title?.endsWith("codex wasn't given a skill it can't use.") === true && notice.description === 'beta needs subagents',
          ),
          JSON.stringify(said),
        )
        // Its brief names only what it got.
        assert.include(yield* briefOf(created.threadId), 'Althar has given you skills for this task: alpha.')
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

  it.live(
    'gives Claude Code, Codex and OpenCode leads only the skills turned on, read-only, and writes none to the home or the repository',
    () => {
      // A home of its own, so what an agent's own folders would get is seen: ~/.agents/skills, ~/.claude/skills and the like.
      const home = mkdtempSync(join(tmpdir(), 'althar-skills-home-'))
      const was = process.env.HOME
      return Effect.acquireUseRelease(
        Effect.sync(() => void (process.env.HOME = home)),
        () =>
          withStore(
            { alpha: skill('alpha'), beta: skill('beta'), gamma: skill('gamma') },
            {},
            (skills) =>
              Effect.gen(function* () {
                const sessions = yield* Sessions
                for (const agentId of ['claude-code', 'codex', 'opencode']) {
                  const { task: created } = yield* task()
                  yield* sessions.start({ threadId: created.threadId, agentId })
                  const folder = skillsFolderOf(agentId, skills.root)
                  assert.isTrue(folder.startsWith(join(skills.root, 'runs')), `${agentId}: ${folder}`)
                  // Gamma is off: not given, nor recorded as given.
                  assert.deepStrictEqual(readdirSync(folder).toSorted(), ['alpha', 'beta'], agentId)
                  assert.deepStrictEqual(
                    (yield* givenTo(created.threadId)).map(({ id }) => id),
                    ['alpha', 'beta'],
                    agentId,
                  )
                  // Read-only copies: the agent can't change what the next session is given.
                  for (const file of skillFilesUnder(folder)) assert.strictEqual(statSync(file).mode & 0o222, 0, `${agentId}: ${file}`)
                  const worktree = yield* worktreeOf(created.threadId)
                  assert.deepStrictEqual(skillFilesUnder(worktree), [], agentId)
                  yield* sessions.stop(created.threadId)
                  assert.isFalse(existsSync(folder), agentId)
                }
                // Nothing reached the home: no ~/.agents/skills, nor any agent's own skills folder.
                assert.deepStrictEqual(skillFilesUnder(home), [])
                assert.isFalse(existsSync(join(home, '.agents', 'skills')))
              }),
            ['gamma'],
          ),
        () => Effect.sync(() => void (was === undefined ? delete process.env.HOME : (process.env.HOME = was))),
      )
    },
  )

  it.live('gives a skill turned on while a lead works only to the session after', () =>
    withStore(
      { alpha: skill('alpha'), gamma: skill('gamma') },
      {},
      (skills) =>
        Effect.gen(function* () {
          const sessions = yield* Sessions
          const { task: created } = yield* task()
          yield* sessions.start({ threadId: created.threadId, agentId: 'claude-code' })
          const first = skillsFolderOf('claude-code', skills.root)
          yield* setActive(skills.root, 'gamma', true)
          // The session under way keeps what it started with.
          assert.deepStrictEqual(readdirSync(first), ['alpha'])
          assert.deepStrictEqual(
            (yield* givenTo(created.threadId)).map(({ id }) => id),
            ['alpha'],
          )
          yield* sessions.stop(created.threadId)
          yield* sessions.start({ threadId: created.threadId, agentId: 'claude-code' })
          const next = skillsFolderOf('claude-code', skills.root)
          assert.notStrictEqual(next, first)
          assert.deepStrictEqual(readdirSync(next).toSorted(), ['alpha', 'gamma'])
          assert.deepStrictEqual(
            (yield* givenTo(created.threadId)).map(({ id }) => id),
            ['alpha', 'gamma'],
          )
          yield* sessions.stop(created.threadId)
        }),
      ['gamma'],
    ),
  )

  it.live('gives the coordinator none, on any agent', () =>
    withStore({ alpha: skill('alpha') }, {}, (skills) =>
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const { project } = yield* task()
        for (const agentId of ['claude-code', 'codex', 'opencode']) {
          yield* sessions.start({ threadId: project.coordinatorThreadId, agentId })
          if (agentId === 'claude-code') {
            assert.strictEqual(sessionMetas.at(-1)?.role, 'reader')
            assert.isUndefined(sessionMetas.at(-1)?.options?.skills)
          }
          assert.isUndefined(launches.at(-1)?.options?.skills, agentId)
          assert.isFalse(existsSync(join(skills.root, 'runs')) && readdirSync(join(skills.root, 'runs')).length > 0, agentId)
          assert.deepStrictEqual(yield* givenTo(project.coordinatorThreadId), [], agentId)
          yield* sessions.stop(project.coordinatorThreadId)
        }
      }),
    ),
  )

  it('counts the coordinator, a reviewer and a review’s lead as only reading, so none is given skills; a task’s lead is', () => {
    assert.isTrue(onlyReads({ role: 'coordinator' }))
    assert.isTrue(onlyReads({ role: 'reviewer' }))
    assert.isTrue(onlyReads({ role: 'task', review: { outside: false } }))
    assert.isFalse(onlyReads({ role: 'task', review: null }))
  })

  it.live('gives a Claude Code lead none without a skills store', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task: created } = yield* task()
      yield* sessions.start({ threadId: created.threadId, agentId: 'claude-code' })
      assert.isUndefined(sessionMetas.at(-1)?.options?.skills)
      assert.notInclude(yield* briefOf(created.threadId), 'given you skills')
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
