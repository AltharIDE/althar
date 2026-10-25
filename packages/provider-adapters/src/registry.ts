import type { InAppSignIn } from './signInFlow'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, dirname, join } from 'node:path'
import { codexWithoutOwnTools, openCodeWithoutOwnTools, type StartingAt } from './ownTools'
import { secretReadRules } from './secrets'

/*
 * Each agent is an entry here, not a code path (docs/architecture/03). The
 * modes and option ids were read from the agents themselves (scripts/probe.ts)
 * on 28 September 2026: claude-agent-acp 0.84.0, codex-acp 2.0.0 and OpenCode
 * 1.18.31; codex-acp again at 2.1.1 on 7 October 2026, unchanged but for a
 * new model; OpenCode's effort on 8 October 2026, which it offers only once
 * a session is on a model that has levels. Probe again after upgrading any
 * of them.
 *
 * GitHub Copilot CLI 1.0.98, Junie 3659.7, Grok Build 1.0.63, Kimi Code
 * 2.2.0, Mistral Vibe 2.26.1 and Qwen Code 0.25.2 were read on 18 and 19
 * October 2026, each
 * started over ACP with a home of its own and no sign-in, against a stand-in
 * model on this machine where it takes one (a provider of its own, or a key
 * it doesn't check before its first turn): their sessions, options and
 * permission requests are what they said, and the rest is from their own
 * code and help. None has run against its vendor's models yet, signed in
 * (`bun run test:agents`), which is what each entry's gaps leave open.
 *
 * Google Antigravity's ACP server 1.3.0 is as Orca (stablyai/orca, MIT) runs
 * it, read from its code and its recording of a real session on 19 October
 * 2026: not yet started here.
 */

export type AgentId =
  | 'claude-code'
  | 'codex'
  | 'opencode'
  | 'copilot'
  | 'junie'
  | 'grok'
  | 'kimi'
  | 'mistral-vibe'
  | 'qwen-code'
  | 'antigravity'

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
  /**
   * A temporary folder of its own (`TMPDIR`, `TEMP`, `TMP`), removed once it
   * has stopped: for an agent that unpacks itself there each time it starts
   * (Antigravity's server, about 1 GB), which a stopped one would leave behind.
   */
  readonly privateTemp?: true
  /**
   * On Windows, its arguments as they are, unquoted, as cmd.exe takes a line
   * (`/s /c "…"`): Node would quote one with quotes in it as a C program
   * reads it (`\"`), which cmd doesn't. Elsewhere it changes nothing.
   */
  readonly verbatim?: true
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
  /**
   * The start of the tool call ids on which a request is the model asking the
   * person, one option for each answer, not for a permission (Antigravity's
   * `interaction_`): it goes to the person as a question, never to the rules.
   */
  readonly questions?: string
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
   * that asks, with Althar's rules denying every write. Null where the agent
   * has no mode at all and asks by what its `sessionMeta` sends (Grok's):
   * started so, it is refused if it offers modes after all.
   */
  readonly modes: { readonly ask: string | null; readonly readOnly: string | null; readonly reader: string | null }
  /**
   * The ids of its session config options. `ownEffort` is the effort level
   * that leaves a model at its own default, for an agent that otherwise puts
   * a session on a model's first level: Althar sets it where nothing chose one.
   */
  readonly options: {
    readonly mode: string
    readonly model: string
    readonly effort?: string
    readonly ownEffort?: string
    /**
     * Options held at a value for every session's whole life, set as it
     * starts and set back whenever the agent moves one: those that would
     * approve without asking (Copilot's `allow_all`, Junie's `brave_mode`).
     */
    readonly held?: Readonly<Record<string, string>>
  }
  /**
   * The agent's own sign-in (docs/architecture/03: the official tool owns it).
   * Althar runs the documented status command and reads its output; it
   * never reads a credential store. `login` is what the user runs.
   */
  readonly signIn: {
    /** Without one (the agent has no status command), Althar can't tell, and the first session says. */
    readonly status?: (node: string) => LaunchSpec
    /** True when signed in, false when not, undefined when the output can't tell. */
    readonly read: (output: string, exitCode: number | null) => boolean | undefined
    /**
     * How the sign-in is paid for, from the same output: a plan, or per use, on
     * a key; undefined when it can't tell. Althar moves work on to an agent
     * by itself only when its plan pays.
     */
    readonly paidBy?: (output: string) => PaidBy | undefined
    /** What the person runs in a terminal to sign in; empty where it has none, and signs in only in Althar (`inApp`). */
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
    /**
     * `'one'` where its sign-in isn't kept in the folder, but in a keychain
     * item every folder shares (Mistral Vibe's), or that isn't known yet: a
     * second account would sign the first one out, so it has its usual one
     * alone. Without it, as many as the person adds.
     */
    readonly accounts?: 'one'
  }
  readonly permissions: PermissionMeanings
  /**
   * The service its model runs on: its name, as a step that keeps failing
   * there says it, and an address of its API that Althar asks whether it
   * answers while that step waits for the connection (ADR-060). None where
   * it runs on whichever provider the person picks: then only whether the
   * computer is online counts.
   */
  readonly service?: { readonly name: string; readonly url: string }
  /** What prints its own version, for Settings; without it, none is shown. */
  readonly version?: (node: string) => LaunchSpec
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
   * Its session settings take what a lead's sandbox lets through from the
   * start (`SessionOptions.sandbox`): commands it runs outside it, and hosts
   * it reaches without asking. Without it, none are worked out for its
   * leads, as it has nowhere to put them.
   */
  readonly upFront?: true
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
  /**
   * `'althar'` where a message that starts with `/` runs one of its own
   * commands, and one of them turns its asking off (Copilot's `/yolo`, Grok's
   * `/always-approve`), with more than it lists: only those Althar sends
   * itself (`/compact`) go as commands, and the person's go as words. Without
   * it, the person's commands reach it as they are.
   */
  readonly commands?: 'althar'
  /** What it does differently, for the support matrix. */
  readonly knownGaps: ReadonlyArray<string>
}

