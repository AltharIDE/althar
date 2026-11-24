import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import { codexLogSaid, localCauseOf, stillThere, strayIn } from '../src/localCause'

/*
 * A local reason an agent couldn't go on (DEV-285), read from what each agent
 * really said: its error, its stderr, or, for Codex, its own log, where its
 * stream said only that it was retrying. What a provider says stays its own.
 */

/** The row Codex's log kept on each try in ai-teacher, its spans cut short (`~/.codex/logs_2.sqlite`, `codex_core::responses_retry`). */
const codexRetry =
  'session_loop{thread_id=01a20c81-3b02-7313-af80-a091aa0fa922}:turn{otel.name="session_task.turn"}: stream disconnected - retrying sampling request (5/5 in 3.219s)... turn_id=01a20c83-1692-7a21-b177-87e3c1cc272c retries=5 max_retries=5 sampling_error=failed to load workspace requirements: not a directory'
/** And the turn it ended on (`codex_core::session::turn`). */
const codexTurn =
  'session_loop{thread_id=01a20c81-3b02-7313-af80-a091aa0fa922}:turn{otel.name="session_task.turn"}: Turn error: failed to load workspace requirements: not a directory'

describe('Codex', () => {
  it('reads the error its log kept on each retry, past the spans', () => {
    expect(localCauseOf(codexRetry)).toEqual({ kind: 'not_a_folder', said: 'failed to load workspace requirements: not a directory' })
    expect(localCauseOf(codexTurn)).toEqual({ kind: 'not_a_folder', said: 'failed to load workspace requirements: not a directory' })
  })

  it('reads a config.toml that does not parse as its settings', () => {
    const said = 'Error loading config.toml: TOML parse error at line 4, column 1\n  |\n4 | modle = "o3"\n  | ^^^^^\nunknown field `modle`'
    expect(localCauseOf(said)?.kind).toBe('config')
  })

  it.each([
    // Its stream, which says only that it tries again, and the adapter's own word for what it couldn't tell apart (codex-acp 2.8.0).
    'stream disconnected - retrying sampling request (1/5 in 206ms)...',
    'Codex encountered an internal error.',
    'Internal error',
    // The provider failing, or the network, which a retry can help.
    'unexpected status 500 Internal Server Error: {"error":{"message":"The server had an error"}}',
    'stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses)',
    'exceeded retry limit, last status: 429 Too Many Requests',
  ])('finds nothing local in %s', (said) => {
    expect(localCauseOf(said)).toBeUndefined()
  })
})

describe('Claude Code', () => {
  it.each([
    [
      "Error: ENOTDIR: not a directory, open '/home/me/projects/app/.claude/settings.local.json'",
      'not_a_folder',
      '/home/me/projects/app/.claude/settings.local.json',
    ],
    ["Error: EACCES: permission denied, mkdir '/home/me/.claude/projects'", 'no_permission', '/home/me/.claude/projects'],
    ["Error: EROFS: read-only file system, open '/home/me/.claude.json'", 'read_only', '/home/me/.claude.json'],
    ["Error: EISDIR: illegal operation on a directory, read '/home/me/.claude.json'", 'is_a_folder', '/home/me/.claude.json'],
  ])('%s', (said, kind, path) => {
    expect(localCauseOf(said)).toMatchObject({ kind, path })
  })

  it('reads the first such line in what it wrote before it stopped, past a stack', () => {
    const stderr = [
      'node:fs:562',
      "Error: ENOTDIR: not a directory, open '/repo/.claude/settings.json'",
      '    at Object.openSync (node:fs:562:18)',
      '    at readFileSync (node:fs:446:35)',
    ].join('\n')
    expect(localCauseOf(stderr)).toMatchObject({ kind: 'not_a_folder', path: '/repo/.claude/settings.json' })
  })

  it('leaves a refused command, a hook and an MCP server their own', () => {
    expect(localCauseOf('Permission denied: Bash(rm -rf dist) needs your approval')).toBeUndefined()
    expect(localCauseOf("PreToolUse hook failed: EACCES: permission denied, open '/repo/.husky/pre-commit'")).toBeUndefined()
    expect(localCauseOf("MCP server linear: ENOTDIR: not a directory, open '/x/y'")).toBeUndefined()
  })
})

describe('OpenCode', () => {
  it.each([
    [
      'ConfigJSONError: Config file at /home/me/projects/app/opencode.json is not valid JSON(C)',
      'config',
      '/home/me/projects/app/opencode.json',
    ],
    [
      'ConfigInvalidError: Config file at /home/me/.config/opencode/opencode.json is invalid',
      'config',
      '/home/me/.config/opencode/opencode.json',
    ],
    [
      "error: ENOTDIR: not a directory, mkdir '/home/me/projects/app/.opencode/plugin'",
      'not_a_folder',
      '/home/me/projects/app/.opencode/plugin',
    ],
    [
      "EACCES: permission denied, open '/home/me/.local/share/opencode/auth.json'",
      'no_permission',
      '/home/me/.local/share/opencode/auth.json',
    ],
  ])('%s', (said, kind, path) => {
    expect(localCauseOf(said)).toMatchObject({ kind, path })
  })

  it('finds nothing local in its provider failing', () => {
    expect(localCauseOf('AI_APICallError: Service Unavailable')).toBeUndefined()
    expect(localCauseOf('ProviderModelNotFoundError: model not found')).toBeUndefined()
  })
})

