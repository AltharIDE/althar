import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/*
 * Each agent is an entry here, not a code path (docs/architecture/03). The
 * modes and option ids were read from the agents themselves (scripts/probe.ts)
 * on 28 September 2026: claude-agent-acp 0.84.0, codex-acp 2.0.0 and OpenCode
 * 1.18.31. Probe again after upgrading any of them.
 */

export type AgentId = 'claude-code' | 'codex' | 'opencode'

/**
 * How to start a process: a command, its arguments, extra environment, and
 * which of Charrette's own environment variables it may inherit beyond the
 * common allowlist (see `process.ts`).
 */
export interface LaunchSpec {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly env?: Readonly<Record<string, string>>
  readonly inheritEnv?: ReadonlyArray<string>
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
  /** Bundled adapters ship with Charrette at pinned versions; user-installed agents are found on the machine. */
  readonly source: 'bundled' | 'user_installed'
  /** The command that starts it. `node` is the Node binary bundled adapters run on: Electron's own, in the app. */
  readonly launch: (node: string) => LaunchSpec
  /**
   * The modes Charrette starts sessions in (ADR-007): one where the agent asks
   * before acting, never a bypass mode; one that only reads; and the one a
   * role that only reads (the coordinator, a reviewer) runs in. That is the
   * read-only mode only where it is a sandbox that still lets the agent call
   * Charrette's tools. Claude Code's plan mode and OpenCode's plan agent are
   * instructions to the model, and it refuses Charrette's tools in them
   * (scripts/probe-tools.ts in the runtime), so those roles run in the mode
   * that asks, with Charrette's rules denying every write.
   */
  readonly modes: { readonly ask: string; readonly readOnly: string; readonly reader: string }
  /** The ids of its session config options. */
  readonly options: { readonly mode: string; readonly model: string; readonly effort?: string }
  /**
   * The agent's own sign-in (docs/architecture/03: the official tool owns it).
   * Charrette runs the documented status command and reads its output; it
   * never reads a credential store. `login` is what the user runs.
   */
  readonly signIn: {
    readonly status: (node: string) => LaunchSpec
    /** True when signed in, false when not, undefined when the output can't tell. */
    readonly read: (output: string, exitCode: number | null) => boolean | undefined
    /**
     * How the sign-in is paid for, from the same output: a plan, or per use, on
     * a key; undefined when it can't tell. Charrette moves work on to an agent
     * by itself only when its plan pays.
     */
    readonly paidBy?: (output: string) => PaidBy | undefined
    readonly login: string
  }
  /**
   * Where it keeps a sign-in (ADR-012): the environment variable that points
   * it at a folder of its own, a home, and its usual folder when that isn't
   * set. `shared` are the person's settings and instructions in that folder,
   * linked into a home Charrette makes, so every account works the same;
   * never anything that holds a sign-in.
   */
  readonly home: {
    readonly variable: string
    readonly usual: (env: Readonly<Record<string, string | undefined>>, homeDir: string) => string
    readonly shared: ReadonlyArray<string>
  }
  readonly permissions: PermissionMeanings
  /**
   * What goes in `_meta` on `session/new`, to keep the agent asking whatever
   * its settings say (ADR-007): for a lead, or for a role that only reads
   * (the coordinator, a reviewer), whose writes are refused outright.
   */
  readonly sessionMeta?: (role?: 'lead' | 'reader') => Readonly<Record<string, unknown>>
  /** What it does differently, for the support matrix. */
  readonly knownGaps: ReadonlyArray<string>
}

const require = createRequire(import.meta.url)
const bundled = (packageName: string, entry: string) => join(dirname(require.resolve(`${packageName}/package.json`)), entry)

