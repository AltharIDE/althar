import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import { AgentRunOutcome, type AgentManagedExit, type AgentRunExit } from '@althar/worker-protocol'
import type { AgentWorkerPool, WorkerAgentProcess } from '@althar/worker-protocol/agent-runs'
import { assert, it } from '@effect/vitest'
import { Deferred, Effect, Fiber } from 'effect'

import type { WorkerGrant } from '../src/workerHome/codes'
import { workerExecution } from '../src/workerHome/execution'
import { workerTestDirectory as temporary } from './workerTestFiles'
import { repository } from './support'

const request = (worktree: string) => ({
  workerId: 'wrk_' + '1'.repeat(32),
  projectId: 'proj_' + '2'.repeat(32),
  workspaceId: 'ws_' + '3'.repeat(32),
  providerId: 'codex',
  worktree,
  toolPort: 3200,
})

it.live('keeps each repository’s own baseline and sends commands to the selected checkout in a worker set', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const api = repository()
      const web = repository()
      const scratch = repository()
      const fixture = repository()
      writeFileSync(join(fixture, 'README.md'), 'From the scratch helper\n')
      const scratchPatch = execFileSync('git', ['diff', 'HEAD'], { cwd: fixture })
      execFileSync('git', ['add', 'README.md'], { cwd: fixture })
      const scratchTree = execFileSync('git', ['write-tree'], { cwd: fixture }).toString().trim()
      const input = request(api)
      const webId = 'ws_' + '4'.repeat(32)
      const repositories = [
        { workspaceId: input.workspaceId, worktree: api, directory: 'api' },
        { workspaceId: webId, worktree: web, directory: 'web' },
      ]
      const checkpoints: Array<string | undefined> = []
      let launchedIn: string | undefined
      let helperIn: string | undefined
      let scratchId: string | undefined
      let scratchOwns = true
      let typed = ''
      let helperMode: 'ready' | 'without-input' | 'without-checkout' | 'overflow' | 'refuses' = 'ready'
      let managedAvailable = true
      let stoppedHelpers = 0
      let emitOutput: ((data: Uint8Array) => void) | undefined
      let fenceAfterPatch = false
      let fenceChecks = 0
      const stopped: AgentRunExit = {
        $typeName: 'althar.worker.v1.AgentRunExit',
        problem: '',
        workerBusy: false,
        runId: 'war_' + '5'.repeat(32),
        outcome: AgentRunOutcome.STOPPED,
      }
      const service = workerExecution(() => ({
        connect: () => assert.fail('No transport fixture needed'),
        connectPreview: () => assert.fail('No transport fixture needed'),
        connected: () => [],
        openTools: () => undefined,
        history: () => undefined,
        remove: () => false,
        update: () => false,
        cancelUpdate: () => false,
        updateOf: () => undefined,
        retryUpdate: () => undefined,
        stopRun: () => false,
        list: () => [
          {
            workerId: input.workerId,
            busy: false,
            capabilities: [{ projectId: input.projectId, providerId: input.providerId, workspaceSets: true }],
          },
        ],
        start: async (_id, _placement, options) => {
          assert.isUndefined(options?.checkout)
          assert.deepStrictEqual(
            options?.repositories?.map(({ workspaceId, directory }) => [workspaceId, directory]),
            [
              [input.workspaceId, 'api'],
              [webId, 'web'],
            ],
          )
          return {
            workspacePath: '/worker/task',
            toolPort: 4517,
            skillsPath: '/private/lead-skills',
            localMcp: [{ name: 'lint', executable: '/usr/bin/lint' }],
            setup: {
              $typeName: 'althar.worker.v1.AgentWorkspaceSetupResult',
              exitCode: 0,
              timedOut: false,
              outputTail: new Uint8Array(),
              repositories: [
                {
                  $typeName: 'althar.worker.v1.AgentRepositorySetupResult',
                  workspaceId: input.workspaceId,
                  exitCode: 0,
                  timedOut: false,
                  outputTail: Buffer.from('API ready'),
                },
                {
                  $typeName: 'althar.worker.v1.AgentRepositorySetupResult',
                  workspaceId: webId,
                  exitCode: 124,
                  timedOut: true,
                  outputTail: Buffer.from('Web timed out'),
                },
              ],
            },
            output: new PassThrough(),
            exit: Promise.resolve(stopped),
            write: async () => undefined,
            stop: async () => stopped,
            ownsRun: () => !fenceAfterPatch || ++fenceChecks === 1,
            readPatch: async (tree, head, id) => {
              checkpoints.push(id)
              if (scratchId !== undefined && scratchId === id) {
                assert.strictEqual(head, execFileSync('git', ['rev-parse', 'HEAD'], { cwd: scratch }).toString().trim())
                return { tree: scratchTree, head, patch: scratchPatch, commits: Buffer.alloc(0) }
              }
              const at = repositories.find((entry) => entry.workspaceId === id)?.worktree
              assert.isString(at)
              const git = (ref: string) => execFileSync('git', ['rev-parse', ref], { cwd: at }).toString().trim()
              assert.strictEqual(head, git('HEAD'))
              assert.strictEqual(tree, git('HEAD^{tree}'))
              return { tree, head, patch: Buffer.alloc(0), commits: Buffer.alloc(0) }
            },
            startCommand: async ({ directory }) => {
              if (!managedAvailable) throw { failure: 'connection lost' }
              launchedIn = directory
              return {
                exit: Promise.resolve({ $typeName: 'althar.worker.v1.AgentManagedExit', outcome: AgentRunOutcome.STOPPED }),
                stop: async () => undefined,
              }
            },
            startHelper: async ({ id, directory, output, checkout, skills }) => {
              emitOutput = output
              if (helperMode === 'refuses') throw 'This helper is unavailable.'
              if (helperMode === 'overflow') output(Buffer.alloc(129 * 1024))
              if (checkout !== undefined) {
                scratchId = id
                assert.strictEqual(checkout.head, execFileSync('git', ['rev-parse', 'HEAD'], { cwd: scratch }).toString().trim())
              }
              helperIn = directory
              let ended!: (result: AgentManagedExit) => void
              const exit = new Promise<AgentManagedExit>((resolve) => {
                ended = resolve
              })
              return {
                exit,
                ...(skills === undefined ? {} : { skillsPath: '/private/helper-skills' }),
                ...(checkout === undefined || helperMode === 'without-checkout'
                  ? {}
                  : { checkoutPath: '/worker/scratch', ownsProcess: () => scratchOwns }),
                stop: async () => {
                  stoppedHelpers++
                  ended({ $typeName: 'althar.worker.v1.AgentManagedExit', outcome: AgentRunOutcome.STOPPED })
                },
                ...(helperMode === 'without-input'
                  ? {}
                  : {
                      write: async (bytes: Uint8Array) => {
                        typed = Buffer.from(bytes).toString()
                        output(bytes)
                      },
                    }),
              }
            },
          }
        },
      }))
      assert.deepStrictEqual(service.list(input.projectId)[0]?.multiRepoProviders, ['codex'])
      const running = yield* service.open({ ...input, repositories })
      assert.strictEqual(running.skillsPath, '/private/lead-skills')
      assert.deepStrictEqual(running.localMcp, [{ name: 'lint', executable: '/usr/bin/lint' }])
      assert.deepStrictEqual(running.repositorySetup, {
        [input.workspaceId]: { code: 0, timedOut: false, output: 'API ready' },
        [webId]: { code: 124, timedOut: true, output: 'Web timed out' },
      })
      yield* running.checkpoint
      assert.deepStrictEqual(checkpoints, [input.workspaceId, webId])
      const start = service.startCommand
      if (start === undefined) return assert.fail('The assigned worker supports managed commands')
      const command = {
        ...input,
        worktree: web,
        id: 'proc_' + '1'.repeat(32),
        directory: 'client',
        command: 'make test',
        output: () => undefined,
      }
      yield* start(command)
      assert.strictEqual(launchedIn, 'web/client')
      for (const changed of [{ worktree: join(web, 'wrong') }, { projectId: 'another project' }, { workerId: 'another worker' }])
        assert.include((yield* Effect.flip(start({ ...command, ...changed }))).reason, 'assigned worker')
      managedAvailable = false
      assert.strictEqual((yield* Effect.flip(start(command))).reason, 'The worker connection was lost.')
      const openHelper = service.openHelper
      if (openHelper === undefined) return assert.fail('The assigned worker supports helpers')
      const helper = yield* openHelper({ ...input, worktree: web, directory: 'web-client' })
      assert.strictEqual(helper.path, '/worker/task/web')
      assert.strictEqual(helper.toolPort, 4517)
      assert.strictEqual(helperIn, 'web/web-client')
      assert.strictEqual(helper.checkpoint, running.checkpoint)
      for (const changed of [
        { worktree: join(web, 'wrong') },
        { projectId: 'another project' },
        { workerId: 'another worker' },
        { toolPort: 3201 },
      ])
        assert.include((yield* Effect.flip(openHelper({ ...input, worktree: web, directory: '', ...changed }))).reason, 'Start the lead')
      for (const [mode, message] of [
        ['without-input', 'did not open the helper'],
        ['overflow', 'did not open the helper'],
        ['without-checkout', 'did not confirm its separate helper checkout'],
        ['refuses', 'This helper is unavailable.'],
      ] as const) {
        helperMode = mode
        const copy = mode === 'without-checkout' ? { copy: scratch } : {}
        const failed = yield* Effect.scoped(Effect.flip(openHelper({ ...input, worktree: web, directory: '', ...copy })))
        assert.include(failed.reason, message)
      }
      assert.strictEqual(stoppedHelpers, 3)
      helperMode = 'ready'
      yield* Effect.promise(() => helper.transport.stdin.getWriter().write(Buffer.from('helper ACP')))
      assert.strictEqual(typed, 'helper ACP')
      assert.strictEqual(
        Buffer.from((yield* Effect.promise(() => helper.transport.stdout.getReader().read())).value ?? []).toString(),
        'helper ACP',
      )
      const checkpoint = service.checkpointWorktree
      if (checkpoint === undefined) return assert.fail('The worker service can checkpoint before making a helper copy')
      yield* Effect.flip(checkpoint({ ...input, projectId: 'different' }))
      yield* checkpoint({ ...input, worktree: web })
      const copy = yield* openHelper({
        ...input,
        directory: '',
        worktree: web,
        copy: scratch,
        skills: [{ path: 'notes/SKILL.md', executable: false, data: Buffer.from('Scratch instructions') }],
      })
      assert.strictEqual(copy.path, '/worker/scratch')
      assert.strictEqual(copy.skillsPath, '/private/helper-skills')
      assert.deepStrictEqual(copy.localMcp, running.localMcp)
      assert.strictEqual(helperIn, '')
      yield* copy.checkpoint
      assert.strictEqual(checkpoints.at(-1), scratchId)
      assert.strictEqual(readFileSync(join(web, 'README.md'), 'utf8'), '# Meridian\n')
      assert.strictEqual(readFileSync(join(scratch, 'README.md'), 'utf8'), 'From the scratch helper\n')
      scratchOwns = false
      assert.include((yield* Effect.flip(copy.checkpoint)).message, 'no longer owns')
      const sent = stoppedHelpers
      emitOutput?.(Buffer.alloc(129 * 1024))
      assert.strictEqual(stoppedHelpers, sent + 1)
      emitOutput?.(Buffer.from('not read'))
      assert.strictEqual(stoppedHelpers, sent + 1)
      assert.deepStrictEqual(yield* copy.transport.exited, { code: null, signal: 'SIGTERM' })
      fenceAfterPatch = true
      assert.include((yield* Effect.flip(running.checkpoint)).message, 'no longer owns')
      yield* helper.transport.stop
      assert.deepStrictEqual(yield* helper.transport.exited, { code: null, signal: 'SIGTERM' })
    }),
  ),
)

