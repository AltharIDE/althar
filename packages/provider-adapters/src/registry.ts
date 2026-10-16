import type { InAppSignIn } from './signInFlow'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { codexWithoutOwnTools, openCodeWithoutOwnTools, type StartingAt } from './ownTools'

/*
 * Each agent is an entry here, not a code path (docs/architecture/03). The
 * modes and option ids were read from the agents themselves (scripts/probe.ts)
 * on 28 September 2026: claude-agent-acp 0.84.0, codex-acp 2.0.0 and OpenCode
 * 1.18.31; codex-acp again at 2.1.1 on 7 October 2026, unchanged but for a
 * new model; OpenCode's effort on 8 October 2026, which it offers only once
 * a session is on a model that has levels. Probe again after upgrading any
 * of them.
 */

export type AgentId = 'claude-code' | 'codex' | 'opencode'

/**
 * A launch that happens out on the device rather than here: the person's own
 * command installed outside a sandbox that cannot see it (a Flatpak's home).
 * The executor hands it the working directory and the environment it
 * assembled, and runs what comes back (`Installs.ts`'s `onDevice`).
 */
export interface OutOnDevice {
  (at: { readonly cwd?: string; readonly env: Readonly<Record<string, string | undefined>> }): LaunchSpec
}

/**
 * How to start a process: a command, its arguments, extra environment, and
 * which of Althar's own environment variables it may inherit beyond the
 * common allowlist (see `process.ts`).
 */
export interface LaunchSpec {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly env?: Readonly<Record<string, string>>
  readonly inheritEnv?: ReadonlyArray<string>
  /**
   * Where this command is not here but out on the device (a Flatpak): how the
   * executor runs it there instead, with the cwd and environment it assembled.
   */
  readonly onDevice?: OutOnDevice
}

/**
 * What an agent's permission options mean, by id. Agents give the same ACP
 * kind to options that do different things: Codex has two `reject_once`
 * options, one that skips the action and carries on, and one that stops the
 * turn to wait for a person. Ids not listed here fall back to their kind:
 * `allow_once` allows this action, `reject_once` rejects it and carries on.
 */
export interface PermissionMeanings {
  readonly rejectAndContinue: ReadonlyArray<string>
  readonly rejectAndStop: ReadonlyArray<string>
  /** How far each allow option reaches, when it is not just this action. */
  readonly allowScopes: Readonly<Record<string, 'once' | 'turn' | 'session'>>
}

