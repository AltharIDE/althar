import { Schema } from 'effect'

/*
 * The model's vocabularies: every state and kind the store records. The words
 * are the architecture's, not the interface's (see docs/glossary.md). The
 * store checks each column against the same list, and a test keeps the two in
 * step.
 */

export const ActorKind = Schema.Literals(['person', 'agent', 'system'])
export type ActorKind = typeof ActorKind.Type

export const RepositoryAccess = Schema.Literals(['read', 'write', 'observe'])
export type RepositoryAccess = typeof RepositoryAccess.Type

export const LocationKind = Schema.Literals(['existing', 'managed'])
export type LocationKind = typeof LocationKind.Type

export const LocationState = Schema.Literals(['ready', 'needs_access', 'changed', 'unavailable'])
export type LocationState = typeof LocationState.Type

export const TaskState = Schema.Literals(['draft', 'open', 'done', 'abandoned'])
export type TaskState = typeof TaskState.Type

/** A plan the coordinator proposes before a task starts. */
export const PlanState = Schema.Literals(['proposed', 'accepted', 'replaced', 'declined'])
export type PlanState = typeof PlanState.Type

/** A run's logical state. `suspended` is Stopped on screen; `cancelled` is Abandon. */
export const RunState = Schema.Literals(['admitted', 'running', 'suspended', 'succeeded', 'failed', 'cancelled'])
export type RunState = typeof RunState.Type

export const RunAttemptState = Schema.Literals(['active', 'succeeded', 'failed', 'cancelled', 'interrupted'])
export type RunAttemptState = typeof RunAttemptState.Type

export const WorkspaceState = Schema.Literals(['preparing', 'ready', 'published', 'cleaned', 'failed'])
export type WorkspaceState = typeof WorkspaceState.Type

export const ExecutionState = Schema.Literals(['running', 'succeeded', 'failed', 'cancelled'])
export type ExecutionState = typeof ExecutionState.Type

export const GraphRevisionCause = Schema.Literals(['materialized', 'patch'])
export type GraphRevisionCause = typeof GraphRevisionCause.Type

/** The node types of docs/architecture/05. */
export const NodeType = Schema.Literals([
  'deterministic_action',
  'agent',
  'integration',
  'human_decision',
  'condition',
  'bounded_map',
  'join',
  'verification',
  'compensation',
  'subworkflow',
  'bounded_loop',
])
export type NodeType = typeof NodeType.Type

export const NodeState = Schema.Literals(['pending', 'ready', 'running', 'succeeded', 'failed', 'skipped', 'cancelled', 'uncertain'])
export type NodeState = typeof NodeState.Type

export const ThreadKind = Schema.Literals(['coordinator', 'task', 'step'])
export type ThreadKind = typeof ThreadKind.Type

/** What a thread item is: a normalized entry of the conversation record. */
export const ThreadItemKind = Schema.Literals([
  'user_message',
  'agent_message',
  'agent_thought',
  'tool_call',
  'plan',
  'step_result',
  'notice',
  /** A task in the coordinator's thread: its plan, then its card. Charrette posts it. */
  'task',
  /** Something heard from outside, written by someone else: a comment on the task's pull request, its checks. */
  'arrival',
])
export type ThreadItemKind = typeof ThreadItemKind.Type

/** How a message written during a turn is delivered (docs/architecture/01). */
export const InputDisposition = Schema.Literals(['after_current', 'interrupt_and_continue', 'supersede_pending', 'cancel_run'])
export type InputDisposition = typeof InputDisposition.Type

export const UserInputState = Schema.Literals(['queued', 'delivered', 'superseded'])
export type UserInputState = typeof UserInputState.Type

export const TurnDeliveryState = Schema.Literals(['pending', 'delivered', 'completed', 'interrupted', 'interruption_uncertain', 'failed'])
export type TurnDeliveryState = typeof TurnDeliveryState.Type

export const InstallationStatus = Schema.Literals(['supported', 'degraded', 'blocked', 'missing'])
export type InstallationStatus = typeof InstallationStatus.Type

export const AuthMode = Schema.Literals(['vendor_cli', 'api_key', 'oauth', 'enterprise', 'workload'])
export type AuthMode = typeof AuthMode.Type

export const AccountState = Schema.Literals(['ok', 'warning', 'limited'])
export type AccountState = typeof AccountState.Type

export const AccountStatusSource = Schema.Literals(['error', 'side_channel'])
export type AccountStatusSource = typeof AccountStatusSource.Type

export const ProcessPurpose = Schema.Literals(['agent', 'verify', 'setup', 'git', 'other', 'probe'])
export type ProcessPurpose = typeof ProcessPurpose.Type

/** `launching` is written before the process is spawned, so a crash in between still leaves a trace to reconcile. */
export const ProcessState = Schema.Literals(['launching', 'running', 'exited', 'killed', 'unknown'])
export type ProcessState = typeof ProcessState.Type

