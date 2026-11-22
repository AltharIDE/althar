import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import { makeFakeService } from '@althar/connectors/testing'
import { Api, clientProtocol, emitterPort, type MessageSender } from '@althar/contracts'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { RpcClient } from 'effect/rpc'

import { connection, services } from '../src/Api'
import { firstPlace, homeFolders } from '../src/homeFolders'
import { Secrets } from '../src/Secrets'

import { fakeAgents, fakeConnectors, HOST, ROOMY } from './support'

/*
 * A window on another computer makes a project on the home it's on: the home
 * finds where its person keeps code and where a new project goes, and grants
 * each folder itself, as the picker does on a desktop; the window names no
 * path, and can't open one the home didn't find.
 */

const commandId = () => `cmd_${randomBytes(16).toString('hex')}`

const temp = (prefix: string) => realpathSync(mkdtempSync(join(tmpdir(), prefix)))

/** A repository with one commit, at `path`. */
const repositoryAt = (path: string) => {
  mkdirSync(path, { recursive: true })
  execFileSync('git', ['init', '--quiet', '--initial-branch', 'main'], { cwd: path })
  writeFileSync(join(path, 'README.md'), '# Here\n')
  execFileSync('git', ['add', '.'], { cwd: path })
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '--quiet', '-m', 'First'], { cwd: path })
  return path
}

/** A client on one end of a channel, the home's runtime with `sender`'s authority on the other. */
const clientOf = (context: Effect.Success<ReturnType<typeof homeAt>>, sender: MessageSender) =>
  Effect.gen(function* () {
    const channel = new MessageChannel()
    yield* Effect.addFinalizer(() => Effect.sync(() => channel.port1.close()))
    yield* Effect.forkScoped(
      Layer.launch(
        connection(
          emitterPort(channel.port1, (data) => data),
          sender,
        ),
      ).pipe(Effect.provideContext(context)),
    )
    const protocol = yield* Layer.build(clientProtocol(emitterPort(channel.port2, (data) => data)))
    return yield* RpcClient.make(Api).pipe(Effect.provideContext(protocol))
  })

/** The home's runtime, its code hosts as `connectors` give them. */
const homeAt = (home: string, connectors = fakeConnectors({})) =>
  Layer.build(
    services({
      database: ':memory:',
      worktreeRoot: temp('althar-worktrees-'),
      appVersion: '0.0.0-test',
      deviceName: 'runner-1',
      agents: fakeAgents(),
      secrets: Secrets.memory(),
      connectors,
      accountsRoot: temp('althar-accounts-'),
      agentsRoot: temp('althar-agents-'),
      busy: { machine: ROOMY },
      checksAppear: Duration.zero,
      elsewhere: { home, env: {} },
    }),
  )

/** The home's runtime, and a window on another computer (socket authority) talking to it. */
const onHome = (home: string) => Effect.flatMap(homeAt(home), (context) => clientOf(context, { kind: 'socket' }))

