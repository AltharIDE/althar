import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import {
  CODE_AROUND,
  CODE_WHOLE,
  type CodeRoot,
  type CodeRoots,
  codeRootOf,
  findCode,
  followLine,
  looksLikePath,
  looksLikeSymbol,
  nearNames,
  parseName,
  readCode,
} from '../src/code'
import { NotFound } from '../src/errors'

const numbered = (from: number, to: number, said = (n: number) => `// line ${n}`) =>
  Array.from({ length: to - from + 1 }, (_, i) => said(from + i))

/** Twenty lines of Runs.ts, the eighth declaring planWaits. */
const RUNS = numbered(1, 20, (n) => (n === 8 ? 'export function planWaits() {' : `// line ${n}`))

/**
 * A repository as a project's: two files called model.ts, a test that
 * declares planWaits again, a decision, a picture; then a day later three
 * lines put in at the top of Runs.ts and its fifteenth rewritten.
 */
const repository = () => {
  const root = mkdtempSync(join(tmpdir(), 'althar-code-'))
  const git = (env: Readonly<Record<string, string>>, ...args: Array<string>) =>
    execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', ...args], { cwd: root, env: { ...process.env, ...env } })
      .toString()
      .trim()
  const write = (path: string, text: string | Buffer) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  const at = (date: string) => ({ GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date })
  git({}, 'init', '-q', '-b', 'main')
  write('packages/runtime/src/Runs.ts', `${RUNS.join('\n')}\n`)
  write('apps/desktop/src/model.ts', 'export const desktop = 1\n')
  write('packages/ui/src/model.ts', 'export const ui = 1\n')
  write('packages/ui/tests/Runs.test.ts', 'function planWaits() {}\n')
  write('docs/decisions/048-where-the-runtime-runs.md', '# Where the runtime runs\n')
  write('brand/mark.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1]))
  write('.gitignore', '.althar/scratch/\ndist/\n')
  git({}, 'add', '.')
  git(at('2026-10-01T10:00:00Z'), 'commit', '-q', '-m', 'Start')
  const first = git({}, 'rev-parse', 'HEAD')
  const later = ['// one', '// two', '// three', ...RUNS.map((line, i) => (i === 14 ? '// line 15, rewritten' : line))]
  write('packages/runtime/src/Runs.ts', `${later.join('\n')}\n`)
  git({}, 'add', '.')
  git(at('2026-10-02T10:00:00Z'), 'commit', '-q', '-m', 'Wait in order')
  const second = git({}, 'rev-parse', 'HEAD')
  return { root, first, second, write }
}

const rootOf = (path: string, more: Partial<CodeRoot> = {}): CodeRoot => ({
  slug: 'althar',
  name: 'althar',
  branch: 'main',
  path,
  commit: null,
  base: null,
  within: null,
  seen: [],
  editor: path,
  ...more,
})

/** The repository's default branch, as the coordinator reads it, its copy in the coordinator's folder named too. */
const onMain = (root: string, commit: string): CodeRoots => ({
  kind: 'default',
  roots: [rootOf(root, { commit, seen: ['/work/meridian/.coordinator/althar'] })],
})

const kinds = (found: ReadonlyArray<{ readonly kind: string; readonly name: string }>) => found.map((one) => `${one.kind} ${one.name}`)

describe('the names agents write', () => {
  it('reads a path and the lines it means, without the sentence around it', () => {
    assert.deepStrictEqual(parseName('packages/runtime/src/Runs.ts:359'), { name: 'packages/runtime/src/Runs.ts', line: 359 })
    assert.deepStrictEqual(parseName('Runs.ts:12-30.'), { name: 'Runs.ts', line: 12, end: 30 })
    assert.deepStrictEqual(parseName('Runs.ts:12–30'), { name: 'Runs.ts', line: 12, end: 30 })
    assert.deepStrictEqual(parseName('Runs.ts:12:4'), { name: 'Runs.ts', line: 12 })
    assert.deepStrictEqual(parseName('Runs.ts#L3-L9'), { name: 'Runs.ts', line: 3, end: 9 })
    assert.deepStrictEqual(parseName('Runs.ts:30-12'), { name: 'Runs.ts', line: 30 })
    assert.deepStrictEqual(parseName('Runs.ts:0'), { name: 'Runs.ts' })
    assert.deepStrictEqual(parseName('src/a.ts),'), { name: 'src/a.ts' })
    assert.deepStrictEqual(parseName('listEditors()'), { name: 'listEditors()' })
    for (const words of ['npm test', 'https://github.com/a/b.ts', '', '  ']) assert.isNull(parseName(words), words)
  })

  it('tells a path and a name in code from a word', () => {
    for (const path of ['packages/ui', 'Runs.ts', '.gitignore', 'a/b']) assert.isTrue(looksLikePath(path), path)
    for (const word of ['Runs', 'listEditors', '...']) assert.isFalse(looksLikePath(word), word)
    for (const name of ['listEditors', 'listEditors()', 'CodeHost', 'DOCUMENT_READ', 'default_base_ref', 'refresh()'])
      assert.isTrue(looksLikeSymbol(name), name)
    for (const word of ['main', 'string', 'Runs', 'API', 'void()', 'two-words']) assert.isFalse(looksLikeSymbol(word), word)
  })

  it('follows a line through what changed since, unless it was rewritten', () => {
    const diff = ['@@ -0,0 +1,3 @@', '+// one', '+// two', '+// three', '@@ -15 +18 @@', '-// line 15', '+// line 15, rewritten'].join('\n')
    assert.strictEqual(followLine(diff, 1), 4)
    assert.strictEqual(followLine(diff, 10), 13)
    assert.isNull(followLine(diff, 15))
    assert.strictEqual(followLine(diff, 16), 19)
    // Lines taken out above it move it up; lines put in below leave it.
    assert.strictEqual(followLine('@@ -2,3 +1,0 @@\n@@ -40,0 +38,2 @@', 10), 7)
    assert.strictEqual(followLine('', 10), 10)
  })

  it('offers files of nearly the name of one that isn’t there', () => {
    const files = ['docs/decisions/048-where-the-runtime-runs.md', 'docs/decisions/049-reach.md', 'src/Runs.ts', 'lib/Runs.ts']
    assert.deepStrictEqual(nearNames(files, 'docs/Runs.ts'), ['src/Runs.ts', 'lib/Runs.ts'])
    assert.deepStrictEqual(nearNames(files, 'docs/decisions/050-where-the-runtime-runs.md'), [
      'docs/decisions/048-where-the-runtime-runs.md',
    ])
    assert.deepStrictEqual(nearNames(files, 'docs/decisions/reac'), ['docs/decisions/049-reach.md'])
    assert.deepStrictEqual(nearNames(files, 'x/ab.md'), [])
  })
})

describe('finding what a message names', () => {
  it.effect('on the default branch, follows the lines a message named from when it was said', () =>
    Effect.gen(function* () {
      const { root, first, second } = repository()
      const [found = []] = yield* findCode(onMain(root, second), [
        {
          at: '2026-10-01T12:00:00.000Z',
          names: [
            'packages/runtime/src/Runs.ts:10',
            'Runs.ts:15',
            'model.ts',
            'planWaits',
            'and/or',
            'packages/runtime/src/Run.ts',
            'packages/runtime/',
            'npm test',
            'brand/mark.png',
            '/work/meridian/.coordinator/althar/docs/decisions/048-where-the-runtime-runs.md',
          ],
        },
      ])
      assert.deepStrictEqual(kinds(found), [
        'file packages/runtime/src/Runs.ts:10',
        'file Runs.ts:15',
        'several model.ts',
        'file planWaits',
        'missing packages/runtime/src/Run.ts',
        'file brand/mark.png',
        'file /work/meridian/.coordinator/althar/docs/decisions/048-where-the-runtime-runs.md',
      ])
      const [ten, fifteen, model, waits, run, mark, decision] = found
      // Line 10 then is line 13 now; line 15 was rewritten since, so it is to be read as it was.
      assert.deepInclude(ten, { path: 'packages/runtime/src/Runs.ts', line: 10, byName: false, lines: 23, content: 'text', changed: null })
      const said = '2026-10-01T12:00:00.000Z'
      assert.deepStrictEqual(ten?.kind === 'file' ? ten.since : undefined, { commit: first, said, now: { line: 13 } })
      assert.deepInclude(fifteen, { path: 'packages/runtime/src/Runs.ts', line: 15, byName: true })
      assert.deepStrictEqual(fifteen?.kind === 'file' ? fifteen.since : undefined, { commit: first, said, now: null })
      assert.deepStrictEqual(model?.kind === 'several' ? model.paths : [], ['apps/desktop/src/model.ts', 'packages/ui/src/model.ts'])
      // A name in code: the one file that declares it, a test's own declaration aside, at its line as it is.
      assert.deepInclude(waits, { path: 'packages/runtime/src/Runs.ts', line: 11, symbol: 'planWaits', since: null })
      assert.deepStrictEqual(run?.kind === 'missing' ? run.near : [], ['packages/runtime/src/Runs.ts', 'packages/ui/tests/Runs.test.ts'])
      assert.deepInclude(mark, { content: 'binary', lines: 0, since: null })
      assert.deepInclude(decision, { path: 'docs/decisions/048-where-the-runtime-runs.md' })
    }),
  )

  it.effect('takes a file’s name in the folder its message names, and says nothing of when where nothing changed since', () =>
    Effect.gen(function* () {
      const { root, second } = repository()
      const [named = [], now = []] = yield* findCode(onMain(root, second), [
        { at: '2026-10-03T00:00:00.000Z', names: ['packages/ui/src/', 'model.ts', 'Runs.ts:15'] },
        { at: null, names: ['Runs.ts:15'] },
      ])
      assert.deepInclude(named[0], { kind: 'file', name: 'model.ts', path: 'packages/ui/src/model.ts', byName: true })
      assert.deepInclude(named[1], { line: 15, since: null })
      assert.deepInclude(now[0], { line: 15, since: null })
    }),
  )

  it.effect('in a task’s worktree, reads what isn’t committed, what it added, its notes and what git ignores', () =>
    Effect.gen(function* () {
      const { root, first, write } = repository()
      write('packages/runtime/src/Runs.ts', `${['// one', '// two', '// three', ...RUNS].join('\n')}\n// at the end\n`)
      write('src/new.ts', 'export const fresh = 1\nexport const more = 2\n')
      write('.althar/scratch/notes.md', '# Notes\n')
      write('dist/out.js', 'built()\n')
      const [found = []] = yield* findCode({ kind: 'task', roots: [rootOf(root, { base: first, branch: 'althar/wait' })] }, [
        {
          at: '2026-10-01T12:00:00.000Z',
          names: ['Runs.ts:12', 'src/new.ts', 'notes.md', 'dist/out.js', `${root}/src/new.ts`, '/etc/hosts'],
        },
      ])
      assert.deepStrictEqual(kinds(found), [
        'file Runs.ts:12',
        'file src/new.ts',
        'file notes.md',
        'file dist/out.js',
        `file ${root}/src/new.ts`,
      ])
      const [runs, fresh, notes, out, whole] = found
      // What the task changed, committed and not, against where it started; nothing of when, which only the default branch keeps.
      assert.deepInclude(runs, { lines: 24, changed: { add: 4, del: 0 }, since: null })
      assert.deepInclude(fresh, { changed: { add: 2, del: 0 } })
      assert.deepInclude(notes, { path: '.althar/scratch/notes.md', byName: true, changed: null })
      assert.deepInclude(out, { path: 'dist/out.js', changed: null })
      assert.deepInclude(whole, { path: 'src/new.ts' })
    }),
  )

  it.effect('finds each name in code however many one file declares, and a name two files declare as neither', () =>
    Effect.gen(function* () {
      const { root, write } = repository()
      const declared = ['parseName', 'looksLikePath', 'looksLikeSymbol', 'followLine', 'readName']
      write('src/names.ts', `${declared.map((name) => `export function ${name}() {}`).join('\n')}\n`)
      // The last is declared in another file too, and below where the file declares three of the others.
      write('src/other.ts', 'export const readName = 1\n')
      const asked = [{ at: null, names: declared }]
      const [inTask = []] = yield* findCode({ kind: 'task', roots: [rootOf(root)] }, asked)
      execFileSync('git', ['add', '.'], { cwd: root })
      execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', 'commit', '-q', '-m', 'Names'], { cwd: root })
      const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim()
      const [onDefault = []] = yield* findCode(onMain(root, commit), asked)
      for (const found of [inTask, onDefault])
        assert.deepStrictEqual(
          found.map((one) => (one.kind === 'file' ? `${one.name} ${one.path}:${one.line}` : one.kind)),
          ['parseName src/names.ts:1', 'looksLikePath src/names.ts:2', 'looksLikeSymbol src/names.ts:3', 'followLine src/names.ts:4'],
        )
    }),
  )

  it.effect('names a file under its repository where a place has several, and finds the same path in both as several', () =>
    Effect.gen(function* () {
      const one = repository()
      const two = repository()
      const place: CodeRoots = {
        kind: 'task',
        roots: [rootOf(one.root, { slug: 'api', name: 'API' }), rootOf(two.root, { slug: 'web', name: 'Web' })],
      }
      const [found = []] = yield* findCode(place, [
        { at: null, names: ['web/apps/desktop/src/model.ts', 'docs/decisions/048-where-the-runtime-runs.md'] },
      ])
      assert.deepInclude(found[0], { kind: 'file', path: 'web/apps/desktop/src/model.ts' })
      assert.deepStrictEqual(found[1]?.kind === 'several' ? found[1].paths : [], [
        'api/docs/decisions/048-where-the-runtime-runs.md',
        'web/docs/decisions/048-where-the-runtime-runs.md',
      ])
      assert.deepInclude(codeRootOf(place, 'web/apps/desktop/src/model.ts'), { path: 'apps/desktop/src/model.ts' })
      for (const out of ['../x.ts', '/etc/hosts', 'other/x.ts', '']) assert.isNull(codeRootOf(place, out), out)
    }),
  )
})

describe('reading a file a message names', () => {
  it.effect('reads it as it is, as it was at a commit the default branch had, and nothing else', () =>
    Effect.gen(function* () {
      const { root, first, second } = repository()
      const place = onMain(root, second)
      const now = yield* readCode(place, 'packages/runtime/src/Runs.ts')
      assert.deepInclude(now, { from: 1, total: 23, cut: false })
      assert.isTrue(now.text.startsWith('// one\n'))
      const then = yield* readCode(place, 'packages/runtime/src/Runs.ts', first)
      assert.deepStrictEqual([then.total, then.text.split('\n')[14]], [20, '// line 15'])
      const refused = (path: string, commit?: string) =>
        Effect.map(Effect.flip(readCode(place, path, commit)), (error) => error instanceof NotFound)
      assert.isTrue(yield* refused('packages/runtime/src/Runs.ts', 'f'.repeat(40)))
      assert.isTrue(yield* refused('packages/runtime/src/Runs.ts', '--all'))
      assert.isTrue(yield* refused('brand/mark.png'))
      assert.isTrue(yield* refused('../outside.ts'))
      assert.isTrue(yield* refused('packages/runtime'))
      // A task's worktree is read as it is; it has no commits to read from.
      assert.isTrue(
        yield* Effect.map(
          Effect.flip(readCode({ kind: 'task', roots: [rootOf(root)] }, 'packages/runtime/src/Runs.ts', first)),
          () => true,
        ),
      )
    }),
  )

  it.effect('past a size, reads the lines around the one asked for', () =>
    Effect.gen(function* () {
      const { root, write } = repository()
      const long = numbered(1, 60_000, (n) => `const line${n} = ${'x'.repeat(20)}`)
      write('big.ts', `${long.join('\n')}\n`)
      assert.isAbove(Buffer.byteLength(long.join('\n')), CODE_WHOLE)
      const place: CodeRoots = { kind: 'task', roots: [rootOf(root)] }
      const around = yield* readCode(place, 'big.ts', undefined, 30_000)
      assert.deepInclude(around, { from: 30_000 - CODE_AROUND, total: 60_000, cut: true })
      assert.strictEqual(around.text.split('\n').length, CODE_AROUND * 2)
      assert.deepInclude(yield* readCode(place, 'big.ts', undefined, 59_999), { from: 60_000 - CODE_AROUND * 2 + 1 })
    }),
  )
})
