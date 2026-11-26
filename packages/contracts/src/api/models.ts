import { Schema } from 'effect'
import { RpcGroup } from 'effect/rpc'
import { AcpCatalog, AcpConnection } from '../agentCatalog'
import { LineComments } from '../lineComments'
import { call, ClientAuthority, command } from './rpc'
import { SentFiles, SentImages, UsageWindowKind } from './shared'

/**
 * How much room a model has where work on it would start: on the account
 * the runtime picks for it (the most room first, as the project moves work
 * through an agent's accounts), that account's tightest window as last read,
 * a model's own window (Opus's week) counted. Only a model on a plan whose
 * usage is read has one.
 */
export const ModelRoom = Schema.Struct({
  agentId: Schema.String,
  /** The model's id at the agent. */
  model: Schema.String,
  accountId: Schema.String,
  accountName: Schema.String,
  /** The agent has more than one account here, so the account is worth naming. */
  several: Schema.Boolean,
  /** 0 to 100. */
  leftPercent: Schema.Number,
  resetsAt: Schema.NullOr(Schema.String),
  kind: UsageWindowKind,
  label: Schema.NullOr(Schema.String),
  /** The account is marked out of usage, as steering sees it (no fresh reading since shows room): until when. The room above is its last read. */
  outUntil: Schema.optional(Schema.String),
})
export type ModelRoom = typeof ModelRoom.Type

/**
 * The models an agent offers, and how hard each can be asked to think, in
 * the agent's own names: from its latest session, or asked of it once.
 */
export const AgentModels = Schema.Struct({
  agentId: Schema.String,
  models: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      description: Schema.NullOr(Schema.String),
      /** In the agent's order; empty where the model has no such choice, or it isn't known yet. */
      efforts: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
      /** The effort a session on it starts at, the person's default aside; null where it isn't known. */
      effort: Schema.NullOr(Schema.String),
    }),
  ),
  /** What it is on, as last seen: its own default, or what it was last set to. */
  model: Schema.NullOr(Schema.String),
  effort: Schema.NullOr(Schema.String),
  /** The person's default effort for each model they set one for: a session on it starts there. */
  defaults: Schema.Array(Schema.Struct({ model: Schema.String, effort: Schema.String })),
  /** The models the person switched off, by id: no plan picks them, and no picker offers them. */
  blocked: Schema.Array(Schema.String),
  /** Being asked now, for an agent not seen before: read again shortly. */
  probing: Schema.Boolean,
  /** It takes images in a message, as it said when last asked or started (ACP's `promptCapabilities.image`); null until it has said. */
  images: Schema.NullOr(Schema.Boolean),
})
export type AgentModels = typeof AgentModels.Type

/**
 * Which agent and model work, and how hard: a thread's agent, model and effort, defaults, blocked models, Auto's model moves, model rooms.
 * Agents themselves: installing one, the ACP catalog and connections.
 */
export const ModelsApi = RpcGroup.make(
  /** Hands the thread to another agent; with what the person said, that is the new lead's first turn, after its brief. */
  command(
    'SwitchAgent',
    {
      threadId: Schema.String,
      agentId: Schema.String,
      model: Schema.optional(Schema.String),
      effort: Schema.optional(Schema.String),
      body: Schema.optional(Schema.String),
      /** Images sent with what the person said. */
      images: Schema.optional(SentImages),
      /** Files and folders sent with what the person said. */
      files: Schema.optional(SentFiles),
      /** Any of what the person said came from dictation. */
      dictated: Schema.optional(Schema.Boolean),
      /** Comments on lines of the task's diff sent with what the person said (decisions: desktop-app § Comments on the diff). */
      comments: Schema.optional(LineComments),
    },
    Schema.String,
  ),
  /**
   * The person's pick of the thread's model, taken at once: the thread's session shows it as who leads from its next turn
   * (`nextLead`), and the runtime sets it on the agent in the background, once no turn runs. What the agent wouldn't take is
   * said in the thread, and the lead stays as it was. `agentId` is the agent whose model it is, as the picker showed it: the
   * one on the thread where left out; while another takes the thread over, the one going out takes it back.
   */
  command('SetModel', { threadId: Schema.String, agentId: Schema.optional(Schema.String), model: Schema.String }, Schema.Void),
  /** How hard the thread's agent thinks, picked as `SetModel` is: taken at once, set on the agent in the background. */
  command('SetEffort', { threadId: Schema.String, agentId: Schema.optional(Schema.String), effort: Schema.String }, Schema.Void),
  /**
   * The thread's agent picked with nothing of its model or effort chosen, as `SetModel` is: the one on the thread picked back
   * over another waiting to take over keeps the thread, as it is; the one going out, picked while another takes over, takes it back.
   */
  command('SetAgent', { threadId: Schema.String, agentId: Schema.String }, Schema.Void),
  /** Every agent's models and efforts, as far as Althar knows them. */
  call('GetModels', {}, Schema.Array(AgentModels)),
  /** The person's default effort for one of an agent's models, kept for the profile. */
  command('SetDefaultEffort', { agentId: Schema.String, model: Schema.String, effort: Schema.String }, Schema.Void),
  /** Switches one of an agent's models off, or on again: one switched off is never planned, and no picker offers it. */
  command('SetModelBlocked', { agentId: Schema.String, model: Schema.String, blocked: Schema.Boolean }, Schema.Void),
  /** Keeps the heavier model for this task, as the line Auto moved the lead with offers: Auto moves nothing more here. */
  command('KeepTheModel', { itemId: Schema.String }, Schema.Void),
  /** Puts the move Auto made again, after Keep: the task's lead may move back to the lighter model. */
  command('UndoTheModelMove', { itemId: Schema.String }, Schema.Void),
  /** Each model's room where work on it would start, in the project where given (its rule for moving work through accounts): read again as plan usage changes. */
  call('GetModelRooms', { projectId: Schema.optional(Schema.String) }, Schema.Array(ModelRoom)),
  /** Downloads an agent's latest release for the person, checks it against the digest its release publishes, and keeps it for Althar to run; done once it is ready. */
  command('InstallAgent', { agentId: Schema.String }, Schema.Void),
).middleware(ClientAuthority)

/** External ACP connections share the API's authority boundary, with a small handler group of their own. */
export const AcpApi = RpcGroup.make(
  call('GetAgentCatalog', { refresh: Schema.optional(Schema.Boolean) }, AcpCatalog),
  command('SaveAcpConnection', { connection: AcpConnection }, Schema.Number),
  command('CheckAcpConnection', { agentId: Schema.String }, Schema.Number),
  command('RemoveAcpConnection', { agentId: Schema.String }, Schema.Number),
).middleware(ClientAuthority)
