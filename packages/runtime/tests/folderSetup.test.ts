import { execFileSync } from 'node:child_process'
import { type AddressInfo, createServer, type Socket } from 'node:net'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Fiber } from 'effect'
import { afterEach, vi } from 'vitest'

import { CloneRefused, FolderRefused, PublishRefused } from '../src/errors'
import { cloneFolderOf, cloneRepository, IGNORED, prepareFolder, whyCloneFailed } from '../src/folderSetup'
import { readFolder } from '../src/Projects'
import { publishRepository } from '../src/publish'
import { words } from '../src/words'
import { until } from '@althar/testing/effect'

/*
 * A project set up where it starts: a folder made ready to be its repository
 * (git where it has none, a first commit where it has git and none); a
 * repository cloned from its host; and one only on this computer put on a
 * host, made there, set as `origin`, and pushed.
 */

const temp = (prefix = 'althar-setup-') => realpathSync(mkdtempSync(join(tmpdir(), prefix)))

/** git, as the person has it: their identity in a config of the test's own, or none. */
const as = (identity: string | null) => {
  const config = join(temp(), 'gitconfig')
  const who = identity === null ? '' : `\tname = ${identity}\n\temail = ${identity.toLowerCase()}@example.test\n`
  writeFileSync(config, `[user]\n${who}\tuseConfigOnly = true\n[init]\n\tdefaultBranch = trunk\n`)
  vi.stubEnv('GIT_CONFIG_GLOBAL', config)
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
  for (const key of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'EMAIL'])
    vi.stubEnv(key, undefined)
}

const git = (cwd: string, ...args: ReadonlyArray<string>) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const tracked = (cwd: string) =>
  git(cwd, 'ls-files')
    .split('\n')
    .filter((line) => line !== '')
    .toSorted()

/** A folder with these files in it, each path's folders made. */
const folderWith = (files: Readonly<Record<string, string>>) => {
  const at = temp()
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(at, path, '..'), { recursive: true })
    writeFileSync(join(at, path), content)
  }
  return at
}

/** A repository with a commit, for a clone's source: bare, as a host keeps it. */
const bareWith = (files: Readonly<Record<string, string>>) => {
  const work = folderWith(files)
  git(work, 'init', '--quiet', '--initial-branch=main')
  git(work, 'add', '--all')
  // Its own author: the host's commit, whoever runs the tests and whatever identity they have.
  git(work, '-c', 'user.name=Host', '-c', 'user.email=host@example.test', 'commit', '--quiet', '--message', 'Start')
  const bare = join(temp(), 'origin.git')
  git(work, 'clone', '--quiet', '--bare', work, bare)
  return bare
}

afterEach(() => vi.unstubAllEnvs())

