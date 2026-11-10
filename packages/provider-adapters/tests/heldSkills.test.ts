import { assert, describe, it } from '@effect/vitest'

import type { HeldSkill } from '../src/heldSkills'
import { agents, type SessionOptions } from '../src/registry'

/*
 * The person's own skills a session isn't given, held back in each agent the
 * way it documents (`heldSkills.ts` says which versions were read): what each
 * agent's session options and config carry for a held list.
 */

const held: ReadonlyArray<HeldSkill> = [
  { name: 'impeccable' },
  { name: 'write-docs', called: 'docs-writer' },
  { name: 'superpowers:brainstorming' },
]

type Settings = {
  permissions: { deny: ReadonlyArray<string>; ask?: ReadonlyArray<string> }
  skillOverrides?: Readonly<Record<string, string>>
}
type Meta = { claudeCode: { options: { settings: Settings; plugins?: unknown } } }

const claude = agents['claude-code']
const metaOf = (role: 'lead' | 'reader', options: SessionOptions) => {
  if (claude.sessionMeta === undefined) return assert.fail('Claude Code has session options')
  return claude.sessionMeta(role, options) as Meta
}

const contained = { folder: '/tmp/coordinator', reads: { allowed: [], denied: [] } }

describe('Claude Code', () => {
  const sessions: ReadonlyArray<readonly [string, 'lead' | 'reader', SessionOptions]> = [
    ['a lead', 'lead', { web: true }],
    ['a reviewer', 'reader', { web: false }],
    ['the coordinator', 'reader', { contained }],
    ["a review's lead from outside", 'reader', { untrusted: true, offline: true }],
  ]

  it('denies each held skill by the name it is called, a plugin’s as plugin:skill, in every role', () => {
    for (const [who, role, options] of sessions) {
      const without = metaOf(role, options).claudeCode.options.settings
      const settings = metaOf(role, { ...options, heldSkills: held }).claudeCode.options.settings
      assert.deepStrictEqual(
        settings.permissions.deny,
        [...without.permissions.deny, 'Skill(impeccable)', 'Skill(write-docs)', 'Skill(docs-writer)', 'Skill(superpowers:brainstorming)'],
        who,
      )
      // Off its list too, where its own folders' are read from skillOverrides: a plugin's isn't.
      assert.deepStrictEqual(settings.skillOverrides, { impeccable: 'off', 'write-docs': 'off', 'docs-writer': 'off' }, who)
      assert.deepStrictEqual(settings.permissions.ask, without.permissions.ask, who)
    }
  })

  it('keeps the run’s own plugin and changes nothing where none is held', () => {
    const options = { web: true, skills: '/data/skills/runs/r1/claude-code/plugin' }
    assert.deepStrictEqual(metaOf('lead', { ...options, heldSkills: [] }), metaOf('lead', options))
    assert.deepStrictEqual(metaOf('lead', { ...options, heldSkills: held }).claudeCode.options.plugins, [
      { type: 'local', path: options.skills },
    ])
  })
})

describe('Codex', () => {
  const own = { CODEX_CONFIG: JSON.stringify({ 'mcp_servers.github.command': 'npx', 'mcp_servers.github.enabled': false }) }

  it('switches each held skill off by name in the config codex-acp starts every session with', () => {
    const config = JSON.parse(codexEnv(own, { web: true, heldSkills: held }).CODEX_CONFIG ?? '{}')
    assert.deepStrictEqual(config.skills, {
      config: [
        { name: 'impeccable', enabled: false },
        { name: 'docs-writer', enabled: false },
        { name: 'write-docs', enabled: false },
      ],
    })
    // Beside what it already carried: the person's servers off, its web search and its network.
    assert.strictEqual(config['mcp_servers.github.enabled'], false)
    assert.strictEqual(config.web_search, 'live')
    assert.isTrue(config['sandbox_workspace_write.network_access'])
  })

  it('keeps rules already there, and adds none where none is held', () => {
    const rules = { CODEX_CONFIG: JSON.stringify({ skills: { config: [{ path: '/x/SKILL.md', enabled: false }] } }) }
    const config = JSON.parse(codexEnv(rules, { heldSkills: [{ name: 'impeccable' }] }).CODEX_CONFIG ?? '{}')
    assert.deepStrictEqual(config.skills.config, [
      { path: '/x/SKILL.md', enabled: false },
      { name: 'impeccable', enabled: false },
    ])
    assert.notProperty(JSON.parse(codexEnv(own, { heldSkills: [] }).CODEX_CONFIG ?? '{}'), 'skills')
  })

  it('holds them in a review of a team’s pull request too', () => {
    const reviewing = { ...own, ...agents.codex.reviewing?.env?.(own) }
    const config = JSON.parse(codexEnv(reviewing, { web: false, untrusted: true, heldSkills: held }).CODEX_CONFIG ?? '{}')
    assert.lengthOf(config.skills.config, 3)
    assert.isFalse(config['features.hooks'])
  })
})

const codexEnv = (own: Readonly<Record<string, string>>, options: SessionOptions) => agents.codex.sessionEnv?.(own, options) ?? {}

describe('OpenCode', () => {
  const launched = agents.opencode.launch('/usr/bin/node').env ?? {}
  const own = {
    ...launched,
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      ...JSON.parse(launched.OPENCODE_CONFIG_CONTENT ?? '{}'),
      mcp: { github: { enabled: false } },
    }),
  }
  const configOf = (from: Readonly<Record<string, string>>, options: SessionOptions) => {
    const env = { ...from, ...agents.opencode.sessionEnv?.(from, options) }
    return JSON.parse(env.OPENCODE_CONFIG_CONTENT ?? '{}')
  }

  it('denies each held skill by its id, globally and for its built-in agents, whatever the web switch says', () => {
    for (const options of [{}, { web: true }, { web: false }, { web: true, offline: true }]) {
      const config = configOf(own, { ...options, heldSkills: held })
      for (const permission of [config.permission, config.agent.build.permission, config.agent.plan.permission]) {
        // Its id is its folder's name; a plugin's skill is Claude Code's alone.
        assert.deepStrictEqual(permission.skill, { impeccable: 'deny', 'write-docs': 'deny' }, JSON.stringify(options))
        assert.strictEqual(permission.bash, 'ask')
      }
      assert.deepStrictEqual(config.mcp, { github: { enabled: false } })
    }
  })

  it('keeps the web switch as it was, and changes nothing where none is held and the web is unsaid', () => {
    const config = configOf(own, { web: true, heldSkills: held })
    assert.strictEqual(config.permission.webfetch, 'allow')
    assert.deepStrictEqual(agents.opencode.sessionEnv?.(own, { heldSkills: [] }), {})
    assert.deepStrictEqual(agents.opencode.sessionEnv?.(own, {}), {})
  })

  it('holds them as a review’s lead too, beside what keeps the repository’s own config out', () => {
    const reviewing = { ...own, ...agents.opencode.reviewing?.env?.(own) }
    const config = configOf(reviewing, { heldSkills: held })
    assert.strictEqual(config.lsp, false)
    assert.deepStrictEqual(config.permission.skill, { impeccable: 'deny', 'write-docs': 'deny' })
  })
})
