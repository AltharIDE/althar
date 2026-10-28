import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { commitRecord, defaultBranch, fetchInto, remoteOf, treeOf } from '../src/git'
import { hosted, repository } from './support'

/*
 * What the runtime reads of a repository by itself: a commit's record exactly
 * as git keeps it, even one git wrote oddly; what a worktree holds before
 * anything was ever staged in it; the default branch where no remote says;
 * and the remote its work goes to.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test', ...args], { cwd })
    .toString()
    .trim()

/** A commit object written as given, whether or not git would make one so: as an older git, or another tool, may have. */
const written = (cwd: string, text: string | Buffer) =>
  execFileSync('git', ['hash-object', '-t', 'commit', '-w', '--literally', '--stdin'], { cwd, input: text }).toString().trim()

const AUTHOR = 'author Ada Lovelace <ada@althar.test> 1760000000 +0200'
const COMMITTER = 'committer Grace Hopper <grace@althar.test> 1760000100 -0130'
const ada = { name: 'Ada Lovelace', email: 'ada@althar.test', date: '1760000000 +0200' }
const grace = { name: 'Grace Hopper', email: 'grace@althar.test', date: '1760000100 -0130' }

describe('a commit’s record', () => {
  it.live('is read as git keeps it, and says what making it again would lose: a message in another encoding, or a tag it merged', () =>
    Effect.gen(function* () {
      const path = repository()
      const tree = git(path, 'rev-parse', 'HEAD^{tree}')
      const head = git(path, 'rev-parse', 'HEAD')

      // Its message in Latin-1, as git keeps it: read here as UTF-8, so making it again would change it.
      const latin = written(
        path,
        Buffer.from(`tree ${tree}\nparent ${head}\n${AUTHOR}\n${COMMITTER}\nencoding ISO-8859-1\n\nCafé\n`, 'latin1'),
      )
      assert.deepStrictEqual(yield* commitRecord(path, latin), {
        tree,
        parents: [head],
        author: ada,
        committer: grace,
        message: `Caf${Buffer.from([0xe9]).toString('utf8')}\n`,
        keeps: true,
        signed: false,
      })

      // One that names UTF-8, however it spells it, loses nothing.
      for (const encoding of ['UTF-8', 'utf8']) {
        const named = written(path, `tree ${tree}\nparent ${head}\n${AUTHOR}\n${COMMITTER}\nencoding ${encoding}\n\nCafé\n`)
        const record = yield* commitRecord(path, named)
        assert.isFalse(record.keeps, encoding)
        assert.strictEqual(record.message, 'Café\n')
      }

      // A merge of a signed tag carries the tag in it, which a commit made again wouldn't.
      const side = written(path, `tree ${tree}\nparent ${head}\n${AUTHOR}\n${COMMITTER}\n\nSide\n`)
      const merged = written(
        path,
        [
          `tree ${tree}`,
          `parent ${head}`,
          `parent ${side}`,
          AUTHOR,
          COMMITTER,
          `mergetag object ${side}`,
          ' type commit',
          ' tag v1.0',
          ' tagger Ada Lovelace <ada@althar.test> 1760000000 +0200',
          ' ',
          ' Version one',
          '',
          "Merge tag 'v1.0'",
          '',
        ].join('\n'),
      )
      const record = yield* commitRecord(path, merged)
      assert.deepStrictEqual(record.parents, [head, side])
      assert.isTrue(record.keeps)
      assert.isFalse(record.signed)
      assert.strictEqual(record.message, "Merge tag 'v1.0'\n")
    }),
  )

  it.live('has an empty message where the commit has none, and is refused where who made it can’t be read', () =>
    Effect.gen(function* () {
      const path = repository()
      const tree = git(path, 'rev-parse', 'HEAD^{tree}')

      // No line between its headers and a message: it has none.
      const bare = written(path, `tree ${tree}\n${AUTHOR}\n${COMMITTER}\n`)
      assert.deepStrictEqual(yield* commitRecord(path, bare), {
        tree,
        parents: [],
        author: ada,
        committer: grace,
        message: '',
        keeps: false,
        signed: false,
      })

      // Its author without an address, or no author, committer or tree at all: nothing to make it again from.
      const unreadable = [
        `tree ${tree}\nauthor Ada Lovelace\n${COMMITTER}\n\nStart\n`,
        `tree ${tree}\n${AUTHOR}\ncommitter Grace Hopper <grace@althar.test> yesterday\n\nStart\n`,
        `tree ${tree}\n${COMMITTER}\n\nStart\n`,
        `tree ${tree}\n${AUTHOR}\n\nStart\n`,
        `${AUTHOR}\n${COMMITTER}\n\nStart\n`,
      ]
      for (const text of unreadable) {
        const commit = written(path, text)
        const refused = yield* Effect.flip(commitRecord(path, commit))
        assert.strictEqual(refused.stderr, 'A commit git could not be read.', text)
        assert.deepStrictEqual(refused.args, ['cat-file', 'commit', commit])
      }
    }),
  )
})

