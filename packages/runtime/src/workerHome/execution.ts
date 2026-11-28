import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import { PassThrough, Readable } from 'node:stream'
import { AgentRequestFailed, AgentStartFailed } from '@althar/provider-adapters'
import { acceptWorkerPatch, prepareWorkerWorkspace, sendSizeWords, verifyWorkerIndex, type WorkerSendLimits } from '../workerWorkspace'
import type { CapturedWorkerCheckout, WorkerAdmin, WorkerExecution, WorkerExecutionPlatform, WorkerSetupOutcome } from '../workerExecution'
import { AgentRunOutcome } from '@althar/worker-protocol'
import {
  isWorkerBusy,
  MAX_WORKER_BUNDLE_BYTES,
  MAX_WORKER_SET_BYTES,
  type AgentWorkerPool,
  type WorkerAgentProcess,
  type WorkerManagedProcess,
  WORKER_UPDATE_UNSUPPORTED,
} from '@althar/worker-protocol/agent-runs'
import { Effect, Scope, Semaphore } from 'effect'

import type { GitFailed } from '../errors'
import { WorkerTaken } from '../workerWait'
import { WorkerHomeError } from './errors'
import type { WorkerEnrollment } from './network'
import type { EnrolledWorker } from './store'

const unavailable = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : 'The worker connection was lost.'
}

/** A send that couldn't be made, in the words it gives where it gives any (what is too large, and what to do), not git's. */
const saidPlainly = (error: GitFailed): Error | GitFailed => (error.reason === undefined ? error : new Error(error.reason))

const setupOutcome = (report: { exitCode: number; timedOut: boolean; outputTail: Uint8Array }): WorkerSetupOutcome => ({
  code: report.exitCode,
  timedOut: report.timedOut,
  output: Buffer.from(report.outputTail).toString('utf8'),
})

/** The home's ledger of its workers, as its listener keeps it open: who is enrolled, and taking one out. */
export interface WorkerLedger {
  readonly workers: () => ReadonlyArray<EnrolledWorker>
  readonly revoke: (workerId: string) => void
  /**
   * The run a worker's reservation still holds, by the workspace it holds: kept from its start until the worker says it
   * ended, through a dropped connection, so it holds the workspace while it may still be at work there.
   */
  readonly outstanding?: (workerId: string) => { readonly workspaceId: string } | undefined
  /** Where the home is its own authority for its workers: adding them, and their projects. */
  readonly managed?: WorkerEnrollment
}

/**
 * Where a task's work runs when it runs on a worker, from the pool of workers connected now (`active`); with the
 * home's ledger (`ledger`), its own list of every worker it enrolled, connected or not, and taking one out.
 */
