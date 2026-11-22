import type { ProjectWorker } from '@althar/contracts'
import type { AgentRequestFailed, AgentStartFailed, Transport } from '@althar/provider-adapters'
import type {
  WorkerLocalMcpCommand,
  WorkerManagedCommand,
  WorkerManagedProcess,
  WorkerSetup,
  WorkerSkillFile,
} from '@althar/worker-protocol/agent-runs'
import { Effect, type Scope } from 'effect'
import { SqlClient } from 'effect/sql'

export type { ProjectWorker } from '@althar/contracts'

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
export interface WorkerExecutionPlatform {
  readonly list: (projectId: string) => ReadonlyArray<ProjectWorker>
  readonly startCommand?: (input: AssignedCommand) => Effect.Effect<WorkerManagedProcess, AgentStartFailed, Scope.Scope>
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
