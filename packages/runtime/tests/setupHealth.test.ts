import { chmodSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ASK_EVERY,
  checkSetup,
  codexCommand,
  type Converse,
  frontOf,
  matcherProblem,
  parseClaudeAnswers,
  parseCodexAnswers,
  pluginProblem,
  readSetup,
  scanSetup,
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
  it('that names only slips of Claude Code’s tools never matches', () => {
    expect(matcherProblem('Bashh')).toEqual({
      why: 'Its matcher “Bashh” matches no tool, so it never runs. Claude Code calls it “Bash”.',
      runs: false,
    })
    expect(matcherProblem('bash|wrte')).toEqual({
      why: 'Its matcher “bash|wrte” matches no tool, so it never runs. Claude Code calls them “Bash” and “Write”.',
      runs: false,
    })
    expect(matcherProblem('(unclosed')).toEqual({
      why: 'Its matcher “(unclosed” can’t be read as a pattern, so it never runs.',
      runs: false,
    })
  })

  it('read as a whole: one that also names a tool it has still runs for that one', () => {
    expect(matcherProblem('Edit|write')).toEqual({
      why: '“write” in its matcher “Edit|write” matches no tool: Claude Code calls it “Write”. It still runs for the rest.',
      runs: true,
    })
    // A name Althar doesn't know may be a tool it hasn't heard of: the hook may run for it.
    expect(matcherProblem('MyOwnTool|Bashh')?.runs).toBe(true)
  })

  it('that matches every tool, a tool it has, a server’s, a pattern, or one Althar doesn’t know, is left alone', () => {
    for (const matcher of ['', '*', 'Bash', 'Edit|Write', 'Task', 'mcp__github__create_issue', 'Notebook.*', 'mcp__.*', 'MyOwnTool'])
      expect(matcherProblem(matcher)).toBeUndefined()
  })
})