export interface AgentDefinition {
  readonly id: AgentId
  readonly name: string
  /** Bundled adapters ship with Althar at pinned versions; user-installed agents are found on the machine. */
  readonly source: 'bundled' | 'user_installed'
  /** The command that starts it. `node` is the Node binary bundled adapters run on: the one the app ships, or Electron's own in dev (`adapterNode`). */
  readonly launch: (node: string) => LaunchSpec
  /**
   * The modes Althar starts sessions in (ADR-007): one where the agent asks
   * before acting, never a bypass mode; one that only reads; and the one a
   * role that only reads (the coordinator, a reviewer) runs in. That is the
   * read-only mode only where it is a sandbox that still lets the agent call
   * Althar's tools. Claude Code's plan mode and OpenCode's plan agent are
   * instructions to the model, and it refuses Althar's tools in them
   * (scripts/probe-tools.ts in the runtime), so those roles run in the mode
   * that asks, with Althar's rules denying every write.
   */
  readonly modes: { readonly ask: string; readonly readOnly: string; readonly reader: string }
  /**
   * The ids of its session config options. `ownEffort` is the effort level
   * that leaves a model at its own default, for an agent that otherwise puts
   * a session on a model's first level: Althar sets it where nothing chose one.
   */
  readonly options: { readonly mode: string; readonly model: string; readonly effort?: string; readonly ownEffort?: string }
  /**
   * The agent's own sign-in (docs/architecture/03: the official tool owns it).
   * Althar runs the documented status command and reads its output; it
   * never reads a credential store. `login` is what the user runs.
   */
  readonly signIn: {
    readonly status: (node: string) => LaunchSpec
    /** True when signed in, false when not, undefined when the output can't tell. */
    readonly read: (output: string, exitCode: number | null) => boolean | undefined
    /**
     * How the sign-in is paid for, from the same output: a plan, or per use, on
     * a key; undefined when it can't tell. Althar moves work on to an agent
     * by itself only when its plan pays.
     */
    readonly paidBy?: (output: string) => PaidBy | undefined
    readonly login: string
    /** Its sign-in as Althar runs it, without a terminal (`signInFlow.ts`); without it, `login` in a terminal. */
    readonly inApp?: InAppSignIn
    /**
     * Its own sign-out, run in an account's home when the person removes an
     * account Althar made, before its folder goes (ADR-012). Without one,
     * the sign-in is a file in the home, gone with it.
     */
    readonly logout?: {
      readonly run: (node: string) => LaunchSpec
      /** The same, as the person would type it. */
      readonly line: string
    }
  }
  /**
   * Where it keeps a sign-in (ADR-012): the environment variable that points
   * it at a folder of its own, a home, and its usual folder when that isn't
   * set. `shared` picks, from what is in the usual folder, what isn't the
   * account's own: the person's settings and instructions, or other tools'
   * data where the variable is a general one. It is linked into a home
   * Althar makes, so every account works the same; never a sign-in.
   */
  readonly home: {
    readonly variable: string
    readonly usual: (env: Readonly<Record<string, string | undefined>>, homeDir: string) => string
    readonly shared: (names: ReadonlyArray<string>) => ReadonlyArray<string>
  }
  readonly permissions: PermissionMeanings
  /** What prints its own version, for Settings; without it, none is shown. */
  readonly version?: (node: string) => LaunchSpec
  /**
   * The one major version Althar runs it at, where another isn't safe yet:
   * no session starts on a copy whose `version` says another, and Settings
   * says `why`; Althar's download takes only releases of this one.
   */
  readonly supported?: { readonly major: number; readonly why: string }
  /**
   * The command its launch, sign-in and version run by name, and the copies
   * of it Althar has where the person has none of their own: one that
   * ships with Althar, and one Althar can download at the person's asking
   * (only for an agent whose license lets anyone fetch and run its
   * releases). The person's own always comes first (`installs.ts`).
   */
  readonly cli?: AgentCli
  /**
   * What goes in `_meta` on `session/new`, to keep the agent asking whatever
   * its settings say (ADR-007): for a lead, or for a role that only reads
   * (the coordinator, a reviewer, the lead of a review), whose writes are
   * refused outright. `untrusted`, for the lead of a review of someone else's
   * pull request, loads none of the repository's settings or hooks, nor the
   * person's own allow rules; `offline`, for one from outside the project,
   * takes away what the agent reaches the web with where its settings can:
   * each agent's entry says what that holds it to.
   */
  readonly sessionMeta?: (role?: 'lead' | 'reader', options?: SessionOptions) => Readonly<Record<string, unknown>>
  /**
   * How it is held as the lead of a review of someone else's pull request
   * (docs/architecture/06), beyond its reader mode and `sessionMeta`.
   * `env`, what its environment adds over `withoutOwnTools`' (which it is
   * given) so that nothing of the repository's own config, hooks or plugins
   * loads. `outside`, whether that holds it to only reading a pull request
   * from outside the project: every command it runs asks first and meets
   * Althar's reader rules, none running because its sandbox would contain
   * it, and nothing of its own reaches the network. Without `outside`, no
   * review of someone else's pull request is started on it, a team's
   * included: it could run the pull request's code.
   */
  readonly reviewing?: {
    readonly outside: boolean
    readonly env?: (own: Readonly<Record<string, string>>) => Readonly<Record<string, string>>
  }
  /**
   * Verified session settings that remove the agent's built-in tools, disable
   * user hooks and exclude its own MCP servers. Without this capability the
   * runtime asks the person instead of starting a permission judge. A read-only
   * sandbox is not sufficient: it can still read credentials outside the cwd.
   */
  readonly permissionJudge?: { readonly sessionMeta: Readonly<Record<string, unknown>> }
  /**
   * What its environment adds, as it starts somewhere, to keep the person's
   * own MCP servers out of its sessions (ownTools.ts); without it, it loads
   * only the servers it is given.
   */
  readonly withoutOwnTools?: (at: StartingAt) => Readonly<Record<string, string>>
  /** What it does differently, for the support matrix. */
  readonly knownGaps: ReadonlyArray<string>
}