describe('the checkout', () => {
  const made: Array<string> = []
  afterEach(() => {
    for (const one of made.splice(0)) rmSync(one, { recursive: true, force: true })
  })

  /** A repository with a task's worktree beside it, as Althar makes one: `.git` a file naming the repository's. */
  const repository = () => {
    const at = mkdtempSync(join(tmpdir(), 'local-cause-'))
    made.push(at)
    const main = join(at, 'ai-teacher')
    const worktree = join(at, 'worktrees', 'fix-login', 'ai-teacher')
    mkdirSync(join(main, '.git', 'worktrees', 'fix-login'), { recursive: true })
    writeFileSync(join(main, '.git', 'worktrees', 'fix-login', 'commondir'), '../..\n')
    mkdirSync(join(worktree, 'src'), { recursive: true })
    writeFileSync(join(worktree, '.git'), `gitdir: ${join(main, '.git', 'worktrees', 'fix-login')}\n`)
    return { main, worktree }
  }

  it('finds the file at the repository’s own root that every worktree shares, where Codex reads a folder', () => {
    const { main, worktree } = repository()
    writeFileSync(join(main, '.codex'), '')
    expect(strayIn('codex', join(worktree, 'src'))).toBe(join(main, '.codex'))
    expect(stillThere({ kind: 'not_a_folder', path: join(main, '.codex'), said: '' })).toBe(true)
    rmSync(join(main, '.codex'))
    mkdirSync(join(main, '.codex'))
    expect(stillThere({ kind: 'not_a_folder', path: join(main, '.codex'), said: '' })).toBe(false)
    expect(strayIn('codex', worktree)).toBeUndefined()
  })

  it('finds the one in the worktree itself, and the file along a path the agent named', () => {
    const { worktree } = repository()
    writeFileSync(join(worktree, '.claude'), '')
    expect(strayIn('claude-code', worktree)).toBe(join(worktree, '.claude'))
    expect(strayIn('opencode', worktree, join(worktree, '.claude', 'settings.json'))).toBe(join(worktree, '.claude'))
  })

  it('says nothing for an agent with no folder of its own, or a checkout with nothing out of place', () => {
    const { worktree } = repository()
    expect(strayIn('codex', worktree)).toBeUndefined()
    expect(strayIn('grok', worktree)).toBeUndefined()
  })
})

describe('Codex’s own log', () => {
  const made: Array<string> = []
  afterEach(() => {
    for (const one of made.splice(0)) rmSync(one, { recursive: true, force: true })
  })

  /** A log as Codex 0.170 keeps it: the columns it reads by, the rest left out. */
  const log = (rows: ReadonlyArray<{ ts: number; level: string; target: string; thread: string | null; body: string }>) => {
    const home = mkdtempSync(join(tmpdir(), 'codex-home-'))
    made.push(home)
    const db = new DatabaseSync(join(home, 'logs_2.sqlite'))
    db.exec(`CREATE TABLE logs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, ts_nanos INTEGER NOT NULL,
      level TEXT NOT NULL, target TEXT NOT NULL, feedback_log_body TEXT, thread_id TEXT)`)
    const insert = db.prepare('INSERT INTO logs (ts, ts_nanos, level, target, feedback_log_body, thread_id) VALUES (?, 0, ?, ?, ?, ?)')
    for (const row of rows) insert.run(row.ts, row.level, row.target, row.body, row.thread)
    db.close()
    return home
  }

  it('reads what it kept of a thread, newest first, and the cause in it', () => {
    const thread = '01a20c81-3b02-7313-af80-a091aa0fa922'
    const home = log([
      { ts: 100, level: 'WARN', target: 'codex_core::responses_retry', thread, body: codexRetry },
      { ts: 101, level: 'INFO', target: 'codex_core::session::turn', thread, body: codexTurn },
      { ts: 102, level: 'WARN', target: 'codex_core::responses_retry', thread: 'another', body: 'sampling_error=unexpected status 500' },
    ])
    const said = codexLogSaid(home, { id: thread })
    expect(said.split('\n')).toEqual([
      'failed to load workspace requirements: not a directory',
      'failed to load workspace requirements: not a directory',
    ])
    expect(localCauseOf(said)?.kind).toBe('not_a_folder')
  })

  it('reads what it wrote since a start, where there was no thread yet', () => {
    const home = log([
      { ts: 10, level: 'ERROR', target: 'codex_core', thread: null, body: 'old: Error loading config.toml: nothing' },
      {
        ts: 200,
        level: 'ERROR',
        target: 'codex_app_server',
        thread: null,
        body: 'failed to load configuration: Not a directory (os error 20)',
      },
    ])
    expect(codexLogSaid(home, { since: 150_000 })).toBe('failed to load configuration: Not a directory (os error 20)')
  })

  it('is empty without a log', () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-home-'))
    made.push(home)
    expect(codexLogSaid(home, { id: 'x' })).toBe('')
  })
})
