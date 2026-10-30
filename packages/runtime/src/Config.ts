import { execFile } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

import { available, type Fetch, type Product, type ProductInfo } from '@althar/connectors'
import { adapterNode, agents, type AgentDefinition, type SessionOptions, type Transport, usingLocated } from '@althar/provider-adapters'
import { Context, Crypto, type Duration, Effect, Layer } from 'effect'

import type { Machine } from './atOnce'
import { CliUnanswered, UnknownAgent } from './errors'
import { Installs, type OnDevice } from './Installs'
import type { LoadOptions } from './MachineLoad'
import type { PlanUsageOptions } from './PlanUsage'
import type { ModelFactsOptions } from './ModelFacts'

/** A screenshot an agent asks for: the page, the viewport it is drawn at, and what of it, all of it or one element. */
export interface Shot {
  readonly url: string
  readonly width: number
  readonly height: number
  /** The whole page, as tall as it is, not only what the viewport shows. */
  readonly fullPage: boolean
  /** A CSS selector: only the first element it finds. */
  readonly selector: string | null
  /** The origins of Althar's runs it may be of beside this computer's: a page it goes on to, by a redirect or itself, must be at one of them too (screenshots.ts, mayDraw). */
  readonly origins: ReadonlyArray<string>
}

/** A screenshot taken: a PNG at 1×, as base64, its size, and the page's title. */
export interface Screenshot {
  readonly png: string
  readonly width: number
  readonly height: number
  readonly title: string
}

