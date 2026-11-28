import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'vite-plus/test'

import { DAY, LANDED } from '../src/quarantine'
import { described, failedTwice, ownerOf } from '../src/tend'

const ci = 'github-actions[bot]'
const at = (milliseconds: number) => new Date(milliseconds).toISOString()

describe('a broken test', () => {
  test('is one that failed on its retry twice in a day, by its issue’s comments', () => {
    const failed = (when: number, by = ci) => ({ at: at(when), by, body: "Failed, on its retry too, and didn't fail" })
    expect(failedTwice([failed(LANDED + DAY), failed(LANDED + DAY + DAY - 1)])).toBe(true)
    expect(
      failedTwice([failed(LANDED + 3 * DAY), { at: at(LANDED + 3 * DAY + 60_000), by: ci, body: 'Failed again.\n\nFailed, on' }]),
    ).toBe(true)
    // Two days apart is flaky, and so is a retry that passed.
    expect(failedTwice([failed(LANDED + DAY), failed(LANDED + 3 * DAY)])).toBe(false)
    expect(failedTwice([failed(LANDED + DAY), { at: at(LANDED + DAY + 60_000), by: ci, body: 'Failed, then passed on its retry' }])).toBe(
      false,
    )
    // Only CI's word counts, and only since owners and ends landed.
    expect(failedTwice([failed(LANDED + DAY), failed(LANDED + DAY + 60_000, 'someone')])).toBe(false)
    expect(failedTwice([failed(LANDED - DAY), failed(LANDED - DAY + 60_000)])).toBe(false)
  })
})

describe('a test’s owner', () => {
  test('is the last commit to its file or what it imports, with its pull request and session', () => {
    const root = mkdtempSync(join(tmpdir(), 'tend-'))
    const git = (...args: ReadonlyArray<string>) =>
      execFileSync('git', ['-c', 'user.name=Someone', '-c', 'user.email=someone@example.com', ...args], { cwd: root, encoding: 'utf8' })
    git('init', '--quiet')
    mkdirSync(join(root, 'src'))
    mkdirSync(join(root, 'tests'))
    writeFileSync(join(root, 'src/words.ts'), 'export const said = 1\n')
    writeFileSync(join(root, 'tests/words.test.ts'), 'expect(said).toBe(1)\n')
    git('add', '.')
    git('commit', '--quiet', '-m', 'Words the window says (#1200)')
    writeFileSync(join(root, 'src/words.ts'), 'export const said = 2\n')
    git('commit', '--quiet', '-am', 'Say it once (#1219)\n\nClaude-Session: https://claude.ai/code/session_1')
    writeFileSync(join(root, 'README.md'), '# Elsewhere\n')
    git('add', '.')
    git('commit', '--quiet', '-m', 'Docs (#1230)')
    const owner = ownerOf(['tests/words.test.ts', 'src/words.ts'], git)
    expect(owner).toMatchObject({
      subject: 'Say it once (#1219)',
      pull: 1219,
      session: 'https://claude.ai/code/session_1',
      file: 'src/words.ts',
    })
    expect(owner?.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(ownerOf(['tests/words.test.ts'], git)).toMatchObject({ pull: 1200, session: undefined, file: 'tests/words.test.ts' })
    expect(ownerOf(['gone.ts'], git)).toBeUndefined()
    expect(described(owner!, 'someone')).toBe(
      `#1219 (Say it once) by someone, session https://claude.ai/code/session_1: the last to change \`src/words.ts\`, on ${owner?.date}`,
    )
  })
})
