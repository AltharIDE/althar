import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import {
  commandPattern,
  type Found,
  fromClaude,
  fromCodex,
  fromOpenCode,
  type KeptCommand,
  offerOf,
  plainJson,
  readAgentRules,
  type RuleSource,
  withImported,
} from '../src/agentRules'

/*
 * The agents' own permission settings as the first draft of a project's
 * rules (DEV-41): each agent's files read, each rule said as the project's
 * or skipped with why, weighed against what the project has, and the
 * chosen ones kept with where they came from.
 */

const claude: RuleSource = { agent: 'claude', file: '.claude/settings.json' }
const codex: RuleSource = { agent: 'codex', file: '~/.codex/rules/default.rules' }
const opencode: RuleSource = { agent: 'opencode', file: 'opencode.json' }

/** What each rule becomes, in a line: the decision and the command, or why it's skipped. */
const said = (found: ReadonlyArray<Found> | null) =>
  (found ?? []).map((each) =>
    'skip' in each.becomes
      ? `${each.said} → skipped: ${each.becomes.skip}`
      : `${each.said} → ${each.decision} ${each.becomes.match === 'exact' ? 'exactly ' : ''}${each.becomes.pattern}`,
  )

describe('a command pattern, as Althar’s rules say it', () => {
  it('keeps a line without a wildcard whole, and reads one ending in a wildcard as how a command starts', () => {
    assert.deepStrictEqual(commandPattern('npm run build', 'allow', 'claude'), { pattern: 'npm run build', match: 'exact' })
    assert.deepStrictEqual(commandPattern('npm test:*', 'allow', 'claude'), { pattern: 'npm test', match: 'prefix' })
    assert.deepStrictEqual(commandPattern('npm  test *', 'allow', 'claude'), { pattern: 'npm test', match: 'prefix' })
    assert.deepStrictEqual(commandPattern('git push *', 'never', 'opencode'), { pattern: 'git push', match: 'prefix' })
    // No space: `lsof` starts with `ls` too, as Althar's `ls*` says.
    assert.deepStrictEqual(commandPattern('ls*', 'allow', 'claude'), { pattern: 'ls*', match: 'prefix' })
    // OpenCode has no `:*`: a colon is a colon.
    assert.deepStrictEqual(commandPattern('npm test:*', 'allow', 'opencode'), { pattern: 'npm test:*', match: 'prefix' })
  })

  it('keeps a wildcard before the end for a never or an ask, and skips it for an allow, which would let more through', () => {
    assert.deepStrictEqual(commandPattern('git * main', 'never', 'claude'), { pattern: 'git * main', match: 'prefix' })
    assert.deepStrictEqual(commandPattern('git * main *', 'ask', 'claude'), { pattern: 'git * main', match: 'prefix' })
    assert.deepStrictEqual(commandPattern('git * main', 'allow', 'claude'), { skip: 'wildcard' })
    assert.deepStrictEqual(commandPattern('* --version', 'never', 'claude'), { skip: 'wildcard' })
    assert.deepStrictEqual(commandPattern('git push ?', 'never', 'opencode'), { skip: 'wildcard' })
    assert.deepStrictEqual(commandPattern('*', 'ask', 'opencode'), { skip: 'every-command' })
    assert.deepStrictEqual(commandPattern(' ', 'ask', 'claude'), { skip: 'every-command' })
    assert.deepStrictEqual(commandPattern(':*', 'ask', 'claude'), { skip: 'every-command' })
  })
})

