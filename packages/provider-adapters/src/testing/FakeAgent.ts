import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as acp from '@agentclientprotocol/sdk'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import type { InProcessAgent } from '../AgentConnection'
import { stopBackgroundMethod, type StopBackgroundResponse } from '../background'

/*
 * A scripted ACP agent for tests, so the adapter's contract runs in CI without
 * signing in to anything. It speaks real ACP through the same SDK the agents
 * use. The prompt's text picks a scenario. It starts every session in a bypass
 * mode, so tests show the adapter always moves a session out of it. It takes
 * images in a prompt unless told not to, and says first what images it was
 * sent: `saw images: image/png 68 B, …`.
 */

export const scenarios = {
  /** Two message chunks, then the turn ends with usage. */
  hello: 'hello',
  /** A thought, then a message. */
  think: 'think',
  /** A tool call that asks permission, then succeeds or fails on the answer. */
  tool: 'tool',
  /** Like `tool`, but it offers only allow-always and reject-once. */
  toolAlwaysOnly: 'tool-always-only',
  /** A tool call that says what it is, then asks permission with nothing but its id, as Codex does for an MCP tool. */
  bareAsk: 'bare-ask',
  /** A plan, context usage, a notice, and the agent changing its own option. */
  updates: 'updates',
  /** One chunk, then waits until cancelled. */
  slow: 'slow',
  /** Fails with Claude Code's usage-limit message. */
  usageLimit: 'usage-limit',
  /** Fails because the user is not signed in. */
  auth: 'auth',
  /** Sends an update type the protocol doesn't have yet. */
  unknownUpdate: 'unknown-update',
  /**
   * A command, with Codex's options: allow, allow for the session, decline
   * (carry on), cancel (stop the turn). Cancelling the turn while it waits
   * withdraws the request, as the real agents do.
   */
  commandChoices: 'command-choices',
  /** Carries on after a permission answer until the client cancels. */
  deniedThenWait: 'denied-then-wait',
  /** A file edit, with Codex's options: the only rejection stops the turn. */
  fileEdit: 'file-edit',
  /** Like `fileEdit`, but it asks again every time the turn is resumed. */
  stubborn: 'stubborn',
  /** Asks the person a plain question, as an MCP server's form does, and repeats the answer. */
  question: 'question',
  /**
   * Asks as Claude Code's AskUserQuestion does: a tool call, then a form of
   * two questions, the second with several picks, each with a field for the
   * person's own words; repeats the answer.
   */
  questions: 'questions',
  /** Claude's structured report of an exhausted quota, then a normal end. */
  quota: 'quota',
  /** Claude's structured report of a full context. */
  contextFull: 'context-full',
  /** Claude's structured warning of a short rate limit, then a normal reply. */
  rateWarning: 'rate-warning',
  /** The agent leaves the mode it was put in, as a plan session does on leaving plan mode. */
  leaveMode: 'leave-mode',
  /** Ends the turn, then sends an update between turns. */
  afterTurn: 'after-turn',
  /** Ends the turn, then says a message in two chunks on its own, as an agent woken by a command that finished does. */
  wakesItself: 'wakes-itself',
  /** Reports the session's mode and model. */
  settings: 'settings',
  /** The process exits mid-turn. Only when the agent runs as a process. */
  exit: 'exit',
  /**
   * What an agent hands back, in each agent's shape: a command's output
   * streamed in chunks and its exit (Codex), a failing command's output
   * whole at its end (Claude Code), output as the tool's own words, whole
   * each time (OpenCode), a screenshot, a picture in a message, a markdown
   * document it writes in its folder, a link to a file, and a message with
   * a table in it.
   */
  handsBack: 'hands-back',
  /** A command whose output streams until the turn is cancelled. */
  streams: 'streams',
  /**
   * Leaves `bun dev` running, as Claude Code reports a command it sends to
   * the background: its tool call done, then the command spawned under what
   * the call says it does, then the file its output goes to, where it says
   * where it serves. Some other background work, which isn't a command, too.
   * Stopping it ends it. `[lead:serve]` does the same for a lead, and
   * `[lead:serve-exits]` has it end by itself just after the turn, failing.
   */
  background: 'background',
  /** The same as Codex reports one: spawned after the turn, by its command, its output on its tool call. */
  backgroundCodex: 'background-codex',
  /**
   * Commands the agent starts of its own, with no tool call: `npm run watch`
   * keeps running, `npm test` ends well and `npm run lint` badly, neither
   * saying an exit code, and `npm run dev`, which it stops itself. Output
   * for a call and a command it never named, too.
   */
  backgroundOwn: 'background-own',
  /**
   * Followed by a command, `run git status --short`: runs it, asking first
   * with Codex's command options, each time as a tool call of its own, and
   * says what was chosen (`chosen=allow_once`).
   */
  run: 'run ',
} as const

/** A 480 × 300 PNG of a page, as a screenshot tool hands it back. */
export const SCREENSHOT_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAeAAAAEsCAIAAACUnPcNAAAEeElEQVR42u3cIQ4CQRBEUS7Xbu6vUAQHCgFBLRs0jiGpod/POwFkS23vYZMkRXbwE0iSgZYkGWhJMtCSJAMtSQZakmSgJUkGWpIMtCTJQEuSgZYkGWhJkoGWJAMtSTLQkmSgJUkGWpIMtCTJQEuSDLQkGWhJkoGWJAMtSTLQkiQDLUkGWpJkoCXpzwb6cb8BEMhAAxhoAAw0gIEGwEADGGgADDQABhrAQANgoAEMNAAGGgADDWCgATDQAAYaAAMNYKABMNAAGGgAAw2AgQYw0AAYaAAMNICBBsBAAxjoz86nIwC7xIHeJKl9BlqSDLSBliQDLUkG2kBLkoGWJANtoCXJQBtoSTLQkmSgDbQkNR3oqsFyPGmSgcZASwbaQGOgJQNtoA20ZKANNAZaMtDe4pAkAy1JBtpAS5KBliQDbaAlyUAbaEky0JJkoA20JBloSTLQBlqSDLQkGei4gQYgcaABmMtAAxhoAAw0gIEGwEADGGgADDQADlUA2h6qOPWWJN/ikCQDbaAlyUBLkoE20JJkoCXJQBtoSTLQBlqSDLQkGWgDLUl9B7pqsBxPmmSgMdCSgTbQGGjJQBtoAy0ZaAONgZYMtLc4JMlAS5KBNtCSZKAlyUAbaEky0AZakgy0JBloAy1JBlqSDLSBliQDLUkGOm6gAUgcaADmMtAABhoAAw1goAEw0AAGGgADDYBDFYC2hypOvSXJtzgkyUAbaEky0JJkoA20JBloSTLQBlqSDLSBliQDLUkG2kBLUt+Brhosx5MmGWgMtGSgDTQGWjLQBtpASwbaQGOgJQPtLQ5JMtCSZKANtCQZaEky0AZakgy0gZYkAy1JBtpAS5KBliQDbaAlyUBLkoGOG2gAEgcagLkMNICBBsBAAxhoAAw0gIEGwEAD4FAFoO2hilNvSfItDkky0AZakgy0JBloAy1JBlqSDLSBliQDbaAlyUBLkoE20JLUd6CrBsvxpEkGGgMtGWgDjYGWDLSBNtCSgTbQGGjJQHuLQ5IMtCQZaAMtSQZakgy0gZYkA22gJclAS5KBNtCSZKAlyUAbaEky0JJkoOMGGoDEgQZgLgMNYKABMNAABhoAAw1goAEw0AAYaAADDYCBBjDQABhoAAw0gIEGwEADGGgADDSAgf7G9fIEYGegAQy0gQYw0AAG2kADGGgAA22gAQy0gQYw0AAG2kADGGgAA22gAQy0vwTAQAMYaAMNYKABDLSBBjDQAAbaQAMYaAMNYKABDLSBBjDQAAbaQAMYaAMNYKABDLSBBjDQAAbaQAMYaAADbaABDLSBBjDQAAbaQAMYaAADbaABDDQAv2OgAQw0AAYawEADYKABDDQABhoAAw1goAEw0AAGGgADDYCBBjDQABhoAAMNgIEGMNAAGGgADDSAgQbAQAMYaAAMNAAGGsBAA2CgAQw0AAYawEADYKABMNAABhoAAw1goAEw0AAYaAADDYCBBjDQABhoAAPtJwAw0AAYaAADDYCBBjDQABhoAAw0gIEGwEADGGgADDQAby/e9HZPsgFukQAAAABJRU5ErkJggg=='