describe('a folder that isn’t a repository', () => {
  it.effect('gets git on main, whatever git’s own default, with its files as the first commit and a .gitignore', () =>
    Effect.gen(function* () {
      as('Dana')
      const at = folderWith({
        'README.md': '# Tidepool',
        'src/main.ts': 'export {}',
        '.env': 'SECRET=1',
        '.env.example': 'SECRET=',
        'node_modules/x/index.js': '',
      })
      const prepared = yield* prepareFolder(at)
      assert.deepStrictEqual(prepared, { did: 'started', path: at, branch: 'main', files: 4 })
      assert.strictEqual(git(at, 'branch', '--show-current'), 'main')
      // What holds secrets, and what's installed, stays out; an example of the secrets goes in.
      assert.deepStrictEqual(tracked(at), ['.env.example', '.gitignore', 'README.md', 'src/main.ts'])
      assert.strictEqual(readFileSync(join(at, '.gitignore'), 'utf8'), IGNORED)
      assert.strictEqual(git(at, 'log', '--format=%an|%s'), 'Dana|Initial commit')
      assert.strictEqual(git(at, 'status', '--porcelain', '--untracked-files=no'), '')
    }),
  )

  it.effect('keeps a .gitignore of its own, as it is, and what holds secrets out of the commit all the same', () =>
    Effect.gen(function* () {
      as('Dana')
      const at = folderWith({
        '.gitignore': 'build/\n',
        'build/out.js': '',
        'app.py': '',
        '.env': 'SECRET=1',
        'config/.env.production': 'SECRET=2',
        'certs/server.pem': '',
        '.env.example': 'SECRET=',
      })
      const prepared = yield* prepareFolder(at)
      assert.deepInclude(prepared, { did: 'started', files: 3 })
      assert.strictEqual(readFileSync(join(at, '.gitignore'), 'utf8'), 'build/\n')
      assert.deepStrictEqual(tracked(at), ['.env.example', '.gitignore', 'app.py'])
      // Still in the folder, untracked, as they were.
      assert.strictEqual(readFileSync(join(at, '.env'), 'utf8'), 'SECRET=1')
      assert.match(git(at, 'status', '--porcelain'), /\?\? \.env\n/)
    }),
  )

  it.effect('with a .git git can’t read is refused, and the .git and its history are left as they were', () =>
    Effect.gen(function* () {
      as('Dana')
      const at = folderWith({ 'app.py': '' })
      git(at, 'init', '--quiet', '--initial-branch=main')
      git(at, 'add', '--all')
      git(at, 'commit', '--quiet', '-m', 'Theirs')
      const objects = readdirSync(join(at, '.git', 'objects')).toSorted()
      writeFileSync(join(at, '.git', 'HEAD'), 'garbage\n')
      const refused = yield* Effect.flip(prepareFolder(at))
      assert.deepInclude(refused, { reason: 'broken_repository' })
      assert.match(words(refused, (id) => id).message, /has a \.git that git can’t read\. Mend it, or choose another folder\./)
      assert.strictEqual(readFileSync(join(at, '.git', 'HEAD'), 'utf8'), 'garbage\n')
      assert.deepStrictEqual(readdirSync(join(at, '.git', 'objects')).toSorted(), objects)
      assert.isFalse(existsSync(join(at, '.gitignore')))
    }),
  )

  it.effect('that is empty gets git and a first commit of its .gitignore, which reading it said was empty', () =>
    Effect.gen(function* () {
      as(null)
      const at = temp()
      writeFileSync(join(at, '.DS_Store'), '')
      const read = yield* readFolder(at)
      assert.deepInclude(read, { kind: 'folder', empty: true, repositories: [] })
      const prepared = yield* prepareFolder(at)
      assert.deepStrictEqual(prepared, { did: 'started', path: at, branch: 'main', files: 1 })
      // Git knows no one: Althar commits it.
      assert.strictEqual(git(at, 'log', '--format=%an'), 'Althar')
    }),
  )

  it.effect('with files is read as not empty', () =>
    Effect.gen(function* () {
      const read = yield* readFolder(folderWith({ 'notes.md': '' }))
      assert.deepInclude(read, { kind: 'folder', empty: false })
    }),
  )

  it.effect('with repositories inside is refused, and left as it was', () =>
    Effect.gen(function* () {
      as('Dana')
      const at = folderWith({ 'notes.md': '', 'deep/app/README.md': '' })
      git(join(at, 'deep/app'), 'init', '--quiet')
      const refused = yield* Effect.flip(prepareFolder(at))
      assert.instanceOf(refused, FolderRefused)
      assert.deepInclude(refused, { reason: 'repositories_inside', names: ['deep/app'] })
      assert.deepStrictEqual(readdirSync(at).toSorted(), ['deep', 'notes.md'])
      assert.match(words(refused, (id) => id).message, /has git repositories inside it: deep\/app\. Choose one of them/)
      // One inside with commits, which git would take in as an empty link.
      git(join(at, 'deep/app'), 'add', '--all')
      git(join(at, 'deep/app'), 'commit', '--quiet', '-m', 'Its own')
      assert.deepInclude(yield* Effect.flip(prepareFolder(at)), { reason: 'repositories_inside', names: ['deep/app'] })
      assert.deepStrictEqual(readdirSync(at).toSorted(), ['deep', 'notes.md'])
    }),
  )

  it.effect('with more files than a repository starts with is refused, and left as it was', () =>
    Effect.gen(function* () {
      as('Dana')
      const at = folderWith({ 'a.txt': '', 'b.txt': '', 'c.txt': '' })
      const refused = yield* Effect.flip(prepareFolder(at, 3))
      assert.deepInclude(refused, { reason: 'too_many', count: 4 })
      assert.deepStrictEqual(readdirSync(at).toSorted(), ['a.txt', 'b.txt', 'c.txt'])
      assert.match(words(refused, (id) => id).message, /has 4 files, too many to start a repository with/)
    }),
  )

  it.effect('that is the home folder, or one it is in, is refused before anything is made', () =>
    Effect.gen(function* () {
      const home = folderWith({ 'Documents/x.md': '' })
      vi.stubEnv('HOME', home)
      assert.deepInclude(yield* Effect.flip(prepareFolder(home)), { reason: 'too_wide' })
      assert.deepInclude(yield* Effect.flip(prepareFolder(join(home, '..'))), { reason: 'too_wide' })
      assert.isFalse(existsSync(join(home, '.git')))
    }),
  )

  it.effect.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'that can’t be read is said to be, when read and when made ready',
    () =>
      Effect.gen(function* () {
        const at = folderWith({ 'x.md': '' })
        chmodSync(at, 0o000)
        try {
          const read = yield* Effect.flip(readFolder(at))
          assert.deepInclude(read, { _tag: 'FolderRefused', reason: 'unreadable' })
          assert.deepInclude(yield* Effect.flip(prepareFolder(at)), { reason: 'unreadable' })
          assert.match(words(read, (id) => id).message, /Althar can’t read althar-setup-\w+\. Give it access to the folder/)
          assert.deepInclude(
            words(read, (id) => id),
            { why: 'unreadable' },
          )
        } finally {
          chmodSync(at, 0o755)
        }
      }),
  )
})