export interface RuntimeOptions {
  /** Where task worktrees go: `<root>/<project>/<task>/<repository>` (ADR-006). */
  readonly worktreeRoot: string
  /** Where the homes of accounts Althar makes go (ADR-012): `<root>/<account>`. Without it, it makes none. */
  readonly accountsRoot?: string
  /**
   * Where the artifact store keeps its bytes (`Artifacts.ts`): pictures
   * agents hand back and what commands print, `<root>/<digest>`. Without it,
   * nothing is kept, and the thread says so.
   */
  readonly artifactsRoot?: string
  /** Where agents Althar downloads at the person's asking are kept (`Installs.ts`): `<root>/<agent>`. Without it, it downloads none. */
  readonly agentsRoot?: string
  /**
   * The device outside a sandbox that cannot see it (a Flatpak's host): the
   * person's own commands are found and run out there (`Installs.ts`).
   * Without it, everything is looked for and run here, as always.
   */
  readonly onDevice?: OnDevice
  /**
   * Where the models probe may start an agent whose copy lives outside the
   * sandbox (a Flatpak): a folder the device sees at the same path too.
   * Without it, the system's temporary folder (`Models.ts`).
   */
  readonly probeRoot?: string
  /** Opens a line in a terminal for the person to run, such as an agent's own sign-in; whether it could. Without it, the person runs it. */
  readonly openTerminal?: (line: string) => Effect.Effect<boolean>
  /**
   * Takes a screenshot, headless, where something can draw a page: the
   * desktop app's main process, with Chromium. It fails with why, in words
   * for the agent. Without it, the screenshot tool says this Althar can't.
   */
  readonly screenshot?: (shot: Shot) => Effect.Effect<Screenshot, string>
  /** Opens a page in the person's browser, for an agent's sign-in that doesn't itself; whether it could. Without it, the window offers the link. */
  readonly openUrl?: (url: string) => Effect.Effect<boolean>
  /** The editors on this device a task's files open in, and opening one on a folder, at a file and line where it can; without it, none. */
  readonly editors?: {
    readonly list: () => ReadonlyArray<{ readonly id: string; readonly name: string }>
    readonly open: (editor: string, folder: string, file: string | null, line: number | null) => Effect.Effect<boolean>
  }
  readonly appVersion: string
  /** What this device is called, when the profile is new. */
  readonly deviceName: string
  /** How long a proposed plan waits before it starts on its own: 25 seconds unless a test says otherwise. */
  readonly countdown?: Duration.Duration
  /** How often a task's pull requests are asked for news while it listens: 30 seconds unless a test says otherwise. */
  readonly listenEvery?: Duration.Duration
  /** When finished tasks' folders are first swept after Althar starts, and how often after: 2 minutes and an hour unless a test says otherwise (ADR-056). */
  readonly foldersFirst?: Duration.Duration
  readonly foldersEvery?: Duration.Duration
  /**
   * When Althar first looks for what settled tasks left running after it starts, and how often after: 20 seconds and 5
   * minutes unless a test says otherwise (LeftBehind.ts).
   */
  readonly leftFirst?: Duration.Duration
  readonly leftEvery?: Duration.Duration
  /** How full the disk a folder is on is read, in bytes: the system's own figures unless a test says, so none depends on the Mac it runs on. */
  readonly disk?: (path: string) => Effect.Effect<{ readonly total: number; readonly free: number; readonly used: number } | null>
  /**
   * How long after a change's work comes back its pull request may show no checks before Althar takes it to have none: a
   * host registers its checks a few seconds after a push. A minute unless a test says otherwise (ADR-040).
   */
  readonly checksAppear?: Duration.Duration
  /** How long a change's checks may run, while Althar sees them through, before the change is the person's: 45 minutes unless a test says (ADR-041). */
  readonly checksStuck?: Duration.Duration
  /** The public ids of Althar's apps registered with code hosts and trackers, for their browser sign-in. */
  readonly clientIds?: Partial<Record<Product, string>>
  /** Althar's GitHub App, by its slug, for where it is installed on an owner. */
  readonly githubApp?: string
  /**
   * How code hosts and trackers are called. The app gives its own network,
   * which trusts the certificates and proxies the Mac does, as a company's
   * own server needs; Node's `fetch` trusts only its bundled roots.
   */
  readonly fetch?: Fetch
  /** How long stopping an agent waits for it to end its turn before it stops its process: 10 seconds unless a test says otherwise. */
  readonly stopGrace?: Duration.Duration
  /** Maximum time for the coordinator to judge a permission, including startup: one minute by default. */
  readonly permissionJudgeTimeout?: Duration.Duration
  /** When a turn counts as stalled, and how much work goes on before the person is asked (`Stalls.ts`). */
  readonly stalls?: StallOptions
  /** Where what is known of models comes from (`ModelFacts.ts`); without it, nothing is fetched and nothing is known. */
  readonly modelFacts?: ModelFactsOptions
  /**
   * What each agent's process writes to stderr, as it comes, by agent and pid: the app keeps it in its log of agents. Without it,
   * only the last few kilobytes are kept, for the error when an agent stops.
   */
  readonly agentStderr?: AgentStderr
  /** How this computer's load is read, and how often at most (`MachineLoad.ts`). */
  readonly load?: LoadOptions
  /** How plan usage is read from each agent, and how often on its own (`PlanUsage.ts`). */
  readonly usage?: PlanUsageOptions
  /** How a task's worktree is set up before its lead starts (`Setups.ts`). */
  readonly setups?: SetupOptions
  /** When a lead that ended its turn counts as done, and how long a round waits for one that isn't (`leftRunning.ts`, `conflicts.ts`). */
  readonly idle?: IdleOptions
  /** How many tasks are at work at once here, and how what waits for a place is looked at (`Busy.ts`). */
  readonly busy?: BusyOptions
  /** When automations run, and the clock and zone they are read by (`Automations.ts`). */
  readonly automations?: AutomationOptions
  /** How Althar tells whether an agent's service answers, and how long a step waits before it tries one that failed again (`Connectivity.ts`). */
  readonly connectivity?: ConnectivityOptions
}

/** Each is the default unless a test says otherwise. */
export interface AutomationOptions {
  /** The zone the computer is in now: its clock's. */
  readonly zone?: () => string
  /** How often the clock is looked at, besides whenever an automation changes: every 30 seconds. */
  readonly tick?: Duration.Duration
  /** How long a run the computer slept through, or Althar was closed for, waits after waking or launching: two minutes. */
  readonly settle?: Duration.Duration
  /** Whether each automation starts its few minutes after its time: yes. */
  readonly stagger?: boolean
  /** Pull requests a review automation lists at a time, reading back from the latest: 100, as many as GitHub gives at once. */
  readonly listed?: number
}

/** Each is the default unless a test says otherwise. */
export interface ConnectivityOptions {
  /** Whether a service answers at its address: whether a light request there gets any answer within five seconds. */
  readonly answers?: (url: string) => Effect.Effect<boolean>
  /** How long a step waits before each try again at a service that keeps failing while the computer is online: 15 s, 1 min, 4 min. */
  readonly pauses?: ReadonlyArray<Duration.Duration>
  /** How often a step waiting for the connection asks again whether its service answers, while the computer says it is online: 30 s. */
  readonly every?: Duration.Duration
}

