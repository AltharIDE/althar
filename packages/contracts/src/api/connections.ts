import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { FeedPosition } from '../identities'
import { KnownArray } from '../open'
import { call, ClientAuthority, command, SocketAllowed, socketCanCall } from './rpc'
import { ApiError, Cursor, Product } from './shared'

/* ---- Code hosts and trackers (docs/architecture/06) ---- */

/** A person's sign-in to a code host or tracker, on this Mac. */
export const ConnectionSummary = Schema.Struct({
  id: Schema.String,
  product: Product,
  /** The product's name: GitHub, Linear. */
  name: Schema.String,
  /** The instance: https://github.com, or a company's own server. */
  webUrl: Schema.String,
  account: Schema.Struct({ login: Schema.String, name: Schema.NullOr(Schema.String) }),
  auth: Schema.Literals(['device_flow', 'pkce', 'token']),
  /** Ready, or its token stopped working and it needs signing in again. */
  state: Schema.Literals(['ready', 'reauth_required']),
  /**
   * The workspace its sign-in reaches, where it reaches only one (ADR-059):
   * Linear's, by the key its links carry and its name. Null, or left out,
   * where it reaches more, or isn't known yet.
   */
  workspace: Schema.optional(Schema.NullOr(Schema.Struct({ key: Schema.String, name: Schema.String }))),
})
export type ConnectionSummary = typeof ConnectionSummary.Type

/** A service as a person connects it: a product's Cloud and Data Center editions are one service. */
export const Service = Schema.Literals(['github', 'gitlab', 'bitbucket', 'linear', 'jira', 'trello', 'clickup'])
export type Service = typeof Service.Type

/** A product a person can connect, and how they sign in to it. */
export const ProductOption = Schema.Struct({
  product: Product,
  /** The service it is an edition of. */
  service: Service,
  name: Schema.String,
  host: Schema.Boolean,
  tracker: Schema.Boolean,
  /** The hosted service's address; null for one that only runs on a company's own server. */
  hostedUrl: Schema.NullOr(Schema.String),
  /** An instance on a company's own server can be connected, by its address. */
  selfHosted: Schema.Boolean,
  /** A sign-in reaches one of its workspaces, and another is connected beside it (ADR-059): Linear's. Left out for none. */
  workspaces: Schema.optional(Schema.Boolean),
  /** The service's own sign-in, in the browser, is set up here; otherwise a pasted token. */
  browserSignIn: Schema.Boolean,
  /** What a pasted token goes with: the account's email, or the API key it was made for. */
  tokenNeeds: Schema.NullOr(Schema.Literals(['email', 'key'])),
  /** What its tokens start with, to notice one on the clipboard; none where they have no mark of their own. */
  tokenPrefixes: Schema.Array(Schema.String),
  /** Where a token is made for the API key the person typed, with `{key}` where it goes. */
  tokenHelpForKey: Schema.NullOr(Schema.String),
  /** What a typed API key is checked against before it is sent: the first pattern it matches says what is wrong with it. */
  keyChecks: Schema.Array(Schema.Struct({ pattern: Schema.String, says: Schema.String })),
})
export type ProductOption = typeof ProductOption.Type

/** A project's repositories on an instance of a service, as their remotes name them. */
export const ConnectPlace = Schema.Struct({
  product: Product,
  /** The instance: https://github.com, or a company's own server. */
  webUrl: Schema.String,
  project: Schema.String,
  /** The remote that names it, as git calls it, where git was asked: origin. */
  remote: Schema.NullOr(Schema.String),
  /** The repositories' paths there: northwind/meridian-api. */
  repositories: Schema.Array(Schema.String),
})
export type ConnectPlace = typeof ConnectPlace.Type

export const ConnectionList = Schema.Struct({
  cursor: Cursor,
  position: Schema.optional(FeedPosition),
  /** Each of a product a newer home connects to and this client doesn't know is left out, here and below. */
  connections: KnownArray('product', [ConnectionSummary]),
  products: KnownArray('product', [ProductOption]),
  /** Where the projects' code is, on the hosted services and on servers already connected. */
  places: KnownArray('product', [ConnectPlace]),
})
export type ConnectionList = typeof ConnectionList.Type