describe('Claude Code’s settings', () => {
  it('reads deny, ask and allow, in that order, as never, ask and allow', () => {
    const text = JSON.stringify({
      permissions: {
        allow: ['Bash(npm test:*)', 'Bash(git status)'],
        deny: ['Bash(rm -rf:*)'],
        ask: ['Bash(git push *)'],
        defaultMode: 'acceptEdits',
      },
      env: { FOO: '1' },
    })
    assert.deepStrictEqual(said(fromClaude(text, claude)), [
      'Bash(rm -rf:*) → never rm -rf',
      'Bash(git push *) → ask git push',
      'Bash(npm test:*) → allow npm test',
      'Bash(git status) → allow exactly git status',
    ])
    assert.deepStrictEqual(fromClaude(text, claude)?.[0]?.from, claude)
  })

  it('skips what isn’t a command, with why', () => {
    const text = JSON.stringify({
      permissions: {
        deny: ['Read(./.env)', 'Edit(/secrets/**)', 'WebFetch(domain:example.com)', 'WebSearch', 'mcp__github__create_issue', 'Bash', '*'],
        ask: ['Bash(run_in_background:true)', 'Task(Explore)', 'Bash(*)'],
        allow: [42, '', 'Bash(* --version)'],
      },
    })
    assert.deepStrictEqual(said(fromClaude(text, claude)), [
      'Read(./.env) → skipped: paths',
      'Edit(/secrets/**) → skipped: paths',
      'WebFetch(domain:example.com) → skipped: network',
      'WebSearch → skipped: network',
      'mcp__github__create_issue → skipped: mcp',
      'Bash → skipped: every-command',
      '* → skipped: every-command',
      'Bash(run_in_background:true) → skipped: tool',
      'Task(Explore) → skipped: tool',
      'Bash(*) → skipped: every-command',
      'Bash(* --version) → skipped: wildcard',
    ])
  })

  it('reads a file without permissions as none, and one that isn’t its settings as unreadable', () => {
    assert.deepStrictEqual(fromClaude('{"model":"opus"}', claude), [])
    assert.isNull(fromClaude('{"permissions": ', claude))
    assert.isNull(fromClaude('{"permissions": {"allow": "Bash"}}', claude))
    assert.isNull(fromClaude('[]', claude))
  })
})

describe('OpenCode’s config', () => {
  it('reads its bash patterns as commands, and says the rest is skipped', () => {
    const text = `{
      // Comments and trailing commas, as OpenCode reads its config.
      "$schema": "https://opencode.ai/config.json",
      "permission": {
        "*": "ask",
        "edit": "deny",
        "webfetch": "allow",
        "doom_loop": "ask",
        "bash": {
          "*": "ask",
          "git status": "allow",
          "npm test *": "allow",
          "rm -rf *": "deny", /* gone for good */
          "git push ?": "deny",
          "terraform *": "maybe",
        },
        "read": { "*.env": "deny" },
      },
      "agent": { "plan": { "permission": { "bash": { "git *": "deny" } } }, "build": "nonsense" },
    }`
    assert.deepStrictEqual(said(fromOpenCode(text, opencode)), [
      '*: "ask" → skipped: every-command',
      'edit: "deny" → skipped: paths',
      'webfetch: "allow" → skipped: network',
      'doom_loop: "ask" → skipped: tool',
      'bash: "*": "ask" → skipped: every-command',
      'bash: "git status": "allow" → allow exactly git status',
      'bash: "npm test *": "allow" → allow npm test',
      'bash: "rm -rf *": "deny" → never rm -rf',
      'bash: "git push ?": "deny" → skipped: wildcard',
      'read: "*.env": "deny" → skipped: paths',
      'agent.plan: bash: "git *": "deny" → skipped: one-agent',
    ])
  })

  it('reads every permission at once as everything, and a config it can’t read as unreadable', () => {
    assert.deepStrictEqual(said(fromOpenCode('{"permission": "allow"}', opencode)), ['permission: "allow" → skipped: every-command'])
    assert.deepStrictEqual(said(fromOpenCode('{"bash": "allow"}', opencode)), [])
    assert.deepStrictEqual(said(fromOpenCode('{"permission": "everything"}', opencode)), [])
    assert.deepStrictEqual(said(fromOpenCode('{"permission": 3}', opencode)), [])
    assert.isNull(fromOpenCode('{"permission": {', opencode))
    assert.isNull(fromOpenCode('"allow"', opencode))
  })

  it('keeps what is in strings as it is, comment marks and all', () => {
    assert.strictEqual(plainJson('{"a": "http://x/*y*/", // no\n "b": [1, 2,],}'), '{"a": "http://x/*y*/", \n "b": [1, 2]}')
    assert.strictEqual(plainJson('{"a": "say \\"hi\\" // still"} /* open'), '{"a": "say \\"hi\\" // still"} ')
  })
})