/** What the fake agent says before it asks as Claude Code does: why it asks. */
export const WHY = 'The rates change hourly, so a cache would save most of the calls to the provider.'

/** The document `hands-back` writes, in the session's folder. */
export const HANDED_DOCUMENT = {
  path: 'docs/notes.md',
  body: '# Notes\n\nRefunds share the partner budget.\n\n| Endpoint | Budget |\n| --- | --: |\n| charges | 600 |\n| refunds | shared |\n',
}

export const USAGE_LIMIT_MESSAGE = 'Claude AI usage limit reached|1759075200'

/** How many tokens its context holds, as it says when a prompt ends `[context:…]`. */
export const CONTEXT_SIZE = 200_000

/** The `_meta` Claude Code's adapter sends with a structured failure. */
const failureMeta = (failure: {
  readonly category: string
  readonly severity: string
  readonly title: string
  readonly actions: ReadonlyArray<string>
}) => ({
  jetbrains: { air: { version: 1, sessionFailure: { id: 'turn-1:error', revision: 1, ...failure } } },
})

const commandOptions: Array<acp.PermissionOption> = [
  { optionId: 'allow_once', name: 'Yes, proceed', kind: 'allow_once' },
  { optionId: 'allow_for_session', name: "Yes, and don't ask again for this command in this session", kind: 'allow_always' },
  { optionId: 'decline', name: 'No, continue without running it', kind: 'reject_once' },
  { optionId: 'cancel', name: 'No, and tell Codex what to do differently', kind: 'reject_once' },
]

const fileEditOptions: Array<acp.PermissionOption> = [
  { optionId: 'allow_once', name: 'Yes, proceed', kind: 'allow_once' },
  { optionId: 'allow_for_session', name: "Yes, and don't ask again for these files", kind: 'allow_always' },
  { optionId: 'cancel', name: 'No, and tell Codex what to do differently', kind: 'reject_once' },
]

/** The option meanings of the Codex-style options above, as the registry would give them. */
export const codexLikeMeanings = {
  rejectAndContinue: ['decline'],
  rejectAndStop: ['cancel'],
  allowScopes: { allow_once: 'once' as const },
}

export interface FakeAgentOptions {
  /** A scripted response to a permission judgment, with the actual session settings exposed to the test. */
  readonly judgment?: (input: {
    readonly prompt: string
    readonly mode: string
    readonly model: string
    readonly effort: string
    readonly mcpServers: number
    readonly meta: Readonly<Record<string, unknown>> | undefined
    readonly askToWrite: () => Promise<string>
  }) => Promise<string>
  /** What `exit` does. The process entry point exits the process. */
  readonly exit?: () => void
  /**
   * How it offers modes: as a config option (the default, as Claude Code,
   * Codex and OpenCode do), as legacy session modes, not at all, or as a
   * config option that ignores being set.
   */
  readonly modes?: 'config' | 'legacy' | 'none' | 'stuck'
  /** Answer `initialize` with the protocol version and nothing else. */
  readonly bare?: boolean
  /** Called when a session is closed with `session/close`. */
  readonly closed?: (sessionId: string) => void
  /** Called when something a session left running is stopped, with its task's id. */
  readonly stoppedBackground?: (id: string) => void
  /** Called with what the client says it can do, as it initializes. */
  readonly initialized?: (capabilities: acp.ClientCapabilities | undefined) => void
  /** Leave a permission request open when the turn is cancelled, for Althar to answer. */
  readonly keepsRequests?: boolean
  /**
   * Out of usage: every prompt fails with Claude Code's usage-limit message,
   * until `until` (in milliseconds, which the message gives as its reset), or
   * for good, saying no reset time.
   */
  readonly outOfUsage?: { readonly until?: number }
  /**
   * Offer effort as OpenCode does: as a model's variants, with a `default`
   * that leaves it at its own. The small model has none, and a third, huge
   * model levels of its own. Put on another model, a session takes its first.
   */
  readonly variants?: boolean
  /** Models it fails to put a session on the first time, as Claude Code does now and then when Anthropic doesn't confirm one. */
  readonly failsOnce?: ReadonlyArray<string>
  /** Models it says yes to but doesn't put a session on: the session stays on the model it was on. */
  readonly staysOn?: ReadonlyArray<string>
  /** How long it takes to make a session, in milliseconds: for what happens while an agent starts. */
  readonly slowStart?: number
  /** Whether it says it takes images in a prompt, as Claude Code, Codex and OpenCode do. True unless false. */
  readonly images?: boolean
}

interface SessionState {
  mode: string
  model: string
  /** Empty where the model it is on has no effort levels. */
  effort: string
  cancelled: boolean
  stubborn: boolean
  abort: AbortController | undefined
  directories: number
  mcpServers: number
  meta: Readonly<Record<string, unknown>> | undefined
  /** Where the session works, for a step that writes. */
  cwd: string
  /** Althar's tools, when the session was given them over HTTP. */
  tools: { readonly url: string; readonly headers: Record<string, string> } | undefined
  /** The role markers the session has been given, in any turn. */
  markers: Set<string>
  /** Markers it has played once already, such as `[lead:hang-once]`. */
  played: Set<string>
  /** It was briefed as a project's coordinator: it plans what a lead's markers say, and plays none of them itself. */
  coordinator: boolean
  /** Commands it has run with `run`, so each is a tool call of its own. */
  runs: number
  /** What it left running, by its task's id. */
  background: Map<string, { readonly toolCallId: string; readonly outputPath?: string }>
  /** How many commands it has left running, so each has an id of its own. */
  served: number
}

/** What `bun dev` prints, coloured as Vite colours it. */
const SERVING =
  '\n  \u001b[32mVITE\u001b[39m v7.1.0  ready in 312 ms\n\n  ➜  Local:   \u001b[36mhttp://localhost:\u001b[1m5173\u001b[22m/\u001b[39m\n  ➜  Network: use --host to expose\n'

/**
 * Leaves `bun dev` running in the background (`background`), as Claude Code
 * or Codex reports it. Sent as raw notifications: ACP's schema doesn't have
 * these updates yet.
 */
const leaveRunning = async (
  sessionId: string,
  session: SessionState,
  client: acp.AgentContext,
  as: 'claude' | 'codex',
  options: { readonly exits?: boolean } = {},
) => {
  const notify = (update: Record<string, unknown>) =>
    client.notify(acp.methods.client.session.update, { sessionId, update: update as unknown as acp.SessionUpdate })
  session.served += 1
  const id = `bg-${session.served}`
  const toolCallId = `serve-${session.served}`
  await notify({
    sessionUpdate: 'tool_call',
    toolCallId,
    title: 'bun dev',
    kind: 'execute',
    status: 'in_progress',
    rawInput: { command: 'bun dev' },
  })
  if (as === 'codex') {
    session.background.set(id, { toolCallId })
    // Codex says it once its list of background terminals names it, after the turn, and streams its output on its tool call.
    setTimeout(() => {
      void notify({ sessionUpdate: 'async_task_spawned', asyncTaskId: id, name: 'bun dev', taskType: 'shell', canStop: true, toolCallId })
      void notify({ sessionUpdate: 'tool_call_update', toolCallId, _meta: { terminal_output_delta: { data: SERVING } } })
    }, 20)
    return
  }
  const folder = join(tmpdir(), 'althar-fake-agent')
  mkdirSync(folder, { recursive: true })
  const outputPath = join(folder, `${sessionId}-${id}.output`)
  writeFileSync(outputPath, SERVING)
  session.background.set(id, { toolCallId, outputPath })
  await notify({
    sessionUpdate: 'async_task_spawned',
    asyncTaskId: id,
    name: 'Start the dev server',
    taskType: 'shell',
    description: 'Start the dev server',
    showInTranscript: false,
    canStop: true,
    toolCallId,
  })
  await notify({ sessionUpdate: 'async_task_progress', asyncTaskId: id, outputFilePath: outputPath })
  await notify({ sessionUpdate: 'tool_call_update', toolCallId, status: 'completed' })
  // Background work that isn't a command, as Claude Code reports some.
  await notify({ sessionUpdate: 'async_task_spawned', asyncTaskId: `dream-${id}`, name: 'Dreaming', taskType: 'dream', canStop: true })
  if (options.exits === true)
    setTimeout(() => {
      if (!session.background.delete(id)) return
      appendFileSync(outputPath, 'error: Port 5173 is in use\n[exited with code 1]\n')
      void notify({ sessionUpdate: 'async_task_state_update', asyncTaskId: id, state: 'failed' })
    }, 300)
}