describe('a worktree’s tree', () => {
  it.live('is what it holds where nothing was ever staged, and stages nothing of its own', () =>
    Effect.gen(function* () {
      const path = mkdtempSync(join(tmpdir(), 'althar-unstaged-'))
      git(path, 'init', '-q', '-b', 'main')
      writeFileSync(join(path, 'README.md'), '# New\n')
      writeFileSync(join(path, 'notes.txt'), 'Not committed yet.\n')
      // A new repository has no index until something is staged.
      const index = join(path, '.git', 'index')
      assert.isFalse(existsSync(index))
      const tree = yield* treeOf(path)
      assert.isFalse(existsSync(index))
      git(path, 'add', '-A')
      assert.strictEqual(tree, git(path, 'write-tree'))
      assert.strictEqual(git(path, 'ls-tree', '--name-only', tree), 'README.md\nnotes.txt')
    }),
  )
})

describe('the default branch', () => {
  it.live('is the first usual name here where no remote says, else main', () =>
    Effect.gen(function* () {
      const path = repository()
      git(path, 'branch', '-m', 'main', 'trunk')
      git(path, 'branch', 'develop')
      // Neither main nor master: trunk comes before develop.
      assert.strictEqual(yield* defaultBranch(path), 'trunk')
      git(path, 'branch', '-m', 'trunk', 'feature')
      assert.strictEqual(yield* defaultBranch(path), 'develop')
      git(path, 'branch', '-D', 'develop')
      // None of them: main, never the feature branch that happens to be checked out.
      assert.strictEqual(yield* defaultBranch(path), 'main')
    }),
  )
})

describe('a fetch by URL', () => {
  it.live('signs in with the connection’s header, and is null for a branch the remote doesn’t have', () =>
    Effect.gen(function* () {
      const { working, bare } = hosted()
      const target = { url: bare, header: 'Authorization: Basic eDp5' }
      const head = git(working, 'rev-parse', 'HEAD')
      assert.strictEqual(yield* fetchInto(working, target, 'main', 'refs/althar/fetched/main'), head)
      assert.strictEqual(git(working, 'rev-parse', 'refs/althar/fetched/main'), head)
      assert.isNull(yield* fetchInto(working, target, 'nowhere', 'refs/althar/fetched/nowhere'))
    }),
  )
})

describe('the remote work goes to', () => {
  it.live('is the one the default branch follows, else origin, else the only one; none where it can’t tell', () =>
    Effect.gen(function* () {
      const path = repository()
      assert.isNull(yield* remoteOf(path, 'main'))
      git(path, 'remote', 'add', 'fork', 'https://github.test/ninemate/api.git')
      // The only remote, whatever it is called.
      assert.strictEqual(yield* remoteOf(path, 'main'), 'fork')
      git(path, 'remote', 'add', 'upstream', 'https://github.test/meridian/api.git')
      // Two, neither origin, and main follows neither: no way to tell.
      assert.isNull(yield* remoteOf(path, 'main'))
      git(path, 'remote', 'add', 'origin', 'https://github.test/me/api.git')
      assert.strictEqual(yield* remoteOf(path, 'main'), 'origin')
      git(path, 'config', 'branch.main.remote', 'upstream')
      git(path, 'config', 'branch.main.merge', 'refs/heads/main')
      assert.strictEqual(yield* remoteOf(path, 'main'), 'upstream')
      // Following a branch here follows no remote: origin, as before.
      git(path, 'config', 'branch.main.remote', '.')
      assert.strictEqual(yield* remoteOf(path, 'main'), 'origin')
    }),
  )
})