/** Each is the default unless a test says otherwise. */
export interface IdleOptions {
  /** How long an agent must say nothing outside a turn, once what it left running ended, to be taken as done: 30 seconds. */
  readonly quiet?: Duration.Duration
  /** How long a round waits for a lead that is still at work before it judges the branch as it is: 45 minutes. */
  readonly within?: Duration.Duration
  /** How long an agent is given to wake once what it left running ended, before it speaks: five minutes. */
  readonly wake?: Duration.Duration
  /** How long after its turn ends a lead is given to report what it left running: two seconds. */
  readonly reports?: Duration.Duration
  /** How long a step's agent whose turn ended having done nothing at all is given before it is told to carry on: a minute. */
  readonly blank?: Duration.Duration
}

export interface BusyOptions {
  /** The machine the default is worked out from: this one, as Node says it, unless a test says. */
  readonly machine?: Machine
  /** How often what waits is looked at, besides whenever an agent's turn or session ends: every 5 seconds. */
  readonly every?: Duration.Duration
  /** How often the CPU of what agents left running is read, while any is: every 2 seconds. */
  readonly sample?: Duration.Duration
  /** How long what an agent left running must stay below real CPU before it stops taking a place: 30 seconds. */
  readonly quiet?: Duration.Duration
  /** How long an agent waiting on the person's answer, to a question or a permission, keeps its place: five minutes. */
  readonly askGrace?: Duration.Duration
  /** How many automations' tasks may be at work at once: one. */
  readonly automations?: number
  /**
   * The CPU time of each process in the tree of each of these agents (the agent's process and everything it started), by
   * process and in milliseconds, by thread; null where it can't be said, as for an agent that is no process of its own:
   * read with `ps` from the agent's process, once a sample.
   */
  readonly cpuOf?: (
    agents: ReadonlyArray<{ readonly threadId: string; readonly pid: number | null }>,
  ) => Effect.Effect<ReadonlyMap<string, ReadonlyMap<number, number> | null>>
}

export interface SetupOptions {
  /** How long a setup may run before it is stopped and counts as failed: ten minutes unless a test says otherwise. */
  readonly within?: Duration.Duration
  /** The shell it runs in, as a login shell: the person's own (`SHELL`) unless a test says otherwise. */
  readonly shell?: string
}

/** Called with what an agent's process writes to stderr. */
export type AgentStderr = (agentId: string, chunk: string, pid: number) => void

/** Each is the default unless a test says otherwise. */
export interface StallOptions {
  /** How often running turns are looked at: 30 seconds. */
  readonly every?: Duration.Duration
  /** How long a turn may show no sign of life before it counts as stalled: 10 minutes. */
  readonly quiet?: Duration.Duration
  /** The same while one of the agent's tools is running, such as a command: 20 minutes. */
  readonly quietInTool?: Duration.Duration
  /** How long an agent has to end a turn it was asked to stop, before it is started afresh: a minute. */
  readonly cancelGrace?: Duration.Duration
  /** How late a look at the turns may come before it means the machine slept: a minute past when it was due. */
  readonly asleepAfter?: Duration.Duration
  /** How long the agents may work on a thread since the person last said anything there: 6 hours. */
  readonly work?: Duration.Duration
  /** How many turns they may take in that time: 40. */
  readonly turns?: number
  /** The CPU time each process and everything it started have used, in milliseconds, or null once it's gone: read with `ps`, once a look. */
  readonly cpuOf?: (pids: ReadonlyArray<number>) => Effect.Effect<ReadonlyMap<number, number | null>>
}

export class RuntimeConfig extends Context.Service<RuntimeConfig, RuntimeOptions>()('@althar/runtime/RuntimeConfig') {}

/** An agent the runtime can start: its registry entry, and how to reach it from a working directory. */
export interface AgentEntry {
  readonly definition: AgentDefinition
  /**
   * How to reach it from a working directory, with an account's home in its
   * environment (ADR-012); `untrusted`, as the lead of a review of someone
   * else's pull request, with what keeps that repository's config from running.
   */
  readonly transport: (cwd: string, env?: Readonly<Record<string, string>>, options?: SessionOptions) => Transport
}

/**
 * The agents the runtime starts. In the app they are the registry's, each run
 * as a process; tests put the fake agent here.
 */
