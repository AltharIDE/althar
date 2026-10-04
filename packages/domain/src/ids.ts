import { Crypto, Effect, Schema } from 'effect'

/*
 * Every identity has its own kind of id: a short prefix, an underscore, and a
 * UUIDv7 as 32 hex digits. Ids sort by creation time, say what they identify
 * in a log, and cannot be passed where another kind is expected.
 */

const kind = <const B extends string>(prefix: string, brand: B) => ({
  prefix,
  schema: Schema.String.check(Schema.isPattern(new RegExp(`^${prefix}_[0-9a-f]{32}$`))).pipe(Schema.brand(brand)),
})

export const Ids = {
  device: kind('dev', 'DeviceId'),
  actor: kind('act', 'ActorId'),
  project: kind('proj', 'ProjectId'),
  policy: kind('pol', 'PolicyId'),
  repositoryBinding: kind('repo', 'RepositoryBindingId'),
  repositoryLocation: kind('loc', 'RepositoryLocationId'),
  task: kind('task', 'TaskId'),
  taskRequirement: kind('req', 'TaskRequirementId'),
  taskPlan: kind('plan', 'TaskPlanId'),
  run: kind('run', 'RunId'),
  runAttempt: kind('ratt', 'RunAttemptId'),
  runtimeInstance: kind('rt', 'RuntimeInstanceId'),
  workspace: kind('ws', 'WorkspaceId'),
  workspaceSnapshot: kind('snap', 'WorkspaceSnapshotId'),
  workflowDefinition: kind('wdef', 'WorkflowDefinitionId'),
  workflowVersion: kind('wver', 'WorkflowVersionId'),
  workflowExecution: kind('wexe', 'WorkflowExecutionId'),
  node: kind('node', 'NodeId'),
  nodeAttempt: kind('natt', 'NodeAttemptId'),
  thread: kind('thr', 'ThreadId'),
  threadItem: kind('item', 'ThreadItemId'),
  userInput: kind('input', 'UserInputId'),
  turnDelivery: kind('turn', 'TurnDeliveryId'),
  agentInstallation: kind('inst', 'AgentInstallationId'),
  principal: kind('prin', 'PrincipalId'),
  accountStatus: kind('acct', 'AccountStatusId'),
  agentAccount: kind('acc', 'AgentAccountId'),
  providerSession: kind('sess', 'ProviderSessionId'),
  process: kind('proc', 'ProcessId'),
  permissionRequest: kind('perm', 'PermissionRequestId'),
  attentionRequest: kind('attn', 'AttentionRequestId'),
  decision: kind('dec', 'DecisionId'),
  finding: kind('find', 'FindingId'),
  changeSet: kind('chg', 'ChangeSetId'),
  repositoryChange: kind('rchg', 'RepositoryChangeId'),
  workItem: kind('work', 'WorkItemId'),
  mutationReceipt: kind('mut', 'MutationReceiptId'),
  artifact: kind('art', 'ArtifactId'),
  observation: kind('obs', 'ObservationId'),
  recordEvent: kind('evt', 'RecordEventId'),
  command: kind('cmd', 'CommandId'),
  connection: kind('conn', 'ConnectionId'),
  externalLink: kind('xlink', 'ExternalLinkId'),
} as const

export type IdKind = keyof typeof Ids

