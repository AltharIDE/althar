import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  checkSetup,
  type Converse,
  frontOf,
  matcherProblem,
  parseClaudeAnswers,
  parseCodexAnswers,
  pluginProblem,
  readSetup,
  type SetupIo,
  setupParts,
} from '../src/setupHealth'

/*
 * Whether each part of the person's own setup loads: frontmatter read as Claude Code 2.1.326 reads it, hook matchers
 * against its tools, a plugin's manifest, Codex's config.toml and skills; and what Claude Code's `initialize` and
 * `get_settings` and Codex's app-server say, as they print it, kept and standing only while a file is as it was.
 */

const BEFORE = new Date('2026-11-08T08:00:00.000Z')
const ASKED = '2026-11-08T09:00:00.000Z'
const NOW = '2026-11-08T10:00:00.000Z'

/** A home of the test's own, every file written before the agents were asked. */
const homeWith = (files: Readonly<Record<string, string>>) => {
  const homeDir = mkdtempSync(join(tmpdir(), 'althar-setup-home-'))
  for (const [path, text] of Object.entries(files)) {
    const at = join(homeDir, path)
    mkdirSync(dirname(at), { recursive: true })
    writeFileSync(at, text)
    utimesSync(at, BEFORE, BEFORE)
  }
  const io: SetupIo = { homeDir, env: {}, folder: join(homeDir, 'althar'), now: () => NOW }
  return io
}

const keep = (io: SetupIo, record: unknown) => {
  mkdirSync(io.folder, { recursive: true })
  writeFileSync(join(io.folder, 'setup-health.json'), JSON.stringify(record))
}

const agent = (name: string, description = 'Reviews a change.') => `---\nname: ${name}\ndescription: ${description}\n---\nBody.\n`

describe('frontmatter as Claude Code reads it', () => {
  it('reads YAML, then each value as it is written, and says where there is none', () => {
    expect(frontOf('---\nname: a\ndescription: fine\n---\nb')).toEqual({ kind: 'read', data: { name: 'a', description: 'fine' } })
    // Claude Code 2.1.326 loads this agent with the description `[unclosed`.
    expect(frontOf('---\nname: a\ndescription: [unclosed\n---\nb')).toEqual({ kind: 'read', data: { name: 'a', description: '[unclosed' } })
    expect(frontOf('---\nname: a\n\tdescription: x\n---\nb')).toEqual({ kind: 'unreadable' })
    expect(frontOf('Just a body.')).toEqual({ kind: 'none' })
    expect(frontOf('---\nname: a\nnever closed')).toEqual({ kind: 'none' })
    expect(frontOf('---\n---\nb')).toEqual({ kind: 'read', data: {} })
  })
})

describe('a hook matcher', () => {
  it('that names a slip of one of Claude Code’s tools never matches', () => {
    expect(matcherProblem('Bashh')).toBe('Its matcher “Bashh” matches no tool, so it never runs. Claude Code calls it “Bash”.')
    expect(matcherProblem('Edit|write')).toBe('Its matcher “write” matches no tool, so it never runs. Claude Code calls it “Write”.')
    expect(matcherProblem('(unclosed')).toBe('Its matcher “(unclosed” can’t be read as a pattern, so it never runs.')
  })

  it('that matches every tool, a tool it has, a server’s, a pattern, or one Althar doesn’t know, is left alone', () => {
    for (const matcher of ['', '*', 'Bash', 'Edit|Write', 'Task', 'mcp__github__create_issue', 'Notebook.*', 'mcp__.*', 'MyOwnTool'])
      expect(matcherProblem(matcher)).toBeUndefined()
  })
})

describe('a plugin’s manifest', () => {
  it('that keeps the plugin from loading, or a field from counting', () => {
    expect(pluginProblem('{ nope')).toBe('Its plugin.json isn’t valid JSON, so Claude Code doesn’t load the plugin.')
    expect(pluginProblem('{"version":"1.0.0"}')).toBe('Its plugin.json gives no name, so Claude Code doesn’t load the plugin.')
    expect(pluginProblem('{"name":"p","version":1}')).toBe('Its plugin.json’s “version” isn’t text, so Claude Code ignores it.')
    expect(pluginProblem('{"name":"p","keywords":["a",2]}')).toBe(
      'Its plugin.json’s “keywords” isn’t a list of words, so Claude Code ignores it.',
    )
    expect(pluginProblem('{"name":"p","version":"1","repository":{"url":"x"},"keywords":["a"]}')).toBeUndefined()
  })
})