export class Agents extends Context.Service<
  Agents,
  {
    /** Every agent the runtime can start. */
    readonly list: ReadonlyArray<AgentEntry>
    get(agentId: string): Effect.Effect<AgentEntry, UnknownAgent>
  }
>()('@althar/runtime/Agents') {
  /** Agents from a list of entries. */
  static readonly from = (entries: ReadonlyArray<AgentEntry>) =>
    Agents.of({
      list: entries,
      get: (agentId) => {
        const entry = entries.find((candidate) => candidate.definition.id === agentId)
        return entry === undefined ? Effect.fail(new UnknownAgent({ agentId })) : Effect.succeed(entry)
      },
    })

  /**
   * The registry's agents, each run as a process without the person's ways
   * into a code host, so they reach one only through Althar (ADR-011):
   * `gh` and `glab` signed out, their config folders an empty one; git's
   * credential helpers reset, so neither git nor `curl` through it signs in
   * as the person; and git never asks for a password. The person's SSH agent
   * isn't passed on either (provider-adapters' process environment). Nor
   * are the MCP servers the person set up for an agent themselves, which
   * Codex and OpenCode would otherwise load beside Althar's (ownTools.ts).
   * The lead of a review of someone else's pull request also starts with what
   * its registry entry says keeps that repository's config, hooks and plugins
   * from loading, and with git that takes no repository the pull request
   * carries for its own (`readingUntrusted`).
   */
  static readonly registry = (stderr?: AgentStderr): Layer.Layer<Agents, never, Installs> =>
    Layer.effect(
      Agents,
      Effect.gen(function* () {
        const installs = yield* Installs
        // In a Flatpak a bundled copy lives inside the app's sandbox: the sign-in
        // line the person runs names the app that carries it (`usingLocated`).
        return Agents.fromRegistry(
          (definition) => usingLocated(definition, () => installs.locate(definition), process.env.FLATPAK_ID),
          stderr,
        )
      }),
    )

  /**
   * The registry's agents, each as `located` points its commands: at the person's own, or the copy Althar downloaded. What each
   * process writes to stderr goes to `stderr`, where it is given.
   */
  static readonly fromRegistry = (
    located: (definition: AgentDefinition) => AgentDefinition = (definition) => definition,
    stderr?: AgentStderr,
  ) => {
    const signedOut = mkdtempSync(join(tmpdir(), 'althar-no-sign-in-'))
    return Agents.from(
      Object.values(agents)
        .map(located)
        .map((definition) => ({
          definition,
          transport: (cwd: string, env: Readonly<Record<string, string>> = {}, options: SessionOptions = {}) => {
            const spec = definition.launch(adapterNode())
            const own = definition.withoutOwnTools?.({ env: { ...process.env, ...env }, homeDir: homedir(), cwd }) ?? {}
            const held = options.untrusted === true ? { ...readingUntrusted, ...definition.reviewing?.env?.({ ...spec.env, ...own }) } : {}
            return {
              _tag: 'Process' as const,
              spec: { ...spec, env: { ...spec.env, ...withoutSignIns(signedOut), ...own, ...held, ...env } },
              cwd,
              ...(stderr === undefined ? {} : { stderr: (chunk: string, pid: number) => stderr(definition.id, chunk, pid) }),
            }
          },
        })),
    )
  }
}

/**
 * What an agent's environment adds so it carries none of the person's
 * sign-ins to code hosts. And a branch it makes from a remote's follows
 * nothing: git would write that to the repository's `.git/config`, which an
 * agent's sandbox refuses, so `git switch -c x origin/x` failed halfway,
 * leaving the worktree where it was (ADR-066).
 */
export const withoutSignIns = (signedOut: string): Readonly<Record<string, string>> => ({
  GH_CONFIG_DIR: signedOut,
  GLAB_CONFIG_DIR: signedOut,
  // An empty helper resets git's list of them: the person's keychain and stored credentials aren't asked.
  GIT_CONFIG_COUNT: '2',
  GIT_CONFIG_KEY_0: 'credential.helper',
  GIT_CONFIG_VALUE_0: '',
  GIT_CONFIG_KEY_1: 'branch.autoSetupMerge',
  GIT_CONFIG_VALUE_1: 'false',
  GIT_TERMINAL_PROMPT: '0',
})