/** ACP's tool kinds. */
export const ToolKind = Schema.Literals(['read', 'edit', 'delete', 'move', 'search', 'execute', 'think', 'fetch', 'switch_mode', 'other'])
export type ToolKind = typeof ToolKind.Type

export const PermissionRequestState = Schema.Literals(['open', 'decided', 'cancelled'])
export type PermissionRequestState = typeof PermissionRequestState.Type

/**
 * What was decided. `allow` and `reject` answer a permission request; `fix`,
 * `answer` and `dismiss` answer a finding or a question. The option sent to the
 * agent is recorded apart, and is never an "always" option (ADR-007).
 */
export const DecisionOutcome = Schema.Literals(['allow', 'reject', 'answer', 'fix', 'dismiss'])
export type DecisionOutcome = typeof DecisionOutcome.Type

/**
 * How far a permission decision reaches: this request only, the rest of the
 * turn (when the agent offers nothing narrower), or a rule for later ones.
 */
export const DecisionScope = Schema.Literals(['once', 'turn', 'rule'])
export type DecisionScope = typeof DecisionScope.Type

export const FindingSeverity = Schema.Literals(['blocking', 'major', 'minor', 'nit'])
export type FindingSeverity = typeof FindingSeverity.Type

/** A review finding: open until the lead fixes it or sets it aside, or a person dismisses it. */
export const FindingState = Schema.Literals(['open', 'fixed', 'set_aside', 'dismissed'])
export type FindingState = typeof FindingState.Type

/** Why Charrette recorded what code a workspace held. */
export const SnapshotReason = Schema.Literals(['node_started', 'node_ended', 'switch', 'interrupt'])
export type SnapshotReason = typeof SnapshotReason.Type

/** Why a node attempt is held without needing a person. */
export const HoldReason = Schema.Literals(['usage_limit', 'agent_unavailable'])
export type HoldReason = typeof HoldReason.Type

export const AttentionKind = Schema.Literals([
  'permission',
  'question',
  'stuck',
  'plan',
  'graph_patch',
  'usage_limit',
  'review_disagreement',
])
export type AttentionKind = typeof AttentionKind.Type

export const AttentionState = Schema.Literals(['open', 'answered', 'expired', 'withdrawn'])
export type AttentionState = typeof AttentionState.Type

export const ChangeSetState = Schema.Literals(['open', 'published', 'abandoned'])
export type ChangeSetState = typeof ChangeSetState.Type

export const PullRequestState = Schema.Literals(['none', 'draft', 'ready', 'merged', 'closed'])
export type PullRequestState = typeof PullRequestState.Type

export const WorkItemState = Schema.Literals(['pending', 'claimed', 'done', 'failed', 'uncertain'])
export type WorkItemState = typeof WorkItemState.Type

export const MutationState = Schema.Literals(['intended', 'confirmed', 'failed', 'uncertain'])
export type MutationState = typeof MutationState.Type

/** The code hosts and trackers Charrette connects to (docs/architecture/06). Cloud and Data Center are separate products. */
export const ConnectionProduct = Schema.Literals([
  'github',
  'gitlab',
  'bitbucket_cloud',
  'bitbucket_dc',
  'linear',
  'jira_cloud',
  'jira_dc',
  'trello',
])
export type ConnectionProduct = typeof ConnectionProduct.Type

/** How a person signed in to a service: its device flow, its browser sign-in with PKCE, or a token they pasted. */
export const ConnectionAuth = Schema.Literals(['device_flow', 'pkce', 'token'])
export type ConnectionAuth = typeof ConnectionAuth.Type

/** Whether a connection works: ready, needing its person to sign in again, or removed. */
export const ConnectionState = Schema.Literals(['ready', 'reauth_required', 'removed'])
export type ConnectionState = typeof ConnectionState.Type

/** What a task's external link points at: the issue it came from, or a change it opened. */
export const ExternalKind = Schema.Literals(['issue', 'change'])
export type ExternalKind = typeof ExternalKind.Type

export const ArtifactKind = Schema.Literals(['brief', 'message', 'transcript', 'patch', 'log', 'report', 'findings', 'summary', 'other'])
export type ArtifactKind = typeof ArtifactKind.Type

export const Sensitivity = Schema.Literals(['normal', 'may_contain_secrets'])
export type Sensitivity = typeof Sensitivity.Type

/** The aggregates whose changes are recorded and fed to clients. */
export const AggregateType = Schema.Literals([
  'project',
  'task',
  'task_plan',
  'run',
  'run_attempt',
  'workspace',
  'workflow_execution',
  'node',
  'node_attempt',
  'thread',
  'thread_item',
  'user_input',
  'turn_delivery',
  'provider_session',
  'permission_request',
  'attention_request',
  'decision',
  'finding',
  'change_set',
  'mutation_receipt',
  'agent_installation',
  'account_status',
  'connection',
  'external_link',
  'policy',
  'agent_account',
])
export type AggregateType = typeof AggregateType.Type