describe('what the agents say', () => {
  it('Claude Code: the agents it loaded and the settings files it skipped', () => {
    const printed = [
      '{"type":"system","subtype":"session_state_changed","state":"running"}',
      JSON.stringify({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: 'althar-initialize',
          response: { agents: [{ name: 'good' }, { name: 'Explore' }], commands: [] },
        },
      }),
      JSON.stringify({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: 'althar-settings',
          response: {
            effective: {},
            errors: [
              {
                file: '/h/.claude/settings.json',
                path: 'permissions.defaultMode',
                message: 'Invalid value. Expected one of: "default", "plan"',
              },
            ],
          },
        },
      }),
    ].join('\n')
    expect(parseClaudeAnswers(printed)).toEqual({
      agents: ['good', 'Explore'],
      errors: [
        { file: '/h/.claude/settings.json', path: 'permissions.defaultMode', message: 'Invalid value. Expected one of: "default", "plan"' },
      ],
    })
    expect(parseClaudeAnswers('Invalid API key')).toBeUndefined()
  })

  it('Codex: what it warns of a settings file, and each skill it couldn’t load', () => {
    const printed = [
      'WARNING: proceeding, even though we could not create PATH aliases',
      '{"id":1,"result":{"codexHome":"/h/.codex"}}',
      '{"method":"configWarning","params":{"summary":"Invalid configuration; using defaults.","details":"/h/.codex/config.toml:2:10: unclosed table, expected `]`","path":"/h/.codex/config.toml"}}',
      '{"method":"configWarning","params":{"summary":"Codex\'s Linux sandbox uses bubblewrap and needs access to create user namespaces.","details":null}}',
      '{"id":2,"result":{"data":[{"cwd":"/tmp/x","skills":[],"errors":[{"path":"/h/.agents/skills/bad/SKILL.md","message":"missing field `description`"}]}]}}',
    ].join('\n')
    expect(parseCodexAnswers(printed, { homeDir: '/h' })).toEqual({
      config: [
        {
          path: '/h/.codex/config.toml',
          words: 'Invalid configuration; using defaults. ~/.codex/config.toml:2:10: unclosed table, expected `]`',
        },
      ],
      skills: [{ path: '/h/.agents/skills/bad/SKILL.md', message: 'missing field `description`' }],
    })
    expect(parseCodexAnswers('error: unexpected argument', { homeDir: '/h' })).toBeUndefined()
    // Its config.toml unreadable, it lists no skill at all: an error for the folder, which says nothing of each skill.
    expect(
      parseCodexAnswers(
        '{"id":1,"result":{}}\n{"id":2,"result":{"data":[{"cwd":"/tmp/x","skills":[],"errors":[{"path":"/tmp/x","message":"failed to reload config"}]}]}}',
        { homeDir: '/h' },
      ),
    ).toEqual({ config: [] })
  })
})

