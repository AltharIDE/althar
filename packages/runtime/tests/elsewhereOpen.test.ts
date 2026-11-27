import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { lockedInodes, namesIn, openElsewhere, openWords, processesOf, toolOf } from '../src/elsewhere/open'

/*
 * Telling that Claude Code or Codex still has a conversation open (elsewhere/open.ts, DEV-264), from what each writes
 * while it does, as read from Claude Code 2.1.309 and Codex 0.167.0: the process list as each platform prints it,
 * Claude Code's records of its open sessions, and the kernel's list of locks.
 */

const CLAUDE = '0b9e2f6a-1c2d-4e5f-8a9b-0c1d2e3f4a5b'
const CODEX = '01a1edb1-dbd8-7762-8523-7e621a15539d'

describe('telling a conversation is open in another process', () => {
  it('reads the process list as ps and PowerShell print it', () => {
    assert.deepStrictEqual(processesOf('  412 /usr/bin/claude --resume x\n\r\n9 codex\r\n  nonsense\n'), [
      { pid: 412, args: '/usr/bin/claude --resume x' },
      { pid: 9, args: 'codex' },
    ])
  })

  it('knows each tool’s process by its program or the script Node runs', () => {
    const cases: ReadonlyArray<readonly [string, string | null]> = [
      ['claude --resume x', 'claude_code'],
      ['/home/a/.local/bin/claude', 'claude_code'],
      ['/opt/App/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude --resume x', 'claude_code'],
      ['node /usr/lib/node_modules/@anthropic-ai/claude-code/cli.js -r x', 'claude_code'],
      [
        '"C:\\Program Files\\nodejs\\node.exe" C:\\Users\\a\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js',
        'claude_code',
      ],
      ['C:\\Users\\a\\.local\\bin\\claude.exe --resume x', 'claude_code'],
      ['codex resume x', 'codex'],
      ['node /home/a/.nvm/lib/node_modules/@openai/codex/bin/codex.js resume x', 'codex'],
      ['/x/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex resume x', 'codex'],
      ['vim notes-about-claude.md', null],
      ['grep claude', null],
      ['bash -c claude', null],
    ]
    for (const [args, tool] of cases) assert.strictEqual(toolOf(args), tool, args)
  })

  it('finds the id in a tool’s own arguments only, whole or after =', () => {
    assert.isTrue(namesIn({ pid: 1, args: `claude --resume ${CLAUDE}` }, 'claude_code', CLAUDE))
    assert.isTrue(namesIn({ pid: 1, args: `claude --resume=${CLAUDE} --verbose` }, 'claude_code', CLAUDE))
    assert.isTrue(namesIn({ pid: 1, args: `codex resume ${CODEX}` }, 'codex', CODEX))
    assert.isTrue(namesIn({ pid: 1, args: `"C:\\npm\\codex.cmd" resume "${CODEX}"` }, 'codex', CODEX))
    // Another session's, another tool's, or a word that only holds it.
    assert.isFalse(namesIn({ pid: 1, args: `claude --resume ${CODEX}` }, 'claude_code', CLAUDE))
    assert.isFalse(namesIn({ pid: 1, args: `codex resume ${CLAUDE}` }, 'claude_code', CLAUDE))
    assert.isFalse(namesIn({ pid: 1, args: `less /tmp/${CLAUDE}.jsonl` }, 'claude_code', CLAUDE))
    assert.isFalse(namesIn({ pid: 1, args: `claude /tmp/${CLAUDE}.jsonl` }, 'claude_code', CLAUDE))
  })

  it('reads who holds a lock from the kernel’s list, by inode, not one only waiting for it', () => {
    const locks = [
      '6: FLOCK  ADVISORY  WRITE 2977689 00:24:68426857 0 EOF',
      '211: OFDLCK ADVISORY  WRITE -1 00:24:1767 0 0',
      '7: POSIX  ADVISORY  READ 1234 fd:01:5512 0 EOF',
      '8: -> FLOCK  ADVISORY  WRITE 99 00:24:4242 0 EOF',
    ].join('\n')
    assert.deepStrictEqual([...lockedInodes(locks)], [68426857, 1767, 5512])
  })

  it.effect('takes Claude Code’s record of an open session only while its pid is a Claude Code process', () =>
    Effect.gen(function* () {
      const claude = realpathSync(mkdtempSync(join(tmpdir(), 'althar-claude-')))
      mkdirSync(join(claude, 'sessions'))
      writeFileSync(join(claude, 'sessions', '412.json'), JSON.stringify({ pid: 412, sessionId: CLAUDE, kind: 'interactive' }))
      writeFileSync(join(claude, 'sessions', '413.json'), '{ not json')
      const places = { claude, codex: join(claude, 'no-codex') }
      const conversations = [{ agent: 'claude_code' as const, id: CLAUDE }]
      const with_ = (args: string | null) =>
        openElsewhere(conversations, places, {
          platform: 'linux',
          processes: Effect.succeed(args === null ? [] : [{ pid: 412, args }]),
        })
      assert.strictEqual(yield* with_('/usr/bin/claude'), 'claude_code')
      // Crashed and its pid another's since, or gone: not open.
      assert.isNull(yield* with_('/usr/bin/python3 serve.py'))
      assert.isNull(yield* with_(null))
      // Where the processes can't be listed, nothing can be told, and nothing is held.
      assert.isNull(yield* openElsewhere(conversations, places, { platform: 'linux', processes: Effect.succeed(null) }))
      assert.isNull(yield* openElsewhere([], places))
    }),
  )

  it.effect('reads no lock on Windows, where only taking it would tell, and so goes by the arguments there', () =>
    Effect.gen(function* () {
      const codex = realpathSync(mkdtempSync(join(tmpdir(), 'althar-codex-')))
      mkdirSync(join(codex, 'thread-writer-locks'))
      writeFileSync(join(codex, 'thread-writer-locks', `${CODEX}.lock`), '')
      const places = { claude: join(codex, 'no-claude'), codex }
      const conversations = [{ agent: 'codex' as const, id: CODEX }]
      const on = (args: string) =>
        openElsewhere(conversations, places, { platform: 'win32', processes: Effect.succeed([{ pid: 7, args }]) })
      assert.isNull(yield* on('C:\\codex\\codex.exe'))
      assert.strictEqual(yield* on(`C:\\codex\\codex.exe resume ${CODEX}`), 'codex')
    }),
  )

  it('says which tool has it, and what to do', () => {
    assert.strictEqual(
      openWords('claude_code'),
      'Claude Code still has this conversation open in another window. Close it there and send again.',
    )
    assert.strictEqual(openWords('codex'), 'Codex still has this conversation open in another window. Close it there and send again.')
  })
})