export const DeviceId = Ids.device.schema
export type DeviceId = typeof DeviceId.Type
export const ActorId = Ids.actor.schema
export type ActorId = typeof ActorId.Type
export const ProjectId = Ids.project.schema
export type ProjectId = typeof ProjectId.Type
export const PolicyId = Ids.policy.schema
export type PolicyId = typeof PolicyId.Type
export const RepositoryBindingId = Ids.repositoryBinding.schema
export type RepositoryBindingId = typeof RepositoryBindingId.Type
export const RepositoryLocationId = Ids.repositoryLocation.schema
export type RepositoryLocationId = typeof RepositoryLocationId.Type
export const TaskId = Ids.task.schema
export type TaskId = typeof TaskId.Type
export const TaskRequirementId = Ids.taskRequirement.schema
export type TaskRequirementId = typeof TaskRequirementId.Type
export const TaskPlanId = Ids.taskPlan.schema
export type TaskPlanId = typeof TaskPlanId.Type
export const RunId = Ids.run.schema
export type RunId = typeof RunId.Type
export const RunAttemptId = Ids.runAttempt.schema
export type RunAttemptId = typeof RunAttemptId.Type
export const RuntimeInstanceId = Ids.runtimeInstance.schema
export type RuntimeInstanceId = typeof RuntimeInstanceId.Type
export const WorkspaceId = Ids.workspace.schema
export type WorkspaceId = typeof WorkspaceId.Type
export const WorkspaceSnapshotId = Ids.workspaceSnapshot.schema
export type WorkspaceSnapshotId = typeof WorkspaceSnapshotId.Type
export const WorkflowDefinitionId = Ids.workflowDefinition.schema
export type WorkflowDefinitionId = typeof WorkflowDefinitionId.Type
export const WorkflowVersionId = Ids.workflowVersion.schema
export type WorkflowVersionId = typeof WorkflowVersionId.Type
export const WorkflowExecutionId = Ids.workflowExecution.schema
export type WorkflowExecutionId = typeof WorkflowExecutionId.Type
export const NodeId = Ids.node.schema
export type NodeId = typeof NodeId.Type
export const NodeAttemptId = Ids.nodeAttempt.schema
export type NodeAttemptId = typeof NodeAttemptId.Type
export const ThreadId = Ids.thread.schema
export type ThreadId = typeof ThreadId.Type
export const ThreadItemId = Ids.threadItem.schema
export type ThreadItemId = typeof ThreadItemId.Type
export const UserInputId = Ids.userInput.schema
export type UserInputId = typeof UserInputId.Type
export const TurnDeliveryId = Ids.turnDelivery.schema
export type TurnDeliveryId = typeof TurnDeliveryId.Type
export const AgentInstallationId = Ids.agentInstallation.schema
export type AgentInstallationId = typeof AgentInstallationId.Type
export const PrincipalId = Ids.principal.schema
export type PrincipalId = typeof PrincipalId.Type
export const AccountStatusId = Ids.accountStatus.schema
export type AccountStatusId = typeof AccountStatusId.Type
export const ProviderSessionId = Ids.providerSession.schema
export type ProviderSessionId = typeof ProviderSessionId.Type
export const ProcessId = Ids.process.schema
export type ProcessId = typeof ProcessId.Type
export const PermissionRequestId = Ids.permissionRequest.schema
export type PermissionRequestId = typeof PermissionRequestId.Type
export const AttentionRequestId = Ids.attentionRequest.schema
export type AttentionRequestId = typeof AttentionRequestId.Type
export const DecisionId = Ids.decision.schema
export type DecisionId = typeof DecisionId.Type
export const FindingId = Ids.finding.schema
export type FindingId = typeof FindingId.Type
export const ChangeSetId = Ids.changeSet.schema
export type ChangeSetId = typeof ChangeSetId.Type
export const RepositoryChangeId = Ids.repositoryChange.schema
export type RepositoryChangeId = typeof RepositoryChangeId.Type
export const WorkItemId = Ids.workItem.schema
export type WorkItemId = typeof WorkItemId.Type
export const MutationReceiptId = Ids.mutationReceipt.schema
export type MutationReceiptId = typeof MutationReceiptId.Type
export const ArtifactId = Ids.artifact.schema
export type ArtifactId = typeof ArtifactId.Type
export const ObservationId = Ids.observation.schema
export type ObservationId = typeof ObservationId.Type
export const RecordEventId = Ids.recordEvent.schema
export type RecordEventId = typeof RecordEventId.Type
export const CommandId = Ids.command.schema
export type CommandId = typeof CommandId.Type
export const ConnectionId = Ids.connection.schema
export type ConnectionId = typeof ConnectionId.Type
export const ExternalLinkId = Ids.externalLink.schema
export type ExternalLinkId = typeof ExternalLinkId.Type

interface IdDefinition<S> {
  readonly prefix: string
  readonly schema: S
}

/** A new id of the given kind. Its time part comes from the Effect clock, so tests control it. */
export const newId = <S extends Schema.Top & { make(input: string): S['Type'] }>(
  definition: IdDefinition<S>,
): Effect.Effect<S['Type'], never, Crypto.Crypto> =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    const uuid = yield* Effect.orDie(crypto.randomUUIDv7)
    return definition.schema.make(`${definition.prefix}_${uuid.replaceAll('-', '')}`)
  })