describe('Codex’s rules', () => {
  it('reads each prefix rule as how a command starts, with forbidden as never and prompt as ask', () => {
    const text = `
# Rules Codex kept as the person answered.
prefix_rule(pattern = ["git", "push"], decision = "forbidden", justification = "Pushes go through review.")
prefix_rule(
    pattern = ["gh", "pr", ["view", "list"]],
    decision = 'prompt',
    match = ["gh pr view 7888"],
    not_match = ["gh pr create"],
)
prefix_rule(["npm", "test"])
prefix_rule(pattern = ["make", r"""lint"""], decision = "allow",)
load("helpers.star", "x")
`
    assert.deepStrictEqual(said(fromCodex(text, codex)), [
      'prefix_rule(pattern = ["git", "push"], decision = "forbidden") → never git push',
      'prefix_rule(pattern = ["gh", "pr", ["view", "list"]], decision = "prompt") → ask gh pr view',
      'prefix_rule(pattern = ["gh", "pr", ["view", "list"]], decision = "prompt") → ask gh pr list',
      'prefix_rule(pattern = ["npm", "test"]) → allow npm test',
      'prefix_rule(pattern = ["make", "lint"], decision = "allow") → allow make lint',
    ])
  })

  it('skips what it can’t say the same way, and other kinds of rule', () => {
    const text = `
prefix_rule(pattern = ["git push"], decision = "forbidden")
prefix_rule(pattern = ["rm", "*"], decision = "forbidden")
prefix_rule(pattern = ["rm"], decision = "refused")
prefix_rule(pattern = [], decision = "allow")
prefix_rule(pattern = ["a", 1 + 2], decision = "allow")
prefix_rule(pattern = ["git"] + ["push"])
prefix_rule(pattern = ["x", ["a", "b", "c", "d"], ["a", "b", "c", "d"], ["a", "b", "c", "d"], ["a", "b"]], decision = "allow")
network_rule(host = "example.com", decision = "forbidden")
custom_rule(things = {"a": (1, 2)}, decision = "prompt")
`
    assert.deepStrictEqual(said(fromCodex(text, codex)), [
      'prefix_rule(pattern = ["git push"], decision = "forbidden") → skipped: unsayable',
      'prefix_rule(pattern = ["rm", "*"], decision = "forbidden") → skipped: wildcard',
      'prefix_rule(pattern = ["rm"], decision = "refused") → skipped: unsayable',
      'prefix_rule(pattern = [], decision = "allow") → skipped: unsayable',
      'prefix_rule(pattern = ["a", …], decision = "allow") → skipped: unsayable',
      'prefix_rule(pattern = …) → skipped: unsayable',
      'prefix_rule(pattern = ["x", ["a", "b", "c", "d"], ["a", "b", "c", "d"], ["a", "b", "c", "d"], ["a", "b"]], decision = "allow") → skipped: wildcard',
      'network_rule(decision = "forbidden") → skipped: network',
      'custom_rule(decision = "prompt") → skipped: tool',
    ])
  })

  it('counts what alternatives would make before making any, so a file can’t make millions', () => {
    const many = JSON.stringify(Array.from({ length: 50 }, (_, index) => `w${index}`))
    const text = `prefix_rule(pattern = ["x", ${many}, ${many}, ${many}, ${many}, ${many}], decision = "forbidden")`
    const started = Date.now()
    const found = fromCodex(text, codex)
    assert.isBelow(Date.now() - started, 1_000)
    assert.deepStrictEqual(
      found?.map((each) => each.becomes),
      [{ skip: 'wildcard' }],
    )
  })

  it('reads strings as Python does, side by side and escaped', () => {
    assert.deepStrictEqual(said(fromCodex(`prefix_rule(pattern = ["it" 's', "\\"a\\""], decision = "prompt")`, codex)), [
      'prefix_rule(pattern = ["its", "\\"a\\""], decision = "prompt") → ask its "a"',
    ])
    assert.deepStrictEqual(said(fromCodex(`prefix_rule(pattern = ['a\\tb'])`, codex)), [
      'prefix_rule(pattern = ["a\\tb"]) → skipped: unsayable',
    ])
  })

  it('reads a file it can’t follow as unreadable', () => {
    assert.isNull(fromCodex('prefix_rule(pattern = ["git", "push"]', codex))
    assert.isNull(fromCodex('prefix_rule(pattern = ["git", "push", decision = "allow")', codex))
    assert.isNull(fromCodex('prefix_rule(pattern = ["git, "push"])', codex))
    assert.isNull(fromCodex('prefix_rule(pattern = (["git"]', codex))
    assert.isNull(fromCodex('prefix_rule(pattern = ', codex))
    assert.deepStrictEqual(fromCodex('# nothing yet\n[x for x in ("a", "b")]\nvalue = 3', codex), [])
  })
})