/** What `[lead:explore]` reads, in order. */
const EXPLORED = [
  'README.md',
  'src/checkout/index.ts',
  'src/checkout/payment.ts',
  'src/checkout/retry.test.ts',
  'src/lib/http/client.ts',
  'src/lib/backoff.ts',
  'docs/payments.md',
]

/** Worktrees where a lead has stopped answering once: started afresh, it answers. Kept across sessions, as a restart makes a new one. */
const wedgedIn = new Set<string>()

/**
 * A lead that stalls or goes round in circles, as markers say:
 * `[lead:hang]` runs \`npm run dev\` and never ends its turn until cancelled,
 * every turn; `[lead:hang-once]` does that once. `[lead:wedge-once]` doesn't
 * stop when cancelled either, until it is started afresh. `[lead:loop]` runs a
 * failing \`npm test\` three times in a row, every turn, then waits until
 * cancelled; `[lead:loop-once]` does that once. `[lead:long-once]` stops once
 * at its output limit, and `[lead:refuse]` refuses. `[lead:explore]` reads
 * a few files, changes none, and works on until cancelled. Otherwise, nothing: the
 * turn goes on as it would.
 */
const playStall = async (
  session: SessionState,
  text: string,
  update: (value: acp.SessionUpdate) => Promise<void>,
): Promise<acp.PromptResponse | undefined> => {
  for (const marker of text.match(/\[(coordinator|lead|review):[a-z-]+\]/g) ?? []) session.markers.add(marker)
  const once = (marker: string) => session.markers.has(marker) && !session.played.has(marker) && session.played.add(marker) !== undefined
  /** Waits until cancelled, or, stubborn, until the test is long over. */
  const hang = async (stubborn = false) => {
    for (let waited = 0; (stubborn || !session.cancelled) && waited < 30_000; waited += 10) await pause(10)
    return { stopReason: session.cancelled ? 'cancelled' : 'end_turn' } satisfies acp.PromptResponse
  }
  if (session.markers.has('[lead:refuse]')) return { stopReason: 'refusal' }
  if (once('[lead:long-once]')) return { stopReason: 'max_tokens' }
  if (session.markers.has('[lead:wedge-once]') && !wedgedIn.has(session.cwd)) {
    wedgedIn.add(session.cwd)
    return await hang(true)
  }
  if (session.markers.has('[lead:explore]')) {
    for (const [i, file] of EXPLORED.entries()) {
      const path = join(session.cwd, file)
      await update({
        sessionUpdate: 'tool_call',
        toolCallId: `read-${i}`,
        title: `Read ${file}`,
        kind: 'read',
        status: 'completed',
        rawInput: { path },
        locations: [{ path }],
      })
      await pause(30)
    }
    return await hang()
  }
  if (session.markers.has('[lead:hang]') || once('[lead:hang-once]')) {
    await update({
      sessionUpdate: 'tool_call',
      toolCallId: 'dev',
      title: 'npm run dev',
      kind: 'execute',
      status: 'in_progress',
      rawInput: { command: 'npm run dev' },
    })
    return await hang()
  }
  if (session.markers.has('[lead:loop]') || once('[lead:loop-once]')) {
    for (const call of ['test-1', 'test-2', 'test-3']) {
      await update({
        sessionUpdate: 'tool_call',
        toolCallId: call,
        title: 'npm test',
        kind: 'execute',
        status: 'in_progress',
        rawInput: { command: 'npm test' },
      })
      await update({
        sessionUpdate: 'tool_call_update',
        toolCallId: call,
        status: 'failed',
        rawOutput: { exitCode: 1, output: '1 failing' },
      })
    }
    return await hang()
  }
  return undefined
}

/**
 * Calls Althar's tools over the MCP server a session was given. The fake
 * plays a role when its prompt carries a marker, as a task's description or
 * the person's message can: `[coordinator:plan]` drafts and plans a task,
 * passing on the `[lead:…]` and `[review:…]` markers it was given
 * (`[coordinator:plan-effort]` puts its lead on the large model at high
 * effort), and `[coordinator:start]` starts one at once, without a plan;
 * `[lead:finish]` finishes the step, and so does being told to carry on with
 * it after; `[review:pass]` and `[review:findings]`
 * report a review. Settling findings, it writes a file and commits it, so
 * the change changes, and finishes; a later review round passes. The session remembers its
 * markers: `[review:always]` finds something every round, and
 * `[lead:set-aside]` settles without changing anything. `[lead:wait]` works
 * until it is stopped, and so does `[review:wait]` reviewing, or `[review:wait-later]` from its second round;
 * `[lead:settle-quietly]` settles without reporting. `[lead:slowly]` takes some
 * seconds over what it was asked before it plays its part.
 * `[lead:edit]` commits a change when it finishes, as a lead is asked to;
 * `[lead:scratch]` leaves a scratch file lying about too, and deletes it when
 * Althar says it isn't committed; `[lead:evidence]` saves a screenshot in
 * the worktree, uncommitted, and finishes with it, a test run and something
 * it couldn't try, and settling, a new run and nothing left untried;
 * `[review:evidence]` reads each evidence file its brief names, and says so
 * in its summary. Asked for its pull request's description
 * in the repository's template, it fills it in, ticking a box it shouldn't.
 * Told what people said on its pull
 * request, `[lead:answer]`
 * replies there; told its checks failed, `[lead:fix]` commits a fix and
 * publishes it, `[lead:fix-more]` commits other work after it, and
 * `[lead:fix-hold]` works on after it until it is interrupted. Asked to "push pls" once its pull request is open,
 * `[lead:push]` commits what it has and asks the person to push it. Asked to bring its branch up to date, `[lead:resolve]`
 * merges what it was told to, keeps both sides of each conflict and commits
 * the merge; `[lead:resolve-more]` does too, then commits other work on top
 * of it; `[lead:resolve-fails]` can't, and says so; `[lead:resolve-wait]`
 * works at it until it is interrupted or stopped, and `[lead:resolve-hold]`
 * does so once it has committed the merge. Asked to plan a
 * change with a link in it, the coordinator drafts the task from that issue.
 */
/** Writes a line to a file in the worktree and commits it, as a lead commits as it goes. */
const commitIn = (cwd: string, file: string, message: string) => {
  appendFileSync(join(cwd, file), `${file.replace(/\.txt$/, '')}\n`)
  const git = (...args: Array<string>) =>
    execFileSync('git', ['-c', 'user.name=Fake', '-c', 'user.email=fake@althar.test', ...args], { cwd })
  git('add', '-A')
  git('commit', '-q', '-m', message)
}

/** Merges a branch into the worktree's, keeping both sides of each conflict, and commits the merge. */
const resolveIn = (cwd: string, ref: string) => {
  const git = (...args: Array<string>) =>
    execFileSync('git', ['-c', 'user.name=Fake', '-c', 'user.email=fake@althar.test', ...args], { cwd, stdio: 'pipe' }).toString()
  try {
    git('merge', '-q', '--no-edit', ref)
  } catch {
    for (const file of git('diff', '--name-only', '--diff-filter=U')
      .split('\n')
      .filter((line) => line !== '')) {
      const lines = readFileSync(join(cwd, file), 'utf8').split('\n')
      writeFileSync(join(cwd, file), lines.filter((line) => !/^(<<<<<<<|=======|>>>>>>>)( |$)/.test(line)).join('\n'))
    }
    git('add', '-A')
    git('commit', '-q', '--no-edit')
  }
}

