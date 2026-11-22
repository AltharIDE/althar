import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import { Api, clientProtocol, emitterPort } from '@althar/contracts'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { RpcClient } from 'effect/rpc'

import { connection, services } from '../src/Api'
import { firstPlace, homeFolders } from '../src/homeFolders'
import { Secrets } from '../src/Secrets'

import { fakeAgents, fakeConnectors, ROOMY } from './support'

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

/** The home's runtime on one end of a channel, and a window on another computer (socket authority) on the other. */
const onHome = (home: string) =>
  Effect.gen(function* () {
    const channel = new MessageChannel()
    yield* Effect.addFinalizer(() => Effect.sync(() => channel.port1.close()))
    const context = yield* Layer.build(
      services({
        database: ':memory:',
        worktreeRoot: temp('althar-worktrees-'),
        appVersion: '0.0.0-test',
        deviceName: 'runner-1',
        agents: fakeAgents(),
        secrets: Secrets.memory(),
        connectors: fakeConnectors({}),
        accountsRoot: temp('althar-accounts-'),
        agentsRoot: temp('althar-agents-'),
        busy: { machine: ROOMY },
        checksAppear: Duration.zero,
        elsewhere: { home, env: {} },
      }),
    )
    yield* Effect.forkScoped(
      Layer.launch(
        connection(
          emitterPort(channel.port1, (data) => data),
          { kind: 'socket' },
        ),
      ).pipe(Effect.provideContext(context)),
    )
    const protocol = yield* Layer.build(clientProtocol(emitterPort(channel.port2, (data) => data)))
    return yield* RpcClient.make(Api).pipe(Effect.provideContext(protocol))
  })

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
