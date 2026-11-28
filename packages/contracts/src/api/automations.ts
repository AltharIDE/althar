import { Schema } from 'effect'
import { RpcGroup } from 'effect/rpc'
import { AutomationDefinition, AutomationSnapshot, AutomationsSnapshot } from '../automations'
import { call, ClientAuthority, command } from './rpc'

/**
 * A project's automations: reading, making, changing, turning on, pausing, running and deleting them.
 * Undoing what the coordinator changed of one, and the switches for all of them.
 */
export const AutomationsApi = RpcGroup.make(
  /** A project's automations, for its Automations tab. */
  call('GetAutomations', { projectId: Schema.String }, AutomationsSnapshot),
  /** One automation, for its own page: its definition, its limits and its runs. */
  call('GetAutomation', { automationId: Schema.String }, AutomationSnapshot),
  /** Makes an automation in a project, on this computer: proposed, waiting for the person to turn it on, unless `on`. */
  command(
    'MakeAutomation',
    { projectId: Schema.String, definition: AutomationDefinition, on: Schema.optional(Schema.Boolean) },
    Schema.Struct({ automationId: Schema.String }),
  ),
  /** The person changes an automation: it holds from its next run, and stays on where it is. */
  command('ChangeAutomation', { automationId: Schema.String, definition: AutomationDefinition }, Schema.Void),
  /** Turns an automation on, or back on: no time before now counts. `itemId`, where the person did it from the coordinator's card asking it. */
  command('TurnOnAutomation', { automationId: Schema.String, itemId: Schema.optional(Schema.String) }, Schema.Void),
  /** Pauses an automation: nothing of it starts until it is turned on again. A run under way finishes. */
  command('PauseAutomation', { automationId: Schema.String }, Schema.Void),
  /** Runs an automation once now, with every limit a run has, whether it is on or not yet. */
  command('RunAutomationNow', { automationId: Schema.String, itemId: Schema.optional(Schema.String) }, Schema.Void),
  /** Deletes an automation: nothing of it starts again. The tasks its runs made stay. */
  command('DeleteAutomation', { automationId: Schema.String }, Schema.Void),
  /** Puts back what the coordinator changed an automation from, as the card in its thread shows it. */
  command('UndoAutomationChange', { itemId: Schema.String }, Schema.Void),
  /** Whether an automation's reviews post themselves once drafted, as the person said on its first; an outside pull request's still waits. */
  command('SetAutomationPostsReviews', { automationId: Schema.String, on: Schema.Boolean }, Schema.Void),
  /** Pauses every automation, or lets them run again. Runs under way finish. */
  command('SetAutomationsPaused', { paused: Schema.Boolean }, Schema.Void),
).middleware(ClientAuthority)
