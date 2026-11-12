import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { agentTools, serversFor, setToolInProject, setToolRoles } from '../src/agentTools'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { homeWith } from './agentHome'
import { repository, runtime } from './support'

/*
 * The person's servers as Settings' tiles read them (ADR-097): how each
 * runs, whether each agent that runs it is signed in, why it last failed,
 * a project's mark pressed out and back in, and a repository's own servers,
 * off until the person turns them on, and then only in their own project.
 */

const homeOf = () => {
  const home = homeWith({
    claude: {
      mcpServers: {
        linear: { type: 'http', url: 'https://mcp.linear.app/mcp' },
        local: { type: 'stdio', command: 'srv' },
      },
    },
    codex: { mcp_servers: { linear: { url: 'https://mcp.linear.app/mcp' }, local: { command: 'srv' } } },
  })
  const folder = mkdtempSync(join(tmpdir(), 'althar-tiles-'))
  return { home, folder }
}

const withHealth = (folder: string, servers: Record<string, unknown>) => {
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'mcp-health.json'), JSON.stringify({ checkedAt: '2026-11-08T09:00:00.000Z', servers }))
}

const openProject = (path: string) =>
  Effect.gen(function* () {
    return (yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path })).projectId
  })

describe('the person’s servers as tiles', () => {
  it.live('say how each runs, each agent’s sign-in and its last failure, and where each agent keeps them', () => {
    const { home, folder } = homeOf()
    withHealth(folder, {
      linear: {
        claude: { status: 'connected', at: '2026-11-08T09:00:00.000Z' },
        codex: { status: 'needs-auth', at: '2026-11-08T09:00:00.000Z' },
        // OpenCode doesn't run it: what it says is not read.
        opencode: { status: 'failed', why: 'not there', at: '2026-11-08T09:30:00.000Z' },
      },
      local: {
        claude: { status: 'failed', why: 'spawn srv ENOENT', at: '2026-11-08T08:00:00.000Z' },
        codex: { status: 'failed', why: 'exited with code 1', at: '2026-11-08T09:00:00.000Z' },
      },
    })
    return Effect.gen(function* () {
      const tools = yield* agentTools(null)
      const linear = tools.servers.find((one) => one.name === 'linear')
      const local = tools.servers.find((one) => one.name === 'local')
      assert.strictEqual(linear?.way, 'address')
      assert.strictEqual(local?.way, 'command')
      assert.deepStrictEqual(linear?.signIn, { claude: 'yes', codex: 'no', opencode: 'unknown' })
      assert.strictEqual(linear?.failed, null)
      assert.deepStrictEqual(local?.failed, { agent: 'codex', why: 'exited with code 1', at: '2026-11-08T09:00:00.000Z' })
      assert.deepStrictEqual(local?.signIn, { claude: 'unknown', codex: 'unknown', opencode: 'unknown' })
      assert.deepStrictEqual([linear?.repository, linear?.home, linear?.from, linear?.offIn], [null, null, null, []])
      assert.deepStrictEqual(tools.places, [
        { agent: 'claude', file: '~/.claude.json', folder: '~/.claude/skills' },
        { agent: 'codex', file: '~/.codex/config.toml', folder: '~/.agents/skills' },
        { agent: 'opencode', file: '~/.config/opencode/opencode.json', folder: '~/.config/opencode/skills' },
      ])
      assert.strictEqual(tools.checkedAt, '2026-11-08T09:00:00.000Z')
    }).pipe(Effect.provide(runtime(':memory:', {}, { agentConfigs: { homeDir: home, folder, env: {} } })))
  })

  it.live('says a connected command server needs no sign-in', () => {
    const { home, folder } = homeOf()
    withHealth(folder, { local: { claude: { status: 'connected', at: '2026-11-08T09:00:00.000Z' } } })
    return Effect.gen(function* () {
      const local = (yield* agentTools(null)).servers.find((one) => one.name === 'local')
      assert.strictEqual(local?.signIn.claude, 'none')
      assert.strictEqual((yield* agentTools(null)).checkedAt, '2026-11-08T09:00:00.000Z')
    }).pipe(Effect.provide(runtime(':memory:', {}, { agentConfigs: { homeDir: home, folder, env: {} } })))
  })

  it.live('keeps a project pressed out, gives it to no role there, and lets the roles apply again once pressed back in', () => {
    const { home, folder } = homeOf()
    return Effect.gen(function* () {
      yield* setToolRoles('server', 'local', ['lead', 'reviewer'], null)
      yield* setToolInProject('server', 'local', 'project-a', false)
      const row = (yield* agentTools(null)).servers.find((one) => one.name === 'local')
      assert.deepStrictEqual(row?.offIn, ['project-a'])
      assert.deepStrictEqual(row?.roles, ['lead', 'reviewer'])
      assert.deepStrictEqual((yield* agentTools('project-a')).servers.find((one) => one.name === 'local')?.roles, [])
      for (const role of ['lead', 'reviewer', 'coordinator'] as const)
        assert.notInclude(
          (yield* serversFor(role, 'project-a', true)).map((one) => one.name),
          'local',
        )
      assert.include(
        (yield* serversFor('lead', 'project-b', true)).map((one) => one.name),
        'local',
      )
      yield* setToolInProject('server', 'local', 'project-a', true)
      assert.deepStrictEqual((yield* agentTools(null)).servers.find((one) => one.name === 'local')?.offIn, [])
      assert.include(
        (yield* serversFor('lead', 'project-a', true)).map((one) => one.name),
        'local',
      )
      assert.notInclude(
        (yield* serversFor('coordinator', 'project-a', true)).map((one) => one.name),
        'local',
      )
    }).pipe(Effect.provide(runtime(':memory:', {}, { agentConfigs: { homeDir: home, folder, env: {} } })))
  })
})

