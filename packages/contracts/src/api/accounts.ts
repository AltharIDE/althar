import { Schema } from 'effect'
import { RpcGroup } from 'effect/rpc'
import { call, ClientAuthority, command } from './rpc'
import { AccountStatus, PlanUsage, UsageLimit } from './shared'

/** How signing an account in inside Althar stands (ADR-012): the agent's own login, run in the account's home. */
export const AccountSignInState = Schema.Union([
  Schema.Struct({ state: Schema.Literal('starting') }),
  /** Waiting on the browser. `link` opens it elsewhere; `paste`: a code the page shows can be pasted; `refused`: the last one wasn't taken, in the agent's words. */
  Schema.Struct({
    state: Schema.Literal('browser'),
    link: Schema.NullOr(Schema.String),
    paste: Schema.Boolean,
    refused: Schema.NullOr(Schema.String),
  }),
  /** A one-time code to type on `page`, good until `expiresAt`. */
  Schema.Struct({ state: Schema.Literal('device'), code: Schema.String, page: Schema.String, expiresAt: Schema.String }),
  /** Signed in, as `who` on `plan` where the agent says. */
  Schema.Struct({ state: Schema.Literal('done'), who: Schema.NullOr(Schema.String), plan: Schema.NullOr(Schema.String) }),
  Schema.Struct({ state: Schema.Literal('failed'), message: Schema.String }),
])
export type AccountSignInState = typeof AccountSignInState.Type

/** A folder an account switcher keeps one of the agent's accounts in, by a grant for it. */
export const FoundAccount = Schema.Struct({
  grant: Schema.String,
  /** Its name there, as the account's. */
  name: Schema.String,
  /** The folder, shown, never sent back. */
  path: Schema.String,
  /** The switcher that keeps such folders. */
  tool: Schema.String,
})
export type FoundAccount = typeof FoundAccount.Type

/**
 * An agent's accounts: adding, naming, ordering, signing in and out, removing.
 * Plan usage, usage limits, which accounts a project uses, and the warning that a sign-in ends.
 */
export const AccountsApi = RpcGroup.make(
  /**
   * Adds an account to an agent: the folder a grant names, as another tool
   * made it, or, without one, a folder Althar makes, to sign in to.
   */
  command('AddAccount', { agentId: Schema.String, name: Schema.String, grant: Schema.optional(Schema.String) }, AccountStatus),
  command('RenameAccount', { accountId: Schema.String, name: Schema.String }, Schema.Void),
  /** Stops using an account; its folder, with its sign-in, stays. Not the agent's usual one. */
  command('RemoveAccount', { accountId: Schema.String, anyway: Schema.optional(Schema.Boolean) }, Schema.Void),
  /**
   * Signs an account out with its agent's own tool, and keeps it, to sign in again: the usual folder's too, which signs the
   * agent's own command out with it. Not for an agent without a command that signs out (AgentStatus' `signsOut`).
   */
  command('SignOutAccount', { accountId: Schema.String }, Schema.Void),
  /** Puts an agent's accounts in the person's order: the first that can runs work first. */
  command('OrderAccounts', { agentId: Schema.String, accountIds: Schema.Array(Schema.String) }, Schema.Void),
  /** Folders account switchers keep the agent's accounts in, not added yet. */
  call('FindAccounts', { agentId: Schema.String }, Schema.Struct({ found: Schema.Array(FoundAccount) })),
  /**
   * Opens the agent's own sign-in for the account, in Terminal, where the
   * person signs in: the line it runs, and whether it could open it.
   * Copilot CLI accepts a GitHub host, remembered for the account.
   */
  command(
    'SignInAccount',
    { accountId: Schema.String, host: Schema.optional(Schema.String) },
    Schema.Struct({ line: Schema.String, opened: Schema.Boolean }),
  ),
  /** Signs an account in inside Althar, this way: its id, to ask how it stands. */
  command(
    'StartAccountSignIn',
    { accountId: Schema.String, way: Schema.Literals(['browser', 'device']), host: Schema.optional(Schema.String) },
    Schema.Struct({ flowId: Schema.String, state: AccountSignInState }),
  ),
  call('GetAccountSignIn', { flowId: Schema.String }, AccountSignInState),
  /** A code the browser's page showed, for the agent. */
  command('PasteAccountSignInCode', { flowId: Schema.String, code: Schema.String }, Schema.Void),
  command('CancelAccountSignIn', { flowId: Schema.String }, Schema.Void),
  /** Whether work moves on to an agent's next account in the project, and which accounts each agent may use there (null: every one). */
  command(
    'SetProjectAccounts',
    {
      projectId: Schema.String,
      rotate: Schema.Boolean,
      only: Schema.NullOr(Schema.Record(Schema.String, Schema.Array(Schema.String))),
    },
    Schema.Void,
  ),
  /** What the project does when an agent reaches its usage limit. */
  command('SetUsageLimit', { projectId: Schema.String, policy: UsageLimit }, Schema.Void),
  /** Every account's plan usage: read again first where `refresh`, else as kept (at most a minute old). */
  call('GetPlanUsage', { refresh: Schema.optional(Schema.Boolean) }, PlanUsage),
  /** Puts aside the warning that an account's sign-in ends at `endsAt`: it isn't raised again for that sign-in. */
  command(
    'DismissSignInEnding',
    { accountId: Schema.String, endsAt: Schema.String, stage: Schema.Literals(['soon', 'last', 'ended']) },
    Schema.Void,
  ),
).middleware(ClientAuthority)