it.live('prepares a real task checkout and keeps the worker process scoped to the Althar session', () =>
  Effect.gen(function* () {
    const root = temporary()
    const worktree = join(root, 'repo')
    mkdirSync(worktree)
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test', ...args], { cwd: worktree })
        .toString()
        .trim()
    git('init', '--quiet', '-b', 'main')
    writeFileSync(join(worktree, 'README.md'), 'Task files\n')
    git('add', 'README.md')
    git('commit', '--quiet', '-m', 'Initial')
    const head = git('rev-parse', 'HEAD')
    const tree = git('rev-parse', 'HEAD^{tree}')
    const input = request(worktree)
    const exit: AgentRunExit = {
      $typeName: 'althar.worker.v1.AgentRunExit',
      problem: '',
      workerBusy: false,
      runId: 'war_' + '4'.repeat(32),
      outcome: AgentRunOutcome.STOPPED,
    }
    let outcome: (exit: AgentRunExit) => void = () => undefined
    let stopping = 0
    let reachable = true
    let canCapture = true
    let toolsAvailable = true
    let losesConnection = false
    let launchError: Error | undefined
    let refusesClose = false
    const copying = yield* Deferred.make<void>()
    const finishCopy = yield* Deferred.make<void>()
    const written: Uint8Array[] = []
    const worker: WorkerAgentProcess = {
      workspacePath: '/worker/project',
      toolPort: 4517,
      output: new PassThrough(),
      exit: new Promise((resolve) => {
        outcome = resolve
      }),
      write: async (chunk) => {
        written.push(chunk)
      },
      startCommand: async () => ({
        exit: Promise.resolve({ $typeName: 'althar.worker.v1.AgentManagedExit', outcome: AgentRunOutcome.STOPPED }),
        stop: async () => {
          throw new Error('The lease has closed')
        },
      }),
      stop: async () => {
        if (refusesClose) throw new Error('The worker no longer has a route')
        stopping += 1
        outcome(exit)
        return exit
      },
      ownsRun: () => true,
      readPatch: async (baseline, parent, _workspaceId, capture) => {
        if (!reachable) throw new Error('Worker disconnected.')
        assert.strictEqual(baseline, tree)
        assert.strictEqual(parent, head)
        return {
          tree,
          head,
          patch: Buffer.alloc(0),
          commits: Buffer.alloc(0),
          ...(capture && canCapture ? { index: { tree, patch: Buffer.alloc(0) } } : {}),
        }
      },
    }
    const orphans: Array<string> = []
    const pool: AgentWorkerPool = {
      connect: () => assert.fail('No transport fixture needed'),
      connectPreview: () => assert.fail('No transport fixture needed'),
      connected: () => [],
      openTools: () => undefined,
      history: () => undefined,
      remove: () => false,
      update: () => false,
      cancelUpdate: () => false,
      updateOf: () => undefined,
      retryUpdate: () => undefined,
      // What the worker is asked to stop that no lead here holds any more.
      stopRun: (id) => {
        orphans.push(id)
        return true
      },
      list: () => [{ workerId: input.workerId, busy: false, capabilities: [{ projectId: input.projectId, providerId: input.providerId }] }],
      start: async (id, placement, options) => {
        assert.strictEqual(id, input.workerId)
        assert.deepStrictEqual(placement, { projectId: input.projectId, workspaceId: input.workspaceId, providerId: input.providerId })
        assert.strictEqual(options?.toolPort, input.toolPort)
        assert.strictEqual(options?.checkout?.head, head)
        if (launchError !== undefined) throw launchError
        if (losesConnection) {
          const exit = Promise.reject<AgentRunExit>(new Error('The worker stream closed before an exit'))
          void exit.catch(() => undefined)
          return { ...worker, exit }
        }
        if (toolsAvailable) {
          await Effect.runPromise(Deferred.succeed(copying, undefined))
          await Effect.runPromise(Deferred.await(finishCopy))
          return worker
        }
        return {
          workspacePath: worker.workspacePath,
          output: worker.output,
          exit: worker.exit,
          write: worker.write,
          startCommand: worker.startCommand,
          stop: worker.stop,
          ownsRun: worker.ownsRun,
          readPatch: worker.readPatch,
        }
      },
    }
    const service = workerExecution(() => pool)
    assert.deepStrictEqual(service.list(input.projectId), [{ workerId: input.workerId, providers: ['codex'], busy: false }])
    yield* Effect.scoped(
      Effect.gen(function* () {
        const opening = yield* Effect.forkScoped(service.open(input))
        yield* Deferred.await(copying)
        assert.isTrue(service.list(input.projectId)[0]?.busy)
        const concurrent = yield* Effect.flip(service.open(input))
        // Taken by a start under way: one to wait for, not a failure; and no other start may reserve it meanwhile.
        assert.strictEqual(concurrent._tag, 'WorkerTaken')
        assert.include(concurrent.reason, 'preparing another task')
        assert.isUndefined(service.reserve?.(input.workerId, 'ws_' + 'e'.repeat(32)))
        yield* Deferred.succeed(finishCopy, undefined)
        const running = yield* Fiber.join(opening)
        // Its run is a lead's here: nothing asks the worker to stop it.
        assert.isFalse(service.settle?.(input.workerId))
        assert.deepStrictEqual(orphans, [])
        assert.strictEqual(running.path, '/worker/project')
        assert.strictEqual(running.toolPort, 4517)
        const openHelper = service.openHelper
        if (openHelper === undefined) return assert.fail('No worker helper service')
        assert.include((yield* Effect.flip(openHelper({ ...input, directory: '' }))).reason, 'Update this worker')
        yield* Effect.promise(() => running.transport.stdin.getWriter().write(Buffer.from('prompt')))
        assert.strictEqual(Buffer.from(written[0] ?? []).toString(), 'prompt')
        yield* running.checkpoint
        const checkpoint = service.checkpointWorktree
        const command = service.startCommand
        if (checkpoint === undefined || command === undefined) return assert.fail('The worker should support commands and checkpoints')
        assert.include((yield* Effect.flip(checkpoint({ ...input, workerId: 'another worker' }))).message, 'assigned worker')
        assert.include((yield* Effect.flip(checkpoint({ ...input, worktree: 'missing' }))).message, 'assigned worker')
        yield* Effect.scoped(command({ ...input, command: 'build', directory: '', id: 'proc_' + 'a'.repeat(32), output: () => undefined }))
        const capture = service.captureCheckouts
        if (capture === undefined) return assert.fail('No worker checkout capture service')
        for (const change of [{ workerId: 'another worker' }, { projectId: 'another project' }, { worktree: 'missing' }])
          assert.include((yield* Effect.flip(capture({ ...input, ...change }))).message, 'assigned worker')
        assert.deepStrictEqual(yield* capture(input), new Map([[worktree, { head, tree, index: tree }]]))
        canCapture = false
        assert.include((yield* Effect.flip(capture(input))).message, 'did not return its staged files')
        reachable = false
        assert.strictEqual((yield* Effect.flip(running.checkpoint)).message, 'Worker disconnected.')
        outcome(exit)
        assert.deepStrictEqual(yield* running.transport.exited, { code: null, signal: 'SIGTERM' })
      }),
    )
    assert.strictEqual(stopping, 1)
    // No lead here holds a run there now: whatever the worker still holds, it is asked to stop.
    assert.isTrue(service.settle?.(input.workerId))
    assert.deepStrictEqual(orphans, [input.workerId])
    // Free, it is reserved for one workspace's start, which the next start for it opens with, and let go.
    const release = service.reserve?.(input.workerId, input.workspaceId)
    assert.isDefined(release)
    assert.isUndefined(service.reserve?.(input.workerId, 'ws_' + 'e'.repeat(32)))
    release?.()
    toolsAvailable = false
    const missingTools = yield* Effect.scoped(Effect.flip(service.open(input)))
    assert.include(missingTools.reason, 'worker did not open the Althar tools connection')
    assert.deepStrictEqual(
      (yield* Effect.scoped(Effect.flip(service.open({ ...input, repositories: [] })))).reason,
      'There are no task repositories to send to this worker.',
    )
    assert.strictEqual(stopping, 2)
    toolsAvailable = true
    losesConnection = true
    refusesClose = true
    yield* Effect.scoped(
      Effect.gen(function* () {
        const running = yield* service.open(input)
        assert.deepStrictEqual(yield* running.transport.exited, { code: null, signal: null })
        yield* running.transport.stop
      }),
    )
    assert.strictEqual(stopping, 2)
    launchError = new Error('The enrolled worker is busy on another home')
    assert.strictEqual((yield* Effect.scoped(Effect.flip(service.open(input)))).reason, launchError.message)
  }),
)