describe('a repository’s own servers', () => {
  it.live('are listed off, and once turned on are given only to their own project’s sessions', () => {
    const { home, folder } = homeOf()
    const own = repository()
    const other = repository()
    writeFileSync(
      join(own, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          docs: { command: 'docs-mcp', args: ['--serve'] },
          // Named as one of the person's own: the person's stays theirs.
          local: { command: 'repo-local' },
          althar: { command: 'not-althar' },
        },
      }),
    )
    return Effect.gen(function* () {
      const projectId = yield* openProject(own)
      const otherId = yield* openProject(other)
      const listed = (yield* agentTools(null)).servers.filter((one) => one.repository !== null)
      assert.deepStrictEqual(
        listed.map((one) => [one.name, one.repository, one.roles, one.sources, one.about]),
        [
          ['docs', projectId, [], [{ from: 'repository', where: '.mcp.json' }], 'docs-mcp --serve'],
          ['local', projectId, [], [{ from: 'repository', where: '.mcp.json' }], 'repo-local'],
        ],
      )
      assert.deepStrictEqual(
        (yield* agentTools(otherId)).servers.filter((one) => one.repository !== null),
        [],
      )
      assert.notInclude(
        (yield* serversFor('lead', projectId, true)).map((one) => one.name),
        'docs',
      )

      yield* setToolRoles('server', 'docs', ['lead'], null, projectId)
      const docs = (yield* agentTools(projectId)).servers.find((one) => one.name === 'docs' && one.repository === projectId)
      assert.deepStrictEqual(docs?.roles, ['lead'])
      // Kept apart from the person's own `local`, whose roles are still every role's.
      assert.deepStrictEqual((yield* agentTools(null)).servers.find((one) => one.name === 'local' && one.repository === null)?.roles, [
        'lead',
        'reviewer',
        'coordinator',
      ])
      assert.deepInclude(yield* serversFor('lead', projectId, true), {
        type: 'stdio',
        name: 'docs',
        command: 'docs-mcp',
        args: ['--serve'],
        env: {},
      })
      assert.notInclude(
        (yield* serversFor('reviewer', projectId, true)).map((one) => one.name),
        'docs',
      )
      assert.notInclude(
        (yield* serversFor('lead', otherId, true)).map((one) => one.name),
        'docs',
      )
      // A review of a pull request from outside the project gets none of the repository's own.
      assert.notInclude(
        (yield* serversFor('lead', projectId, true, false)).map((one) => one.name),
        'docs',
      )
      // Turning on the repository's `local` gives the person's own, never two of a name.
      yield* setToolRoles('server', 'local', ['lead'], null, projectId)
      const given = (yield* serversFor('lead', projectId, true)).filter((one) => one.name === 'local')
      assert.deepStrictEqual(
        given.map((one) => (one.type === 'stdio' ? one.command : '')),
        ['srv'],
      )
    }).pipe(Effect.provide(runtime(':memory:', {}, { agentConfigs: { homeDir: home, folder, env: {} } })))
  })
})