/**
 * What the environment of a review's lead adds to `withoutSignIns`' (whose
 * git settings it keeps), beside its agent's `reviewing.env`. Git reads
 * none of the person's config or the system's: a filter, diff or merge
 * driver defined there (`python -m nbstripout`, a textconv) would run on the
 * pull request's files as the lead's `git status` or `git diff` reads them,
 * in the copy, where it finds the pull request's own modules first; the
 * copy is a repository of its own whose config defines none (`addReadCopy`).
 * And git uses a bare repository only where it is named, never one it finds
 * by itself: a pull request can carry one, under any name, whose config
 * names a program for git to run (an external diff, a signature checker);
 * `git -C` into it would run it.
 */
export const readingUntrusted: Readonly<Record<string, string>> = {
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_COUNT: '3',
  GIT_CONFIG_KEY_2: 'safe.bareRepository',
  GIT_CONFIG_VALUE_2: 'explicit',
}

/** Crypto from the platform's Web Crypto, which Node and Electron both have. */
export const WebCrypto: Layer.Layer<Crypto.Crypto> = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => globalThis.crypto.getRandomValues(new Uint8Array(size)),
    digest: (algorithm, data) =>
      Effect.map(
        Effect.promise(() => globalThis.crypto.subtle.digest(algorithm, Uint8Array.from(data))),
        (buffer) => new Uint8Array(buffer),
      ),
  }),
)

/** A command-line tool for a code host, whose sign-in on this device Althar can take a copy of. */
export type CliTool = 'gh' | 'glab'

/**
 * The token a tool is signed in to a host with, read the way the tool itself
 * hands it out (from its config or the keychain it keeps it in), or null
 * where it isn't there or says it isn't signed in. A tool that didn't get to
 * say, timed out or never started, fails. Only the runtime reads it; it goes
 * to Althar's own keychain and never to an agent.
 */
export const cliToken = (
  tool: CliTool,
  host: string,
  /** How long it has to answer: ten seconds, or longer where it starts slowly, as on a machine running tests. */
  within = 10_000,
): Effect.Effect<string | null, CliUnanswered> =>
  Effect.callback<string | null, CliUnanswered>((resume) => {
    const args = tool === 'gh' ? ['auth', 'token', '--hostname', host] : ['config', 'get', 'token', '--host', host]
    // An app opened from the Finder has a short PATH: where Homebrew puts the tools is looked in too.
    const path = [process.env.PATH, '/opt/homebrew/bin', '/usr/local/bin']
      .filter((part) => part !== undefined && part !== '')
      .join(delimiter)
    execFile(
      tool,
      args,
      { timeout: within, windowsHide: true, env: { ...process.env, PATH: path, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' } },
      (error, stdout) => {
        const token = stdout.trim()
        if (error === null) return resume(Effect.succeed(/^\S{20,400}$/.test(token) ? token : null))
        // It ran and said no, or isn't installed: it has no sign-in to give.
        if (error.killed !== true && (typeof error.code === 'number' || error.code === 'ENOENT')) return resume(Effect.succeed(null))
        resume(
          Effect.fail(new CliUnanswered({ tool, message: `${tool} didn’t answer (${error.signal ?? error.code ?? 'no reason given'})` })),
        )
      },
    )
  })

/**
 * The code hosts and trackers the runtime connects to (docs/architecture/06):
 * each product it has an adapter for, how it calls their APIs, the public ids
 * of Althar's own apps registered with them (a product without one takes
 * a pasted token), its GitHub App's slug, for where it is installed, the
 * loopback port a browser sign-in comes back to, and how a command-line
 * tool's sign-in is read. Tests put fakes here.
 */
export class Connectors extends Context.Service<
  Connectors,
  {
    readonly products: ReadonlyArray<ProductInfo>
    readonly fetch: Fetch
    readonly clientIds: Partial<Record<Product, string>>
    readonly callbackPort: number
    readonly appSlug?: string
    readonly cliToken: (tool: CliTool, host: string) => Effect.Effect<string | null, CliUnanswered>
  }
>()('@althar/runtime/Connectors') {
  /** The products with adapters, over the network. */
  static readonly live = (
    clientIds: Partial<Record<Product, string>> = {},
    fetch: Fetch = globalThis.fetch,
    appSlug?: string,
  ): Layer.Layer<Connectors> =>
    Layer.succeed(
      Connectors,
      Connectors.of({
        products: available(),
        fetch,
        clientIds,
        callbackPort: 47821,
        cliToken,
        ...(appSlug === undefined ? {} : { appSlug }),
      }),
    )
}