/**
 * How a session is started beyond its role: `untrusted`, it leads a review of
 * someone else's pull request, whose repository's settings and hooks are the
 * pull request's to write; `offline`, it has no network where the agent lets
 * Althar take it away.
 */
export interface SessionOptions {
  readonly offline?: boolean
  readonly untrusted?: boolean
}

export interface AgentCli {
  /** The command by name, as on the person's PATH; `.exe` is added on Windows. */
  readonly name: string
  /** The copy that ships with Althar, by its path; null where this platform has none. */
  readonly bundled?: () => string | null
  /** Where Althar can download it. */
  readonly download?: AgentDownload
}

export interface AgentDownload {
  /** Its GitHub repository, owner/name: its latest release is what is downloaded, of the agent's `supported` major where it has one. */
  readonly repository: string
  /** The release's file for each `platform-arch`, as Node names them: a zip or a gzipped tar with the command in it. */
  readonly assets: Readonly<Record<string, string>>
  /** About how big the download is, as the person reads it. */
  readonly size: string
}

/** Whether this Linux runs on musl, as Alpine does, rather than glibc: Node's report names glibc's version where there is one. */
export const isMusl = (platform: string = process.platform): boolean => {
  if (platform !== 'linux') return false
  try {
    const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined
    return report?.header?.glibcVersionRuntime === undefined
  } catch {
    return false
  }
}

/**
 * Claude Code's own program as the Agent SDK ships it, for this platform and
 * processor: the copy its sessions run on (claude-agent-acp starts it), so it
 * is there even where the person never installed Claude Code. Null where
 * it isn't.
 */
export const bundledClaude = (
  platform: string = process.platform,
  arch: string = process.arch,
  musl: boolean = isMusl(platform),
): string | null => {
  try {
    const fromAdapter = createRequire(require.resolve('@agentclientprotocol/claude-agent-acp/package.json'))
    // The SDK exports no package.json, so it is found by its entry, as Node resolves it.
    const fromSdk = createRequire(fromAdapter.resolve('@anthropic-ai/claude-agent-sdk'))
    const binary = platform === 'win32' ? 'claude.exe' : 'claude'
    // On Linux, the build for its C library first, the other only if that one is missing.
    for (const variant of platform !== 'linux' ? [''] : musl ? ['-musl', ''] : ['', '-musl']) {
      try {
        return join(dirname(fromSdk.resolve(`@anthropic-ai/claude-agent-sdk-${platform}-${arch}${variant}/package.json`)), binary)
      } catch {
        // The next build.
      }
    }
    return null
  } catch {
    return null
  }
}

/** Shares these names, where the usual folder has them. */
const only =
  (names: ReadonlyArray<string>) =>
  (present: ReadonlyArray<string>): ReadonlyArray<string> =>
    present.filter((name) => names.includes(name))

const require = createRequire(import.meta.url)
const bundled = (packageName: string, entry: string) => join(dirname(require.resolve(`${packageName}/package.json`)), entry)

/** Codex's builds, by Node's `platform-arch`: the Rust target each is, as `@openai/codex`'s `bin/codex.js` names them. */
const CODEX_TARGETS: Readonly<Record<string, string>> = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-musl',
  'linux-x64': 'x86_64-unknown-linux-musl',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'win32-x64': 'x86_64-pc-windows-msvc',
}

/**
 * Codex's own program as the adapter's `@openai/codex` ships it, for this
 * platform and processor, for its sign-in, status and version where the
 * person has no Codex. Not `bin/codex.js`, which finds it for a terminal:
 * that needs a `node` on the PATH, which an app opened from the Finder
 * doesn't have. Null where there is no build.
 */
export const bundledCodex = (platform: string = process.platform, arch: string = process.arch): string | null => {
  const target = CODEX_TARGETS[`${platform}-${arch}`]
  if (target === undefined) return null
  try {
    const fromAdapter = createRequire(require.resolve('@agentclientprotocol/codex-acp/package.json'))
    const fromCodex = createRequire(fromAdapter.resolve('@openai/codex/package.json'))
    const vendor = join(dirname(fromCodex.resolve(`@openai/codex-${platform}-${arch}/package.json`)), 'vendor')
    return join(vendor, target, 'bin', platform === 'win32' ? 'codex.exe' : 'codex')
  } catch {
    return null
  }
}