describe('what the project is offered', () => {
  const rule = (decision: Found['decision'], pattern: string, from: RuleSource = claude, match: 'prefix' | 'exact' = 'prefix'): Found => ({
    from,
    said: `${decision} ${pattern}`,
    decision,
    becomes: { pattern, match },
  })
  const offered = (found: ReadonlyArray<Found>, commands: ReadonlyArray<KeptCommand> = []) =>
    offerOf(found, commands).map((each) => (each.rule === undefined ? `${each.said}: ${each.skipped}` : `${each.said} (${each.from.file})`))

  it('offers each rule once, from the first file that has it', () => {
    assert.deepStrictEqual(offered([rule('never', 'rm -rf'), rule('never', 'rm -rf', codex), rule('allow', 'npm test')]), [
      'never rm -rf (.claude/settings.json)',
      'allow npm test (.claude/settings.json)',
    ])
    // The same words matched another way are another rule.
    assert.deepStrictEqual(offered([rule('allow', 'git status'), rule('allow', 'git status', opencode, 'exact')]), [
      'allow git status (.claude/settings.json)',
      'allow git status (opencode.json)',
    ])
  })

  it('offers what comes first for the same words, as each agent weighs its own', () => {
    assert.deepStrictEqual(
      offered([
        rule('allow', 'npm publish'),
        rule('ask', 'npm publish', opencode),
        rule('never', 'git push', codex),
        rule('ask', 'git push'),
      ]),
      [
        'allow npm publish: under-ask',
        'ask npm publish (opencode.json)',
        'never git push (~/.codex/rules/default.rules)',
        'ask git push: under-never',
      ],
    )
  })

  it('skips what the project has already, or has above it, and offers what outranks what it has', () => {
    const commands: ReadonlyArray<KeptCommand> = [
      { pattern: 'rm -rf', decision: 'never' },
      { pattern: 'npm publish', decision: 'ask' },
      { pattern: 'git push', decision: 'allow' },
      { pattern: 'make deploy', decision: 'never', match: 'exact' },
    ]
    assert.deepStrictEqual(
      offered(
        [
          rule('never', 'rm -rf'),
          rule('allow', 'npm publish'),
          rule('ask', 'git push'),
          rule('ask', 'make deploy', claude, 'exact'),
          rule('ask', 'make deploy'),
        ],
        commands,
      ),
      [
        'never rm -rf: already',
        'allow npm publish: under-ask',
        'ask git push (.claude/settings.json)',
        'ask make deploy: under-never',
        'ask make deploy (.claude/settings.json)',
      ],
    )
  })

  it('skips what no project can change: the code host through Althar, and credentials never read', () => {
    assert.deepStrictEqual(
      offered([
        rule('allow', 'gh pr merge'),
        rule('never', 'security find-generic-password'),
        rule('allow', 'gh pr view'),
        rule('allow', 'gh *'),
      ]),
      [
        'allow gh pr merge: fixed',
        'never security find-generic-password: fixed',
        'allow gh pr view (.claude/settings.json)',
        'allow gh * (.claude/settings.json)',
      ],
    )
  })

  it('says what was skipped as it was, with an id that is the same each time it is read', () => {
    const found: ReadonlyArray<Found> = [
      { from: claude, said: 'Read(./.env)', decision: 'never', becomes: { skip: 'paths' } },
      rule('never', 'rm -rf'),
    ]
    const [skipped, offeredRule] = offerOf(found, [])
    assert.deepInclude(skipped, { from: claude, said: 'Read(./.env)', decision: 'never', skipped: 'paths' })
    assert.deepInclude(offeredRule, { decision: 'never', rule: { pattern: 'rm -rf', match: 'prefix' } })
    assert.strictEqual(offerOf(found, [])[1]?.id, offeredRule?.id)
    assert.notStrictEqual(skipped?.id, offeredRule?.id)
    assert.match(offeredRule?.id ?? '', /^[0-9a-f]{20}$/)
  })
})

describe('the rules chosen', () => {
  const found: ReadonlyArray<Found> = [
    { from: claude, said: 'Bash(rm -rf:*)', decision: 'never', becomes: { pattern: 'rm -rf', match: 'prefix' } },
    { from: opencode, said: 'bash: "git status": "allow"', decision: 'allow', becomes: { pattern: 'git status', match: 'exact' } },
    { from: claude, said: 'Bash(npm publish *)', decision: 'ask', becomes: { pattern: 'npm publish', match: 'prefix' } },
    { from: claude, said: 'Read(./.env)', decision: 'never', becomes: { skip: 'paths' } },
  ]

  it('are kept with where they came from, in place of what they outrank, and only those chosen', () => {
    const commands: ReadonlyArray<KeptCommand> = [
      { pattern: 'npm publish', decision: 'allow' },
      { pattern: 'terraform', decision: 'ask' },
    ]
    const offer = offerOf(found, commands)
    const ids = new Set([...offer.map((each) => each.id), 'nothing-offered'])
    ids.delete(offer[1]?.id ?? '')
    assert.deepStrictEqual(withImported(commands, offer, ids), [
      { pattern: 'terraform', decision: 'ask' },
      { pattern: 'rm -rf', decision: 'never', from: claude },
      { pattern: 'npm publish', decision: 'ask', from: claude },
    ])
    assert.deepStrictEqual(withImported(commands, offer, new Set()), commands)
  })

  it('never put an allow in place of what comes first, should the project have changed since', () => {
    const offer = offerOf(found, [])
    const since: ReadonlyArray<KeptCommand> = [{ pattern: 'git status', decision: 'never', match: 'exact' }]
    assert.deepStrictEqual(withImported(since, offer, new Set([offer[1]?.id ?? ''])), since)
  })
})

