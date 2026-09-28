import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/*
 * Each agent is an entry here, not a code path (docs/architecture/03). The
 * modes and option ids were read from the agents themselves (scripts/probe.ts)
 * on 28 September 2026: claude-agent-acp 0.84.0, codex-acp 2.0.0 and OpenCode
 * 1.18.31. Probe again after upgrading any of them.
 */

export type AgentId = 'claude-code' | 'codex' | 'opencode'

/** How to start a process: a command, its arguments, and extra environment. */
export interface LaunchSpec {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly env?: Readonly<Record<string, string>>
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
   * before acting, never a bypass mode, and one that only reads.
   */
  readonly modes: { readonly ask: string; readonly readOnly: string }
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
    readonly login: string
  }
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
 * process Charrette starts asks, and its requests reach Charrette.
 */
const openCodeAsks = JSON.stringify({ permission: { edit: 'ask', bash: 'ask', webfetch: 'ask' } })

export const agents: Readonly<Record<AgentId, AgentDefinition>> = {
  'claude-code': {
    id: 'claude-code',
    name: 'Claude Code',
    source: 'bundled',
    launch: (node) => ({ command: node, args: [bundled('@agentclientprotocol/claude-agent-acp', 'dist/index.js')] }),
    modes: { ask: 'default', readOnly: 'plan' },
    options: { mode: 'mode', model: 'model', effort: 'effort' },
    signIn: {
      status: () => ({ command: 'claude', args: ['auth', 'status'] }),
      read: loggedInField,
      login: 'claude auth login',
    },
    knownGaps: [
      'Starts in whatever mode the user set in Claude Code, which may be bypassPermissions, so Charrette always sets the mode.',
      "Allow rules in the user's own Claude Code settings approve actions before Charrette sees them.",
      'Usage limits reach the Agent SDK but are not forwarded over ACP; only errors show them.',
    ],
  },
  codex: {
    id: 'codex',
    name: 'Codex',
    source: 'bundled',
    launch: (node) => ({ command: node, args: [bundled('@agentclientprotocol/codex-acp', 'dist/index.js')] }),
    modes: { ask: 'agent', readOnly: 'read-only' },
    options: { mode: 'mode', model: 'model', effort: 'reasoning_effort' },
    signIn: {
      status: (node) => ({ command: node, args: [bundledCodex(), 'login', 'status'] }),
      read: (output, exitCode) => (/not logged in/i.test(output) ? false : /logged in/i.test(output) && exitCode === 0 ? true : undefined),
      login: 'codex login',
    },
    knownGaps: [
      'In agent mode it works inside its sandbox without asking and asks to go beyond it, such as for the network.',
      'Usage limits are held by the adapter but only shown as /status text; only errors show them over ACP.',
    ],
  },
  opencode: {
    id: 'opencode',
    name: 'OpenCode',
    source: 'user_installed',
    launch: () => ({ command: 'opencode', args: ['acp'], env: { OPENCODE_CONFIG_CONTENT: openCodeAsks } }),
    modes: { ask: 'build', readOnly: 'plan' },
    options: { mode: 'mode', model: 'model' },
    signIn: {
      status: () => ({ command: 'opencode', args: ['auth', 'list'] }),
      /* OpenCode runs its free models without signing in, so no credentials means "can't tell", not "signed out". */
      read: (output) => {
        const count = /(\d+)\s+credentials?/i.exec(output)?.[1]
        return count !== undefined && Number(count) > 0 ? true : undefined
      },
      login: 'opencode auth login',
    },
    knownGaps: ['No effort option.', 'Provider rate limits come back as errors; API keys have no plan windows.'],
  },
}