describe('the parts of the person’s setup that don’t load', () => {
  it('by Althar’s own reading, before any agent is asked: one part each broken file', () => {
    const io = homeWith({
      '.claude/settings.json': JSON.stringify({
        hooks: { PreToolUse: [{ matcher: 'Bashh', hooks: [{ type: 'command', command: 'true' }] }] },
        enabledPlugins: { 'fine@market': true, 'off@market': false },
      }),
      '.claude/agents/review-agent.md': '---\nname: review-agent\n\tdescription: x\n---\nb',
      '.claude/agents/nodesc.md': '---\nname: nodesc\n---\nb',
      '.claude/agents/good.md': agent('good', '[lenient'),
      '.claude/commands/ok.md': 'Just a prompt.',
      '.claude/commands/deep/broken.md': '---\ndescription: x\n\tallowed-tools: y\n---\nb',
      '.claude/output-styles/fine.md': '---\nname: fine\ndescription: x\n---\nb',
      '.claude/skills/fine/SKILL.md': agent('fine'),
      '.codex/config.toml': 'model = "x"\n[features\n',
      '.agents/skills/half/SKILL.md': '---\nname: half\n---\nb',
      '.agents/skills/whole/SKILL.md': agent('whole'),
      'plugin/.claude-plugin/plugin.json': '{"name":"fine","version":2}',
    })
    // Installed where the home is; the one that's off isn't read.
    mkdirSync(join(io.homeDir, '.claude/plugins'), { recursive: true })
    writeFileSync(
      join(io.homeDir, '.claude/plugins/installed_plugins.json'),
      JSON.stringify({
        version: 2,
        plugins: {
          'fine@market': [{ installPath: join(io.homeDir, 'plugin') }],
          'off@market': [{ installPath: join(io.homeDir, 'plugin') }],
        },
      }),
    )
    const parts = setupParts(io).map(({ at: _at, ...part }) => part)
    expect(parts).toEqual([
      {
        agent: 'claude',
        kind: 'hook',
        name: 'hooks.PreToolUse',
        where: '~/.claude/settings.json',
        why: 'Its matcher “Bashh” matches no tool, so it never runs. Claude Code calls it “Bash”.',
        by: null,
      },
      expect.objectContaining({
        kind: 'agent',
        name: 'nodesc.md',
        why: 'Its frontmatter gives no description, so Claude Code leaves it out.',
      }),
      {
        agent: 'claude',
        kind: 'agent',
        name: 'review-agent.md',
        where: '~/.claude/agents/review-agent.md',
        why: 'Its frontmatter can’t be read, so Claude Code leaves it out.',
        by: null,
      },
      expect.objectContaining({ kind: 'command', name: 'broken.md', where: '~/.claude/commands/deep/broken.md' }),
      expect.objectContaining({ kind: 'plugin', name: 'fine', why: 'Its plugin.json’s “version” isn’t text, so Claude Code ignores it.' }),
      expect.objectContaining({ agent: 'codex', kind: 'config', name: 'config.toml', where: '~/.codex/config.toml', by: null }),
      {
        agent: 'codex',
        kind: 'skill',
        name: 'half',
        where: '~/.agents/skills/half/SKILL.md',
        why: 'Its frontmatter gives no description, so Codex leaves it out.',
        by: null,
      },
    ])
    expect(parts.find((part) => part.kind === 'config')?.why).toMatch(/^Codex can’t read it, so it uses its defaults: /)
  })

  it('a settings file that isn’t JSON is one part, and nothing in it is read further', () => {
    const io = homeWith({ '.claude/settings.json': '{ "hooks": ' })
    expect(setupParts(io).map((part) => [part.kind, part.why])).toEqual([
      ['settings', 'It isn’t valid JSON, so Claude Code skips the whole file.'],
    ])
  })

  it('by what the agents said, while each file is as it was when they said it', () => {
    const io = homeWith({
      '.claude/settings.json': JSON.stringify({ permissions: { defaultMode: 'weird' } }),
      '.claude/agents/good.md': agent('good'),
      '.claude/agents/shadowed.md': agent('shadowed'),
      '.claude/agents/odd.md': '---\nname: odd\n---\nb',
      '.codex/config.toml': 'model = 3\n',
      '.agents/skills/bad/SKILL.md': agent('bad'),
    })
    keep(io, {
      checkedAt: ASKED,
      claude: {
        at: ASKED,
        // `odd` has no description, but Claude Code said it loaded it: its word stands.
        agents: ['good', 'odd', 'Explore'],
        errors: [
          {
            file: join(io.homeDir, '.claude/settings.json'),
            path: 'permissions.defaultMode',
            message: 'Invalid value. Expected one of: "default", "plan"',
          },
        ],
      },
      codex: {
        at: ASKED,
        config: [
          { path: join(io.homeDir, '.codex/config.toml'), words: 'Invalid configuration; using defaults. model: expected a string' },
        ],
        skills: [{ path: join(io.homeDir, '.agents/skills/bad/SKILL.md'), message: 'invalid YAML' }],
      },
    })
    expect(setupParts(io).map(({ kind, name, why, by }) => ({ kind, name, why, by }))).toEqual([
      {
        kind: 'settings',
        name: 'settings.json',
        why: 'Claude Code skips the whole file: permissions.defaultMode: Invalid value. Expected one of: "default", "plan"',
        by: 'claude',
      },
      { kind: 'agent', name: 'shadowed.md', why: 'Claude Code leaves it out.', by: 'claude' },
      { kind: 'config', name: 'config.toml', why: 'Invalid configuration; using defaults. model: expected a string', by: 'codex' },
      { kind: 'skill', name: 'bad', why: 'Codex leaves it out: invalid YAML', by: 'codex' },
    ])

    // The person fixes their files: what the agents said of them no longer stands, and Althar reads them itself.
    for (const [path, text] of [
      ['.claude/settings.json', '{}'],
      ['.codex/config.toml', 'model = "gpt"\n'],
      ['.agents/skills/bad/SKILL.md', agent('bad')],
      ['.claude/agents/shadowed.md', agent('shadowed')],
    ] as const)
      writeFileSync(join(io.homeDir, path), text)
    expect(setupParts(io)).toEqual([])
  })

  it('what an agent said a day ago no longer stands', () => {
    const io = homeWith({ '.claude/agents/shadowed.md': agent('shadowed') })
    keep(io, { checkedAt: '2026-11-06T09:00:00.000Z', claude: { at: '2026-11-06T09:00:00.000Z', agents: [] } })
    expect(setupParts(io)).toEqual([])
  })

  it('a damaged record is none at all', () => {
    const io = homeWith({})
    keep(io, 'not a record')
    expect(readSetup(io)).toEqual({ checkedAt: null })
  })
})