/** The Codex binary codex-acp drives, so its sign-in status is the one that counts. */
const bundledCodex = () => {
  const fromAdapter = createRequire(require.resolve('@agentclientprotocol/codex-acp/package.json'))
  return join(dirname(fromAdapter.resolve('@openai/codex/package.json')), 'bin/codex.js')
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
 * process Charrette starts asks, and its requests reach Charrette. Agent-level
 * permissions take precedence over global ones, so the built-in agents are
 * set too, in case a repository's config allows more for them.
 *
 * OpenCode also stops its loop when a request is rejected, unless told to
 * carry on, so a rejection works as it does for the other agents.
 */
const asks = { edit: 'ask', bash: 'ask', webfetch: 'ask' }
const openCodeConfig = JSON.stringify({
  permission: asks,
  agent: { build: { permission: asks }, plan: { permission: asks } },
  experimental: { continue_loop_on_deny: true },
})

/**
 * Claude Code reads the user's settings and the repository's committed
 * `.claude/settings.json`, and an allow rule in either approves an action
 * before Charrette sees it. Ask rules win over allow rules, and over a hook
 * that approves, so every session gets these, and bypass mode is made
 * unreachable for its whole life.
 *
 * Its sandbox keeps shell commands inside the worktree (docs/architecture/03):
 * a command that stays inside runs without asking, and one that has to leave
 * (the network, a write elsewhere) asks, and reaches Charrette. In a git
 * worktree the sandbox lets git write to the main repository's `.git`, except
 * its hooks and config. Where the sandbox can't start, commands run without
 * it and every one asks.
 *
 * Only the MCP servers Charrette gives a session are loaded, not the user's
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
        sandbox: { enabled: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: true, failIfUnavailable: false },
      },
    },
  },
}

/**
 * Claude Code for a role that only reads: its edit tools denied, which also
 * denies its sandbox's writes, and every shell command asking, so each one
 * reaches Charrette's reader rules rather than running because the sandbox
 * would contain it. What it reads is a throwaway copy all the same.
 */
const claudeReads = {
  claudeCode: {
    options: {
      allowDangerouslySkipPermissions: false,
      strictMcpConfig: true,
      settings: {
        permissions: { deny: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'], ask: ['Bash', 'WebFetch'] },
        sandbox: { enabled: true, autoAllowBashIfSandboxed: false, allowUnsandboxedCommands: false, failIfUnavailable: false },
      },
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
    },
    /* On macOS its sign-in is a Keychain item named after the folder's path, so a home never moves. */
    home: {
      variable: 'CLAUDE_CONFIG_DIR',
      usual: (env, homeDir) => env.CLAUDE_CONFIG_DIR || join(homeDir, '.claude'),
      shared: ['settings.json', 'CLAUDE.md', 'agents', 'commands', 'skills', 'plugins', 'output-styles'],
    },
    /* From claude-agent-acp's permissions/options/shared.js. Rejecting skips the action and Claude carries on. */
    permissions: { rejectAndContinue: ['reject'], rejectAndStop: [], allowScopes: { 'allow-once': 'once', 'exit-plan-default': 'once' } },
    sessionMeta: (role = 'lead') => (role === 'reader' ? claudeReads : claudeAsks),
    knownGaps: [
      'Starts in whatever mode the user set in Claude Code, which may be bypassPermissions, so Charrette always sets the mode.',
      "Hooks in the repository's or the user's settings run as code on the Mac whenever Claude uses a tool; they cannot approve past the ask rules.",
      "Its sandbox denies writes to a repository's tracked `.claude/` files, so git can fail to check those out inside it.",
      'Usage limits reach the Agent SDK but are not forwarded over ACP; only errors show them.',
    ],
  },
  codex: {
    id: 'codex',
    name: 'Codex',
    source: 'bundled',
    launch: (node) => ({ command: node, args: [bundled('@agentclientprotocol/codex-acp', 'dist/index.js')], inheritEnv: ['CODEX_HOME'] }),
    /*
     * Not `agent`, codex-acp's default: that mode sends every request to go
     * beyond the sandbox to an automatic reviewer, so none reach Charrette.
     * In `workspace-write` the person, through Charrette, is the reviewer.
     */
    modes: { ask: 'workspace-write', readOnly: 'read-only', reader: 'read-only' },
    options: { mode: 'mode', model: 'model', effort: 'reasoning_effort' },
    signIn: {
      status: (node) => ({ command: node, args: [bundledCodex(), 'login', 'status'] }),
      read: (output, exitCode) => (/not logged in/i.test(output) ? false : /logged in/i.test(output) && exitCode === 0 ? true : undefined),
      /* "Logged in using ChatGPT" is the person's plan; "using an API key" is paid per use. */
      paidBy: (output) => (/using chatgpt/i.test(output) ? 'plan' : /api key/i.test(output) ? 'key' : undefined),
      login: 'codex login',
    },
    home: {
      variable: 'CODEX_HOME',
      usual: (env, homeDir) => env.CODEX_HOME || join(homeDir, '.codex'),
      shared: ['config.toml', 'AGENTS.md', 'skills', 'prompts', 'rules'],
    },
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
      'It works inside its sandbox without asking: it edits the workspace and runs commands there, and asks only to go beyond it, such as for the network.',
      "codex-acp marks every session folder trusted, so a repository's own `.codex` config and hooks apply.",
      'Usage limits are held by the adapter but only shown as /status text; only errors show them over ACP.',
    ],
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
    modes: { ask: 'build', readOnly: 'plan', reader: 'build' },
    options: { mode: 'mode', model: 'model' },
    signIn: {
      status: () => ({ command: 'opencode', args: ['auth', 'list'] }),
      /* OpenCode runs its free models without signing in, so no credentials means "can't tell", not "signed out". */
      read: (output) => {
        const count = /(\d+)\s+credentials?/i.exec(output)?.[1]
        return count !== undefined && Number(count) > 0 ? true : undefined
      },
      /* It runs on the providers' keys it was given, whichever model a session picks: paid per use, as far as Charrette can tell. */
      paidBy: () => 'key',
      login: 'opencode auth login',
    },
    /* Its sign-ins and its history are under the data folder's `opencode`; its config stays the person's, under XDG_CONFIG_HOME. */
    home: {
      variable: 'XDG_DATA_HOME',
      usual: (env, homeDir) => env.XDG_DATA_HOME || join(homeDir, '.local', 'share'),
      shared: [],
    },
    /* Seen on 29 September 2026: `once`, `always` and `reject`, for commands and edits alike. */
    permissions: { rejectAndContinue: ['reject'], rejectAndStop: [], allowScopes: { once: 'once' } },
    knownGaps: [
      'No effort option.',
      'Provider rate limits come back as errors; API keys have no plan windows.',
      'Carrying on after a rejection relies on an experimental setting, continue_loop_on_deny.',
    ],
  },
}
