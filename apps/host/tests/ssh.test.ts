import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { userInfo } from 'node:os'
import { join, resolve } from 'node:path'

import { Agents } from '@althar/runtime'
import { apiClient, inspectSshHost, openSshConnection } from '@althar/transport-node'
import { until } from '@althar/testing/effect'
import { assert, it } from '@effect/vitest'
import { Deferred, Effect, Layer } from 'effect'

import { initializeHome, serveHome, type HomeReady } from '../src/home'
import { parseOptions } from '../src/options'
import { temporary } from './support'

const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`
const portNumber = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close()
        reject(new Error('No test port'))
        return
      }
      server.close((error) => (error == null ? resolve(address.port) : reject(error)))
    })
  })

it.live('uses real OpenSSH with pinned keys, preserves host state after disconnect and rejects changed host keys and homes', () =>
  Effect.scoped(
    Effect.gen(function* () {
      // This daemon uses only fixture keys. Container root ownership may be anonymized; StrictModes is off only on this isolated test daemon.
      const root = temporary(process.cwd())
      chmodSync(root, 0o700)
      const profile = join(root, "profile '$literal")
      const options = parseOptions(['init', '--profile', profile, '--key-file', join(root, 'keys/master')], {}, root)
      const dependencies = {
        agents: Layer.succeed(Agents, Agents.from([])),
        agentConfigs: { homeDir: root, folder: join(root, 'agent-sync') },
      }
      const initialized = yield* initializeHome(options, dependencies)
      const ready = yield* Deferred.make<HomeReady>()
      yield* Effect.forkScoped(serveHome(options, (info) => Effect.asVoid(Deferred.succeed(ready, info)), dependencies))
      yield* Deferred.await(ready)
      for (const name of ['host-key', 'client-key', 'wrong-key'])
        execFileSync('/usr/bin/ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(root, name)], {
          stdio: 'pipe',
          env: { PATH: '/usr/bin:/bin' },
        })
      const port = yield* Effect.promise(portNumber)
      const config = join(root, 'sshd.conf')
      writeFileSync(
        config,
        `Port ${port}\nListenAddress 127.0.0.1\nHostKey ${join(root, 'host-key')}\nPidFile ${join(root, 'sshd.pid')}\nAuthorizedKeysFile ${join(root, 'client-key.pub')}\nUsePAM no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nStrictModes no\nAllowUsers ${userInfo().username}\nLogLevel VERBOSE\n`,
        { mode: 0o600 },
      )
      const sshd = spawn('/usr/sbin/sshd', ['-D', '-e', '-f', config], {
        stdio: ['ignore', 'ignore', 'pipe'],
        env: { PATH: '/usr/bin:/bin' },
      })
      let log = ''
      sshd.stderr.on('data', (bytes: Buffer) => {
        log = (log + bytes.toString('utf8')).slice(-16_384)
      })
      const closed = new Promise<void>((done) => {
        sshd.once('close', () => done())
        sshd.once('error', () => done())
      })
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          sshd.kill('SIGTERM')
          await closed
        }),
      )
      yield* until(
        Effect.sync(() => {
          if (sshd.exitCode !== null) throw new Error(log)
          return log.includes('Server listening')
        }),
        Boolean,
      )
      const knownHosts = join(root, 'known_hosts')
      const pinned = (name: string) => `[127.0.0.1]:${port} ${readFileSync(join(root, `${name}.pub`), 'utf8')}`
      writeFileSync(knownHosts, pinned('host-key'), { mode: 0o600 })
      const sshConfig = join(root, 'ssh.conf')
      writeFileSync(
        sshConfig,
        `Host fixture\n  HostName 127.0.0.1\n  Port ${port}\n  User ${userInfo().username}\n  IdentityFile ${join(root, 'client-key')}\n  IdentitiesOnly yes\n  UserKnownHostsFile ${knownHosts}\n  GlobalKnownHostsFile /dev/null\n`,
        { mode: 0o600 },
      )
      const launcher = join(root, "launcher '$literal")
      writeFileSync(launcher, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(resolve('dist/althar-host.js'))} "$@"\n`, { mode: 0o700 })
      const target = { target: 'fixture', launcher, profile, configFile: sshConfig }
      const status = yield* inspectSshHost(target, { environment: { PATH: '/usr/bin:/bin', HOME: root } }).pipe(
        Effect.mapError((error) => new Error(`${error.reason}\n${log}`)),
      )
      assert.strictEqual(status.homeId, initialized.homeId)
      const connect = Effect.scoped(
        Effect.gen(function* () {
          const connection = yield* openSshConnection(
            { ...target, homeId: initialized.homeId },
            { environment: { PATH: '/usr/bin:/bin', HOME: root } },
          )
          const { api, info } = yield* apiClient(connection)
          assert.strictEqual(info.identity.role, 'socket')
          assert.deepStrictEqual((yield* api.ListProjects()).projects, [])
          assert.strictEqual(
            (yield* Effect.flip(api.Answer({ commandId: `cmd_${'1'.repeat(32)}`, attentionId: 'none', decision: 'allow' }))).reason,
            'PersonRequired',
          )
          return info.identity
        }),
      )
      assert.deepStrictEqual(yield* connect, yield* connect)
      const wrongHome = yield* Effect.scoped(
        Effect.flip(
          openSshConnection({ ...target, homeId: `home_${'9'.repeat(32)}` }, { environment: { PATH: '/usr/bin:/bin', HOME: root } }),
        ),
      )
      assert.strictEqual(wrongHome.reason, 'HomeMismatch')
      writeFileSync(knownHosts, pinned('wrong-key'))
      const refused = yield* Effect.flip(inspectSshHost(target, { environment: { PATH: '/usr/bin:/bin', HOME: root } }))
      assert.strictEqual(refused.reason, 'SshHostKeyRejected')
    }),
  ),
)
