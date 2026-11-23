import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test'

import { realPath, removeTreeSync } from '../src/files'
import { gitCeiling, identify, isOwnRepository, setConfig } from '../src/git'

const fixture = join(import.meta.dirname, 'fixtures', 'leak.fixture.ts')

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Setup', '-c', 'user.email=setup@althar.test', ...args], { cwd, encoding: 'utf8' }).trim()

let sandbox = ''
/** The person's repository, and one of its task worktrees, as Althar makes them. */
let main = ''
let worktree = ''

beforeAll(() => {
  sandbox = realPath(mkdtempSync(join(tmpdir(), 'althar-isolation-')))
  main = join(sandbox, 'althar')
  mkdirSync(main)
  git(main, 'init', '-q', '-b', 'main')
  writeFileSync(join(main, 'README.md'), '# Althar\n')
  git(main, 'add', '.')
  git(main, 'commit', '-q', '-m', 'Start')
  worktree = join(sandbox, 'worktrees', 'task')
  git(main, 'worktree', 'add', '-q', '-b', 'task', worktree)
})

afterAll(() => removeTreeSync(sandbox))

/** A test run started in the worktree, its temporary folder in it too, as under a sandbox that gives the task one. */
const runInWorktree = (env: Record<string, string>) => {
  const temporary = join(worktree, '.tmp')
  mkdirSync(temporary, { recursive: true })
  const answer = execFileSync(process.execPath, [fixture], {
    cwd: worktree,
    encoding: 'utf8',
    env: { ...process.env, TMPDIR: temporary, TEMP: temporary, TMP: temporary, ...env },
  })
  return JSON.parse(answer.trim().split('\n').at(-1) ?? '{}') as Record<string, string>
}

describe('a test run started inside a task worktree', () => {
  test('writes nothing to the repository around it, where the repository a test made is no repository', () => {
    const before = readFileSync(join(main, '.git', 'config'), 'utf8')
    const outcome = runInWorktree({ GIT_CEILING_DIRECTORIES: '' })
    expect(outcome.identify).toMatch(/Refusing to set user\.name/)
    expect(outcome.setConfig).toMatch(/Refusing to set user\.name/)
    // The test's own `git config` finds no repository either, so nothing of it is written.
    expect(outcome.plain).not.toBe('wrote')
    expect(readFileSync(join(main, '.git', 'config'), 'utf8')).toBe(before)
    expect(before).not.toMatch(/user|t@t\.test/)
  })

  test('would have written there without the ceiling: the folder is part of the worktree', () => {
    const folder = join(worktree, 'not-a-repository')
    mkdirSync(folder)
    expect(isOwnRepository(folder)).toBe(false)
    execFileSync('git', ['config', '--local', 'althar.leak', 'yes'], { cwd: folder })
    expect(git(main, 'config', '--local', '--get', 'althar.leak')).toBe('yes')
    git(main, 'config', '--local', '--unset', 'althar.leak')
  })
})

describe('configuring a test repository', () => {
  test('sets the identity of a repository of its own, and of no other', () => {
    const own = join(sandbox, 'own')
    mkdirSync(own)
    git(own, 'init', '-q', '-b', 'main')
    expect(isOwnRepository(own)).toBe(true)
    identify(own, 'Fake', 'fake@althar.test')
    expect(git(own, 'config', '--local', '--get', 'user.email')).toBe('fake@althar.test')
    const inside = join(own, 'inside')
    mkdirSync(inside)
    expect(() => setConfig(inside, 'user.name', 'T')).toThrow(/not the top level of a repository of its own/)
    expect(() => setConfig(join(sandbox, 'missing'), 'user.name', 'T')).toThrow(/Refusing/)
    expect(git(own, 'config', '--local', '--get', 'user.name')).toBe('Fake')
  })

  test('refuses the root of a linked worktree of a repository outside the temporary folder, whose config it shares', () => {
    // The task worktree's root is its own top level, but `git config --local` there writes to the main repository's.
    const temporary = join(worktree, '.tmp-root')
    mkdirSync(temporary, { recursive: true })
    const before = readFileSync(join(main, '.git', 'config'), 'utf8')
    const outcome = JSON.parse(
      execFileSync(process.execPath, [fixture, worktree], {
        cwd: worktree,
        encoding: 'utf8',
        env: { ...process.env, TMPDIR: temporary, TEMP: temporary, TMP: temporary },
      })
        .trim()
        .split('\n')
        .at(-1) ?? '{}',
    ) as Record<string, string>
    expect(outcome.identify).toMatch(/Refusing to set user\.name/)
    expect(outcome.setConfig).toMatch(/Refusing to set user\.name/)
    expect(readFileSync(join(main, '.git', 'config'), 'utf8')).toBe(before)
  })

  test('refuses the root of any linked worktree, though its repository sits in the temporary folder, and sets the main one', () => {
    // A repository already there, as when the temporary folder is a parent of the person's projects.
    const own = join(sandbox, 'linked-own')
    mkdirSync(own)
    git(own, 'init', '-q', '-b', 'main')
    git(own, 'commit', '-q', '--allow-empty', '-m', 'Start')
    const linked = join(sandbox, 'linked-own-task')
    git(own, 'worktree', 'add', '-q', '-b', 'task', linked)
    const before = readFileSync(join(own, '.git', 'config'), 'utf8')
    expect(isOwnRepository(linked)).toBe(false)
    expect(() => identify(linked, 'T', 't@t.test')).toThrow(/Refusing to set user\.name/)
    expect(readFileSync(join(own, '.git', 'config'), 'utf8')).toBe(before)
    identify(own, 'Fake', 'fake@althar.test')
    expect(git(linked, 'config', '--local', '--get', 'user.email')).toBe('fake@althar.test')
  })

  test('keeps git above the temporary folder out of reach in every test', () => {
    expect(process.env.GIT_CEILING_DIRECTORIES?.split(delimiter)).toContain(realPath(tmpdir()))
    expect(gitCeiling(sandbox)).toBe(sandbox)
  })
})