const playRole = async (session: SessionState, text: string, serve: (exits: boolean) => Promise<void>): Promise<string | undefined> => {
  for (const marker of text.match(/\[(coordinator|lead|review):[a-z-]+\]/g) ?? []) session.markers.add(marker)
  const asked = session.markers.size > 0 || text.includes('Settle each') || text.startsWith('Round ') || text.startsWith('More to review')
  if (session.tools === undefined || !asked) return undefined
  const client = new Client({ name: 'fake-agent', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(session.tools.url), { requestInit: { headers: session.tools.headers } })
  // The SDK's transport types its optional fields loosely, which strict optional types reject.
  await client.connect(transport as Parameters<typeof client.connect>[0])
  try {
    const available = new Set((await client.listTools()).tools.map((tool) => tool.name))
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args })
      const content = Array.isArray(result.content) ? result.content : []
      return content.map((part) => (typeof part === 'object' && part !== null && 'text' in part ? String(part.text) : '')).join('')
    }
    if (available.has('report_review')) {
      // Reviews until it is stopped: for a review cut short in the middle; or, `[review:wait-later]`, a later round.
      if (session.markers.has('[review:wait]') || (session.markers.has('[review:wait-later]') && text.startsWith('Round '))) {
        for (let waited = 0; !session.cancelled && waited < 5_000; waited += 10) await pause(10)
        return 'Stopped reviewing.'
      }
      if (session.markers.has('[review:always]'))
        return await call('report_review', {
          verdict: 'changes_requested',
          summary: 'Still not right.',
          findings: [
            { severity: 'minor', claim: 'Name it better.' },
            { severity: 'nit', file: 'README.md', claim: 'A typo.' },
          ],
        })
      // Asked to look at the lead's evidence, it reads each file its brief names, and says what it found.
      const looked = session.markers.has('[review:evidence]')
        ? ` Read: ${[...text.matchAll(/^- [^\n]*: (\/[^\n]+)$/gm)]
            .map(([, path = '']) => `${path.split('/').at(-1) ?? ''} (${statSync(path).size} bytes)`)
            .join(', ')}.`
        : ''
      if (text.includes('[review:findings]') && !text.startsWith('Round '))
        return await call('report_review', {
          verdict: 'changes_requested',
          summary: `The heading needs fixing.${looked}`,
          findings: [{ severity: 'major', file: 'README.md', line: 1, claim: 'The heading is wrong.' }],
        })
      // A round of work after the plan is reviewed for what changed since, as a later round is.
      if (text.includes('[review:') || text.startsWith('Round ') || text.startsWith('More to review'))
        return await call('report_review', { verdict: 'pass', summary: `The change holds.${looked}` })
      return undefined
    }
    if (available.has('finish_step')) {
      // A lead that takes a while over what it was asked, `[lead:slowly]`: long enough to be seen at work.
      if (text.includes('[lead:slowly]')) for (let waited = 0; !session.cancelled && waited < 6_000; waited += 10) await pause(10)
      // A lead that leaves a dev server running, once, then carries on as its other markers say.
      if (text.includes('[lead:serve') && !session.played.has('[lead:serve]')) {
        session.played.add('[lead:serve]')
        await serve(text.includes('[lead:serve-exits]'))
      }
      if (text.includes('Settle each')) {
        if (session.markers.has('[lead:settle-quietly]')) return 'Settled, without saying so.'
        const aside = session.markers.has('[lead:set-aside]')
        if (!aside) commitIn(session.cwd, 'settled.txt', 'Settle the review')
        // What became of each finding, by the ids Althar gave them.
        const findings = (text.match(/find_[0-9a-f]{32}/g) ?? []).map((id) =>
          aside ? { id, outcome: 'set_aside', reason: 'It reads as intended.' } : { id, outcome: 'fixed' },
        )
        // Showing its work, it hands a new run, not its screenshot again, and has now tried what it couldn't.
        const shown = session.markers.has('[lead:evidence]')
          ? {
              evidence: [
                { kind: 'test_run', caption: 'The heading test', command: 'bun test heading', exit_code: 0, output: '1 passed\n' },
              ],
              unverified: [],
            }
          : {}
        return await call('finish_step', { summary: 'Fixed the heading.', findings, ...shown })
      }
      // Told to carry on, as a lead that took a step over is, it finishes as it was told to at first.
      // Told to carry on, or to try another way, as Althar tells one that stalled or went round in circles.
      const toldToGoOn = /^(Carry on with the task|Your last turn|You ran )/.test(text)
      // Asked for its pull request's description in the repository's template, it writes under the first heading, and ticks a box it shouldn't.
      // Asked to show its work, it saves a screenshot in its worktree, uncommitted, and hands it with a test run and what it couldn't try.
      const evidence = (): Record<string, unknown> => {
        if (!session.markers.has('[lead:evidence]')) return {}
        mkdirSync(join(session.cwd, 'evidence'), { recursive: true })
        writeFileSync(join(session.cwd, 'evidence', 'retry.png'), Buffer.from(SCREENSHOT_PNG, 'base64'))
        return {
          evidence: [
            { kind: 'screenshot', caption: 'The retry button after a failed checkout', path: 'evidence/retry.png' },
            {
              kind: 'test_run',
              caption: 'The checkout tests',
              command: 'bun test checkout',
              exit_code: 0,
              output: 'checkout.test.ts\n  ✓ retries once\n\n1 passed\n',
            },
          ],
          unverified: ['Not tried against the real payment provider: no sandbox account'],
        }
      }
      const finish = async () => {
        const answer = await call('finish_step', { summary: 'Did the task.', ...evidence() })
        const template = /~~~~~markdown\n([\s\S]*?)\n~~~~~/.exec(answer)?.[1]
        if (template === undefined) return answer
        const text = template.replace(/^(#+ .*)$/m, '$1\n\nDid the task, in the template.').replace('[ ]', '[x]')
        return await call('finish_step', { summary: 'Did the task.', descriptions: [{ text }] })
      }
      // Asked to resolve a conflict, as a fresh session is with its brief after a restart, it does that rather than finish.
      const resolving = /Bring the branch up to date: merge \S+ into it/.test(text)
      if (!resolving && (text.includes('[lead:finish]') || (toldToGoOn && session.markers.has('[lead:finish]')))) {
        if (session.markers.has('[lead:edit]')) commitIn(session.cwd, 'change.txt', 'Change it')
        if (!session.markers.has('[lead:scratch]')) return await finish()
        appendFileSync(join(session.cwd, 'scratch.log'), 'trying things\n')
        const answer = await call('finish_step', { summary: 'Did the task.' })
        if (!/These aren.t committed/.test(answer)) return answer
        rmSync(join(session.cwd, 'scratch.log'))
        return await finish()
      }
      // Asked to push, it commits and asks the person to, as a lead does: it never pushes itself.
      if (available.has('push_to_pull_request') && session.markers.has('[lead:push]') && /\bpush pls\b/i.test(text)) {
        commitIn(session.cwd, 'pushed.txt', 'Tidy up before pushing')
        return await call('push_to_pull_request', {})
      }
      // What people said on the task's pull request, and its checks.
      if (available.has('reply_on_pull_request') && session.markers.has('[lead:answer]') && / commented on /.test(text)) {
        const thread = /\(thread (\S+)\)/.exec(text)?.[1]
        return await call('reply_on_pull_request', {
          body: 'Seconds, the same as charges.',
          ...(thread === undefined ? {} : { thread_id: thread }),
        })
      }
      // Asked to resolve a conflict with the branch its own goes into: merged and settled, or not.
      const merging = /Bring the branch up to date: merge (\S+) into it/.exec(text)?.[1]
      if (merging !== undefined && session.markers.has('[lead:resolve-fails]'))
        return "Couldn't settle the conflict: both sides change the same lines."
      if (merging !== undefined && session.markers.has('[lead:resolve-wait]')) {
        for (let waited = 0; !session.cancelled && waited < 5_000; waited += 10) await pause(10)
        return 'Stopped before settling it.'
      }
      const more = session.markers.has('[lead:resolve-more]')
      const hold = session.markers.has('[lead:resolve-hold]')
      if (merging !== undefined && (session.markers.has('[lead:resolve]') || more || hold)) {
        resolveIn(session.cwd, merging)
        if (hold) for (let waited = 0; !session.cancelled && waited < 5_000; waited += 10) await pause(10)
        if (!more) return 'Merged it, settled the conflict, and committed the merge.'
        commitIn(session.cwd, 'more.txt', 'Tidy up while here')
        return 'Merged it, settled the conflict, committed the merge, and tidied up while here.'
      }
      // Fixed and committed, for the person to push.
      const fixMore = session.markers.has('[lead:fix-more]')
      const fixHold = session.markers.has('[lead:fix-hold]')
      if ((session.markers.has('[lead:fix]') || fixMore || fixHold) && text.startsWith('Checks failed')) {
        commitIn(session.cwd, 'fixed.txt', 'Fix the failing check')
        if (fixHold) for (let waited = 0; !session.cancelled && waited < 5_000; waited += 10) await pause(10)
        if (!fixMore) return 'Fixed the failing check, and committed it.'
        commitIn(session.cwd, 'more.txt', 'Tidy up while here')
        return 'Fixed the failing check, committed it, and tidied up while here.'
      }
      // Works until it is stopped: for a lead that goes in the middle of its step.
      if (text.includes('[lead:wait]')) {
        for (let waited = 0; !session.cancelled && waited < 5_000; waited += 10) await pause(10)
        return 'Stopped working.'
      }
      return undefined
    }
    // Asked for something small, it starts it at once, passing its lead the markers it was given.
    if (available.has('start_task') && text.includes('[coordinator:start]')) {
      const markers = text.match(/\[(lead|review):[a-z-]+\]/g) ?? []
      const asked = (text.slice(0, text.indexOf('[coordinator:start]')).split('\n').at(-1) ?? '').replace(/^\[\w+\]\s*/, '')
      const title = asked.split(/[.!?]/)[0]?.trim() || 'Try it'
      return await call('start_task', {
        title,
        description: `Try it and say how it went. ${markers.join(' ')}`,
        lead: { agent: 'claude-code', reason: 'Quick to start.' },
      })
    }
    if (available.has('draft_task') && text.includes('[coordinator:plan')) {
      const markers = text.match(/\[(lead|review):[a-z-]+\]/g) ?? []
      // The task is what the person asked for: the line with the marker, up to its first stop.
      // As the thread so far quotes it, after who said it: "[person] Add a retry."
      const asked = (text.slice(0, text.indexOf('[coordinator:plan')).split('\n').at(-1) ?? '').replace(/^\[\w+\]\s*/, '')
      const title =
        asked
          .replace(/https?:\/\/\S+/g, '')
          .split(/[.!?]/)[0]
          ?.trim() || 'Add a retry'
      const link = /https?:\/\/\S+/.exec(asked)?.[0]
      const draft = {
        title,
        description: `Retry the checkout call. ${markers.join(' ')}`,
        ...(link === undefined ? {} : { issue: link }),
      }
      // In a project of several repositories, asked which it changes, it names every one it is told of.
      const first = await call('draft_task', draft)
      const which = /as repositories: (.+)\.$/.exec(first)?.[1]
      const drafted = which === undefined ? first : await call('draft_task', { ...draft, repositories: which.split(', ') })
      const slug = /Drafted ([^\s,.]+)/.exec(drafted)?.[1] ?? ''
      return await call('propose_plan', {
        task: slug,
        lead: {
          agent: 'claude-code',
          // `[coordinator:plan-effort]`: on its large model, thinking hard.
          ...(text.includes('[coordinator:plan-effort]') ? { model: 'large', effort: 'high' } : {}),
          reason: 'It knows the code.',
        },
        review: text.includes('[coordinator:plan-no-review]') ? null : { agent: 'codex' },
      })
    }
    return undefined
  } finally {
    await client.close()
  }
}