describe('a plugin’s manifest, as Claude Code 2.1.326 reads it', () => {
  it('that keeps the plugin from loading', () => {
    const refused = (text: string) => {
      const problem = pluginProblem(text)
      expect(problem?.loads).toBe(false)
      return problem?.why
    }
    expect(refused('{ nope')).toBe('Its plugin.json isn’t valid JSON, so Claude Code doesn’t load the plugin.')
    expect(refused('{"version":"1.0.0"}')).toBe('Its plugin.json gives no name, so Claude Code doesn’t load the plugin.')
    expect(refused('{"name":"my plugin"}')).toBe(
      'Its plugin.json’s name “my plugin” has a space in it, so Claude Code doesn’t load the plugin.',
    )
    // `version` isn't one of the fields it drops: of the wrong kind, the whole manifest fails.
    expect(refused('{"name":"p","version":1}')).toBe('Its plugin.json’s “version” isn’t text, so Claude Code doesn’t load the plugin.')
    expect(refused('{"name":"p","defaultEnabled":"yes"}')).toBe(
      'Its plugin.json’s “defaultEnabled” isn’t true or false, so Claude Code doesn’t load the plugin.',
    )
  })

  it('whose fields it drops, loading the plugin without them', () => {
    const ignored = (text: string) => {
      const problem = pluginProblem(text)
      expect(problem?.loads).toBe(true)
      return problem?.why
    }
    expect(ignored('{"name":"p","keywords":"a, b"}')).toBe(
      '“keywords” in its plugin.json is malformed, so Claude Code ignores it. The plugin still loads.',
    )
    for (const keywords of ['["a",2]', '3', '{"a":1}', 'null'])
      expect(ignored(`{"name":"p","keywords":${keywords}}`)).toMatch(/^“keywords” in its plugin.json is malformed/)
    expect(ignored('{"name":"p","description":{"en":"x"},"homepage":"not a link","author":"me"}')).toBe(
      '“description”, “author” and “homepage” in its plugin.json are malformed, so Claude Code ignores them. The plugin still loads.',
    )
    expect(ignored('{"name":"p","engines":{"claude-code":2}}')).toBe(
      'Its plugin.json’s Claude Code range (“engines”) isn’t text, so Claude Code ignores it. The plugin still loads.',
    )
    expect(ignored('{"name":"p","engines":">=2.1"}')).toBe(
      'Its plugin.json’s “engines” isn’t an object, so Claude Code ignores it. The plugin still loads.',
    )
  })

  it('that it reads whole', () => {
    expect(
      pluginProblem(
        '{"name":"p","version":"1","description":"d","author":{"name":"A","email":"a@b.c"},"homepage":"https://x.dev","repository":"https://github.com/a/b","license":"MIT","keywords":["a"],"engines":{"claude-code":">=2.1.0","other":3}}',
      ),
    ).toBeUndefined()
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
  it('by Althar’s own reading, before any agent is asked: one part each broken file', async () => {
    const io = homeWith({
      '.claude/settings.json': JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: 'Bashh', hooks: [{ type: 'command', command: 'true' }] },
            { matcher: 'Edit', hooks: [{ type: 'command', command: 'true' }] },
            { matcher: 'Edit|wrte', hooks: [{ type: 'command', command: 'true' }] },
          ],
        },
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
    const parts = (await scanSetup(io)).map(({ at: _at, file: _file, ...part }) => part)
    expect(parts).toEqual([
      // Each broken matcher of the event, a row of its own, by where it is.
      {
        agent: 'claude',
        kind: 'hook',
        name: 'hooks.PreToolUse[0]',
        where: '~/.claude/settings.json',
        why: 'Its matcher “Bashh” matches no tool, so it never runs. Claude Code calls it “Bash”.',
        loads: false,
        by: null,
      },
      {
        agent: 'claude',
        kind: 'hook',
        name: 'hooks.PreToolUse[2]',
        where: '~/.claude/settings.json',
        why: '“wrte” in its matcher “Edit|wrte” matches no tool: Claude Code calls it “Write”. It still runs for the rest.',
        loads: true,
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
        loads: false,
        by: null,
      },
      expect.objectContaining({ kind: 'command', name: 'broken.md', where: '~/.claude/commands/deep/broken.md', loads: true }),
      expect.objectContaining({
        kind: 'plugin',
        name: 'fine',
        why: 'Its plugin.json’s “version” isn’t text, so Claude Code doesn’t load the plugin.',
        loads: false,
      }),
      expect.objectContaining({ agent: 'codex', kind: 'config', name: 'config.toml', where: '~/.codex/config.toml', by: null }),
      {
        agent: 'codex',
        kind: 'skill',
        name: 'half',
        where: '~/.agents/skills/half/SKILL.md',
        why: 'Its frontmatter gives no description, so Codex leaves it out.',
        loads: false,
        by: null,
      },
    ])
    expect(parts.find((part) => part.kind === 'config')?.why).toMatch(/^Codex can’t read it, so it uses its defaults: /)
  })

  it('a settings file that isn’t JSON is one part, and nothing in it is read further', async () => {
    const io = homeWith({ '.claude/settings.json': '{ "hooks": ' })
    expect((await scanSetup(io)).map((part) => [part.kind, part.why])).toEqual([
      ['settings', 'It isn’t valid JSON, so Claude Code skips the whole file.'],
    ])
  })

  it('by what the agents said, while each file is as it was when they said it', async () => {
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
    expect((await scanSetup(io)).map(({ kind, name, why, by }) => ({ kind, name, why, by }))).toEqual([
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
    expect(await scanSetup(io)).toEqual([])
  })

  it('what an agent said a day ago no longer stands', async () => {
    const io = homeWith({ '.claude/agents/shadowed.md': agent('shadowed') })
    keep(io, { checkedAt: '2026-11-06T09:00:00.000Z', claude: { at: '2026-11-06T09:00:00.000Z', agents: [] } })
    expect(await scanSetup(io)).toEqual([])
  })

  it('many broken matchers of one event are each said whole, however many', async () => {
    const tools = ['Bashh', 'Wrtie', 'Glbo', 'Grpe', 'Edti', 'Raed', 'WebFecth', 'WebSaerch', 'NotebookEditt']
    const io = homeWith({
      '.claude/settings.json': JSON.stringify({
        hooks: { PreToolUse: tools.map((matcher) => ({ matcher, hooks: [{ type: 'command', command: 'true' }] })) },
      }),
    })
    const parts = await scanSetup(io)
    expect(parts.map((part) => part.name)).toEqual(tools.map((_, index) => `hooks.PreToolUse[${index}]`))
    expect(parts.at(-1)?.why).toBe('Its matcher “NotebookEditt” matches no tool, so it never runs. Claude Code calls it “NotebookEdit”.')
  })

  it('reads only so much of a file, and says nothing of what it can’t tell from that', async () => {
    const long = 'x'.repeat(70 * 1024)
    const io = homeWith({
      // Its frontmatter goes on past what is read: not judged.
      '.claude/agents/long.md': `---\nname: long\ndescription: ${long}\n---\nb`,
      // Its frontmatter closes within it: judged, however long its body.
      '.claude/agents/short.md': `---\nname: short\n---\n${long}`,
      // Too long to parse here: neither it nor its hooks are judged.
      '.claude/settings.json': JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bashh', hooks: [] }] }, pad: 'x'.repeat(600 * 1024) }),
    })
    expect((await scanSetup(io)).map((part) => part.name)).toEqual(['short.md'])
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'a file made unreadable after a clean answer says so, though its time is as it was',
    async () => {
      const io = homeWith({ '.codex/config.toml': 'model = "o3"\n', '.agents/skills/fine/SKILL.md': agent('fine') })
      keep(io, { checkedAt: ASKED, codex: { at: ASKED, config: [], skills: [] } })
      expect(await scanSetup(io)).toEqual([])
      for (const path of ['.codex/config.toml', '.agents/skills/fine/SKILL.md']) {
        chmodSync(join(io.homeDir, path), 0)
        utimesSync(join(io.homeDir, path), BEFORE, BEFORE)
      }
      expect((await scanSetup(io)).map(({ kind, why, by }) => ({ kind, why, by }))).toEqual([
        { kind: 'config', why: 'It can’t be opened (permission denied), so Codex can’t read it.', by: null },
        { kind: 'skill', why: 'It can’t be opened (permission denied), so Codex can’t read it.', by: null },
      ])
    },
  )

  it('keeps what the Codex on the device said of a config.toml Althar can’t see, for as long as that ask stands', async () => {
    const io = homeWith({})
    const warned = (at: string) => ({
      checkedAt: at,
      codex: { at, config: [{ path: join(io.homeDir, '.codex/config.toml'), words: 'invalid type: integer `3`, expected a string' }] },
    })
    const lately = new Date(Date.parse(NOW) - ASK_EVERY / 2).toISOString()
    keep(io, warned(lately))
    expect((await scanSetup(io)).map(({ kind, where, why, by }) => ({ kind, where, why, by }))).toEqual([
      { kind: 'config', where: '~/.codex/config.toml', why: 'invalid type: integer `3`, expected a string', by: 'codex' },
    ])
    // Older than the last ask would be: nothing here says whether it was fixed since.
    keep(io, warned(ASKED))
    expect(await scanSetup(io)).toEqual([])
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'a file that is there but can’t be opened says so, and what an agent said of it still stands',
    async () => {
      const io = homeWith({
        '.claude/settings.json': '{}',
        '.claude/agents/locked.md': agent('locked'),
        '.codex/config.toml': 'model = 3\n',
      })
      for (const path of ['.claude/settings.json', '.claude/agents/locked.md', '.codex/config.toml']) chmodSync(join(io.homeDir, path), 0)
      expect((await scanSetup(io)).map(({ kind, why, by }) => ({ kind, why, by }))).toEqual([
        { kind: 'settings', why: 'It can’t be opened (permission denied), so Claude Code can’t read it.', by: null },
        { kind: 'agent', why: 'It can’t be opened (permission denied), so Claude Code can’t read it.', by: null },
        { kind: 'config', why: 'It can’t be opened (permission denied), so Codex can’t read it.', by: null },
      ])
      keep(io, {
        checkedAt: ASKED,
        claude: {
          at: ASKED,
          errors: [{ file: join(io.homeDir, '.claude/settings.json'), path: '', message: 'EACCES: permission denied' }],
        },
        codex: { at: ASKED, config: [{ path: join(io.homeDir, '.codex/config.toml'), words: 'Codex couldn’t read it.' }] },
      })
      expect((await scanSetup(io)).filter((part) => part.by !== null).map(({ kind, why }) => [kind, why])).toEqual([
        ['settings', 'Claude Code skips the whole file: EACCES: permission denied'],
        ['config', 'Codex couldn’t read it.'],
      ])
    },
  )

  it('a damaged record is none at all', () => {
    const io = homeWith({})
    keep(io, 'not a record')
    expect(readSetup(io)).toEqual({ checkedAt: null })
  })
})

describe('what the agents say, as it comes', () => {
  it('waits for each answer whole: an id in the first piece is never taken for the answer', () => {
    const answer =
      '{"id":2,"result":{"data":[{"errors":[{"path":"/h/.agents/skills/bad/SKILL.md","message":"missing field `description`"}]}]}}'
    const first = `{"id":1,"result":{}}\n${answer.slice(0, 20)}`
    // A Codex that stopped there said nothing that is kept.
    expect(parseCodexAnswers(first, { homeDir: '/h' })).toBeUndefined()
    expect(parseCodexAnswers(`${first}${answer.slice(20)}\n`, { homeDir: '/h' })?.skills).toEqual([
      { path: '/h/.agents/skills/bad/SKILL.md', message: 'missing field `description`' },
    ])
    const settings = JSON.stringify({
      type: 'control_response',
      response: { subtype: 'success', request_id: 'althar-settings', response: { errors: [] } },
    })
    const started = JSON.stringify({
      type: 'control_response',
      response: { subtype: 'success', request_id: 'althar-initialize', response: { agents: [] } },
    })
    expect(parseClaudeAnswers(`${started}\n${settings.slice(0, 60)}`)).toBeUndefined()
    expect(parseClaudeAnswers(`${started}\n${settings}`)).toEqual({ agents: [], errors: [] })
  })

  it('asks the Codex on the device in a Flatpak, by the bridge its sessions run it by', () => {
    expect(codexCommand({})).toBe('codex')
    // Outside a Flatpak a person's own CODEX_PATH never changes which Codex is asked.
    expect(codexCommand({ CODEX_PATH: '/x/codex' })).toBe('codex')
    expect(codexCommand({ FLATPAK_ID: 'dev.althar.app', CODEX_PATH: '/app/bin/althar-host-codex' })).toBe('/app/bin/althar-host-codex')
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
    expect(kept).toEqual({
      checkedAt: NOW,
      claude: { at: NOW, agents: ['a'], errors: [] },
      codex: { at: NOW, config: [], skills: [] },
      parts: [],
    })
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
    expect(kept).toEqual({ checkedAt: NOW, claude: { at: ASKED, agents: ['kept'] }, codex: { at: ASKED, config: [] }, parts: [] })
  })

  it('asks the agents at most every few minutes, and reads the files each time, keeping what it found for Settings', async () => {
    const io = homeWith({ '.claude/agents/nodesc.md': '---\nname: nodesc\n---\nb' })
    const lately = new Date(Date.parse(NOW) - ASK_EVERY / 2).toISOString()
    keep(io, { checkedAt: lately, claude: { at: lately, agents: [] } })
    let asked = 0
    const converse: Converse = async () => {
      asked += 1
      return undefined
    }
    const first = await checkSetup(io, converse)
    expect(asked).toBe(0)
    expect(first.parts?.map((part) => part.name)).toEqual(['nodesc.md'])
    // Settings reads what was found, without reading the files again.
    expect(setupParts(io).map((part) => part.name)).toEqual(['nodesc.md'])
    writeFileSync(join(io.homeDir, '.claude/agents/nodesc.md'), agent('nodesc'))
    expect(setupParts(io).map((part) => part.name)).toEqual(['nodesc.md'])
    expect((await checkSetup(io, converse)).parts).toEqual([])
    expect(setupParts(io)).toEqual([])
    expect(asked).toBe(0)

    // Its last ask a while ago, both are asked (Claude Code's own, then the copy Althar's sessions run on).
    keep(io, { checkedAt: ASKED })
    await checkSetup(io, converse)
    expect(asked).toBeGreaterThanOrEqual(2)
  })
})