/** How an agent's sign-in is paid for: a plan (Claude's, ChatGPT's), or per use, on a key. */
export type PaidBy = 'plan' | 'key'

/** Claude Code's status says how it signed in: its claude.ai account, a plan; anything else is a key or a cloud's billing. */
const claudePaidBy = (output: string): PaidBy | undefined => {
  try {
    const parsed: unknown = JSON.parse(output)
    const method = typeof parsed === 'object' && parsed !== null && 'authMethod' in parsed ? parsed.authMethod : undefined
    if (typeof method !== 'string' || method === 'none') return undefined
    return method === 'claude.ai' ? 'plan' : 'key'
  } catch {
    return undefined
  }
}

const loggedInField = (output: string): boolean | undefined => {
  try {
    const parsed: unknown = JSON.parse(output)
    return typeof parsed === 'object' && parsed !== null && 'loggedIn' in parsed && typeof parsed.loggedIn === 'boolean'
      ? parsed.loggedIn
      : undefined
  } catch {
    return undefined
  }
}

/**
 * OpenCode allows most actions without asking unless its config says
 * otherwise. Inline config overrides the project's own, so every OpenCode
 * process Althar starts asks, and its requests reach Althar. Agent-level
 * permissions take precedence over global ones, so the built-in agents are
 * set too, in case a repository's config allows more for them.
 *
 * OpenCode also stops its loop when a request is rejected, unless told to
 * carry on, so a rejection works as it does for the other agents.
 */
const asks = { edit: 'ask', bash: 'ask', webfetch: 'ask' }
const openCodeBase = {
  permission: asks,
  agent: { build: { permission: asks }, plan: { permission: asks } },
  experimental: { continue_loop_on_deny: true },
}
const openCodeConfig = JSON.stringify(openCodeBase)

/**
 * OpenCode as the lead of a review of someone else's pull request, as
 * OpenCode 1.18.31 reads it (its config loader, seen 14 October 2026):
 * `OPENCODE_DISABLE_PROJECT_CONFIG` skips the repository's `opencode.json`
 * and its `.opencode` folders, whose plugins and tools are code it would run
 * as it starts; `lsp: false` starts no language server, some of which run a
 * project's build scripts to read it (none starts unless a config turns it
 * on, but the person's may); and its web search asks too, which Althar's
 * reader rules refuse, since nothing says what it reaches. Its permissions
 * keep the person's MCP servers off as `withoutOwnTools` left them.
 */
const openCodeReviewing = (own: Readonly<Record<string, string>>): Readonly<Record<string, string>> => {
  const reviewAsks = { ...asks, websearch: 'ask' }
  const config = JSON.parse(own.OPENCODE_CONFIG_CONTENT ?? openCodeConfig) as Readonly<Record<string, unknown>>
  return {
    OPENCODE_DISABLE_PROJECT_CONFIG: '1',
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      ...config,
      permission: reviewAsks,
      agent: { build: { permission: reviewAsks }, plan: { permission: reviewAsks } },
      lsp: false,
    }),
  }
}

/**
 * Codex as the lead of a review of someone else's pull request, through the
 * config codex-acp merges into every session it starts (`CODEX_CONFIG`, read
 * as dotted keys, beside the person's MCP servers switched off): its own web
 * search off (`web_search = "disabled"`, as Codex 0.159 names it), and hooks
 * off (`features.hooks`), since codex-acp trusts every session's folder, so a
 * repository's `.codex` config would otherwise apply. It isn't held to
 * reading: codex-acp 2.1.1 starts every turn with its mode's approval policy
 * (`on-request` for `read-only`), and no session option changes it, so
 * Codex runs a command its read-only sandbox contains without asking, and
 * Althar's reader rules never see it. It could run the pull request's
 * scripts there, with no network and no writes. So it reviews a team's pull
 * request held this far, and none from outside.
 */
