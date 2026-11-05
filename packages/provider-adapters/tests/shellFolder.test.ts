import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { agents } from '../src/registry'
import { claudeShellFolder } from '../src/shellFolder'

/*
 * Where a Claude Code lead's shell is, from its transcript: each entry names
 * the folder the shell was in, so the rules read `rm ../../x.log` from there.
 */

const entry = (cwd: string, more: Record<string, unknown> = {}) => `${JSON.stringify({ type: 'assistant', cwd, ...more })}\n`

describe("a Claude Code session's shell folder", () => {
  const worktree = '/Users/someone/Charrette/meridian/retry/app'

  it('is the newest entry’s folder, read again on each call', () => {
    const home = mkdtempSync(join(tmpdir(), 'claude-home-'))
    const folder = join(home, 'projects', '-Users-someone-Charrette-meridian-retry-app')
    mkdirSync(folder, { recursive: true })
    const transcript = join(folder, 'abc-123.jsonl')
    const where = claudeShellFolder(home, worktree, 'abc-123')
    // No transcript yet: nothing to say.
    expect(where()).toBeUndefined()
    writeFileSync(transcript, entry(worktree) + entry(`${worktree}/packages/ui`))
    expect(where()).toBe(`${worktree}/packages/ui`)
    // An entry without one, or a line cut short, says nothing; the newest that does is where it is.
    appendFileSync(transcript, `${JSON.stringify({ type: 'summary' })}\n{"cwd": "/cut`)
    expect(where()).toBe(`${worktree}/packages/ui`)
    appendFileSync(transcript, `\n${entry(worktree)}`)
    expect(where()).toBe(worktree)
  })

  it('finds a transcript whose folder Claude Code named otherwise, as it does a long path', () => {
    const home = mkdtempSync(join(tmpdir(), 'claude-home-'))
    const folder = join(home, 'projects', '-Users-someone-Charrette-meridian-retry-ap-1a2b3c')
    mkdirSync(folder, { recursive: true })
    writeFileSync(
      join(folder, 'def-456.jsonl'),
      entry(`${worktree}/docs`, { message: { content: 'x'.repeat(300_000) } }) + entry(`${worktree}/src`),
    )
    expect(claudeShellFolder(home, worktree, 'def-456')()).toBe(`${worktree}/src`)
    expect(claudeShellFolder(home, worktree, 'none-such')()).toBeUndefined()
  })

  it('is read for Claude Code, whose transcript records it', () => {
    expect(agents['claude-code'].shellFolder).toBe(claudeShellFolder)
  })
})