export const workerExecution = (
  active: () => AgentWorkerPool | undefined,
  ledger?: () => WorkerLedger | undefined,
  /** Opens the home's worker port, now, where it isn't open: where given, the home adds workers itself. */
  open?: () => Effect.Effect<WorkerLedger, string>,
): WorkerExecutionPlatform => {
  const workspaces = new Map<
    string,
    {
      readonly projectId: string
      readonly workerId: string
      readonly agent: WorkerAgentProcess
      readonly directory: string
      readonly workspaceId: string | undefined
      readonly checkpoint: WorkerExecution['checkpoint']
      readonly capture: Effect.Effect<ReadonlyMap<string, CapturedWorkerCheckout>, AgentRequestFailed>
      readonly writes: Semaphore.Semaphore
      readonly toolPort: number
      readonly homeToolPort: number
      /** What a helper's copy sent to the worker may leave out: what its copy of the history held, and what this run sent it. */
      readonly limits: WorkerSendLimits
    }
  >()
  /** What a send to a worker for a project may leave out and how large it may be, as the worker said it on its stream. */
  const limitsOf = (workerId: string, projectId: string): WorkerSendLimits => {
    const history = active()?.history(workerId, projectId)
    if (history === undefined) return { maxBytes: MAX_WORKER_BUNDLE_BYTES }
    return { maxBytes: history.maxBytes, keeps: history.keeps, known: history.commits }
  }
  /** The workers being readied for a task, each by the workspace it is readied for: it holds the worker as a run does. */
  const preparing = new Map<string, string>()
  /** The workers held for a start that hasn't opened there yet, each by its workspace (`reserve`): used once, by its open. */
  const reserved = new Map<string, string>()
  /** Being readied for a task, or held for one about to be. */
  const readying = (workerId: string) => preparing.get(workerId) ?? reserved.get(workerId)
  /** The agent each worker runs for a lead of this home now: a run a worker holds with none here is no lead's any more. */
  const live = new Map<string, WorkerAgentProcess>()
  /** A worker at work, or being readied for a task: taking it out would cut its task off, so it waits. */
  const working = (workerId: string) =>
    readying(workerId) !== undefined || (active()?.connected() ?? []).some((one) => one.workerId === workerId && one.busy)
  const named = () => new Map((ledger?.()?.workers() ?? []).flatMap(({ workerId, name }) => (name === undefined ? [] : [[workerId, name]])))
  /** The home's managed enrollment, its worker port opened first where it isn't yet. */
  const managed = Effect.gen(function* () {
    const listening = ledger?.() ?? (open === undefined ? undefined : yield* open())
    if (listening?.managed === undefined) return yield* Effect.fail('This home takes workers by its operator’s certificates.')
    return listening.managed
  })
  const said = (error: unknown) =>
    error instanceof WorkerHomeError || error instanceof Error ? error.message : 'The home couldn’t do that.'
  const admin: WorkerAdmin | undefined =
    open === undefined
      ? undefined
      : {
          add: (input) => Effect.flatMap(managed, (enrollment) => Effect.try({ try: () => enrollment.enroll(input), catch: said })),
          code: (name) => Effect.flatMap(managed, (enrollment) => Effect.tryPromise({ try: () => enrollment.code(name), catch: said })),
          assign: (workerId, projectIds) =>
            Effect.flatMap(managed, (enrollment) => Effect.try({ try: () => enrollment.assign(workerId, projectIds), catch: said })),
        }
  return {
    ...(admin === undefined ? {} : { admin }),
    reserve: (workerId, workspaceId) => {
      if (working(workerId)) return
      reserved.set(workerId, workspaceId)
      return () => {
        if (reserved.get(workerId) !== workspaceId) return
        reserved.delete(workerId)
        // Held no longer, and not run after all: an update asked meanwhile goes now.
        if (readying(workerId) === undefined) active()?.retryUpdate(workerId)
      }
    },
    settle: (workerId) => {
      // Being readied, or run by a lead here, it is in use; else what it holds is no lead's.
      if (readying(workerId) !== undefined || live.has(workerId)) return false
      return active()?.stopRun(workerId) ?? false
    },
    adds: () => {
      const listening = ledger?.()
      return admin !== undefined && (listening === undefined || listening.managed !== undefined)
    },
    list: (projectId) => {
      const names = named()
      return (active()?.list(projectId) ?? []).map(({ workerId, busy, capabilities, capacity, signedIn, readiness }) => {
        const multiRepoProviders = capabilities.filter((one) => one.workspaceSets === true).map(({ providerId }) => providerId)
        const name = names.get(workerId)
        return {
          workerId,
          ...(name === undefined ? {} : { name }),
          providers: capabilities.map(({ providerId }) => providerId),
          ...(multiRepoProviders.length === 0 ? {} : { multiRepoProviders }),
          busy: busy || readying(workerId) !== undefined,
          ...(capacity === undefined ? {} : { capacity }),
          ...(signedIn === undefined ? {} : { signedIn: [...signedIn] }),
          ...(readiness === undefined ? {} : { readiness }),
        }
      })
    },
    enrolled: () => {
      const listing = ledger?.()
      if (listing === undefined) return null
      const live = new Map((active()?.connected() ?? []).map((worker) => [worker.workerId, worker]))
      return listing.workers().map(({ workerId, projectIds, name, ssh }) => {
        const worker = live.get(workerId)
        // The workspace its run holds, connected or not: one that dropped mid-run still holds it until it says it stopped.
        const workspaceId = listing.outstanding?.(workerId)?.workspaceId ?? readying(workerId)
        const holding = workspaceId === undefined ? {} : { workspaceId }
        const update = active()?.updateOf(workerId)
        const known = {
          ...(name === undefined ? {} : { name }),
          ...(ssh === undefined ? {} : { ssh }),
          ...(update === undefined ? {} : { update }),
        }
        if (worker === undefined)
          return { workerId, ...known, connected: false, busy: workspaceId !== undefined, providers: [], projectIds, ...holding }
        return {
          workerId,
          ...known,
          ...(worker.signedIn === undefined ? {} : { signedIn: worker.signedIn }),
          ...(worker.release === undefined ? {} : { release: worker.release }),
          ...(worker.updatesOnRequest === true ? { updatesOnRequest: true } : {}),
          ...(worker.readiness === undefined ? {} : { readiness: worker.readiness }),
          ...(worker.anyProject === undefined ? {} : { anyProject: worker.anyProject }),
          connected: true,
          busy: worker.busy || workspaceId !== undefined,
          ...(worker.capacity === undefined ? {} : { capacity: worker.capacity }),
          providers: [...new Set(worker.capabilities.map(({ providerId }) => providerId))],
          projectIds,
          ...holding,
        }
      })
    },
    revoke: (workerId) =>
      Effect.try({
        try: () => {
          const listing = ledger?.()
          if (listing === undefined) throw new Error('This home takes no workers.')
          if (working(workerId)) throw new Error('It runs a task. Remove it once that finishes.')
          // Gone mid-run, it holds its task's workspace until it reconnects and says that run stopped. Taken out now, it
          // couldn't, and the workspace would stay held for good.
          if (listing.outstanding?.(workerId) !== undefined)
            throw new Error('It went offline during a task. Start it again so it can stop that work, then remove it.')
          listing.revoke(workerId)
        },
        catch: (error) => (error instanceof Error ? error.message : 'Could not remove the worker.'),
      }),
    update: (workerId) =>
      Effect.try({
        try: () => {
          const pool = active()
          const listing = ledger?.()
          if (pool === undefined || listing === undefined) throw new Error('This home takes no workers.')
          if (!listing.workers().some((one) => one.workerId === workerId)) throw new Error('This home has no such worker.')
          // Not while the home readies it for a task: told once that's let go, or after the run, between runs.
          if (!pool.update(workerId, undefined, (id) => readying(id) !== undefined)) throw new Error(WORKER_UPDATE_UNSUPPORTED)
        },
        catch: (error) => (error instanceof Error ? error.message : 'Could not ask the worker to update.'),
      }),
    cancelUpdate: (workerId) =>
      Effect.try({
        try: () => {
          if (active()?.cancelUpdate(workerId) !== true) throw new Error('Its update has started already, or wasn’t asked for.')
        },
        catch: (error) => (error instanceof Error ? error.message : 'Could not take the update back.'),
      }),
    startCommand: (input) =>
      Effect.gen(function* () {
        const workspace = workspaces.get(input.worktree)
        const failed = (reason: string) => new AgentStartFailed({ command: input.command, reason })
        if (workspace === undefined || workspace.projectId !== input.projectId || workspace.workerId !== input.workerId)
          return yield* failed('Start this task on its assigned worker before running a project command.')
        return yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: () =>
              workspace.agent.startCommand({ ...input, directory: [workspace.directory, input.directory].filter(Boolean).join('/') }),
            catch: (error) => failed(unavailable(error)),
          }),
          (process) => Effect.tryPromise(() => process.stop()).pipe(Effect.catch(() => Effect.void)),
        )
      }),
    readFile: (input) =>
      Effect.suspend(() => {
        const workspace = workspaces.get(input.worktree)
        const refused = (message: string) => new AgentRequestFailed({ method: 'workspace/file', failure: 'transient', message })
        if (workspace?.projectId !== input.projectId || workspace.workerId !== input.workerId || !workspace.agent.ownsRun())
          return Effect.fail(refused('This worker workspace is unavailable.'))
        const read = workspace.agent.readFile
        if (read === undefined) return Effect.fail(refused('Update this worker to retrieve its workspace files.'))
        return Effect.tryPromise({ try: () => read(input.path, workspace.workspaceId), catch: (error) => refused(unavailable(error)) })
      }),
    captureCheckouts: (input) =>
      Effect.suspend(() => {
        const workspace = workspaces.get(input.worktree)
        if (workspace?.projectId === input.projectId && workspace.workerId === input.workerId) return workspace.capture
        return Effect.fail(
          new AgentRequestFailed({
            method: 'workspace/checkpoint',
            failure: 'transient',
            message: 'Start the lead on its assigned worker before copying its checkout.',
          }),
        )
      }),
    checkpointWorktree: (input) =>
      Effect.suspend(() => {
        const workspace = workspaces.get(input.worktree)
        if (workspace?.projectId === input.projectId && workspace.workerId === input.workerId) return workspace.checkpoint
        return Effect.fail(
          new AgentRequestFailed({
            method: 'workspace/checkpoint',
            failure: 'transient',
            message: 'Start the lead on its assigned worker before copying its checkout.',
          }),
        )
      }),
    openHelper: (input) =>
      Effect.gen(function* () {
        const workspace = workspaces.get(input.worktree)
        const failed = (reason: string) => new AgentStartFailed({ command: input.providerId, reason })
        if (
          workspace === undefined ||
          workspace.projectId !== input.projectId ||
          workspace.workerId !== input.workerId ||
          workspace.homeToolPort !== input.toolPort
        )
          return yield* failed('Start the lead in this worker checkout before starting its helper.')
        const start = workspace.agent.startHelper
        if (start === undefined) return yield* failed('Update this worker to start helper agents.')
        const limit = 128 * 1024
        const output = new PassThrough({ highWaterMark: limit })
        output.on('error', () => undefined)
        let process: WorkerManagedProcess | undefined
        let overflowed = false
        const stop = (child: WorkerManagedProcess) => Effect.tryPromise(() => child.stop()).pipe(Effect.catch(() => Effect.void))
        const commandId = `proc_${randomUUID().replaceAll('-', '')}`
        const made = Effect.scoped(
          Effect.gen(function* () {
            const checkout =
              input.copy === undefined
                ? undefined
                : yield* prepareWorkerWorkspace(input.copy, workspace.limits).pipe(
                    Effect.mapError((error) => failed(unavailable(saidPlainly(error)))),
                  )
            const child = yield* Effect.tryPromise({
              try: () =>
                start({
                  id: commandId,
                  directory: checkout === undefined ? [workspace.directory, input.directory].filter(Boolean).join('/') : input.directory,
                  ...(checkout === undefined ? {} : { checkout }),
                  providerId: input.providerId,
                  ...(input.skills === undefined ? {} : { skills: input.skills }),
                  output: (chunk) => {
                    if (overflowed) return
                    if (output.readableLength + output.writableLength + chunk.byteLength <= limit) {
                      output.write(chunk)
                      return
                    }
                    overflowed = true
                    output.destroy(new Error('The worker helper exceeded its output buffer.'))
                    if (process !== undefined) void process.stop().catch(() => undefined)
                  },
                }),
              catch: (error) => failed(unavailable(error)),
            })
            return { child, base: checkout === undefined ? undefined : { head: checkout.head, tree: checkout.tree } }
          }),
        )
        const { child, base } = yield* Effect.acquireRelease(made, ({ child }) =>
          stop(child).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                output.destroy()
              }),
            ),
          ),
        )
        process = child
        const write = child.write
        if (write === undefined || overflowed) return yield* failed('The worker did not open the helper’s agent connection.')
        void child.exit.then(
          () => output.end(),
          (error: unknown) => output.destroy(new Error(unavailable(error))),
        )
        const copy = input.copy
        const owns = child.ownsProcess
        if (copy !== undefined && (base === undefined || child.checkoutPath === undefined || owns === undefined))
          return yield* failed('The worker did not confirm its separate helper checkout.')
        let baseline = base
        const checkpoint =
          copy === undefined || owns === undefined
            ? workspace.checkpoint
            : workspace.writes.withPermits(1)(
                Effect.gen(function* () {
                  const previous = baseline
                  if (previous === undefined || !owns()) return yield* Effect.fail('The worker no longer owns this helper checkout.')
                  const changed = yield* Effect.tryPromise({
                    try: () => workspace.agent.readPatch(previous.tree, previous.head, commandId),
                    catch: unavailable,
                  })
                  yield* acceptWorkerPatch(copy, previous, changed, owns).pipe(Effect.ensuring(Effect.sync(() => changed.release?.())))
                  baseline = { head: changed.head, tree: changed.tree }
                }).pipe(
                  Effect.mapError(
                    (error) =>
                      new AgentRequestFailed({ method: 'workspace/checkpoint', failure: 'transient', message: unavailable(error) }),
                  ),
                ),
              )
        return {
          transport: {
            _tag: 'Remote',
            stdin: new WritableStream({ write }),
            stdout: Readable.toWeb(output) as ReadableStream<Uint8Array>,
            exited: Effect.promise(() =>
              child.exit.then(
                (result) => ({ code: result.exitCode ?? null, signal: result.outcome === AgentRunOutcome.STOPPED ? 'SIGTERM' : null }),
                () => ({ code: null, signal: null }),
              ),
            ),
            stop: stop(child),
          },
          path: child.checkoutPath ?? posix.join(workspace.agent.workspacePath, workspace.directory),
          toolPort: workspace.toolPort,
          checkpoint,
          ...(child.skillsPath === undefined ? {} : { skillsPath: child.skillsPath }),
          ...(workspace.agent.localMcp === undefined ? {} : { localMcp: workspace.agent.localMcp }),
        }
      }),
    open: (input) =>
      Effect.gen(function* () {
        const { workerId, projectId, workspaceId, providerId, worktree, toolPort, setup, repositories, skills } = input
        const failed = (error: unknown) =>
          error instanceof AgentStartFailed || error instanceof WorkerTaken
            ? error
            : isWorkerBusy(error)
              ? new WorkerTaken({ workerId, reason: unavailable(error) })
              : new AgentStartFailed({ command: providerId, reason: unavailable(error) })
        const pool = active()
        if (pool === undefined) return yield* failed(new Error('The home’s worker listener is unavailable.'))
        const made = Effect.scoped(
          Effect.gen(function* () {
            // Reserved for this workspace by its start (`reserve`), this open uses the reservation; else it takes the worker here.
            yield* Effect.acquireRelease(
              Effect.suspend(() => {
                if (preparing.has(workerId) || (reserved.has(workerId) && reserved.get(workerId) !== workspaceId))
                  return Effect.fail(new WorkerTaken({ workerId, reason: 'This worker is preparing another task.' }))
                reserved.delete(workerId)
                preparing.set(workerId, workspaceId)
                return Effect.void
              }),
              () =>
                Effect.sync(() => {
                  preparing.delete(workerId)
                  // Readied, or let go: an update asked meanwhile goes where nothing runs there now.
                  if (readying(workerId) === undefined) active()?.retryUpdate(workerId)
                }),
            )
            const limits = limitsOf(workerId, projectId)
            const entries = yield* Effect.forEach(
              repositories ?? [{ workspaceId, directory: '', worktree }],
              (entry) =>
                prepareWorkerWorkspace(entry.worktree, limits).pipe(
                  Effect.map((checkout) => ({ ...entry, checkout })),
                  Effect.mapError(saidPlainly),
                ),
              { concurrency: 2 },
            )
            const [primary] = entries
            if (primary === undefined) return yield* failed('There are no task repositories to send to this worker.')
            const bytes = entries.reduce((sum, entry) => sum + entry.checkout.size, 0)
            // A worker on an older release takes a repository set's sends together only up to its own limit.
            if (limits.keeps !== true && repositories !== undefined && bytes > MAX_WORKER_SET_BYTES)
              return yield* failed(
                new Error(
                  `The task’s repositories come to ${sendSizeWords(bytes)} together; the worker takes at most ${sendSizeWords(MAX_WORKER_SET_BYTES)} at once. Update the worker: it then keeps each project’s history, and later sends carry only what’s new. Or run this task on the home.`,
                ),
              )
            // What the home knows it needs there: the send staged, then taken into the worker's copy of the history, or, on an
            // older worker, into its checkout. The checkout a copy makes the worker checks itself, as it knows its copy's size.
            const free = pool.list(projectId).find((one) => one.workerId === workerId)?.capacity?.freeDiskMib
            if (free !== undefined && bytes * 2 > free * 1024 ** 2)
              return yield* failed(
                new Error(
                  `The worker has ${sendSizeWords(free * 1024 ** 2)} free; this task’s send of ${sendSizeWords(bytes)} needs about ${sendSizeWords(bytes * 2)} there. Free space on the worker, or run this task on the home.`,
                ),
              )
            const agent = yield* Effect.tryPromise({
              try: (signal) =>
                pool.start(
                  workerId,
                  { projectId, workspaceId, providerId },
                  {
                    signal,
                    // Decided by the slot that receives it, as its own check found it there now.
                    requireReady: true,
                    ...(repositories === undefined ? { checkout: primary.checkout } : { repositories: entries }),
                    toolPort,
                    ...(setup === undefined ? {} : { setup }),
                    ...(skills === undefined ? {} : { skills }),
                  },
                ),
              catch: failed,
            })
            return {
              agent,
              limits,
              sent: { bytes, thin: entries.every((entry) => entry.checkout.thin), keeps: limits.keeps === true },
              entries: entries.map(({ worktree, workspaceId, directory, checkout }) => ({
                worktree,
                workspaceId: repositories === undefined ? undefined : workspaceId,
                directory,
                base: { head: checkout.head, tree: checkout.tree },
                sent: [checkout.basis, checkout.head],
              })),
            }
          }),
        ).pipe(Effect.mapError(failed))
        const stop = (agent: Awaited<ReturnType<AgentWorkerPool['start']>>) =>
          Effect.promise(() =>
            agent.stop().then(
              () => undefined,
              () => undefined,
            ),
          )
        const { agent, entries, limits, sent } = yield* Effect.acquireRelease(made, ({ agent }) => stop(agent))
        if (agent.toolPort === undefined) return yield* failed(new Error('The worker did not open the Althar tools connection.'))
        const scope = yield* Effect.scope
        yield* Scope.addFinalizer(
          scope,
          Effect.sync(() => {
            for (const entry of entries) if (workspaces.get(entry.worktree)?.agent === agent) workspaces.delete(entry.worktree)
          }),
        )
        live.set(workerId, agent)
        yield* Scope.addFinalizer(
          scope,
          Effect.sync(() => {
            if (live.get(workerId) === agent) live.delete(workerId)
          }),
        )
        const writes = yield* Semaphore.make(1)
        const sync = (captureIndex: boolean) =>
          writes.withPermits(1)(
            Effect.gen(function* () {
              const captured = new Map<string, CapturedWorkerCheckout>()
              for (const entry of entries) {
                const changed = yield* Effect.tryPromise({
                  try: () => agent.readPatch(entry.base.tree, entry.base.head, entry.workspaceId, captureIndex),
                  catch: unavailable,
                })
                // What came back is in files of its own until it is taken in, or refused.
                yield* Effect.gen(function* () {
                  if (captureIndex) {
                    if (changed.index === undefined) return yield* Effect.fail('The worker did not return its staged files.')
                    const index = yield* verifyWorkerIndex(entry.worktree, entry.base.tree, changed.index)
                    captured.set(entry.worktree, { head: changed.head, tree: changed.tree, index })
                  }
                  yield* acceptWorkerPatch(entry.worktree, entry.base, changed, agent.ownsRun)
                }).pipe(Effect.ensuring(Effect.sync(() => changed.release?.())))
                entry.base = { head: changed.head, tree: changed.tree }
                if (!agent.ownsRun()) return yield* Effect.fail('The worker no longer owns this run.')
              }
              return captured
            }).pipe(
              Effect.mapError(
                (error) => new AgentRequestFailed({ method: 'workspace/checkpoint', failure: 'transient', message: unavailable(error) }),
              ),
            ),
          )
        const checkpoint = sync(false).pipe(Effect.asVoid)
        const capture = sync(true)
        for (const entry of entries)
          workspaces.set(entry.worktree, {
            workerId,
            projectId,
            agent,
            directory: entry.directory,
            workspaceId: entry.workspaceId,
            checkpoint,
            capture,
            writes,
            toolPort: agent.toolPort,
            homeToolPort: toolPort,
            // The worker added what it was sent to its copy of the history: a helper's copy needn't carry it again.
            limits:
              limits.keeps === true ? { ...limits, known: [...(limits.known ?? []), ...entries.flatMap(({ sent }) => sent)] } : limits,
          })
        return {
          transport: {
            _tag: 'Remote',
            stdin: new WritableStream({ write: (bytes: Uint8Array) => agent.write(bytes) }),
            stdout: Readable.toWeb(agent.output) as ReadableStream<Uint8Array>,
            exited: Effect.promise(() =>
              agent.exit.then(
                (result) => ({
                  code: result.exitCode ?? null,
                  signal: result.outcome === AgentRunOutcome.STOPPED ? 'SIGTERM' : null,
                }),
                () => ({ code: null, signal: null }),
              ),
            ),
            stop: stop(agent),
          },
          path: agent.workspacePath,
          toolPort: agent.toolPort,
          ...(agent.skillsPath === undefined ? {} : { skillsPath: agent.skillsPath }),
          ...(agent.localMcp === undefined ? {} : { localMcp: agent.localMcp }),
          ...(agent.setup === undefined
            ? {}
            : agent.setup.repositories.length === 0
              ? { setup: setupOutcome(agent.setup) }
              : {
                  repositorySetup: Object.fromEntries(agent.setup.repositories.map((report) => [report.workspaceId, setupOutcome(report)])),
                }),
          checkpoint,
          sent,
        }
      }),
  }
}