const codexReviewing = (own: Readonly<Record<string, string>>): Readonly<Record<string, string>> => ({
  CODEX_CONFIG: JSON.stringify({
    ...(own.CODEX_CONFIG === undefined ? {} : (JSON.parse(own.CODEX_CONFIG) as Readonly<Record<string, unknown>>)),
    web_search: 'disabled',
    'features.hooks': false,
  }),
})

/**
 * Claude Code reads the user's settings and the repository's committed
 * `.claude/settings.json`, and an allow rule in either approves an action
 * before Althar sees it. Ask rules win over allow rules, and over a hook
 * that approves, so every session gets these, and bypass mode is made
 * unreachable for its whole life.
 *
 * Its sandbox keeps shell commands inside the worktree (docs/architecture/03):
 * a command that stays inside runs without asking, and one that has to leave
 * (the network, a write elsewhere) asks, and reaches Althar. In a git
 * worktree the sandbox lets git write to the main repository's `.git`, except
 * its hooks and config. A lead may also bind and listen on localhost
 * (`network.allowLocalBinding`), so a test run can start a server and a
 * prototype can serve a showcase page without leaving the sandbox. On macOS
 * Claude documents that this setting is broader than listening: commands may
 * also connect to any localhost port, including services outside the sandbox,
 * and listen on non-loopback addresses. The domain allowlist and writable
 * paths are unchanged. Where the sandbox can't start, commands run without
 * it and every one asks.
 *
 * Only the MCP servers Althar gives a session are loaded, not the user's
 * or the repository's own, whose tools the ask list doesn't cover.
 */