/**
 * How a session is started beyond its role: `untrusted`, it leads a review of
 * someone else's pull request, whose repository's settings and hooks are the
 * pull request's to write; `offline`, it has no network where the agent lets
 * Althar take it away; `sandbox`, for a lead, what its sandbox lets through
 * from the start, where the agent's settings can say it.
 */
export interface SessionOptions {
  readonly offline?: boolean
  readonly untrusted?: boolean
  /**
   * Where a trusted reader, the coordinator, may reach (ADR-058): where the
   * agent has a sandbox Althar can hold to it, its commands run there without
   * asking, writing only in `folder`, reading none of `denied` but what
   * `allowed` gives back, and reaching no network; else it is started as any
   * reader, and Althar's rules hold it.
   */
  readonly contained?: Contained
  readonly sandbox?: UpFront
}

/** The coordinator's folder, and what its sandboxed commands may read: real paths. */
export interface Contained {
  readonly folder: string
  readonly reads: { readonly allowed: ReadonlyArray<string>; readonly denied: ReadonlyArray<string> }
}

/**
 * What a lead's sandbox lets through from the start, which the project's
 * rules work out: commands it runs outside the sandbox rather than failing
 * inside it first, by how they start, which still ask and meet Althar's
 * rules; and hosts it reaches without asking, only those the rules would let
 * through without anyone.
 */
export interface UpFront {
  readonly commands: ReadonlyArray<string>
  readonly hosts: ReadonlyArray<string>
}

/**
 * Claude Code's `sandbox.excludedCommands` for commands by how they start:
 * each as the whole command, and followed by ` *` for what comes after it,
 * as its settings take a command's start.
 */
export const excludedCommandsOf = (commands: ReadonlyArray<string>): ReadonlyArray<string> =>
  commands.flatMap((command) => [command, `${command} *`])

export interface AgentCli {
  /** The command by name, as on the person's PATH; `.exe` is added on Windows. */
  readonly name: string
  /**
   * Where npm installed it, its command is a Node script (`#!/usr/bin/env
   * node`), and an app opened from the Finder has no Node on its PATH: it
   * starts with the folder it was found in first there, where npm's Node is.
   */
  readonly node?: true
  /** The copy that ships with Althar, by its path; null where this platform has none. */
  readonly bundled?: () => string | null
  /** Where Althar can download it. */
  readonly download?: AgentDownload
  /** Its maker's page on installing it, for a person who installs it themselves: https only. */
  readonly guide?: string
}

export type AgentDownload = GitHubDownload | PinnedDownload

/** An agent's latest release on GitHub, each file with the sha256 GitHub gives it; the command alone is kept. */
export interface GitHubDownload {
  /** Its GitHub repository, owner/name: its latest release is what is downloaded. */
  readonly repository: string
  /** The release's file for each `platform-arch`, as Node names them: a zip or a gzipped tar with the command in it. */
  readonly assets: Readonly<Record<string, string>>
  /** About how big the download is, as the person reads it. */
  readonly size: string
}

/**
 * One version of an agent, from an address its maker gives, each file pinned
 * by the sha256 it was seen with, where the maker publishes none (Google, for
 * Antigravity's server). The whole archive is kept, as what it holds runs
 * together, and nothing in it runs unless every pinned file is exactly so.
 */
export interface PinnedDownload {
  readonly version: string
  /** For each `platform-arch`, the zip's address and sha256, and the sha256 of each file it holds by name. */
  readonly assets: Readonly<
    Record<string, { readonly url: string; readonly sha256: string; readonly files: Readonly<Record<string, string>> }>
  >
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
 *
 * Where the person keeps keys and sign-ins (`SECRET_PLACES`) is denied as
 * reads, which Claude Code's sandbox also applies to the shell commands it
 * runs without asking: so Claude Code's documentation describes it, not yet
 * checked against a real session (docs/plans/safety-pass.md). Althar's rules
 * refuse what reaches them.
 */
/*
 * A project's known commands run outside the sandbox from the start
 * (`excludedCommands`), so a browser, Electron or a test runner, which its
 * sandbox stops on a Mac, doesn't fail once first: Claude Code's settings
 * say an excluded command still goes through its permission flow, so it
 * asks, and meets Althar's rules, as it would on its second try. Known hosts
 * (`network.allowedDomains`) a command in the sandbox reaches without
 * asking: the project's code hosts, registries and trackers, only where its
 * rules would let them through anyway. Both are settings Claude Code takes
 * only from trusted sources, which these, given as the session's own, are.
 */
const claudeAsks = (sandbox: UpFront = { commands: [], hosts: [] }) => ({
  claudeCode: {
    options: {
      allowDangerouslySkipPermissions: false,
      strictMcpConfig: true,
      // An object: the adapter reads a string as a path to a settings file.
      settings: {
        permissions: { deny: secretReadRules(), ask: ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebFetch'] },
        sandbox: {
          enabled: true,
          autoAllowBashIfSandboxed: true,
          allowUnsandboxedCommands: true,
          failIfUnavailable: false,
          ...(sandbox.commands.length === 0 ? {} : { excludedCommands: excludedCommandsOf(sandbox.commands) }),
          network: { allowLocalBinding: true, ...(sandbox.hosts.length === 0 ? {} : { allowedDomains: [...sandbox.hosts] }) },
        },
      },
    },
  },
})

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
          ? { deny: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch', ...secretReadRules()], ask: ['Bash'] }
          : { deny: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', ...secretReadRules()], ask: ['Bash', 'WebFetch'] },
        sandbox: { enabled: true, autoAllowBashIfSandboxed: false, allowUnsandboxedCommands: flatpak, failIfUnavailable: false },
        ...(untrusted ? { disableAllHooks: true } : {}),
      },
    },
  },
})

