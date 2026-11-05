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
  )
})