/** A command-line tool's sign-in on this device, which Althar can take a copy of: gh's or glab's. */
export const CliSignIn = Schema.Struct({
  product: Product,
  webUrl: Schema.String,
  tool: Schema.Literals(['gh', 'glab']),
  /** Who it is signed in as there. */
  account: Schema.String,
  /** Its token's scopes, where the service says them. */
  scopes: Schema.NullOr(Schema.Array(Schema.String)),
})
export type CliSignIn = typeof CliSignIn.Type

/**
 * What connecting a service starts from: where its code is in the person's
 * projects (each server their remotes name asked what it is), the
 * command-line sign-ins on this device, the email the projects commit with,
 * and where a token is made on each instance, filled in for its places.
 */
export const ConnectGuide = Schema.Struct({
  service: Service,
  places: Schema.Array(ConnectPlace),
  clis: Schema.Array(CliSignIn),
  /** The email the projects' commits are made with, and the project whose git says it; null for git's own setting. */
  email: Schema.NullOr(Schema.Struct({ address: Schema.String, project: Schema.NullOr(Schema.String) })),
  tokenPages: Schema.Array(Schema.Struct({ product: Product, webUrl: Schema.String, url: Schema.String })),
})
export type ConnectGuide = typeof ConnectGuide.Type

/** What answered at an address the person typed, and where a token is made there. */
export const FoundServer = Schema.Struct({
  product: Schema.NullOr(Product),
  /** The address as a connection keeps it. */
  webUrl: Schema.String,
  /** Why nothing of the service's did: not an address, nothing answered, or something else did. */
  reason: Schema.NullOr(Schema.Literals(['invalid', 'unreachable', 'other'])),
  tokenPage: Schema.NullOr(Schema.String),
})
export type FoundServer = typeof FoundServer.Type

/** What Althar needs of a connection, each a line of its check. */
export const AccessNeed = Schema.Literals([
  'server',
  'site',
  'key',
  'account',
  'reach',
  'push',
  'changes',
  'checks',
  'issues',
  'read',
  'comment',
  'move',
])
export type AccessNeed = typeof AccessNeed.Type

