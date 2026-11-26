import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { Agents, listenLocalApi, Projects, Runtime, Secrets, services } from '@althar/runtime'
import { apiClient, openLocalConnection } from '@althar/transport-node'
import { removeTreeSync } from '@althar/testing'
import { until } from '@althar/testing/effect'
import { assert, it } from '@effect/vitest'
import { Context, Effect, Layer } from 'effect'
import { runAttachment } from '../src/attachment'
import { Readable } from 'node:stream'

it.live('attaches the built CLI to an already locked profile and disconnects on quit or SIGINT without stopping the home', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = mkdtempSync(join(tmpdir(), 'althar-cli-process-'))
      yield* Effect.addFinalizer(() => Effect.sync(() => removeTreeSync(root)))
      const profile = join(root, 'profile')
      mkdirSync(profile, { mode: 0o700 })
      const repo = join(root, 'repo')
      execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' })
      execFileSync(
        'git',
        ['-c', 'user.name=CLI Fixture', '-c', 'user.email=balazs@otakomaiya.com', 'commit', '--allow-empty', '-m', 'Initial'],
        { cwd: repo, stdio: 'ignore' },
      )
      const context = yield* Layer.build(
        services({
          database: join(profile, 'althar.sqlite'),
          worktreeRoot: join(root, 'worktrees'),
          accountsRoot: join(root, 'accounts'),
          artifactsRoot: join(root, 'artifacts'),
          agentConfigs: { homeDir: root, folder: join(root, 'sync') },
          appVersion: 'test',
          deviceName: 'fixture',
          agents: Layer.succeed(Agents, Agents.from([])),
          secrets: Secrets.memory(),
        }),
      )
      const project = yield* Effect.gen(function* () {
        const path = repo
        return yield* Context.get(context, Projects).open({ path, envelope: yield* Runtime.envelope('project.open', { path }) })
      }).pipe(Effect.provideContext(context))
      const endpoint = yield* listenLocalApi(profile).pipe(Effect.provideContext(context))
      const { api } = yield* apiClient(yield* openLocalConnection(profile, endpoint.homeId))
      let inspected = ''
      yield* runAttachment(
        { command: 'inspect', target: { kind: 'local', profile, homeId: endpoint.homeId }, json: false },
        {
          input: Readable.from([]),
          write: (text) =>
            Effect.sync(() => {
              inspected += text
            }),
        },
      )
      assert.include(inspected, project.projectId)
      assert.include(inspected, endpoint.homeId)
      const task = yield* api.CreateTask({ commandId: `cmd_${'1'.repeat(32)}`, projectId: project.projectId, title: 'Keep working' })
      const run = (args: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          const child = spawn(process.execPath, [resolve('dist/althar.js'), ...args], {
            stdio: 'pipe',
            env: {
              HOME: root,
              USERPROFILE: root,
              PATH: process.platform === 'win32' ? process.env.SystemRoot : '/usr/bin:/bin',
              ...(process.env.SystemRoot === undefined ? {} : { SystemRoot: process.env.SystemRoot }),
            },
          })
          let output = ''
          let error = ''
          child.stdout.on('data', (data: Buffer) => {
            output += data.toString()
          })
          child.stderr.on('data', (data: Buffer) => {
            error += data.toString()
          })
          const closed = new Promise<number | null>((done) => child.once('close', done))
          yield* Effect.addFinalizer(() =>
            Effect.promise(async () => {
              if (child.exitCode === null && child.signalCode === null) child.kill()
              await closed
            }),
          )
          return { child, output: () => output, error: () => error, closed }
        })
      const inspect = yield* run(['inspect', '--profile', profile, '--json'])
      assert.strictEqual(yield* Effect.promise(() => inspect.closed), 0, inspect.error())
      assert.strictEqual(JSON.parse(inspect.output()).info.identity.homeId, endpoint.homeId)
      const interactive = yield* run(['attach', '--profile', profile, '--home', endpoint.homeId, '--thread', task.threadId])
      interactive.child.stdin.end('/allow\n/quit\n')
      assert.strictEqual(yield* Effect.promise(() => interactive.closed), 0, interactive.error())
      assert.include(interactive.output(), 'can’t answer permissions')
      const interrupted = yield* run(['attach', '--profile', profile, '--thread', task.threadId])
      yield* until(
        Effect.sync(() => {
          if (interrupted.child.exitCode !== null) throw new Error(interrupted.error())
          return interrupted.output().includes('No agent is running.')
        }),
        Boolean,
      )
      interrupted.child.kill('SIGINT')
      // Windows' TerminateProcess is not a POSIX signal; the same scope cleanup is covered in source tests there.
      const code = yield* Effect.promise(() => interrupted.closed)
      if (process.platform !== 'win32') assert.strictEqual(code, 0, interrupted.error())
      assert.strictEqual((yield* api.GetThread({ threadId: task.threadId })).task.title, 'Keep working')
    }),
  ),
)
