import type { AgentRequestFailed, AgentStartFailed, Transport } from '@althar/provider-adapters'
import type { Effect, Scope } from 'effect'

export interface ProjectWorker {
  readonly workerId: string
  readonly providers: ReadonlyArray<string>
  readonly busy: boolean
}

export interface WorkerExecution {
  readonly transport: Extract<Transport, { _tag: 'Remote' }>
  readonly path: string
  readonly toolPort: number
  readonly checkpoint: Effect.Effect<void, AgentRequestFailed>
}

/** The runtime owns a task and its permissions. The platform supplies an enrolled execution location. */
export interface WorkerExecutionPlatform {
  readonly list: (projectId: string) => ReadonlyArray<ProjectWorker>
  readonly open: (input: {
    readonly workerId: string
    readonly projectId: string
    readonly workspaceId: string
    readonly providerId: string
    readonly worktree: string
    readonly toolPort: number
  }) => Effect.Effect<WorkerExecution, AgentStartFailed, Scope.Scope>
}