const MODES = ['ask', 'read-only', 'bypass']
const MODELS = ['small', 'large']
/** How hard the fake thinks, as agents offer it: a select in the `thought_level` category. */
const EFFORTS = ['low', 'medium', 'high']
/** Each model's variants, as OpenCode offers them: its own levels, then `default`. */
const VARIANTS: Readonly<Record<string, ReadonlyArray<string>>> = {
  small: [],
  large: ['low', 'high', 'default'],
  huge: ['high', 'max', 'default'],
}

const modeOption = (session: SessionState): acp.SessionConfigOption => ({
  id: 'mode',
  name: 'Mode',
  category: 'mode',
  type: 'select',
  currentValue: session.mode,
  options: MODES.map((value) => ({ value, name: value })),
})

const modelOption = (session: SessionState, variants: boolean): acp.SessionConfigOption => ({
  id: 'model',
  name: 'Model',
  category: 'model',
  type: 'select',
  currentValue: session.model,
  options: [
    {
      group: 'all',
      name: 'All',
      options: [
        { value: 'small', name: 'Small', description: 'Quick, for small things' },
        { value: 'large', name: 'Large', description: 'The most capable' },
        ...(variants ? [{ value: 'huge', name: 'Huge', description: 'Thinks the longest' }] : []),
      ],
    },
  ],
})

const effortOption = (session: SessionState, levels: ReadonlyArray<string>): acp.SessionConfigOption => ({
  id: 'effort',
  name: 'Effort',
  category: 'thought_level',
  type: 'select',
  currentValue: session.effort,
  options: levels.map((value) => ({ value, name: value.charAt(0).toUpperCase() + value.slice(1) })),
})