describe('making a project on a home from a window on another computer', () => {
  it.live('finds the repositories where its person keeps code, and opens one as a project by the grant the home made', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const home = temp('althar-home-')
        repositoryAt(join(home, 'code', 'site'))
        repositoryAt(join(home, 'code', 'api'))
        const client = yield* onHome(home)
        const found = yield* client.FindHomeFolders({})
        assert.deepStrictEqual(found.lookedIn, ['~/code'])
        assert.sameMembers(
          found.repositories.map((one) => `${one.name} ${one.where} ${one.branch}`),
          ['site ~/code/site main', 'api ~/code/api main'],
        )
        // New ones go beside them.
        assert.strictEqual(found.place.where, '~/code')
        // Found again, each is the same grant: asking doesn't pile up grants.
        const again = yield* client.FindHomeFolders({})
        assert.deepStrictEqual(again.place.grant, found.place.grant)
        const site = found.repositories.find((one) => one.name === 'site')!
        assert.strictEqual(again.repositories.find((one) => one.name === 'site')?.grant, site.grant)
        assert.strictEqual((yield* client.ReadFolder({ grant: site.grant })).kind, 'repository')
        const project = yield* client.OpenProject({ commandId: commandId(), grant: site.grant, name: 'Site' })
        assert.strictEqual(project.name, 'Site')
        assert.lengthOf(yield* client.GetRepositories({ projectId: project.id }), 1)
        // A grant the home didn't make opens nothing.
        assert.deepInclude(yield* Effect.flip(client.OpenProject({ commandId: commandId(), grant: 'grant_made_up' })), {
          reason: 'NotFound',
        })
      }),
    ),
  )

  it.live('starts a new repository in the usual place, made as the first project there is', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const home = temp('althar-home-')
        const client = yield* onHome(home)
        const found = yield* client.FindHomeFolders({})
        assert.deepStrictEqual(found.repositories, [])
        assert.deepStrictEqual(found.lookedIn, [])
        const place = firstPlace(home, process.platform)
        assert.isFalse(existsSync(place))
        assert.strictEqual(found.place.where, `~${place.slice(home.length)}`)
        assert.deepInclude(yield* client.PlaceRepository({ grant: found.place.grant, name: 'Tide Tables' }), { name: 'tide-tables' })
        const made = yield* client.MakeRepository({ grant: found.place.grant, name: 'Tide Tables' })
        assert.strictEqual(made.path, join(realpathSync(place), 'tide-tables'))
        const project = yield* client.OpenProject({ commandId: commandId(), grant: made.grant, name: 'Tide Tables' })
        assert.strictEqual(project.name, 'Tide Tables')
      }),
    ),
  )

  it.live('clones a repository from a code host the home is signed in to, as the window’s Create does, and opens it there', () =>
    Effect.scoped(
      Effect.gen(function* () {
        // git reaches GitHub's repository at a bare one of the test's, by its address on the host, as the home's git would.
        const remotes = temp('althar-host-')
        const bare = join(remotes, 'tidepool.git')
        execFileSync('git', ['clone', '-q', '--bare', '--', repositoryAt(join(temp('althar-seed-'), 'tidepool')), bare])
        const config = join(remotes, 'gitconfig')
        writeFileSync(config, `[url "${bare.replaceAll('\\', '/')}"]\n\tinsteadOf = ${HOST}/you/tidepool.git\n`)
        const was = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_NOSYSTEM }
        process.env.GIT_CONFIG_GLOBAL = config
        process.env.GIT_CONFIG_NOSYSTEM = '1'
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            if (was.global === undefined) delete process.env.GIT_CONFIG_GLOBAL
            else process.env.GIT_CONFIG_GLOBAL = was.global
            if (was.system === undefined) delete process.env.GIT_CONFIG_NOSYSTEM
            else process.env.GIT_CONFIG_NOSYSTEM = was.system
          }),
        )
        const github = makeFakeService({ pushUrl: (path) => `${HOST}/${path.join('/')}.git` })
        github.addRepository(['you', 'tidepool'], 'main', { description: 'Tide tables', private: true })
        const home = temp('althar-home-')
        const context = yield* homeAt(home, fakeConnectors({ github }))
        // Signed in to GitHub on the home, by the person there: the window on another computer never holds the token.
        const there = yield* clientOf(context, { kind: 'window' })
        yield* there.ConnectToken({ commandId: commandId(), product: 'github', webUrl: HOST, token: 'ghp_x' })

        const window = yield* clientOf(context, { kind: 'socket' })
        const found = yield* window.FindHomeFolders({})
        const [connection] = (yield* window.ListConnections()).connections
        assert.strictEqual(connection?.state, 'ready')
        const listed = yield* window.ListHostRepositories({ connectionId: connection!.id })
        assert.deepInclude(listed[0], { path: ['you', 'tidepool'] })
        const cloned = yield* window.CloneRepository({
          commandId: commandId(),
          grant: found.place.grant,
          from: { connectionId: connection!.id, path: ['you', 'tidepool'] },
        })
        // Where the home keeps code: its first place, made as the first project there is.
        assert.strictEqual(cloned.path, join(firstPlace(home, process.platform), 'tidepool'))
        const prepared = yield* window.PrepareFolder({ commandId: commandId(), grant: cloned.grant, path: cloned.path })
        const project = yield* window.OpenProject({
          commandId: commandId(),
          grant: cloned.grant,
          name: 'Tidepool',
          repositories: [{ grant: cloned.grant, path: prepared.path }],
        })
        assert.include(
          (yield* window.ListProjects()).projects.map((one) => one.id),
          project.id,
        )
        const [repository] = yield* window.GetRepositories({ projectId: project.id })
        assert.strictEqual(repository?.path, cloned.path)
        assert.strictEqual(
          execFileSync('git', ['config', '--get', 'remote.origin.url'], { cwd: cloned.path, encoding: 'utf8' }).trim(),
          `${HOST}/you/tidepool.git`,
        )
      }),
    ),
  )

  it.live('grants no more than it found: a repository alone, and a place that only takes new code', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const home = temp('althar-home-')
        // The usual place for code is a checkout itself: its folder is the home, with the person's other things in it.
        const code = repositoryAt(join(home, 'code'))
        const secrets = join(home, 'secrets')
        mkdirSync(join(code, 'notes'))
        mkdirSync(secrets)
        writeFileSync(join(secrets, 'keys.txt'), 'not for a window\n')
        const client = yield* onHome(home)
        const found = yield* client.FindHomeFolders({})
        assert.deepStrictEqual(
          found.repositories.map((one) => one.where),
          ['~/code'],
        )
        // New code goes in a usual place of its own, never the home a checkout is in.
        assert.notStrictEqual(found.place.where, '~')
        assert.strictEqual(found.place.where, `~${firstPlace(home, process.platform).slice(home.length)}`)
        const refused = { reason: 'NotFound' }
        const [repository] = found.repositories
        // The place opens nothing, and readies nothing in it.
        assert.deepInclude(yield* Effect.flip(client.ReadFolder({ grant: found.place.grant })), refused)
        assert.deepInclude(
          yield* Effect.flip(client.PrepareFolder({ commandId: commandId(), grant: found.place.grant, path: secrets })),
          refused,
        )
        assert.deepInclude(
          yield* Effect.flip(client.OpenProject({ commandId: commandId(), grant: found.place.grant, name: 'Home' })),
          refused,
        )
        // A repository's opens it, and nothing else by another path: in it, or beside it.
        assert.deepInclude(
          yield* Effect.flip(client.PrepareFolder({ commandId: commandId(), grant: repository!.grant, path: join(code, 'notes') })),
          refused,
        )
        assert.deepInclude(
          yield* Effect.flip(
            client.OpenProject({
              commandId: commandId(),
              grant: repository!.grant,
              name: 'Secrets',
              repositories: [{ grant: repository!.grant, path: secrets }],
            }),
          ),
          refused,
        )
        assert.isFalse(existsSync(join(secrets, '.git')))
        assert.isFalse(existsSync(join(code, 'notes', '.git')))
        // A place doesn't open as a folder for a repository made in it either: that one is granted on its own.
        assert.deepInclude(yield* Effect.flip(client.MakeRepository({ grant: repository!.grant, name: 'Inside' })), refused)
      }),
    ),
  )

  it.live('opens a repository it found only while it is still there: not a link put in its place since', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const home = temp('althar-home-')
        const site = repositoryAt(join(home, 'code', 'site'))
        const elsewhere = repositoryAt(join(home, 'elsewhere'))
        const client = yield* onHome(home)
        const [found] = (yield* client.FindHomeFolders({})).repositories
        assert.strictEqual((yield* client.ReadFolder({ grant: found!.grant })).kind, 'repository')
        renameSync(site, join(home, 'code', 'moved'))
        symlinkSync(elsewhere, site)
        assert.deepInclude(yield* Effect.flip(client.ReadFolder({ grant: found!.grant })), { reason: 'NotFound' })
      }),
    ),
  )

  it.live('tells its window which calls it may make, so the window offers no more than that', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* onHome(temp('althar-home-'))
        const info = yield* client.GetConnectionInfo({})
        assert.include(info.calls ?? [], 'FindHomeFolders')
        assert.include(info.calls ?? [], 'CloneRepository')
        assert.notInclude(info.calls ?? [], 'PublishRepository')
      }),
    ),
  )

  it.live('says what the machine is: its system, cores, memory, room and git', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* onHome(temp('althar-home-'))
        const machine = yield* client.GetMachine({})
        assert.isAbove(machine.cores, 0)
        assert.isAbove(machine.memory, 0)
        assert.isNotEmpty(machine.system)
        assert.isNotNull(machine.disk)
        assert.isAbove(machine.disk?.size ?? 0, machine.disk?.free ?? 0)
        assert.match(machine.git ?? '', /^\d+\.\d+/)
      }),
    ),
  )
})

describe('the home’s folders', () => {
  it.effect('grant each folder once, however often they’re found', () =>
    Effect.gen(function* () {
      const home = temp('althar-home-')
      repositoryAt(join(home, 'projects', 'one'))
      let made = 0
      const find = homeFolders((path) => Effect.sync(() => `grant_${(made += 1)}_${path.length}`), home, 'linux')
      const first = yield* find
      const second = yield* find
      assert.deepStrictEqual(second, first)
      assert.strictEqual(made, 2)
      assert.strictEqual(first.place.where, '~/projects')
    }),
  )

  it('go in ~/projects on Linux and ~/Projects elsewhere, where there is no usual place yet', () => {
    assert.strictEqual(firstPlace('/home/you', 'linux'), '/home/you/projects')
    assert.strictEqual(firstPlace('/Users/you', 'darwin'), '/Users/you/Projects')
  })
})