const claudeAsks = {
  claudeCode: {
    options: {
      allowDangerouslySkipPermissions: false,
      strictMcpConfig: true,
      // An object: the adapter reads a string as a path to a settings file.
      settings: {
        permissions: { ask: ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebFetch'] },
        sandbox: {
          enabled: true,
          autoAllowBashIfSandboxed: true,
          allowUnsandboxedCommands: true,
          failIfUnavailable: false,
          network: { allowLocalBinding: true },
        },
      },
    },
  },
}

/**
 * Claude Code for a role that only reads: its edit tools denied, which also
 * denies its sandbox's writes, and every shell command asking, so each one
 * reaches Althar's reader rules rather than running because the sandbox
 * would contain it. What it reads is a throwaway copy all the same. In a
 * Flatpak its sandbox cannot start (no nested user namespaces there), so,
 * as for the ask mode, commands run without it and every one reaches Althar's
 * reader rules. Those rules refuse direct `flatpak-spawn` commands; the
 * manifest's permission remains broad and is not a boundary against a
 * compromised app or agent.
 *
 * Untrusted, as the lead of a review of someone else's pull request, it
 * loads no settings file (`settingSources: []`, which claude-agent-acp 0.88.0
 * passes over its own default of user, project and local): not the
 * repository's `.claude/settings.json`, which the pull request writes and
 * whose hooks would run its code and whose allow rules would approve its
 * commands before Althar sees them, nor the person's own, whose allow rules
 * would too. Hooks are off besides (`disableAllHooks`), as for the
 * permission judge. Its rules and sandbox below are the programmatic
 * settings, which load whatever the sources.
 */
const claudeReads = (flatpak: boolean, offline: boolean, untrusted: boolean) => ({
  claudeCode: {
    options: {
      allowDangerouslySkipPermissions: false,
      strictMcpConfig: true,
      ...(untrusted ? { settingSources: [] } : {}),
      settings: {
        permissions: offline
          ? { deny: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch'], ask: ['Bash'] }
          : { deny: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'], ask: ['Bash', 'WebFetch'] },
        sandbox: { enabled: true, autoAllowBashIfSandboxed: false, allowUnsandboxedCommands: flatpak, failIfUnavailable: false },
        ...(untrusted ? { disableAllHooks: true } : {}),
      },
    },
  },
})

// claude-agent-acp 0.88.0 forwards this explicit tools array to the SDK.
// Removing the tool set also removes Read/Grep/Glob, which never ask in plan mode.
const claudeJudges = {
  claudeCode: {
    options: {
      tools: [],
      settingSources: [],
      allowDangerouslySkipPermissions: false,
      strictMcpConfig: true,
      settings: { disableAllHooks: true },
    },
  },
}

export const agents: Readonly<Record<AgentId, AgentDefinition>> = {
  'claude-code': {
    id: 'claude-code',
    name: 'Claude Code',
    source: 'bundled',
    launch: (node) => ({
      command: node,
      args: [bundled('@agentclientprotocol/claude-agent-acp', 'dist/index.js')],
      inheritEnv: ['CLAUDE_CONFIG_DIR'],
    }),
    modes: { ask: 'default', readOnly: 'plan', reader: 'default' },
    options: { mode: 'mode', model: 'model', effort: 'effort' },
    signIn: {
      status: () => ({ command: 'claude', args: ['auth', 'status'] }),
      read: loggedInField,
      paidBy: claudePaidBy,
      login: 'claude auth login',
      inApp: { kind: 'claude-login', ways: ['browser'], run: () => ({ command: 'claude', args: ['auth', 'login', '--claudeai'] }) },
      // Its sign-in is a Keychain item named after the home's path, which deleting the folder would leave behind.
      logout: { run: () => ({ command: 'claude', args: ['auth', 'logout'] }), line: 'claude auth logout' },
    },
    /* On macOS its sign-in is a Keychain item named after the folder's path, so a home never moves. */
    home: {
      variable: 'CLAUDE_CONFIG_DIR',
      usual: (env, homeDir) => env.CLAUDE_CONFIG_DIR || join(homeDir, '.claude'),
      shared: only(['settings.json', 'CLAUDE.md', 'agents', 'commands', 'skills', 'plugins', 'output-styles']),
    },
    /* From claude-agent-acp's permissions/options/shared.js. Rejecting skips the action and Claude carries on. */
    version: () => ({ command: 'claude', args: ['--version'] }),
    /* Its sign-in, status and version run `claude`: the person's own, else the copy its sessions run on, which ships with Althar. */
    cli: { name: 'claude', bundled: () => bundledClaude() },
    permissions: { rejectAndContinue: ['reject'], rejectAndStop: [], allowScopes: { 'allow-once': 'once', 'exit-plan-default': 'once' } },
    /*
     * Offline, a reader has WebFetch and WebSearch denied, so Claude Code
     * reaches no page itself; every shell command still asks, and meets
     * Althar's reader rules, which list no command that reaches the network
     * and refuse every fetch for that session. Its sandbox, where it starts,
     * lets a command reach only the domains its settings allow (none here)
     * and asks for any other, which Althar refuses too: so Claude Code's
     * documentation describes it, not yet checked against a real session. In
     * a Flatpak, where the sandbox can't start, the rules are what holds it.
     */
    sessionMeta: (role = 'lead', options = {}) =>
      role === 'reader'
        ? claudeReads(process.env.FLATPAK_ID !== undefined, options.offline === true, options.untrusted === true)
        : claudeAsks,
    /*
     * As a review's lead it is held by its session's settings alone (claudeReads, untrusted): every command asks and meets
     * Althar's reader rules, no settings file or hook of the repository's or the person's loads, and offline its web tools are
     * denied. So it may read a pull request from outside.
     */
    reviewing: { outside: true },
    permissionJudge: { sessionMeta: claudeJudges },
    knownGaps: [
      'Starts in whatever mode the user set in Claude Code, which may be bypassPermissions, so Althar always sets the mode.',
      "Hooks in the repository's or the user's settings run as code on the Mac whenever Claude uses a tool; they cannot approve past the ask rules. A review's lead loads no settings and runs no hooks.",
      "Its sandbox denies writes to a repository's tracked `.claude/` files, so git can fail to check those out inside it.",
      // Not checked against a real session yet: what its sandbox does when the start folder holds worktrees rather than being one.
      "In a task of several repositories it starts in the folder that holds the worktrees, which isn't one, so its sandbox may not let git write the repositories' `.git`; a commit then runs outside the sandbox and asks, and Althar's rules answer it.",
      'Usage limits reach the Agent SDK but are not forwarded over ACP; only errors show them.',
    ],
  },
  codex: {
    id: 'codex',
    name: 'Codex',
    source: 'bundled',
    /*
     * `CODEX_HOME` is the account's home, always. `CODEX_PATH` names the Codex
     * its adapter drives — the person's own, out on the device, where the
     * sandbox cannot reach it — and the bus address carries it to
     * `flatpak-spawn`; both only in a Flatpak, so a person's own `CODEX_PATH`
     * never changes which Codex runs elsewhere.
     */
    launch: (node) => ({
      command: node,
      args: [bundled('@agentclientprotocol/codex-acp', 'dist/index.js')],
      inheritEnv: ['CODEX_HOME', ...(process.env.FLATPAK_ID === undefined ? [] : ['CODEX_PATH', 'DBUS_SESSION_BUS_ADDRESS'])],
    }),
    /*
     * Not `agent`, codex-acp's default: that mode sends every request to go
     * beyond the sandbox to an automatic reviewer, so none reach Althar.
     * In `workspace-write` the person, through Althar, is the reviewer.
     */
    /*
     * Its read-only sandbox has no network (`networkAccess: false` in
     * codex-acp 2.1.1): what would reach it asks, and an offline reader's
     * ask meets Althar's rules, which refuse it. But in that mode it asks
     * only to go beyond the sandbox: a command the sandbox contains runs
     * without asking (codexReviewing says why no session option changes
     * that), so it never leads a review of a pull request from outside.
     */
    modes: { ask: 'workspace-write', readOnly: 'read-only', reader: 'read-only' },
    options: { mode: 'mode', model: 'model', effort: 'reasoning_effort' },
    signIn: {
      status: () => ({ command: 'codex', args: ['login', 'status'] }),
      read: (output, exitCode) => (/not logged in/i.test(output) ? false : /logged in/i.test(output) && exitCode === 0 ? true : undefined),
      /* "Logged in using ChatGPT" is the person's plan; "using an API key" is paid per use. */
      paidBy: (output) => (/using chatgpt/i.test(output) ? 'plan' : /api key/i.test(output) ? 'key' : undefined),
      login: 'codex login',
      // The same Codex CLI the ACP adapter uses, where that CLI is available.
      inApp: {
        kind: 'codex-app-server',
        ways: ['browser', 'device'],
        run: () => ({ command: 'codex', args: ['app-server'] }),
      },
      logout: { run: () => ({ command: 'codex', args: ['logout'] }), line: 'codex logout' },
    },
    home: {
      variable: 'CODEX_HOME',
      usual: (env, homeDir) => env.CODEX_HOME || join(homeDir, '.codex'),
      shared: only(['config.toml', 'AGENTS.md', 'skills', 'prompts', 'rules']),
    },
    version: () => ({ command: 'codex', args: ['--version'] }),
    withoutOwnTools: codexWithoutOwnTools,
    reviewing: { outside: false, env: codexReviewing },
    /*
     * From codex-acp's ApprovalOptionId. `decline` skips a command and carries
     * on; `cancel` stops the turn and is the only rejection offered for a file
     * edit. Allowing a permission profile reaches the rest of the turn.
     */
    permissions: {
      rejectAndContinue: ['decline'],
      rejectAndStop: ['cancel'],
      allowScopes: { allow_once: 'once', allow_permissions_turn: 'turn', allow_permissions_turn_strict_auto_review: 'turn' },
    },
    knownGaps: [
      'It works inside its sandbox without asking: it edits the workspace and runs commands there, and asks only to go beyond it, such as for the network. As a reader too, so it never leads a review of a pull request from outside.',
      "codex-acp marks every session folder trusted, so a repository's own `.codex` config and hooks apply; a review's lead has hooks off.",
      'Usage limits are held by the adapter but only shown as /status text; only errors show them over ACP.',
    ],
    cli: {
      name: 'codex',
      // In a Flatpak sessions use the host's Codex bridge too; reporting the
      // bundled CLI here would show an unrelated sign-in state.
      ...(process.env.FLATPAK_ID === undefined ? { bundled: () => bundledCodex() } : {}),
    },
  },
  opencode: {
    id: 'opencode',
    name: 'OpenCode',
    source: 'user_installed',
    launch: () => ({
      command: 'opencode',
      args: ['acp'],
      env: { OPENCODE_CONFIG_CONTENT: openCodeConfig },
      inheritEnv: ['OPENCODE_CONFIG_DIR'],
    }),
    /*
     * It has no sandbox: a reader, offline or not, is held by Althar's
     * rules alone. Every command asks (`bash: 'ask'`), and its web fetches
     * do (`webfetch: 'ask'`), so an offline reader's are refused there. As a
     * review's lead it loads nothing of the repository's own config, plugins
     * or language servers, and its web search asks too (openCodeReviewing),
     * so it may read a pull request from outside.
     */
    modes: { ask: 'build', readOnly: 'plan', reader: 'build' },
    /*
     * Its efforts are a model's variants, so each model has its own, and
     * some none. Put on a model, a session takes its first variant, such as
     * None for GPT-6 Luna, where OpenCode's own app takes its default.
     */
    options: { mode: 'mode', model: 'model', effort: 'effort', ownEffort: 'default' },
    signIn: {
      status: () => ({ command: 'opencode', args: ['auth', 'list'] }),
      /* OpenCode runs its free models without signing in, so no credentials means "can't tell", not "signed out". */
      read: (output) => {
        const count = /(\d+)\s+credentials?/i.exec(output)?.[1]
        return count !== undefined && Number(count) > 0 ? true : undefined
      },
      /* It runs on the providers' keys it was given, whichever model a session picks: paid per use, as far as Althar can tell. */
      paidBy: () => 'key',
      login: 'opencode auth login',
      // No sign-out: its sign-ins are `opencode/auth.json` in the home, gone with the folder; its own asks which to remove.
    },
    /*
     * Its sign-ins and its history are under the data folder's `opencode`;
     * its config stays the person's, under XDG_CONFIG_HOME. The data folder
     * is every program's, so all else in it is shared: what a session runs,
     * such as mise, fnm or pnpm, finds its data where it always does.
     */
    home: {
      variable: 'XDG_DATA_HOME',
      usual: (env, homeDir) => env.XDG_DATA_HOME || join(homeDir, '.local', 'share'),
      shared: (names) => names.filter((name) => name !== 'opencode'),
    },
    /* Seen on 29 September 2026: `once`, `always` and `reject`, for commands and edits alike. */
    version: () => ({ command: 'opencode', args: ['--version'] }),
    /*
     * OpenCode 2 ignores how Althar keeps the person's MCP servers out (its
     * enabled-only `mcp` entries) and `continue_loop_on_deny`, and its
     * `auth list` reads another account's sign-ins through its background
     * service; seen with 2.0.29 on 15 October 2026 (docs/plans/opencode-2.md).
     */
    supported: {
      major: 1,
      why: 'OpenCode 2 isn’t supported yet: Althar can’t yet keep your own MCP servers out of its sessions, and a rejected command would end the whole turn. Use OpenCode 1 with Althar for now, or another agent.',
    },
    withoutOwnTools: openCodeWithoutOwnTools(openCodeBase),
    reviewing: { outside: true, env: openCodeReviewing },
    /* MIT licensed; its releases are at anomalyco/opencode (sst/opencode before), each file with GitHub's sha256. Seen 9 October 2026, v1.18.35. */
    cli: {
      name: 'opencode',
      download: {
        repository: 'anomalyco/opencode',
        assets: {
          'darwin-arm64': 'opencode-darwin-arm64.zip',
          'darwin-x64': 'opencode-darwin-x64.zip',
          'linux-arm64': 'opencode-linux-arm64.tar.gz',
          'linux-x64': 'opencode-linux-x64.tar.gz',
          'linux-arm64-musl': 'opencode-linux-arm64-musl.tar.gz',
          'linux-x64-musl': 'opencode-linux-x64-musl.tar.gz',
          'win32-arm64': 'opencode-windows-arm64.zip',
          'win32-x64': 'opencode-windows-x64.zip',
        },
        size: '45 MB',
      },
    },
    permissions: { rejectAndContinue: ['reject'], rejectAndStop: [], allowScopes: { once: 'once' } },
    knownGaps: [
      'Provider rate limits come back as errors; API keys have no plan windows.',
      'Carrying on after a rejection relies on an experimental setting, continue_loop_on_deny.',
    ],
  },
}