describe('a repository with no commit yet', () => {
  it.effect('is read as having none, and gets its first of what’s in it, on the branch it is on', () =>
    Effect.gen(function* () {
      as('Dana')
      const at = folderWith({ 'index.html': '<p>hi</p>' })
      git(at, 'init', '--quiet', '--initial-branch=trunk')
      const read = yield* readFolder(at)
      assert.deepInclude(read.repositories[0], { commits: false, branch: 'trunk' })
      assert.deepStrictEqual(yield* prepareFolder(at), { did: 'committed', path: at, branch: 'trunk', files: 1 })
      // No .gitignore is written into a repository of the person's own.
      assert.deepStrictEqual(tracked(at), ['index.html'])
      assert.deepInclude((yield* readFolder(at)).repositories[0], { commits: true })
    }),
  )

  it.effect('keeps what holds secrets out of its first commit, its own ignore saying nothing of them', () =>
    Effect.gen(function* () {
      as('Dana')
      const at = folderWith({ 'index.html': '', '.env': 'SECRET=1', 'deploy/id_ed25519': 'key', 'deploy/id_ed25519.pub': 'public' })
      git(at, 'init', '--quiet', '--initial-branch=trunk')
      assert.deepInclude(yield* prepareFolder(at), { did: 'committed', files: 2 })
      assert.deepStrictEqual(tracked(at), ['deploy/id_ed25519.pub', 'index.html'])
    }),
  )

  it.effect('that has a commit, or a folder inside one, is left as it is', () =>
    Effect.gen(function* () {
      as('Dana')
      const at = folderWith({ 'pkg/a.ts': '' })
      git(at, 'init', '--quiet', '--initial-branch=main')
      git(at, 'add', '--all')
      git(at, 'commit', '--quiet', '-m', 'Mine')
      writeFileSync(join(at, 'pkg/b.ts'), '')
      assert.deepStrictEqual(yield* prepareFolder(at), { did: 'nothing', path: at, branch: 'main', files: 0 })
      assert.deepStrictEqual(yield* prepareFolder(join(at, 'pkg')), { did: 'nothing', path: at, branch: 'main', files: 0 })
      assert.strictEqual(git(at, 'log', '--format=%s'), 'Mine')
      assert.match(git(at, 'status', '--porcelain'), /\?\? pkg\/b\.ts/)
    }),
  )
})