/**
 * Whether Claude Code's sandbox can start here: macOS's own, or bubblewrap
 * and socat on Linux, outside a Flatpak (no nested user namespaces there).
 * Not yet on Windows, where Althar hasn't tried it.
 */
const claudeSandboxStarts = (): boolean => {
  if (process.platform === 'darwin') return existsSync('/usr/bin/sandbox-exec')
  if (process.platform !== 'linux' || process.env.FLATPAK_ID !== undefined) return false
  const onPath = (name: string) =>
    (process.env.PATH ?? '').split(delimiter).some((folder) => folder !== '' && existsSync(join(folder, name)))
  return onPath('bwrap') && onPath('socat')
}

/**
 * Claude Code for the coordinator, a trusted reader in its own copies of the
 * project's repositories (ADR-058): its shell commands run in its sandbox
 * without asking, held to the coordinator's folder. They write only there
 * (and in the sandbox's own temporary folder); read none of the home
 * folder, the person's checkouts or the project's task folders but what
 * Althar gives back (the folder, the mirrors its copies fetch from, the
 * objects they borrow, the toolchains in the home folder), and nothing
 * where the person keeps keys and sign-ins; reach no network
 * (`strictAllowlist` with no domain refuses every host without asking) and
 * no socket; and never run outside it (`allowUnsandboxedCommands: false`).
 * It loads no settings file (`settingSources: []`) and runs no hook, as a
 * review's lead: no allow rule or sandbox exemption of the person's or the
 * repository's lets a command out, and no hook of theirs runs beside it. Its
 * edit tools stay denied: a change is a task. Where the sandbox can't start,
 * the session doesn't either (`failIfUnavailable`), so it is asked for only
 * where it can (`claudeSandboxStarts`); elsewhere the coordinator is started
 * as any reader.
 */
