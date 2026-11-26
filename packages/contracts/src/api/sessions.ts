import { Schema } from 'effect'
import { RpcGroup } from 'effect/rpc'
import { ClientAuthority, command } from './rpc'
import { AlwaysScope, FieldAnswer, UserMessageItem } from './shared'

/**
 * The person's answer to a checkout's ask: wait until its changes are
 * committed, start in a worktree instead, check out the task's branch from
 * the branch it is on, or start the task from that branch.
 */
export const CheckoutAnswer = Schema.Literals(['wait', 'worktree', 'switch', 'from_branch'])
export type CheckoutAnswer = typeof CheckoutAnswer.Type

/** The prompt returned to the composer after its turn and later conversation were undone. */
export const UndoTurnResult = Schema.Struct({
  prompt: Schema.String,
  restored: Schema.Int,
  messages: Schema.Array(UserMessageItem.fields.content),
})
export type UndoTurnResult = typeof UndoTurnResult.Type

/**
 * A thread's agent session and its turns: starting and stopping it, interrupting, trying again, compacting, undoing a turn.
 * The answers the person gives an agent: permissions, questions, a stuck step, a held step, a checkout.
 */
export const SessionsApi = RpcGroup.make(
  command(
    'StartSession',
    { threadId: Schema.String, agentId: Schema.String, model: Schema.optional(Schema.String), effort: Schema.optional(Schema.String) },
    Schema.String,
  ),
  /**
   * Stops the turn the thread's agent is in. Between turns, where a turn Althar asked of a task's lead or reviewer waits for a
   * place up next, that turn is let go instead: it leaves Up next, and its agent reads what it would have said with its next.
   */
  command('Interrupt', { threadId: Schema.String }, Schema.Void),
  /**
   * Tries the thread's last turn again, where it failed, as on the
   * connection: what the person said in it goes to its agent again (ADR-060).
   */
  command('TryAgain', { threadId: Schema.String }, Schema.Void),
  /**
   * Asks the thread's agent to compact its context, as a turn of its own after
   * what was said before; it never waits for a place among the agents at work.
   */
  command('CompactContext', { threadId: Schema.String }, Schema.Void),
  command('StopSession', { threadId: Schema.String }, Schema.Void),
  /** Restores the files and conversation before this delivered message, retaining the original record. */
  command('UndoTurn', { itemId: Schema.String }, UndoTurnResult),
  /**
   * The person's answer to a step that needs them: tell its agent what to do,
   * hand it to an agent (on an account and model, where they picked one), or
   * abandon it (a review is gone on without). A step a usage limit stopped
   * can also wait for the reset, where it is known.
   */
  command(
    'AnswerStuck',
    {
      attentionId: Schema.String,
      answer: Schema.Union([
        Schema.Struct({ kind: Schema.Literal('tell'), note: Schema.String }),
        Schema.Struct({
          kind: Schema.Literal('retry'),
          agentId: Schema.String,
          accountId: Schema.optional(Schema.String),
          model: Schema.optional(Schema.String),
          /** How hard the agent it is handed to thinks, as the model offers it; without it, the model's own default. */
          effort: Schema.optional(Schema.String),
        }),
        Schema.Struct({ kind: Schema.Literal('wait') }),
        Schema.Struct({ kind: Schema.Literal('abandon') }),
      ]),
    },
    Schema.Void,
  ),
  /**
   * Hands a step held for a usage limit to another agent, on the account and
   * model the person picked, rather than waiting for the reset: as answering
   * its call would. A lead's step without a free place waits its turn in Up next.
   */
  command(
    'HandOverHeld',
    { taskId: Schema.String, agentId: Schema.String, accountId: Schema.optional(Schema.String), model: Schema.optional(Schema.String) },
    Schema.Void,
  ),
  /** The person's answer to an agent's question, field by field: the options picked, and any words of their own. */
  command('AnswerQuestion', { attentionId: Schema.String, answers: Schema.Record(Schema.String, FieldAnswer) }, Schema.Void),
  /** The person's answer to what Althar asked before a Local task takes a checkout (ADR-091). */
  command('AnswerCheckout', { attentionId: Schema.String, answer: CheckoutAnswer }, Schema.Void),
  /** The person's answer to a permission; with `always`, it is also kept in the project's rules by that scope, one of those offered. */
  command(
    'Answer',
    {
      attentionId: Schema.String,
      decision: Schema.Literals(['allow', 'reject']),
      reason: Schema.optional(Schema.String),
      always: Schema.optional(AlwaysScope),
    },
    Schema.Void,
  ),
).middleware(ClientAuthority)
