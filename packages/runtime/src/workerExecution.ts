import type { ProjectWorker, WorkerGrant } from '@althar/contracts'
import type { AgentRequestFailed, AgentStartFailed, Transport } from '@althar/provider-adapters'
import type {
  WorkerFile,
  WorkerLocalMcpCommand,
  WorkerManagedCommand,
  WorkerManagedProcess,
  WorkerSetup,
  WorkerSkillFile,
} from '@althar/worker-protocol/agent-runs'
import { Effect, type Scope } from 'effect'
import { SqlClient } from 'effect/sql'

/** A task’s accepted plan is the authority for where its processes run. */
export const taskWorker = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [plan] = yield* sql<{ workerId: string | null }>`
    SELECT json_extract(parameters, '$.workerId') AS worker_id FROM task_plans
    WHERE state = 'accepted' AND task_id = ${taskId}
    ORDER BY decided_at DESC, rowid DESC LIMIT 1`
    return plan?.workerId ?? null
  })

export interface WorkerSetupOutcome {
  readonly code: number
  readonly timedOut: boolean
  readonly output: string
}

export interface WorkerExecution {
  readonly transport: Extract<Transport, { _tag: 'Remote' }>
  readonly path: string
  readonly toolPort: number
  readonly setup?: WorkerSetupOutcome
  readonly repositorySetup?: Readonly<Record<string, WorkerSetupOutcome>>
  readonly skillsPath?: string
  readonly localMcp?: ReadonlyArray<WorkerLocalMcpCommand>
  readonly checkpoint: Effect.Effect<void, AgentRequestFailed>
}

export interface AssignedCommand extends WorkerManagedCommand {
  readonly workerId: string
  readonly projectId: string
  readonly worktree: string
}

export interface AssignedRepository {
  readonly workspaceId: string
  readonly worktree: string
  readonly directory: string
}

interface AssignedHelper {
  readonly copy?: string
  readonly skills?: ReadonlyArray<WorkerSkillFile>
  readonly workerId: string
  readonly projectId: string
  readonly providerId: string
  readonly worktree: string
  readonly toolPort: number
  readonly directory: string
}

/** The runtime owns a task and its permissions. The platform supplies an enrolled execution location. */
export interface CapturedWorkerCheckout {
  readonly head: string
  readonly tree: string
  readonly index: string
}

/** A worker the home enrolled, as the home's own list of them has it: connected now or not, what it runs and reported. */
export interface EnrolledWorkerState {
  readonly workerId: string
  readonly connected: boolean
  /** Running a task, or holding one's workspace after dropping out mid-run: a worker runs one at a time. */
  readonly busy: boolean
  /** What it reported last, while that is current. */
  readonly capacity?: ProjectWorker['capacity']
  /** The agents it can run, by id, for any project. */
  readonly providers: ReadonlyArray<string>
  /** The projects it may work on. */
  readonly projectIds: ReadonlyArray<string>
  /** The task workspace its run holds, connected or not, from its start until it says that run ended. */
  readonly workspaceId?: string
  /** As the person added it, and the SSH address it was set up at, where it was. */
  readonly name?: string
  readonly ssh?: string
  /** Of `providers`, those signed in on it, where it says. */
  readonly signedIn?: ReadonlyArray<string>
  /** The Althar release it runs, where it says. */
  readonly release?: string
  /** It works on whatever project it is given: the home's grants say which. */
  readonly anyProject?: boolean
}

/**
 * Adding workers, where the home is its own authority for them (ADR-103): signing a worker's own key, a one-time code
 * for a machine without SSH, and the projects each works on. Each opens the home's worker port first where it isn't
 * open yet, without a restart. Fails with words to show.
 */
export interface WorkerAdmin {
  readonly add: (input: {
    readonly publicKey: Uint8Array
    readonly name: string
    readonly ssh: string | null
  }) => Effect.Effect<WorkerGrant, string>
  readonly code: (name: string) => Effect.Effect<{ readonly code: string; readonly expiresAt: number }, string>
  readonly assign: (workerId: string, projectIds: ReadonlyArray<string>) => Effect.Effect<void, string>
}

export interface WorkerExecutionPlatform {
  readonly list: (projectId: string) => ReadonlyArray<ProjectWorker>
  /** Every worker the home enrolled, connected or not, in the order they were; null while it isn't listening for workers. */
  readonly enrolled?: () => ReadonlyArray<EnrolledWorkerState> | null
  /** Takes a worker out of this home for good: its certificate is no longer accepted. Fails with words to show. */
  readonly revoke?: (workerId: string) => Effect.Effect<void, string>
  /** Adding workers, where the home does that itself; none where an operator enrolls them by command. */
  readonly admin?: WorkerAdmin
  /** Whether it adds workers itself now: it listens as its own authority, or doesn't listen yet. */
  readonly adds?: () => boolean
  readonly startCommand?: (input: AssignedCommand) => Effect.Effect<WorkerManagedProcess, AgentStartFailed, Scope.Scope>
  readonly readFile?: (
    input: Pick<AssignedCommand, 'workerId' | 'projectId' | 'worktree'> & { readonly path: string },
  ) => Effect.Effect<WorkerFile, AgentRequestFailed>
  readonly captureCheckouts?: (
    input: Pick<AssignedCommand, 'workerId' | 'projectId' | 'worktree'>,
  ) => Effect.Effect<ReadonlyMap<string, CapturedWorkerCheckout>, AgentRequestFailed>
  readonly checkpointWorktree?: (
    input: Pick<AssignedCommand, 'workerId' | 'projectId' | 'worktree'>,
  ) => Effect.Effect<void, AgentRequestFailed>
  readonly openHelper?: (input: AssignedHelper) => Effect.Effect<WorkerExecution, AgentStartFailed, Scope.Scope>
  readonly open: (input: {
    readonly workerId: string
    readonly projectId: string
    readonly workspaceId: string
    readonly providerId: string
    readonly worktree: string
    readonly toolPort: number
    readonly setup?: WorkerSetup
    readonly repositories?: ReadonlyArray<AssignedRepository>
    readonly skills?: ReadonlyArray<WorkerSkillFile>
  }) => Effect.Effect<WorkerExecution, AgentStartFailed, Scope.Scope>
}