describe('asking the agents', () => {
  const claudePrinted = [
    JSON.stringify({
      type: 'control_response',
      response: { subtype: 'success', request_id: 'althar-initialize', response: { agents: [{ name: 'a' }] } },
    }),
    JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: 'althar-settings', response: { errors: [] } } }),
  ].join('\n')
  const codexPrinted = ['{"id":1,"result":{}}', '{"id":2,"result":{"data":[{"errors":[]}]}}'].join('\n')

  it('asks Claude Code what it loads without a turn, a hook or a server, and Codex its skills, and keeps what they said', async () => {
    const io = homeWith({})
    const asked: Array<{ command: string; args: ReadonlyArray<string>; lines: ReadonlyArray<string> }> = []
    const converse: Converse = async (command, args, lines, done) => {
      asked.push({ command, args, lines: lines('/tmp/empty') })
      const printed = command === 'claude' ? claudePrinted : codexPrinted
      expect(done(printed)).toBe(true)
      return printed
    }
    const kept = await checkSetup(io, converse)
    expect(kept).toEqual({ checkedAt: NOW, claude: { at: NOW, agents: ['a'], errors: [] }, codex: { at: NOW, config: [], skills: [] } })
    expect(readSetup(io)).toEqual(kept)
    const claude = asked.find((one) => one.command === 'claude')!
    expect(claude.args).toEqual(expect.arrayContaining(['-p', '--strict-mcp-config', '--settings', '{"disableAllHooks":true}']))
    expect(claude.lines.map((line) => JSON.parse(line).request.subtype)).toEqual(['initialize', 'get_settings'])
    const codex = asked.find((one) => one.command === 'codex')!
    expect(codex.args).toEqual(['app-server'])
    expect(JSON.parse(codex.lines[2]!)).toMatchObject({ method: 'skills/list', params: { cwds: ['/tmp/empty'] } })
  })

  it('an agent that isn’t on this computer, or says nothing it can read, keeps what it last said', async () => {
    const io = homeWith({})
    keep(io, { checkedAt: ASKED, claude: { at: ASKED, agents: ['kept'] }, codex: { at: ASKED, config: [] } })
    const converse: Converse = async (command) => (command === 'codex' ? 'error: no such command' : undefined)
    const kept = await checkSetup(io, converse)
    expect(kept).toEqual({ checkedAt: NOW, claude: { at: ASKED, agents: ['kept'] }, codex: { at: ASKED, config: [] } })
  })
})