/** Why a line of a check isn't ok, with what it names and the page that puts it right, where there is one. */
export const AccessReason = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('refused') }),
  Schema.Struct({ kind: Schema.Literal('scope'), scope: Schema.String, url: Schema.NullOr(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal('permission'), permission: Schema.String, url: Schema.NullOr(Schema.String) }),
  /** `names`: the repositories (owner/name) the account's role there keeps it from, where the service says which. */
  Schema.Struct({ kind: Schema.Literal('role'), role: Schema.NullOr(Schema.String), names: Schema.optional(Schema.Array(Schema.String)) }),
  Schema.Struct({ kind: Schema.Literal('unseen'), names: Schema.Array(Schema.String), url: Schema.NullOr(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal('no_push'), names: Schema.Array(Schema.String), url: Schema.NullOr(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal('not_installed'), owner: Schema.String, url: Schema.NullOr(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal('restricted'), owner: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('sso'), owner: Schema.String, url: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('no_check_runs'), url: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('unreadable') }),
  Schema.Struct({ kind: Schema.Literal('failed'), message: Schema.String }),
])
export type AccessReason = typeof AccessReason.Type

export const AccessLine = Schema.Struct({
  need: AccessNeed,
  state: Schema.Literals(['ok', 'no', 'unknown']),
  /** What was found, in the service's words: a login, an owner, a role, a host. */
  fact: Schema.NullOr(Schema.String),
  /** How many, where the fact is a count: boards, teams, projects. */
  count: Schema.NullOr(Schema.Number),
  reason: Schema.NullOr(AccessReason),
  /** Each repository it asked on its own, with its outcome and why: what a project's card says of its own repositories. */
  repositories: Schema.optional(
    Schema.Array(
      Schema.Struct({
        path: Schema.String,
        state: Schema.Literals(['ok', 'no', 'unknown']),
        reason: Schema.NullOr(AccessReason),
        /** Whether the service said the account itself may push there; null where it didn't say. */
        accountPush: Schema.optional(Schema.NullOr(Schema.Boolean)),
      }),
    ),
  ),
})
export type AccessLine = typeof AccessLine.Type

/** What a connection can do, as its service says, asked when it is made and whenever the person asks again. */
export const ConnectionCheck = Schema.Struct({
  connectionId: Schema.String,
  lines: Schema.Array(AccessLine),
  /** When its token runs out, where the service says. */
  expiresAt: Schema.NullOr(Schema.String),
  /** An app's sign-in that renews itself. */
  renews: Schema.Boolean,
  /** Where the person's tokens for it are listed, to change one. */
  settings: Schema.String,
})
export type ConnectionCheck = typeof ConnectionCheck.Type

/** A sign-in under way: a code to type on the service's page, or a page to approve in the browser. */
export const SignInStart = Schema.Union([
  Schema.Struct({
    flowId: Schema.String,
    kind: Schema.Literal('device'),
    userCode: Schema.String,
    verificationUri: Schema.String,
    expiresAt: Schema.String,
  }),
  Schema.Struct({ flowId: Schema.String, kind: Schema.Literal('browser'), url: Schema.String }),
])
export type SignInStart = typeof SignInStart.Type

export const SignInState = Schema.Union([
  Schema.Struct({ state: Schema.Literal('waiting') }),
  Schema.Struct({ state: Schema.Literal('done'), connectionId: Schema.String }),
  Schema.Struct({
    state: Schema.Literal('ended'),
    reason: Schema.Literals(['denied', 'expired', 'failed']),
    message: Schema.String,
    /** Where Althar's app is installed, where that is what the sign-in lacked: the connection it would replace stays. */
    install: Schema.optional(Schema.String),
  }),
])
export type SignInState = typeof SignInState.Type

export const SOCKET_CODE_SERVICES: ReadonlySet<string> = new Set<Service>(['github', 'gitlab', 'bitbucket'])

/**
 * Connections to code hosts and trackers: listing them, signing in, a pasted token, the CLI, checking and disconnecting.
 * What connecting a service starts from, and finding which product answers at an address.
 */
export const ConnectionsApi = RpcGroup.make(
  /** The connections on the home, and the code hosts and trackers a person can connect. */
  Rpc.make('ListConnections', { success: ConnectionList, error: ApiError }).annotate(SocketAllowed, socketCanCall('ListConnections')),
  /** Starts the service's own sign-in: a code to type on its page, or a page to approve in the browser. */
  command(
    'StartSignIn',
    // With a connection, the sign-in is to sign that one in again, and is taken only for its account.
    { product: Product, webUrl: Schema.optional(Schema.String), connectionId: Schema.optional(Schema.String) },
    SignInStart,
  ),
  /** How a sign-in stands. */
  call('GetSignIn', { flowId: Schema.String }, SignInState),
  command('CancelSignIn', { flowId: Schema.String }, Schema.Void),
  /**
   * Connects with a token the person pasted, and what goes with it, all of
   * which goes to the keychain. With a connection, it signs that one in again
   * with a new token, keeping its address, email and key, for the account it
   * was.
   */
  command(
    'ConnectToken',
    {
      product: Product,
      webUrl: Schema.optional(Schema.String),
      user: Schema.optional(Schema.String),
      key: Schema.optional(Schema.String),
      token: Schema.String,
      connectionId: Schema.optional(Schema.String),
    },
    ConnectionSummary,
  ),
  /** What connecting a service starts from: where its code is, gh's or glab's sign-in, the email to go with a token, and the token pages. */
  call('GetConnectGuide', { service: Service }, ConnectGuide),
  /** Which of a service's products answers at an address, asked without signing in. */
  call('FindServer', { service: Service, webUrl: Schema.String }, FoundServer),
  /** Connects with gh's or glab's sign-in on this device: Althar keeps its own copy of the token, which agents never see. */
  command('ConnectCli', { product: Product, webUrl: Schema.String, connectionId: Schema.optional(Schema.String) }, ConnectionSummary),
  /** Asks the service what a connection can do. */
  /** A connection's check; for one project, by its name, only that project's repositories, and where its work is pushed. */
  call('CheckConnection', { connectionId: Schema.String, project: Schema.optional(Schema.String) }, ConnectionCheck),
  command('Disconnect', { connectionId: Schema.String }, Schema.Void),
).middleware(ClientAuthority)