const permissionOptions = (alwaysOnly: boolean): Array<acp.PermissionOption> =>
  alwaysOnly
    ? [
        { optionId: 'allow-always', name: 'Always allow', kind: 'allow_always' },
        { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
      ]
    : [
        { optionId: 'allow-once', name: 'Allow', kind: 'allow_once' },
        { optionId: 'allow-always', name: 'Always allow', kind: 'allow_always' },
        { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
        { optionId: 'reject-always', name: 'Always reject', kind: 'reject_always' },
      ]

const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

export const fakeAgent = (options: FakeAgentOptions = {}): InProcessAgent => ({ _tag: 'InProcessAgent', app: fakeAgentApp(options) })

export const fakeAgentApp = (options: FakeAgentOptions = {}): acp.AgentApp => {
  const modes = options.modes ?? 'config'
  const variants = options.variants === true
  /** The effort levels of the model a session is on. */
  const levelsOf = (model: string) => (variants ? (VARIANTS[model] ?? []) : EFFORTS)
  const configOptions = (session: SessionState): Array<acp.SessionConfigOption> => {
    const levels = levelsOf(session.model)
    const effort = levels.length === 0 ? [] : [effortOption(session, levels)]
    return modes === 'config' || modes === 'stuck'
      ? [modeOption(session), modelOption(session, variants), ...effort]
      : [modelOption(session, variants), ...effort]
  }
  const sessions = new Map<string, SessionState>()
  const failedOnce = new Set<string>()
  let created = 0
  const sessionOf = (sessionId: string): SessionState => {
    const session = sessions.get(sessionId)
    if (session === undefined) throw acp.RequestError.invalidParams({ sessionId }, 'Unknown session')
    return session
  }

  return acp
    .agent({ name: 'fake-agent' })
    .onRequest(acp.methods.agent.initialize, ({ params }) => {
      options.initialized?.(params.clientCapabilities ?? undefined)
      return options.bare === true
        ? { protocolVersion: acp.PROTOCOL_VERSION }
        : {
            protocolVersion: acp.PROTOCOL_VERSION,
            agentCapabilities: {
              loadSession: false,
              mcpCapabilities: { http: true, sse: false },
              sessionCapabilities: { close: {} },
              promptCapabilities: { image: options.images !== false },
            },
            authMethods: [],
            agentInfo: { name: 'fake-agent', version: '0.0.0' },
            _meta: { steering: { supported: true } },
          }
    })
    .onRequest(acp.methods.agent.session.new, async ({ params }) => {
      if (options.slowStart !== undefined) await pause(options.slowStart)
      created += 1
      const sessionId = `fake-${created}`
      const session: SessionState = {
        mode: 'bypass',
        model: 'small',
        effort: variants ? '' : 'medium',
        cancelled: false,
        stubborn: false,
        abort: undefined,
        directories: params.additionalDirectories?.length ?? 0,
        mcpServers: params.mcpServers.length,
        meta: params._meta ?? undefined,
        cwd: params.cwd,
        tools: (() => {
          const server = params.mcpServers.find((candidate) => 'type' in candidate && candidate.type === 'http')
          return server === undefined || !('url' in server)
            ? undefined
            : { url: server.url, headers: Object.fromEntries(server.headers.map((header) => [header.name, header.value])) }
        })(),
        markers: new Set(),
        played: new Set(),
        coordinator: false,
        runs: 0,
        background: new Map(),
        served: 0,
      }
      sessions.set(sessionId, session)
      return {
        sessionId,
        configOptions: configOptions(session),
        ...(modes === 'legacy' ? { modes: { currentModeId: session.mode, availableModes: MODES.map((id) => ({ id, name: id })) } } : {}),
      }
    })
    .onRequest(acp.methods.agent.session.setMode, ({ params }) => {
      const session = sessionOf(params.sessionId)
      if (!MODES.includes(params.modeId)) throw acp.RequestError.invalidParams(params, `No mode ${params.modeId}`)
      session.mode = params.modeId
      return {}
    })
    .onRequest(acp.methods.agent.session.setConfigOption, ({ params }) => {
      const session = sessionOf(params.sessionId)
      const value = String(params.value)
      if (params.configId === 'mode' && MODES.includes(value)) session.mode = modes === 'stuck' ? session.mode : value
      else if (params.configId === 'model' && options.failsOnce?.includes(value) && !failedOnce.has(value)) {
        failedOnce.add(value)
        throw acp.RequestError.internalError({ details: `Couldn't confirm model "${value}" with the API. Try again.` })
      } else if (params.configId === 'model' && options.staysOn?.includes(value)) {
        // Said yes to, and stays where it was.
      } else if (params.configId === 'model' && (MODELS.includes(value) || (variants && value in VARIANTS))) {
        // OpenCode's way: another model's first variant, or none.
        if (variants && value !== session.model) session.effort = levelsOf(value)[0] ?? ''
        session.model = value
      } else if (params.configId === 'effort' && levelsOf(session.model).includes(value)) session.effort = value
      else throw acp.RequestError.invalidParams(params, `No option ${params.configId}=${value}`)
      return { configOptions: configOptions(session) }
    })
    .onRequest(acp.methods.agent.session.close, ({ params }) => {
      sessions.delete(params.sessionId)
      options.closed?.(params.sessionId)
      return {}
    })
    .onRequest(
      stopBackgroundMethod,
      { parse: (params) => params as { readonly sessionId: string; readonly asyncTaskId: string } },
      async ({ params, client }): Promise<StopBackgroundResponse> => {
        // Stopping what a session left running, as the adapters do: it ends, and says so.
        const session = sessions.get(params.sessionId)
        const left = session?.background.get(params.asyncTaskId)
        if (session === undefined || left === undefined) return { stopped: false }
        session.background.delete(params.asyncTaskId)
        options.stoppedBackground?.(params.asyncTaskId)
        await client.notify(acp.methods.client.session.update, {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: 'async_task_state_update',
            asyncTaskId: params.asyncTaskId,
            state: 'stopped',
          } as unknown as acp.SessionUpdate,
        })
        return { stopped: true }
      },
    )
    .onNotification(acp.methods.agent.session.cancel, ({ params }) => {
      const session = sessionOf(params.sessionId)
      session.cancelled = true
      if (options.keepsRequests !== true) session.abort?.abort()
    })
    .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
      const session = sessionOf(params.sessionId)
      session.cancelled = false
      const prompted = params.prompt.map((block) => (block.type === 'text' ? block.text : '')).join('')
      // A prompt that ends `[context:85]` says its context is that full, in percent, before anything else; the rest plays as it
      // would. `[context-later:85]` says so a moment after, once its turn has ended, as an agent may; `[context:85/4000]`, of a
      // context that holds 4,000 tokens rather than CONTEXT_SIZE.
      const filled = /\s*\[context(-later)?:(\d+)(?:\/(\d+))?\]$/.exec(prompted)
      const text = filled === null ? prompted : prompted.slice(0, filled.index)
      const out = options.outOfUsage
      if (out !== undefined && (out.until === undefined || Date.now() < out.until))
        throw new acp.RequestError(
          -32603,
          out.until === undefined ? 'Claude AI usage limit reached' : `Claude AI usage limit reached|${Math.ceil(out.until / 1000)}`,
        )
      const update = (value: acp.SessionUpdate) =>
        client.notify(acp.methods.client.session.update, { sessionId: params.sessionId, update: value })
      const say = (said: string) => update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: said } })
      const ended = (usage?: acp.Usage): acp.PromptResponse => ({ stopReason: 'end_turn', ...(usage === undefined ? {} : { usage }) })
      if (filled !== null) {
        const size = filled[3] === undefined ? CONTEXT_SIZE : Number(filled[3])
        const usage = { sessionUpdate: 'usage_update' as const, used: Math.round((size * Number(filled[2])) / 100), size }
        if (filled[1] === undefined) await update(usage)
        else setTimeout(() => void update(usage), 300)
      }

      // What images it was sent, in order, by what they are and how many bytes: said before anything else it does.
      const images = params.prompt.flatMap((block) => (block.type === 'image' ? [block] : []))
      if (images.length > 0)
        await say(`saw images: ${images.map((image) => `${image.mimeType} ${Buffer.from(image.data, 'base64').length} B`).join(', ')}\n\n`)

      /** Asks permission; cancelling the turn withdraws the request. */
      const ask = async (toolCall: acp.ToolCallUpdate, offered: Array<acp.PermissionOption>) => {
        session.abort = new AbortController()
        const answer = await client
          .request<acp.RequestPermissionResponse, acp.RequestPermissionRequest>(
            acp.methods.client.session.requestPermission,
            { sessionId: params.sessionId, toolCall, options: offered },
            { cancellationSignal: session.abort.signal },
          )
          .catch(() => undefined)
        session.abort = undefined
        if (answer === undefined) return 'withdrawn'
        return answer.outcome.outcome === 'selected' ? answer.outcome.optionId : 'cancelled'
      }

      /**
       * Asks the person: one plain question, as an MCP server's form asks it; or, as Claude Code asks,
       * one or two in a form, each option with what it means. Cancelling the turn withdraws it.
       */
      const askPerson = async (form: 'plain' | 'one' | 'two'): Promise<string> => {
        const database = {
          type: 'string',
          title: 'Database',
          description: 'Which database should the cache use?',
          oneOf: [
            {
              const: 'Postgres',
              title: 'Postgres',
              description: 'What production already runs: the cache is one more table, backed up with the rest.',
            },
            {
              const: 'SQLite',
              title: 'SQLite',
              description: 'One file beside the service, with no server to run, but nothing shared between instances.',
            },
          ],
        }
        const checks = {
          type: 'array',
          title: 'Checks',
          description: 'Which checks should run before it lands?',
          items: {
            anyOf: [
              { const: 'Unit tests', title: 'Unit tests', description: 'Fast, and already run on every push.' },
              { const: 'Lint', title: 'Lint', description: 'Catches what the type checker doesn’t, in seconds.' },
              { const: 'End-to-end', title: 'End-to-end', description: 'Drives the app as a person would; takes a few minutes.' },
            ],
          },
        }
        const request: acp.CreateElicitationRequest =
          form === 'plain'
            ? {
                sessionId: params.sessionId,
                mode: 'form',
                message: 'Which database?',
                requestedSchema: {
                  type: 'object',
                  properties: { database: { type: 'string', enum: ['postgres', 'sqlite'] } },
                  required: ['database'],
                },
              }
            : {
                sessionId: params.sessionId,
                toolCallId: 'ask-1',
                mode: 'form',
                message: form === 'one' ? database.description : 'Please answer the following questions.',
                requestedSchema: {
                  type: 'object',
                  properties: {
                    question_0: database,
                    question_0_custom: { type: 'string', title: 'Other' },
                    ...(form === 'two' ? { question_1: checks, question_1_custom: { type: 'string', title: 'Other' } } : {}),
                  },
                } as acp.ElicitationSchema,
              }
        if (form !== 'plain') {
          // What it says before asking: why, the way Claude Code does before AskUserQuestion.
          await say(WHY)
          await update({
            sessionUpdate: 'tool_call',
            toolCallId: 'ask-1',
            title: 'Asking for your input',
            kind: 'other',
            status: 'pending',
            rawInput: {},
          })
        }
        const answer = await client
          .request<acp.CreateElicitationResponse, acp.CreateElicitationRequest>(acp.methods.client.elicitation.create, request, {
            cancellationSignal: (session.abort = new AbortController()).signal,
          })
          .catch((): acp.CreateElicitationResponse => ({ action: 'cancel' }))
        session.abort = undefined
        return answer.action === 'accept'
          ? `answer=${JSON.stringify((answer as { readonly content?: unknown }).content)}`
          : `answer=${answer.action}`
      }

      if (text.startsWith('You are the project coordinator, judging one permission request')) {
        const reply =
          options.judgment === undefined
            ? '{"decision":"allow","reason":"This action is needed for the task."}'
            : await options.judgment({
                prompt: text,
                mode: session.mode,
                model: session.model,
                effort: session.effort,
                mcpServers: session.mcpServers,
                meta: session.meta,
                askToWrite: () =>
                  ask(
                    { toolCallId: 'judge-write', title: 'Write a file', kind: 'edit', rawInput: { path: '/tmp/judge-write.txt' } },
                    commandOptions,
                  ),
              })
        await update({ sessionUpdate: 'usage_update', used: 100, size: 10000, cost: { amount: 0.002, currency: 'USD' } })
        await say(reply)
        return ended({ inputTokens: 100, outputTokens: 20, totalTokens: 120 })
      }

      // An answer to a question asked before, told in a later turn, as after a restart: said, then the role played on.
      const told = /The person answered[^\n]*\n([\s\S]*)$/.exec(text)
      if (told?.[1] !== undefined) {
        await say(`told=${told[1].trim().split('\n').join(' | ')}`)
        const after = await playRole(session, text, (exits) => leaveRunning(params.sessionId, session, client, 'claude', { exits }))
        if (after !== undefined) await say(after)
        return ended()
      }
      // A lead that asks the person first, `[lead:ask]`, once: then it plays its part with the answer. The coordinator that plans it only passes the marker on.
      if (text.includes('You are the coordinator of the project')) session.coordinator = true
      if (text.includes('[lead:ask]') && !session.played.has('[lead:ask]') && !session.coordinator) {
        session.played.add('[lead:ask]')
        await say(await askPerson('one'))
        if (session.cancelled) return { stopReason: 'cancelled' }
      }

      // A lead that stalls or loops, where a marker says so.
      const stalled = await playStall(session, text, update)
      if (stalled !== undefined) return stalled
      // With Althar's tools, a marker in the prompt says which role to play.
      const played = await playRole(session, text, (exits) => leaveRunning(params.sessionId, session, client, 'claude', { exits }))
      // Stopped while it played its part, the turn was cancelled, as an agent says.
      if (played !== undefined && session.cancelled) return { stopReason: 'cancelled' }
      if (played !== undefined) {
        await say(played)
        return ended()
      }

      const resumed = /not allowed by (the project's rules|the coordinator)/.test(text)
      if (resumed && !session.stubborn) {
        await say('carrying on without it')
        return ended()
      }
      if (text === scenarios.stubborn) session.stubborn = true
      const scenario = resumed ? scenarios.stubborn : text.startsWith(scenarios.run) ? scenarios.commandChoices : text

      switch (scenario) {
        case scenarios.commandChoices:
        case scenarios.deniedThenWait:
        case scenarios.fileEdit:
        case scenarios.stubborn: {
          const command = scenario === scenarios.commandChoices || scenario === scenarios.deniedThenWait
          const run = text.startsWith(scenarios.run)
          const line = run ? text.slice(scenarios.run.length) : 'make deploy'
          // Each command it is told to run is a tool call of its own, so a thread can hold several.
          if (run) session.runs += 1
          const toolCall = {
            toolCallId: run ? `run-${session.runs}` : 'call-2',
            title: command ? `Run ${line}` : 'Edit app.ts',
            kind: command ? ('execute' as const) : ('edit' as const),
            // As agents do, the command itself, which the title only describes.
            ...(command ? { rawInput: { command: line } } : {}),
          }
          await update({ sessionUpdate: 'tool_call', ...toolCall, status: 'pending' })
          const chosen = await ask(toolCall, command ? commandOptions : fileEditOptions)
          await update({
            sessionUpdate: 'tool_call_update',
            toolCallId: toolCall.toolCallId,
            status: chosen.startsWith('allow') ? 'completed' : 'failed',
          })
          await say(`chosen=${chosen}`)
          if (scenario === scenarios.deniedThenWait) while (!session.cancelled) await pause(10)
          return session.cancelled || chosen === 'cancel' || chosen === 'cancelled' ? { stopReason: 'cancelled' } : ended()
        }
        case scenarios.question:
        case scenarios.questions: {
          await say(await askPerson(scenario === scenarios.questions ? 'two' : 'plain'))
          return session.cancelled ? { stopReason: 'cancelled' } : ended()
        }
        case scenarios.quota:
          await update({
            sessionUpdate: 'session_info_update',
            _meta: failureMeta({
              category: 'limit',
              severity: 'error',
              title: 'The Claude account has no available quota. Resets at 2026-09-29T05:00:00Z',
              actions: [],
            }),
          })
          await say(USAGE_LIMIT_MESSAGE)
          return ended()
        case scenarios.contextFull:
          await update({
            sessionUpdate: 'session_info_update',
            _meta: failureMeta({
              category: 'limit',
              severity: 'error',
              title: 'This Claude turn reached its configured limit.',
              actions: ['new_session'],
            }),
          })
          return { stopReason: 'max_tokens' }
        case scenarios.rateWarning:
          await update({
            sessionUpdate: 'session_info_update',
            _meta: failureMeta({
              category: 'limit',
              severity: 'warning',
              title: 'Claude is temporarily rate limited.',
              actions: ['retry'],
            }),
          })
          await say('Done after a retry')
          return ended()
        case scenarios.leaveMode:
          session.mode = 'ask'
          await update({ sessionUpdate: 'config_option_update', configOptions: configOptions(session) })
          await say('Left plan mode')
          return ended()
        case scenarios.background:
        case scenarios.backgroundCodex:
          await leaveRunning(params.sessionId, session, client, scenario === scenarios.background ? 'claude' : 'codex')
          await say('serving')
          return ended()
        case scenarios.backgroundOwn: {
          const commands = ['npm run watch', 'npm test', 'npm run lint', 'npm run dev']
          for (const [index, name] of commands.entries())
            await update({
              sessionUpdate: 'async_task_spawned',
              asyncTaskId: `own-${index}`,
              name,
              taskType: 'shell',
              canStop: true,
            } as never)
          await update({
            sessionUpdate: 'tool_call_update',
            toolCallId: 'never-made',
            _meta: { terminal_output_delta: { data: 'ready\n' } },
          })
          await update({ sessionUpdate: 'async_task_progress', asyncTaskId: 'never-named', outputFilePath: '/tmp/none' } as never)
          await update({ sessionUpdate: 'async_task_state_update', asyncTaskId: 'own-1', state: 'completed' } as never)
          await update({ sessionUpdate: 'async_task_state_update', asyncTaskId: 'own-2', state: 'failed' } as never)
          await update({ sessionUpdate: 'async_task_state_update', asyncTaskId: 'own-3', state: 'stopped' } as never)
          await say('started')
          return ended()
        }
        case scenarios.afterTurn:
          await say('Done')
          setTimeout(() => void update({ sessionUpdate: 'available_commands_update', availableCommands: [] }), 20)
          return ended()
        case scenarios.wakesItself:
          await say('Done')
          setTimeout(() => void say('Verify ').then(() => say('finished.')), 20)
          return ended()
        case scenarios.hello:
          await say('Hel')
          await say('lo')
          return ended({ inputTokens: 3, outputTokens: 2, totalTokens: 5 })
        case scenarios.think:
          await update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Considering' } })
          await say('Done')
          return ended()
        case scenarios.tool:
        case scenarios.toolAlwaysOnly: {
          const toolCall =
            text === scenarios.tool
              ? {
                  toolCallId: 'call-1',
                  title: 'Write hello.txt',
                  kind: 'edit' as const,
                  rawInput: { path: 'hello.txt' },
                  locations: [{ path: 'hello.txt' }],
                }
              : { toolCallId: 'call-1', title: 'Write hello.txt' }
          await update({ sessionUpdate: 'tool_call', ...toolCall, status: 'pending' })
          const chosen = await ask(toolCall, permissionOptions(text === scenarios.toolAlwaysOnly))
          const allowed = chosen.startsWith('allow')
          await update({
            sessionUpdate: 'tool_call_update',
            toolCallId: 'call-1',
            status: allowed ? 'completed' : 'failed',
            rawOutput: { chosen },
          })
          await say(`chosen=${chosen}`)
          return ended()
        }
        case scenarios.bareAsk: {
          const described = {
            toolCallId: 'call-4',
            title: 'mcp.althar.draft_task',
            kind: 'execute' as const,
            rawInput: { title: 'Probe' },
          }
          await update({ sessionUpdate: 'tool_call', ...described, status: 'pending' })
          const chosen = await ask({ toolCallId: 'call-4' }, permissionOptions(false))
          await say(`chosen=${chosen}`)
          return ended()
        }
        case scenarios.updates:
          await update({ sessionUpdate: 'plan', entries: [{ content: 'Write the test', priority: 'high', status: 'in_progress' }] })
          await update({ sessionUpdate: 'usage_update', used: 1200, size: 200_000, cost: { amount: 0.02, currency: 'USD' } })
          await update({ sessionUpdate: 'notice', severity: 'warning', title: 'Context is filling up' })
          session.model = 'large'
          await update({ sessionUpdate: 'config_option_update', configOptions: configOptions(session) })
          await update({ sessionUpdate: 'current_mode_update', currentModeId: session.mode })
          await update({ sessionUpdate: 'available_commands_update', availableCommands: [] })
          return ended()
        case scenarios.slow:
          await say('Starting')
          for (let waited = 0; !session.cancelled && waited < 5_000; waited += 10) await pause(10)
          return { stopReason: session.cancelled ? 'cancelled' : 'end_turn' }
        case scenarios.usageLimit:
          throw new acp.RequestError(-32603, USAGE_LIMIT_MESSAGE)
        case scenarios.auth:
          throw acp.RequestError.authRequired()
        case scenarios.unknownUpdate:
          await client.notify(acp.methods.client.session.update, {
            sessionId: params.sessionId,
            update: { sessionUpdate: 'future_update', detail: 1 } as unknown as acp.SessionUpdate,
          })
          await say('after')
          return ended()
        case scenarios.settings:
          await say(`mode=${session.mode} model=${session.model} directories=${session.directories} mcp=${session.mcpServers}`)
          return ended()
        case scenarios.handsBack: {
          // Codex: a command's output in chunks as it runs, then its exit.
          await update({
            sessionUpdate: 'tool_call',
            toolCallId: 'run-chunks',
            title: 'npm test',
            kind: 'execute',
            status: 'in_progress',
            rawInput: { command: 'npm test' },
            content: [{ type: 'terminal', terminalId: 'run-chunks' }],
            _meta: { terminal_info: { terminal_id: 'run-chunks', cwd: session.cwd } },
          })
          for (const data of [' ✓ charges/limit (14)\n', ' ✓ refunds/router (38)\n', ' 52 passed\n']) {
            await pause(20)
            await update({
              sessionUpdate: 'tool_call_update',
              toolCallId: 'run-chunks',
              _meta: { terminal_output_delta: { terminal_id: 'run-chunks', data } },
            })
          }
          await update({
            sessionUpdate: 'tool_call_update',
            toolCallId: 'run-chunks',
            status: 'completed',
            _meta: { terminal_exit: { terminal_id: 'run-chunks', exit_code: 0, signal: null } },
          })
          // Claude Code: a failing command's output whole when it ends.
          await update({
            sessionUpdate: 'tool_call',
            toolCallId: 'run-whole',
            title: 'npm run lint',
            kind: 'execute',
            status: 'pending',
            rawInput: { command: 'npm run lint' },
          })
          await update({
            sessionUpdate: 'tool_call_update',
            toolCallId: 'run-whole',
            _meta: { terminal_output_delta: { terminal_id: 'run-whole', data: 'src/a.ts\n  3:1  error  Unexpected any\n✗ 1 problem\n' } },
          })
          await update({
            sessionUpdate: 'tool_call_update',
            toolCallId: 'run-whole',
            status: 'failed',
            _meta: { terminal_exit: { terminal_id: 'run-whole', exit_code: 1, signal: null } },
          })
          // OpenCode: the output so far as the tool's own words, whole each time.
          await update({
            sessionUpdate: 'tool_call',
            toolCallId: 'run-words',
            title: 'git status --short',
            kind: 'execute',
            status: 'pending',
            rawInput: { command: 'git status --short' },
          })
          for (const [status, text] of [
            ['in_progress', ' M src/a.ts\n'],
            ['completed', ' M src/a.ts\n?? docs/notes.md\n'],
          ] as const)
            await update({
              sessionUpdate: 'tool_call_update',
              toolCallId: 'run-words',
              status,
              content: [{ type: 'content', content: { type: 'text', text } }],
            })
          // A screenshot, from a browser tool.
          await update({
            sessionUpdate: 'tool_call',
            toolCallId: 'shot',
            title: 'mcp__playwright__browser_take_screenshot',
            kind: 'other',
            status: 'in_progress',
          })
          await update({
            sessionUpdate: 'tool_call_update',
            toolCallId: 'shot',
            status: 'completed',
            content: [
              { type: 'content', content: { type: 'text', text: 'Took a screenshot of the page.' } },
              { type: 'content', content: { type: 'image', data: SCREENSHOT_PNG, mimeType: 'image/png' } },
            ],
          })
          // A markdown document it writes in its folder.
          const document = join(session.cwd, HANDED_DOCUMENT.path)
          mkdirSync(join(session.cwd, 'docs'), { recursive: true })
          writeFileSync(document, HANDED_DOCUMENT.body)
          await update({
            sessionUpdate: 'tool_call',
            toolCallId: 'write-doc',
            title: `Write ${HANDED_DOCUMENT.path}`,
            kind: 'edit',
            status: 'completed',
            rawInput: { file_path: document, content: HANDED_DOCUMENT.body },
            locations: [{ path: document }],
            content: [{ type: 'diff', path: document, oldText: null, newText: HANDED_DOCUMENT.body }],
          })
          // A file it points at, and a picture, in what it says.
          writeFileSync(join(session.cwd, 'report.csv'), 'endpoint,budget\ncharges,600\nrefunds,shared\n')
          await say('Here is what I found. ')
          await update({
            sessionUpdate: 'agent_message_chunk',
            content: {
              type: 'resource_link',
              uri: `file://${join(session.cwd, 'report.csv')}`,
              name: 'report.csv',
              mimeType: 'text/csv',
              size: 43,
            },
          })
          await update({ sessionUpdate: 'agent_message_chunk', content: { type: 'image', data: SCREENSHOT_PNG, mimeType: 'image/png' } })
          await say('\n\n| Endpoint | Budget |\n| --- | --: |\n| charges | 600 |\n| refunds | shared |\n')
          return ended()
        }
        case scenarios.streams: {
          await update({
            sessionUpdate: 'tool_call',
            toolCallId: 'run-long',
            title: 'npm run dev',
            kind: 'execute',
            status: 'in_progress',
            rawInput: { command: 'npm run dev' },
          })
          for (let line = 1; !session.cancelled && line < 500; line += 1) {
            await update({
              sessionUpdate: 'tool_call_update',
              toolCallId: 'run-long',
              _meta: { terminal_output_delta: { terminal_id: 'run-long', data: `ready in ${line} ms\n` } },
            })
            await pause(25)
          }
          return { stopReason: session.cancelled ? 'cancelled' : 'end_turn' }
        }
        case scenarios.exit:
          await say('Exiting')
          options.exit?.()
          throw acp.RequestError.internalError(undefined, 'This agent can only exit as a process')
        default:
          await say(`echo: ${text}`)
          return ended()
      }
    })
}