const claudeContains = ({ folder, reads }: Contained) => ({
  claudeCode: {
    options: {
      allowDangerouslySkipPermissions: false,
      strictMcpConfig: true,
      settingSources: [],
      settings: {
        disableAllHooks: true,
        permissions: { deny: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', ...secretReadRules()], ask: ['WebFetch'] },
        sandbox: {
          enabled: true,
          autoAllowBashIfSandboxed: true,
          allowUnsandboxedCommands: false,
          failIfUnavailable: true,
          network: { allowedDomains: [], strictAllowlist: true, allowLocalBinding: false, allowAllUnixSockets: false },
          filesystem: { allowWrite: [folder], denyRead: [...reads.denied], allowRead: [...reads.allowed] },
        },
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
    service: { name: 'Anthropic', url: 'https://api.anthropic.com' },
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
      role !== 'reader'
        ? claudeAsks(options.sandbox)
        : options.contained !== undefined && options.untrusted !== true && options.offline !== true && claudeSandboxStarts()
          ? claudeContains(options.contained)
          : claudeReads(process.env.FLATPAK_ID !== undefined, options.offline === true, options.untrusted === true),
    upFront: true,
    /*
     * As a review's lead it is held by its session's settings alone (claudeReads, untrusted): every command asks and meets
     * Althar's reader rules, no settings file or hook of the repository's or the person's loads, and offline its web tools are
     * denied. So it may read a pull request from outside.
     */
    reviewing: { outside: true },
    permissionJudge: { sessionMeta: claudeJudges },
    knownGaps: [
      'Starts in whatever mode the user set in Claude Code, which may be bypassPermissions, so Althar always sets the mode.',
      "Hooks in the repository's or the user's settings run as code on the computer whenever Claude uses a tool; they cannot approve past the ask rules. A review's lead loads no settings and runs no hooks.",
      "Its sandbox denies writes to a repository's tracked `.claude/` files, so git can fail to check those out inside it.",
      // Not checked against a real session yet: what its sandbox does when the start folder holds worktrees rather than being one.
      "In a task of several repositories it starts in the folder that holds the worktrees, which isn't one, so its sandbox may not let git write the repositories' `.git`; a commit then runs outside the sandbox and asks, and Althar's rules answer it.",
      'Usage limits reach the Agent SDK but are not forwarded over ACP; only errors show them.',
      "As the coordinator, its sandbox has to start where Althar asks for it (macOS, and Linux with bubblewrap and socat): where it can't, the coordinator's session fails rather than running commands outside it.",
      "As the coordinator, a command it can't read itself, such as one with `$?`, asks rather than running in its sandbox, and meets Althar's reader rules.",
    ],
  },
  codex: {
    id: 'codex',
    name: 'Codex',
    service: { name: 'OpenAI', url: 'https://api.openai.com' },
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
    /*
     * A project's known commands and hosts (`UpFront`) aren't passed: its
     * `workspace-write` sandbox has no list of commands that run outside it,
     * and its network is one switch (`sandbox_workspace_write.network_access`).
     * Codex 0.160's list of allowed domains belongs to its permission
     * profiles' network proxy, experimental, which codex-acp's modes don't
     * use. So each of those still asks first, and meets Althar's rules.
     */
    knownGaps: [
      'It works inside its sandbox without asking: it edits the workspace and runs commands there, and asks only to go beyond it, such as for the network. As a reader too, so it never leads a review of a pull request from outside.',
      "A project's known commands and hosts aren't passed to it: its sandbox has no list of commands to run outside it, and no list of hosts in the mode Althar starts it in, so each asks first.",
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
     * rules alone, and a lead's known commands and hosts (`UpFront`) have
     * nothing to be passed to, as every command already asks and none
     * fails inside a sandbox first. Every command asks (`bash: 'ask'`), and its web fetches
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
    withoutOwnTools: openCodeWithoutOwnTools(openCodeBase),
    reviewing: { outside: true, env: openCodeReviewing },
    /* MIT licensed; its releases are at anomalyco/opencode (sst/opencode before), each file with GitHub's sha256. Seen 9 October 2026, v1.18.35. */
    cli: {
      name: 'opencode',
      guide: 'https://github.com/anomalyco/opencode',
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
  /*
   * GitHub's own ACP server, in its CLI (public preview). It asks before
   * every edit, command and web fetch in its `#agent` mode, and its `#plan`
   * mode refuses edits in its runtime: as for Claude Code, a reader runs in
   * the mode that asks, with Althar's rules denying every write, as plan mode
   * adds instructions of its own. Its mode ids are ACP's own addresses.
   */
  copilot: {
    id: 'copilot',
    name: 'GitHub Copilot',
    service: { name: 'GitHub', url: 'https://api.githubcopilot.com' },
    source: 'user_installed',
    /*
     * The version it was installed as, not one it downloaded since
     * (`--no-auto-update`); none of the GitHub tools it would reach with the
     * person's sign-in (`--disable-builtin-mcps`), as Althar pushes for agents;
     * and not the person's login-shell environment, which it otherwise gives
     * every command it runs, past Althar's allowlist.
     */
    launch: () => ({
      command: 'copilot',
      args: ['--acp', '--no-auto-update', '--disable-builtin-mcps'],
      env: { COPILOT_AUTO_UPDATE: 'false', COPILOT_DISABLE_LOGIN_SHELL_ENV: '1' },
      inheritEnv: ['COPILOT_HOME'],
    }),
    modes: {
      ask: 'https://agentclientprotocol.com/protocol/session-modes#agent',
      readOnly: 'https://agentclientprotocol.com/protocol/session-modes#plan',
      reader: 'https://agentclientprotocol.com/protocol/session-modes#agent',
    },
    /* `allow_all` approves every request while on, and its `/yolo` turns it on (`commands` keeps the person's off). */
    options: { mode: 'mode', model: 'model', effort: 'reasoning_effort', held: { allow_all: 'off' } },
    /*
     * It has no status command: whether it is signed in shows when a session
     * starts. A sign-in is the person's Copilot plan; a key of their own
     * (`COPILOT_PROVIDER_*`) never reaches its sessions, past Althar's allowlist.
     */
    signIn: { read: () => undefined, login: 'copilot login' },
    /*
     * Its sign-in is a keychain item (service `copilot-cli`), not known to be
     * the folder's own, so it has one account until two are seen apart. Its
     * settings, hooks, MCP servers and saved approvals stay its usual folder's.
     */
    home: {
      variable: 'COPILOT_HOME',
      usual: (env, homeDir) => env.COPILOT_HOME || join(homeDir, '.copilot'),
      shared: only(['copilot-instructions.md', 'instructions', 'agents', 'skills']),
      accounts: 'one',
    },
    /* Seen 18 October 2026: allow_once, allow_always (for the session) and reject_once, which ends the turn. */
    permissions: { rejectAndContinue: [], rejectAndStop: ['reject_once'], allowScopes: { allow_once: 'once' } },
    version: () => ({ command: 'copilot', args: ['--version'] }),
    /*
     * Its license lets anyone install and run copies; its releases are at
     * github/copilot-cli, each file with GitHub's sha256, `copilot` at the
     * archive's root. Seen 19 October 2026, v1.0.98. An npm install is a Node
     * script, and on Windows a `.cmd`, which Althar can't start.
     */
    cli: {
      name: 'copilot',
      node: true,
      guide: 'https://gh.io/copilot-install',
      download: {
        repository: 'github/copilot-cli',
        assets: {
          'darwin-arm64': 'copilot-darwin-arm64.tar.gz',
          'darwin-x64': 'copilot-darwin-x64.tar.gz',
          'linux-arm64': 'copilot-linux-arm64.tar.gz',
          'linux-x64': 'copilot-linux-x64.tar.gz',
          'linux-arm64-musl': 'copilot-linuxmusl-arm64.tar.gz',
          'linux-x64-musl': 'copilot-linuxmusl-x64.tar.gz',
          'win32-arm64': 'copilot-win32-arm64.zip',
          'win32-x64': 'copilot-win32-x64.zip',
        },
        size: '110 MB',
      },
    },
    commands: 'althar',
    knownGaps: [
      "A repository's hooks (`.github/hooks`, `.github/copilot/settings.json`, `.claude/settings.json`) run, and can approve a tool past its asking, with no way to turn them off from the launch: so it never leads a review of a pull request.",
      'Every rejection ends the turn; Althar carries the turn on itself.',
      "Loads the person's own MCP servers from its folder's `mcp-config.json`.",
      "A signed-in `gh` alone doesn't sign its sessions in: Althar gives agents none of the person's code-host sign-ins, so it needs `copilot login`.",
      'No status command, so its sign-in shows only when a session starts; and one account, until its keychain item is seen to be each folder’s own.',
      'Usage limits come only as errors.',
    ],
  },
  /*
   * JetBrains' own ACP server. With its brave mode off, commands, edits to
   * build, config and secret files and to anything outside the project, and
   * MCP tools ask; ordinary edits inside the project don't, as Codex's in its
   * sandbox. Its plan mode takes the edit tools away and keeps commands,
   * which ask, so a reader runs there.
   */
  junie: {
    id: 'junie',
    name: 'Junie',
    source: 'user_installed',
    /* No config of its own or the repository's (`.junie/config.json` can turn brave mode on), and no MCP servers but Althar's. */
    launch: () => ({
      command: 'junie',
      args: ['--acp=true'],
      env: { JUNIE_SKIP_UPDATE_CHECK: '1', JUNIE_CONFIG_DEFAULT_LOCATIONS: 'false', JUNIE_MCP_DEFAULT_LOCATIONS: 'false' },
      inheritEnv: ['JUNIE_HOME'],
    }),
    modes: { ask: 'default', readOnly: 'plan', reader: 'plan' },
    /*
     * Its mode option has no category, and `brave_mode` has the mode's, so the
     * mode is found by its id. Brave mode on approves everything, and its
     * default, `brave-auto`, has a model approve the commands it thinks safe.
     */
    options: { mode: 'mode', model: 'model', effort: 'effort', held: { brave_mode: 'off' } },
    /* It has no status command: whether it is signed in shows when a session starts. Sign in with a JetBrains account in its own window. */
    signIn: { read: () => undefined, login: 'junie' },
    /*
     * Its sign-in is a keychain item named after the folder's path (on
     * Windows a file in it), which deleting the folder would leave behind,
     * and it signs out only over ACP: one account, until Althar signs a home
     * out before removing it. `settings.json` takes the brave mode Althar sets.
     */
    home: {
      variable: 'JUNIE_HOME',
      usual: (env, homeDir) => env.JUNIE_HOME || join(homeDir, '.junie'),
      shared: only(['AGENTS.md', 'skills', 'agent-skills', 'agents', 'commands']),
      accounts: 'one',
    },
    /* Seen 19 October 2026: its option ids are their labels. `No` skips the action and it carries on; `stop` ends a turn at its step limit. */
    permissions: { rejectAndContinue: ['No'], rejectAndStop: ['stop'], allowScopes: { Yes: 'once', continue: 'once' } },
    version: () => ({ command: 'junie', args: ['--version'] }),
    /* Its installer's `junie` is a bash script in ~/.local/bin; on Windows a `.bat`, which Althar can't start. */
    cli: { name: 'junie', guide: 'https://junie.jetbrains.com/' },
    commands: 'althar',
    knownGaps: [
      "Ordinary edits inside the project don't ask; edits to build, config and secret files, and outside it, do.",
      'Its plan mode keeps commands, which ask; whether it keeps Althar’s tools there is not yet checked.',
      'ACP launches trust the project: its skills, agents and commands load.',
      'It keeps the brave mode a session is set to in its `settings.json`, so its own window starts with brave mode off too.',
      'No status command, so its sign-in shows only when a session starts; and one account, until Althar signs a home out before removing it.',
    ],
  },
  /*
   * xAI's own ACP server, in its CLI. It offers no modes: what keeps it
   * asking is its session's `_meta`, which turns its always-approve and its
   * model-judged auto mode off whatever the person's config says. Every
   * rejection ends its turn.
   */
  grok: {
    id: 'grok',
    name: 'Grok Build',
    service: { name: 'xAI', url: 'https://api.x.ai' },
    source: 'user_installed',
    /*
     * A process of its own rather than one a config's leader mode shares, not
     * updating itself, and none of the MCP servers or hooks it reads from
     * Claude Code's and Cursor's settings.
     */
    launch: () => ({
      command: 'grok',
      args: ['agent', '--no-leader', 'stdio'],
      env: {
        GROK_DISABLE_AUTOUPDATER: '1',
        GROK_CLAUDE_MCPS_ENABLED: '0',
        GROK_CURSOR_MCPS_ENABLED: '0',
        GROK_CLAUDE_HOOKS_ENABLED: '0',
        GROK_CURSOR_HOOKS_ENABLED: '0',
      },
      inheritEnv: ['GROK_HOME'],
    }),
    modes: { ask: null, readOnly: null, reader: null },
    options: { mode: 'mode', model: 'model', effort: 'reasoning_effort' },
    signIn: {
      /* `grok models` says how it is signed in, first, and exits 0 either way. */
      status: () => ({ command: 'grok', args: ['models'] }),
      read: (output) => (/not authenticated/i.test(output) ? false : /logged in with|authenticated via/i.test(output) ? true : undefined),
      paidBy: (output) => (/logged in with/i.test(output) ? 'plan' : /XAI_API_KEY|deployment key/i.test(output) ? 'key' : undefined),
      login: 'grok login',
      logout: { run: () => ({ command: 'grok', args: ['logout'] }), line: 'grok logout' },
    },
    /*
     * Its sign-in is `auth.json` in the folder. Its config holds the person's
     * allow rules and MCP servers, and `trusted_folders.toml` and its sessions'
     * saved grants approve things: none of them is shared.
     */
    home: {
      variable: 'GROK_HOME',
      usual: (env, homeDir) => env.GROK_HOME || join(homeDir, '.grok'),
      shared: only(['pager.toml', 'skills', 'agents', 'rules', 'workflows']),
    },
    /* Seen 18 October 2026: a command's always-allow is kept for the project, and reject-always too; every rejection ends the turn. */
    permissions: { rejectAndContinue: [], rejectAndStop: ['reject-once', 'reject-always'], allowScopes: { 'allow-once': 'once' } },
    sessionMeta: () => ({ yoloMode: false, autoMode: false }),
    version: () => ({ command: 'grok', args: ['--version'] }),
    /* Its installers put it in ~/.grok/bin, a native program everywhere; its npm `grok` is one on a Mac and Linux too. */
    cli: { name: 'grok', guide: 'https://www.npmjs.com/package/@xai-official/grok' },
    commands: 'althar',
    knownGaps: [
      "The allow rules in the person's `~/.claude/settings.json` approve its commands before Althar sees them.",
      'Its web search never asks.',
      'Every rejection ends the turn; Althar carries the turn on itself.',
      "A worktree Althar makes is a folder it doesn't trust, so it doesn't read the repository's AGENTS.md.",
    ],
  },
  /*
   * Moonshot's own ACP server, in Kimi Code (the CLI that followed Kimi CLI
   * 1.x). In `default` every command asks; edits inside a git repository
   * don't, as Codex's in its sandbox, and its web fetch and search never do.
   * Its plan mode refuses edits and keeps commands, which ask, so a reader
   * runs there. It says `default` as it starts whatever its config says, so
   * Althar setting the mode is what holds it.
   */
  kimi: {
    id: 'kimi',
    name: 'Kimi Code',
    source: 'user_installed',
    launch: () => ({ command: 'kimi', args: ['acp'], env: { KIMI_CODE_NO_AUTO_UPDATE: '1' }, inheritEnv: ['KIMI_CODE_HOME'] }),
    modes: { ask: 'default', readOnly: 'plan', reader: 'plan' },
    options: { mode: 'mode', model: 'model', effort: 'thinking' },
    signIn: {
      /* Its providers are what its login wrote: none is signed out. What it lists signed in is not yet seen. */
      status: () => ({ command: 'kimi', args: ['provider', 'list'] }),
      read: (output) => (/no providers configured/i.test(output) ? false : undefined),
      login: 'kimi login',
    },
    /*
     * Its sign-in is `credentials/` in the folder, gone with it. Its config
     * holds the providers its login wrote and the mode it starts in, and
     * `mcp.json` the person's MCP servers: neither is shared.
     */
    home: {
      variable: 'KIMI_CODE_HOME',
      usual: (env, homeDir) => env.KIMI_CODE_HOME || join(homeDir, '.kimi-code'),
      shared: only(['tui.toml', 'skills', 'agents']),
    },
    /* Seen 19 October 2026: `reject` fails the tool and it carries on; `approve_always` is the session's, for that command or file. */
    permissions: { rejectAndContinue: ['reject'], rejectAndStop: [], allowScopes: { approve_once: 'once' } },
    version: () => ({ command: 'kimi', args: ['--version'] }),
    /*
     * Its installer's is a program of its own in ~/.kimi-code/bin; npm's a
     * Node script, on Windows a `.cmd`. MIT, but its releases are bare
     * zstd-compressed programs, which Althar's downloads don't unpack yet.
     */
    cli: { name: 'kimi', node: true, guide: 'https://www.kimi.com/code/docs/en/' },
    commands: 'althar',
    knownGaps: [
      "Edits inside a git repository don't ask; commands do.",
      'Its web fetch and search never ask.',
      "Loads the person's own MCP servers from its folder's `mcp.json`, and its plugins'.",
      'The archived Kimi CLI 1.x answers to `kimi` too, with its own modes; a reader on it is refused.',
    ],
  },
  /*
   * Mistral's own ACP server. Its `ask` mode asks before edits, web, MCP
   * tools and every command but a few it reads as safe inside the workdir.
   * It has no read-only mode over ACP, so a reader runs in `ask`, with
   * Althar's rules denying every write.
   */
  'mistral-vibe': {
    id: 'mistral-vibe',
    name: 'Mistral Vibe',
    service: { name: 'Mistral', url: 'https://api.mistral.ai' },
    source: 'user_installed',
    /* Its settings from the environment win over the person's and the repository's: asking, with no model judging what is safe. */
    launch: () => ({
      command: 'vibe-acp',
      args: [],
      env: {
        VIBE_DEFAULT_AGENT: 'ask',
        VIBE_BYPASS_TOOL_PERMISSIONS: 'false',
        VIBE_SMART_APPROVE_DEFAULT: 'false',
        VIBE_SMART_APPROVE_AVAILABLE: 'false',
        VIBE_ENABLE_UPDATE_CHECKS: 'false',
      },
      inheritEnv: ['VIBE_HOME'],
    }),
    modes: { ask: 'ask', readOnly: null, reader: 'ask' },
    /* Its effort is the model's thinking, an option of its own kind. */
    options: { mode: 'mode', model: 'model', effort: 'thinking' },
    /*
     * It has no status command. Its browser sign-in makes a Mistral key for the
     * account, which a Le Chat Pro or Team plan pays for, and pay-as-you-go
     * otherwise: Althar can't tell which.
     */
    signIn: { read: () => undefined, login: 'vibe --setup' },
    /* Its key is a keychain item every folder shares, so it has one account. Its config holds the person's MCP servers. */
    home: {
      variable: 'VIBE_HOME',
      usual: (env, homeDir) => env.VIBE_HOME || join(homeDir, '.vibe'),
      shared: only(['AGENTS.md', 'agents', 'prompts', 'skills']),
      accounts: 'one',
    },
    /* From its code (vibe/acp/utils.py), not yet seen in a turn: rejecting tells the model to try another way, and it carries on. */
    permissions: { rejectAndContinue: ['reject_once'], rejectAndStop: [], allowScopes: { allow_once: 'once' } },
    version: () => ({ command: 'vibe-acp', args: ['--version'] }),
    /* `uv tool install mistral-vibe` puts it in ~/.local/bin. Its releases need their whole folder, which Althar's downloads don't keep. */
    cli: { name: 'vibe-acp', guide: 'https://github.com/mistralai/mistral-vibe' },
    commands: 'althar',
    knownGaps: [
      'No read-only mode over ACP: a reader asks, and Althar’s rules deny it every write.',
      "Loads the person's own MCP servers from its folder's `config.toml`, and Mistral's connectors.",
      'No status command, so its sign-in shows only when a session starts; and one account, as its key is shared.',
      'Whether its web search asks under its newer harness is not yet checked.',
    ],
  },
  /*
   * Alibaba's Qwen team's ACP server. In `default` it asks before edits, web
   * fetches, MCP tools and every command it doesn't read as only reading.
   * Its plan mode refuses whatever would ask, Althar's tools too, so a reader
   * runs in `default`, with Althar's rules denying every write. It starts in
   * `auto`, where a model approves what it thinks safe, unless told.
   */
  'qwen-code': {
    id: 'qwen-code',
    name: 'Qwen Code',
    source: 'user_installed',
    launch: () => ({ command: 'qwen', args: ['--acp', '--approval-mode', 'default'], inheritEnv: ['QWEN_HOME'] }),
    modes: { ask: 'default', readOnly: 'plan', reader: 'default' },
    /* Its efforts are a model's own, and `default` leaves one at its own. */
    options: { mode: 'mode', model: 'model', effort: 'reasoning_effort', ownEffort: 'default' },
    /*
     * It has no status command, and keeps its keys in its settings, which
     * Althar never reads: Alibaba Cloud's Coding Plan key, or any provider's.
     * Sign in with `/auth` in its own window.
     */
    signIn: { read: () => undefined, login: 'qwen' },
    /* Its keys and the person's settings share `settings.json`, which isn't shared. */
    home: {
      variable: 'QWEN_HOME',
      usual: (env, homeDir) => env.QWEN_HOME || join(homeDir, '.qwen'),
      shared: only(['QWEN.md', 'skills', 'agents', 'commands', 'output-styles']),
    },
    /* From its code (toPermissionOptions): `cancel` is the only rejection, and ends the turn. */
    permissions: { rejectAndContinue: [], rejectAndStop: ['cancel'], allowScopes: { proceed_once: 'once' } },
    version: () => ({ command: 'qwen', args: ['--version'] }),
    /* An npm install is a Node script, on Windows a `.cmd`; the standalone one starts its own Node from a shell script. */
    cli: { name: 'qwen', node: true, guide: 'https://github.com/QwenLM/qwen-code' },
    commands: 'althar',
    knownGaps: [
      "A repository's `.qwen/settings.json` can add allow rules, hooks and MCP servers, and it trusts every folder.",
      'Commands it reads as only reading run without asking.',
      'Every rejection ends the turn; Althar carries the turn on itself.',
      'No status command, so its sign-in shows only when a session starts.',
    ],
  },
  /*
   * Google's own ACP server for Antigravity, which the `agy` CLI doesn't
   * have, downloaded apart from it. Its `default` mode asks before its tools;
   * `auto_edit` and `yolo` approve without asking, and it has no read-only
   * mode, so every role runs in `default`, held there, with Althar's rules
   * denying a reader every write. The model asks the person a question as a
   * permission request on an `interaction_` tool call, one option for each
   * answer, which goes to the person and never to the rules.
   */
  antigravity: {
    id: 'antigravity',
    name: 'Google Antigravity',
    source: 'user_installed',
    /*
     * Its sign-in in the home's own file rather than the keychain item every
     * server on the computer shares; no browser of its own (Althar opens the
     * page); and a temporary folder of its own, as it unpacks itself there
     * (about 1 GB) each time it starts. On Linux, `--uid=`, without which it
     * drops to nobody when started as root (the registry's own launch).
     */
    launch: () => ({
      command: 'agy_acp_server.par',
      args: process.platform === 'linux' ? ['--uid='] : [],
      env: { AGY_ACP_FORCE_FILE_STORAGE: '1', PYTHONUNBUFFERED: '1', BROWSER: 'true' },
      inheritEnv: ['GEMINI_HOME'],
      privateTemp: true,
    }),
    modes: { ask: 'default', readOnly: null, reader: 'default' },
    /* Its effort is in its model's id (`gemini-3.8-flash-high`); `yolo`, a mode, is held off by holding the mode. */
    options: { mode: 'mode', model: 'model', held: { mode: 'default' } },
    /*
     * It has no status or login command: it signs in only over ACP, with a
     * Google account (`oauth-personal`), and a session's start says whether it
     * is. Its other ways, a Gemini key or Google Cloud's, never reach it, past
     * Althar's allowlist.
     */
    signIn: {
      read: () => undefined,
      login: '',
      inApp: {
        kind: 'acp-authenticate',
        ways: ['browser'],
        run: () => agents.antigravity.launch(''),
        method: 'oauth-personal',
        link: /Open the following link to authenticate the ACP server:\s*(\S+)/,
      },
    },
    /*
     * Its sign-in, settings and conversations are `antigravity-acp/` in the
     * folder; `config/` holds the person's MCP servers and hooks, and the
     * usual folder is Gemini CLI's too: none of them is shared.
     */
    home: {
      variable: 'GEMINI_HOME',
      usual: (env, homeDir) => env.GEMINI_HOME || join(homeDir, '.gemini'),
      shared: only(['GEMINI.md']),
    },
    /* Its approvals' option ids are not yet seen: each is read by its kind. */
    permissions: { rejectAndContinue: [], rejectAndStop: [], allowScopes: {}, questions: 'interaction_' },
    /*
     * Google publishes no license to pass it on and no checksums: Althar
     * downloads it from Google at the person's asking, version 1.3.0 as Orca
     * pins it, each archive and both programs in it by the sha256 Orca
     * measured. The server finds its harness, `localharness_external`, beside
     * itself. No build for Windows.
     */
    cli: {
      name: 'agy_acp_server.par',
      download: {
        version: '1.3.0',
        assets: {
          'darwin-arm64': {
            url: 'https://dl.google.com/agy-extensions/releases/macos/agy-acp-server-1.3.0-darwin-arm64.zip',
            sha256: '7cd97045f7b4fe81175a107cdf16f9c51484e3c78a5162cae415338bb6aa5b88',
            files: {
              'agy_acp_server.par': 'cb1f0725183ed922079ed6cd1d2422b4d8be44c5fb60be3e9a43d8d04f99a18e',
              localharness_external: 'b04b00662c1821b953a409d43626b86d1229130eeb2078b4e1304c06199aa481',
            },
          },
          'darwin-x64': {
            url: 'https://dl.google.com/agy-extensions/releases/macos/agy-acp-server-1.3.0-darwin-x86_64.zip',
            sha256: 'bb23956b89984bf5d354af2c3725e6c57f0cc1b7228e77a0e91c9c2bc1d47646',
            files: {
              'agy_acp_server.par': 'f31bd5797eeb225a5efa12e24573f1f4eb157ec00698dd6a2cda6f0d924705cf',
              localharness_external: 'd724f49b2c9e440c5d37925b1da203fc204c17dd9c662df45094c641f9806bc6',
            },
          },
          'linux-x64': {
            url: 'https://dl.google.com/agy-extensions/releases/linux/agy-acp-server-1.3.0-linux-x86_64.zip',
            sha256: '9fb60956af0a9d76220a4db91ca9ac88e2a2372ad68f985ab5fceace6b825b96',
            files: {
              'agy_acp_server.par': 'cf6feaebdacfc2255dcfc8883db99b15de8554698554e2a1e78e5ccec1c68a20',
              localharness_external: '63042ca43fc7a69600683920f7706689b82cf8aecefe21dc18cf35e99c9dde4d',
            },
          },
          'linux-arm64': {
            url: 'https://dl.google.com/agy-extensions/releases/linux/agy-acp-server-1.3.0-linux-arm64.zip',
            sha256: '500b0bc0fb858e88f4df404d4cedf80bf9298c178291e39e383d6c50b111cbdf',
            files: {
              'agy_acp_server.par': '03ea51ff7a60cb1b44e65da40fdb35f1f457db7950d1651d9e86945c8aa584c6',
              localharness_external: '7fe676f1234889900800bad3ca50fb9b55f1e16ee4cb82b789f84ae5145fd582',
            },
          },
        },
        size: process.platform === 'darwin' ? '115 MB' : '330 MB',
      },
    },
    commands: 'althar',
    knownGaps: [
      "Google's Antigravity terms call reaching it with its Google sign-in from third-party software a breach that can suspend the account; Google lists this server for other editors, and Orca runs it so, but whether Althar counts is not settled.",
      "Its usual folder's `config/` loads the person's own hooks and MCP servers; an account Althar made has neither.",
      'Its approvals’ option ids are not yet seen, so each is read by its kind.',
      'No status command, so its sign-in shows only when a session starts.',
      'No build for Windows.',
      'It unpacks about 1 GB into a temporary folder each time it starts, removed when it stops.',
    ],
  },
}