describe('reading the files', () => {
  const write = (path: string, text: string) => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
  }

  it.effect('reads each repository’s, then the person’s, saying the files by where the person would find them', () =>
    Effect.gen(function* () {
      const root = mkdtempSync(join(tmpdir(), 'althar-agent-rules-'))
      const home = join(root, 'home')
      const app = join(root, 'app')
      write(join(app, '.claude/settings.json'), JSON.stringify({ permissions: { deny: ['Bash(rm -rf:*)'] } }))
      write(join(app, '.claude/settings.local.json'), JSON.stringify({ permissions: { allow: ['Bash(npm test:*)'] } }))
      write(join(app, '.codex/rules/default.rules'), 'prefix_rule(pattern = ["git", "push"], decision = "forbidden")')
      write(join(app, '.codex/rules/notes.md'), 'not rules')
      write(join(app, 'opencode.json'), '{"permission": {"bash": {"terraform *": "ask"}}}')
      write(join(app, 'opencode.jsonc'), '{ "permission": {')
      write(join(home, '.claude/settings.json'), JSON.stringify({ permissions: { ask: ['Bash(fly deploy)'] } }))
      write(join(home, '.codex/rules/default.rules'), 'prefix_rule(pattern = ["kubectl", "delete"], decision = "prompt")')
      write(join(home, '.config/opencode/opencode.json'), '{"permission": {"edit": "ask"}}')
      mkdirSync(join(home, '.config/opencode/opencode.jsonc'), { recursive: true })

      const { files, found } = yield* readAgentRules([{ name: 'app', path: app }], home)
      assert.deepStrictEqual(
        files.map((file) => `${file.from.agent} ${file.from.file}${file.readable ? '' : ' (unreadable)'}`),
        [
          'claude .claude/settings.json',
          'claude .claude/settings.local.json',
          'codex .codex/rules/default.rules',
          'opencode opencode.json',
          'opencode opencode.jsonc (unreadable)',
          'claude ~/.claude/settings.json',
          'codex ~/.codex/rules/default.rules',
          'opencode ~/.config/opencode/opencode.json',
        ],
      )
      assert.deepStrictEqual(said(found), [
        'Bash(rm -rf:*) → never rm -rf',
        'Bash(npm test:*) → allow npm test',
        'prefix_rule(pattern = ["git", "push"], decision = "forbidden") → never git push',
        'bash: "terraform *": "ask" → ask terraform',
        'Bash(fly deploy) → ask exactly fly deploy',
        'prefix_rule(pattern = ["kubectl", "delete"], decision = "prompt") → ask kubectl delete',
        'edit: "ask" → skipped: paths',
      ])
    }),
  )

  it.effect('names each repository’s files after it where the project has several, and reads nothing where there is nothing', () =>
    Effect.gen(function* () {
      const root = mkdtempSync(join(tmpdir(), 'althar-agent-rules-'))
      write(join(root, 'api/.claude/settings.json'), JSON.stringify({ permissions: { deny: ['Bash(rm -rf:*)'] } }))
      write(join(root, 'web/.claude/settings.json'), 'x'.repeat(1_000_001))
      const read = yield* readAgentRules(
        [
          { name: 'api', path: join(root, 'api') },
          { name: 'web', path: join(root, 'web') },
        ],
        join(root, 'nobody'),
      )
      assert.deepStrictEqual(read.files, [
        { from: { agent: 'claude', file: 'api/.claude/settings.json' }, readable: true },
        { from: { agent: 'claude', file: 'web/.claude/settings.json' }, readable: false },
      ])
      assert.deepStrictEqual(said(read.found), ['Bash(rm -rf:*) → never rm -rf'])
      assert.deepStrictEqual(yield* readAgentRules([], join(root, 'nobody')), { files: [], found: [] })
    }),
  )
})