it.live('refuses a worker start when its network listener is unavailable', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const offline = workerExecution(() => undefined)
      assert.deepStrictEqual(offline.list('project'), [])
      const failure = yield* Effect.flip(offline.open(request('/discarded')))
      assert.include(failure.reason, 'worker listener is unavailable')
    }),
  ),
)

it.live('lists the home’s enrolled workers, connected or not, and takes one out through its ledger', () =>
  Effect.gen(function* () {
    const online = 'wrk_' + '1'.repeat(32)
    const offline = 'wrk_' + '9'.repeat(32)
    const capacity = { platform: 'linux', architecture: 'arm64', cpuCores: 8, freeMemoryMib: 12_000, freeDiskMib: 90_000 } as const
    const pool = {
      connected: () => [
        {
          workerId: online,
          busy: true,
          capacity,
          capabilities: [
            { projectId: 'proj_a', providerId: 'codex' },
            { projectId: 'proj_b', providerId: 'codex' },
            { projectId: 'proj_b', providerId: 'claude-code' },
          ],
        },
      ],
      updateOf: () => undefined,
      retryUpdate: () => undefined,
    } as unknown as AgentWorkerPool
    let enrolled = [
      { workerId: online, projectIds: ['proj_a', 'proj_b'] },
      { workerId: offline, projectIds: ['proj_a'] },
    ]
    const removed: string[] = []
    const service = workerExecution(
      () => pool,
      () => ({
        workers: () => enrolled,
        revoke: (workerId) => {
          if (!enrolled.some((one) => one.workerId === workerId)) throw new Error('No worker has that identity')
          removed.push(workerId)
          enrolled = enrolled.filter((one) => one.workerId !== workerId)
        },
      }),
    )
    assert.deepStrictEqual(service.enrolled?.(), [
      { workerId: online, connected: true, busy: true, capacity, providers: ['codex', 'claude-code'], projectIds: ['proj_a', 'proj_b'] },
      { workerId: offline, connected: false, busy: false, providers: [], projectIds: ['proj_a'] },
    ])
    yield* service.revoke!(offline)
    assert.deepStrictEqual(removed, [offline])
    assert.deepStrictEqual(
      service.enrolled?.()?.map(({ workerId }) => workerId),
      [online],
    )
    assert.strictEqual(yield* Effect.flip(service.revoke!(offline)), 'No worker has that identity')
    // One at work keeps its task: it can't be taken out under it.
    assert.strictEqual(yield* Effect.flip(service.revoke!(online)), 'It runs a task. Remove it once that finishes.')
    assert.deepStrictEqual(removed, [offline])
    // A home that isn't listening for workers has no list of them, and nothing to take out.
    const off = workerExecution(
      () => undefined,
      () => undefined,
    )
    assert.isNull(off.enrolled?.())
    assert.strictEqual(yield* Effect.flip(off.revoke!(online)), 'This home takes no workers.')
    // A ledger that fails with nothing to say says so in Althar's words.
    const silent = workerExecution(
      () => undefined,
      () => ({
        workers: () => [],
        revoke: () => {
          // oxlint-disable-next-line no-throw-literal -- what a ledger might throw that isn't an Error.
          throw 'gone'
        },
      }),
    )
    assert.strictEqual(yield* Effect.flip(silent.revoke!(offline)), 'Could not remove the worker.')
  }),
)