describe('a clone', () => {
  it.effect('goes in a folder of its name in the one chosen, with origin its URL', () =>
    Effect.gen(function* () {
      const bare = bareWith({ 'README.md': '# Tidepool' })
      const parent = temp()
      const path = yield* cloneRepository({
        parent,
        remote: 'balazs/tidepool',
        host: 'GitHub',
        folder: 'tidepool',
        target: { url: bare, header: null },
      })
      assert.strictEqual(path, join(parent, 'tidepool'))
      assert.strictEqual(readFileSync(join(path, 'README.md'), 'utf8'), '# Tidepool')
      assert.strictEqual(git(path, 'remote', 'get-url', 'origin'), bare)
    }),
  )

  it.effect('uses an empty folder of its name, and refuses one with something in it', () =>
    Effect.gen(function* () {
      const bare = bareWith({ 'a.md': '' })
      const parent = temp()
      mkdirSync(join(parent, 'tidepool'))
      const source = { parent, remote: 'balazs/tidepool', host: 'GitHub', folder: 'tidepool', target: { url: bare, header: null } }
      yield* cloneRepository(source)
      const taken = yield* Effect.flip(cloneRepository(source))
      assert.instanceOf(taken, FolderRefused)
      assert.deepInclude(taken, { reason: 'taken' })
      assert.match(words(taken, (id) => id).message, /There’s a folder named tidepool in althar-setup-\w+ already, with something in it/)
    }),
  )

  it.effect('that fails takes away what it made, and leaves an empty folder that was there as it was', () =>
    Effect.gen(function* () {
      const parent = temp()
      const gone = {
        parent,
        remote: 'balazs/gone',
        host: 'GitHub',
        folder: 'gone',
        target: { url: join(parent, 'nowhere.git'), header: null },
      }
      const refused = yield* Effect.flip(cloneRepository(gone))
      assert.instanceOf(refused, CloneRefused)
      assert.isFalse(existsSync(join(parent, 'gone')))
      mkdirSync(join(parent, 'gone'))
      yield* Effect.flip(cloneRepository(gone))
      assert.deepStrictEqual(readdirSync(join(parent, 'gone')), [])
    }),
  )

  it.live('stopped after it wrote something takes that away, and leaves an empty folder that was there as it was', () =>
    Effect.gen(function* () {
      // A host that takes the connection and never answers: git has made its .git by then, and waits.
      const sockets: Array<Socket> = []
      const server = createServer((socket) => void sockets.push(socket))
      yield* Effect.promise(() => new Promise<void>((done) => server.listen(0, '127.0.0.1', done)))
      const { port } = server.address() as AddressInfo
      const parent = temp()
      mkdirSync(join(parent, 'held'))
      const fiber = yield* Effect.forkChild(
        cloneRepository({
          parent,
          remote: 'balazs/held',
          host: 'GitHub',
          folder: 'held',
          target: { url: `http://127.0.0.1:${port}/held.git`, header: null },
        }),
      )
      yield* until(
        Effect.sync(() => readdirSync(join(parent, 'held'))),
        (names) => names.includes('.git'),
      )
      yield* Fiber.interrupt(fiber)
      for (const socket of sockets) socket.destroy()
      server.close()
      assert.deepStrictEqual(readdirSync(join(parent, 'held')), [])
    }),
  )

  it.effect('refuses a folder name that would leave the folder chosen', () =>
    Effect.gen(function* () {
      const parent = temp()
      for (const folder of ['', '.', '..', '../elsewhere'])
        assert.deepInclude(
          yield* Effect.flip(cloneRepository({ parent, remote: 'x', host: 'GitHub', folder, target: { url: 'x', header: null } })),
          { reason: 'taken' },
        )
    }),
  )

  it('reads why git refused it: single sign-on, with where to sign in; a repository it can’t see; anything else', () => {
    assert.deepStrictEqual(
      whyCloneFailed(
        "remote: The 'charrette' organization has enabled or enforced SAML SSO.\nremote: To access this repository, visit https://github.com/orgs/charrette/sso?authorization_request=AB12 and try your request again.",
      ),
      { reason: 'sso', url: 'https://github.com/orgs/charrette/sso?authorization_request=AB12' },
    )
    assert.deepStrictEqual(whyCloneFailed('remote: Repository not found.\nfatal: repository not found'), { reason: 'not_found' })
    assert.deepStrictEqual(whyCloneFailed('fatal: unable to access: Could not resolve host'), { reason: 'failed' })
    assert.strictEqual(cloneFolderOf(['group', 'sub', 'app.git']), 'app')
    assert.strictEqual(
      words(
        new CloneRefused({ reason: 'sso', remote: 'charrette/infra', host: 'GitHub', url: 'https://github.com/orgs/charrette/sso' }),
        (id) => id,
      ).detail,
      'https://github.com/orgs/charrette/sso',
    )
  })
})