it.effect('adds a worker only where the home is its authority, and says what its enrollment couldn’t do', () =>
  Effect.gen(function* () {
    const grant = { homeId: 'home_a', workerId: 'wrk_a' } as unknown as WorkerGrant
    const byCertificates = workerExecution(
      () => undefined,
      () => ({ workers: () => [], revoke: () => {} }),
      () => Effect.fail('closed'),
    )
    // Listening by its operator's certificates: it adds none itself.
    assert.isFalse(byCertificates.adds?.())
    assert.strictEqual(
      yield* Effect.flip(byCertificates.admin!.add({ publicKey: new Uint8Array(), name: 'box', ssh: null })),
      'This home takes workers by its operator’s certificates.',
    )
    const failing = (thrown: unknown) =>
      workerExecution(
        () => undefined,
        () => ({
          workers: () => [],
          revoke: () => {},
          managed: {
            enroll: () => {
              throw thrown
            },
            code: () => Promise.reject(thrown),
            assign: () => {
              throw thrown
            },
          },
        }),
        () => Effect.fail('closed'),
      )
    assert.isTrue(failing(new Error('No room')).adds?.())
    assert.strictEqual(
      yield* Effect.flip(failing(new Error('No room')).admin!.add({ publicKey: new Uint8Array(), name: 'box', ssh: null })),
      'No room',
    )
    assert.strictEqual(yield* Effect.flip(failing('gone').admin!.code('box')), 'The home couldn’t do that.')
    assert.strictEqual(yield* Effect.flip(failing('gone').admin!.assign('wrk_a', [])), 'The home couldn’t do that.')
    // Not listening yet: it opens its port for the first worker, and adds through it.
    const opening = workerExecution(
      () => undefined,
      () => undefined,
      () =>
        Effect.succeed({
          workers: () => [],
          revoke: () => {},
          managed: { enroll: () => grant, code: async () => ({ code: 'c', expiresAt: 1 }), assign: () => {} },
        }),
    )
    assert.isTrue(opening.adds?.())
    assert.strictEqual(yield* opening.admin!.add({ publicKey: new Uint8Array(), name: 'box', ssh: null }), grant)
  }),
)