describe('a repository put on a host', () => {
  /** A repository only here, with a commit, and a host whose pushes go to a bare repository of the test's. */
  const setUp = (options: { readonly pushes?: 'work' | 'fail' } = {}) => {
    as('Dana')
    const root = folderWith({ 'README.md': '# Tidepool' })
    git(root, 'init', '--quiet', '--initial-branch=main')
    git(root, 'add', '--all')
    git(root, 'commit', '--quiet', '-m', 'Start')
    const bare = join(temp(), 'tidepool.git')
    git(temp(), 'init', '--quiet', '--bare', bare)
    let pushes = options.pushes ?? 'work'
    const host = makeFakeService({ pushUrl: () => (pushes === 'work' ? bare : join(bare, 'missing')) })
    const input = {
      root,
      host,
      hostName: 'GitHub',
      owner: { id: 'you', name: 'You', kind: 'user' as const },
      name: 'tidepool',
      private: true,
      // `origin`, where it is the bare repository the host pushes to, is its repository there.
      originOf: (url: string) => Effect.succeed(url === bare || url === join(bare, 'missing') ? ['you', 'tidepool'] : null),
    }
    return { root, bare, host, input, letPushes: () => void (pushes = 'work') }
  }

  it.effect('is made there, empty and as chosen; origin is it, and its branch is pushed and followed', () =>
    Effect.gen(function* () {
      const { root, bare, host, input } = setUp()
      const published = yield* publishRepository(input)
      assert.deepInclude(published, { remote: 'you/tidepool', branch: 'main' })
      assert.deepStrictEqual(host.repositoriesMade, [{ owner: input.owner, name: 'tidepool', private: true }])
      assert.strictEqual(git(root, 'remote', 'get-url', 'origin'), bare)
      assert.strictEqual(git(bare, 'rev-parse', 'main'), git(root, 'rev-parse', 'HEAD'))
      assert.strictEqual(git(root, 'rev-parse', '--abbrev-ref', 'main@{upstream}'), 'origin/main')
      // Nothing to push: the person's own git agrees with the host.
      assert.match(git(root, 'status', '--branch', '--porcelain'), /^## main\.\.\.origin\/main$/m)
    }),
  )

  it.effect('as a folder made ready: what holds secrets never reaches it, its own ignore or none', () =>
    Effect.gen(function* () {
      for (const files of [
        { '.gitignore': 'build/\n', 'app.py': '', '.env': 'SECRET=1' },
        { 'app.py': '', '.env.local': 'SECRET=1' },
      ]) {
        const { bare, input } = setUp()
        const root = folderWith(files)
        yield* prepareFolder(root)
        yield* publishRepository({ ...input, root })
        assert.deepStrictEqual(git(bare, 'ls-tree', '-r', '--name-only', 'main').split('\n').toSorted(), ['.gitignore', 'app.py'])
      }
    }),
  )

  it.effect('that has a remote already is refused, and nothing is made', () =>
    Effect.gen(function* () {
      const { root, host, input } = setUp()
      git(root, 'remote', 'add', 'origin', 'https://gitlab.com/someone/else.git')
      const refused = yield* Effect.flip(publishRepository(input))
      assert.instanceOf(refused, PublishRefused)
      assert.deepInclude(refused, { reason: 'has_remote', remote: 'https://gitlab.com/someone/else.git' })
      assert.lengthOf(host.repositoriesMade, 0)
    }),
  )

  it.effect('with a name the host has already is refused, in the host’s words, and nothing changes here', () =>
    Effect.gen(function* () {
      const { root, host, input } = setUp()
      host.addRepository(['you', 'tidepool'])
      const refused = yield* Effect.flip(publishRepository(input))
      assert.deepInclude(refused, { reason: 'taken', remote: 'you/tidepool', host: 'GitHub' })
      assert.strictEqual(words(refused, (id) => id).message, 'There’s a you/tidepool on GitHub already. Choose another name.')
      assert.strictEqual(git(root, 'remote'), '')
    }),
  )

  it.effect('made and not pushed keeps origin, and trying again pushes to the one made rather than making another', () =>
    Effect.gen(function* () {
      const { root, bare, host, input, letPushes } = setUp({ pushes: 'fail' })
      const failed = yield* Effect.flip(publishRepository(input))
      assert.deepInclude(failed, { reason: 'push_failed', remote: 'you/tidepool' })
      assert.match(words(failed, (id) => id).message, /you\/tidepool is made on GitHub, but pushing to it didn’t work\. Try again\./)
      assert.lengthOf(host.repositoriesMade, 1)
      letPushes()
      git(root, 'remote', 'set-url', 'origin', bare)
      yield* publishRepository(input)
      assert.lengthOf(host.repositoriesMade, 1)
      assert.strictEqual(git(bare, 'rev-parse', 'main'), git(root, 'rev-parse', 'HEAD'))
      // Pushed, it is on the host: putting it there again is refused.
      assert.deepInclude(yield* Effect.flip(publishRepository(input)), { reason: 'has_remote' })
    }),
  )
})
