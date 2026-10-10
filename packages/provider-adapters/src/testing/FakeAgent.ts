import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import * as acp from '@agentclientprotocol/sdk'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import type { InProcessAgent } from '../AgentConnection'

/*
 * A scripted ACP agent for tests, so the adapter's contract runs in CI without
 * signing in to anything. It speaks real ACP through the same SDK the agents
 * use. The prompt's text picks a scenario. It starts every session in a bypass
 * mode, so tests show the adapter always moves a session out of it.
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
  /** A file edit, with Codex's options: the only rejection stops the turn. */
  fileEdit: 'file-edit',
  /** Like `fileEdit`, but it asks again every time the turn is resumed. */
  stubborn: 'stubborn',
  /** Asks the person a question and repeats the answer. */
  question: 'question',
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
} as const

/** A 480 × 300 PNG of a page, as a screenshot tool hands it back. */
export const SCREENSHOT_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAeAAAAEsCAIAAACUnPcNAAAEeElEQVR42u3cIQ4CQRBEUS7Xbu6vUAQHCgFBLRs0jiGpod/POwFkS23vYZMkRXbwE0iSgZYkGWhJMtCSJAMtSQZakmSgJUkGWpIMtCTJQEuSgZYkGWhJkoGWJAMtSTLQkmSgJUkGWpIMtCTJQEuSDLQkGWhJkoGWJAMtSTLQkiQDLUkGWpJkoCXpzwb6cb8BEMhAAxhoAAw0gIEGwEADGGgADDQABhrAQANgoAEMNAAGGgADDWCgATDQAAYaAAMNYKABMNAAGGgAAw2AgQYw0AAYaAAMNICBBsBAAxjoz86nIwC7xIHeJKl9BlqSDLSBliQDLUkG2kBLkoGWJANtoCXJQBtoSTLQkmSgDbQkNR3oqsFyPGmSgcZASwbaQGOgJQNtoA20ZKANNAZaMtDe4pAkAy1JBtpAS5KBliQDbaAlyUAbaEky0JJkoA20JBloSTLQBlqSDLQkGei4gQYgcaABmMtAAxhoAAw0gIEGwEADGGgADDQADlUA2h6qOPWWJN/ikCQDbaAlyUBLkoE20JJkoCXJQBtoSTLQBlqSDLQkGWgDLUl9B7pqsBxPmmSgMdCSgTbQGGjJQBtoAy0ZaAONgZYMtLc4JMlAS5KBNtCSZKAlyUAbaEky0AZakgy0JBloAy1JBlqSDLSBliQDLUkGOm6gAUgcaADmMtAABhoAAw1goAEw0AAGGgADDYBDFYC2hypOvSXJtzgkyUAbaEky0JJkoA20JBloSTLQBlqSDLSBliQDLUkG2kBLUt+Brhosx5MmGWgMtGSgDTQGWjLQBtpASwbaQGOgJQPtLQ5JMtCSZKANtCQZaEky0AZakgy0gZYkAy1JBtpAS5KBliQDbaAlyUBLkoGOG2gAEgcagLkMNICBBsBAAxhoAAw0gIEGwEAD4FAFoO2hilNvSfItDkky0AZakgy0JBloAy1JBlqSDLSBliQDbaAlyUBLkoE20JLUd6CrBsvxpEkGGgMtGWgDjYGWDLSBNtCSgTbQGGjJQHuLQ5IMtCQZaAMtSQZakgy0gZYkA22gJclAS5KBNtCSZKAlyUAbaEky0JJkoOMGGoDEgQZgLgMNYKABMNAABhoAAw1goAEw0AAYaAADDYCBBjDQABhoAAw0gIEGwEADGGgADDSAgf7G9fIEYGegAQy0gQYw0AAG2kADGGgAA22gAQy0gQYw0AAG2kADGGgAA22gAQy0vwTAQAMYaAMNYKABDLSBBjDQAAbaQAMYaAMNYKABDLSBBjDQAAbaQAMYaAMNYKABDLSBBjDQAAbaQAMYaAADbaABDLSBBjDQAAbaQAMYaAADbaABDDQAv2OgAQw0AAYawEADYKABDDQABhoAAw1goAEw0AAGGgADDYCBBjDQABhoAAMNgIEGMNAAGGgADDSAgQbAQAMYaAAMNAAGGsBAA2CgAQw0AAYawEADYKABMNAABhoAAw1goAEw0AAYaAADDYCBBjDQABhoAAPtJwAw0AAYaAADDYCBBjDQABhoAAw0gIEGwEADGGgADDQAby/e9HZPsgFukQAAAABJRU5ErkJggg=='

/** The document `hands-back` writes, in the session's folder. */
export const HANDED_DOCUMENT = {
  path: 'docs/notes.md',
  body: '# Notes\n\nRefunds share the partner budget.\n\n| Endpoint | Budget |\n| --- | --: |\n| charges | 600 |\n| refunds | shared |\n',
}

export const USAGE_LIMIT_MESSAGE = 'Claude AI usage limit reached|1759075200'

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
  /** Where the session works, for a step that writes. */
  cwd: string
  /** Althar's tools, when the session was given them over HTTP. */
  tools: { readonly url: string; readonly headers: Record<string, string> } | undefined
  /** The role markers the session has been given, in any turn. */
  markers: Set<string>
  /** Markers it has played once already, such as `[lead:hang-once]`. */
  played: Set<string>
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
 * passing on the `[lead:…]` and `[review:…]` markers it was given;
 * `[lead:finish]` finishes the step, and so does being told to carry on with
 * it after; `[review:pass]` and `[review:findings]`
 * report a review. Settling findings, it writes a file and commits it, so
 * the change changes, and finishes; a later review round passes. The session remembers its
 * markers: `[review:always]` finds something every round, and
 * `[lead:set-aside]` settles without changing anything. `[lead:wait]` works
 * until it is stopped, and `[lead:settle-quietly]` settles without reporting.
 * `[lead:edit]` commits a change when it finishes, as a lead is asked to;
 * `[lead:scratch]` leaves a scratch file lying about too, and deletes it when
 * Althar says it isn't committed. Asked for its pull request's description
 * in the repository's template, it fills it in, ticking a box it shouldn't.
 * Told what people said on its pull
 * request, `[lead:answer]`
 * replies there; told its checks failed, `[lead:fix]` commits a fix and
 * publishes it. Asked to plan a change with a link in it, the coordinator
 * drafts the task from that issue.
 */
/** Writes a line to a file in the worktree and commits it, as a lead commits as it goes. */
const commitIn = (cwd: string, file: string, message: string) => {
  appendFileSync(join(cwd, file), `${file.replace(/\.txt$/, '')}\n`)
  const git = (...args: Array<string>) =>
    execFileSync('git', ['-c', 'user.name=Fake', '-c', 'user.email=fake@althar.test', ...args], { cwd })
  git('add', '-A')
  git('commit', '-q', '-m', message)
}

const playRole = async (session: SessionState, text: string): Promise<string | undefined> => {
  for (const marker of text.match(/\[(coordinator|lead|review):[a-z-]+\]/g) ?? []) session.markers.add(marker)
  const asked = session.markers.size > 0 || text.includes('Settle each') || text.startsWith('Round ')
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
      if (session.markers.has('[review:always]'))
        return await call('report_review', {
          verdict: 'changes_requested',
          summary: 'Still not right.',
          findings: [
            { severity: 'minor', claim: 'Name it better.' },
            { severity: 'nit', file: 'README.md', claim: 'A typo.' },
          ],
        })
      if (text.includes('[review:findings]') && !text.startsWith('Round '))
        return await call('report_review', {
          verdict: 'changes_requested',
          summary: 'The heading needs fixing.',
          findings: [{ severity: 'major', file: 'README.md', line: 1, claim: 'The heading is wrong.' }],
        })
      if (text.includes('[review:') || text.startsWith('Round '))
        return await call('report_review', { verdict: 'pass', summary: 'The change holds.' })
      return undefined
    }
    if (available.has('finish_step')) {
      if (text.includes('Settle each')) {
        if (session.markers.has('[lead:settle-quietly]')) return 'Settled, without saying so.'
        const aside = session.markers.has('[lead:set-aside]')
        if (!aside) commitIn(session.cwd, 'settled.txt', 'Settle the review')
        // What became of each finding, by the ids Althar gave them.
        const findings = (text.match(/find_[0-9a-f]{32}/g) ?? []).map((id) =>
          aside ? { id, outcome: 'set_aside', reason: 'It reads as intended.' } : { id, outcome: 'fixed' },
        )
        return await call('finish_step', { summary: 'Fixed the heading.', findings })
      }
      // Told to carry on, as a lead that took a step over is, it finishes as it was told to at first.
      // Told to carry on, or to try another way, as Althar tells one that stalled or went round in circles.
      const toldToGoOn = /^(Carry on with the task|Your last turn|You ran )/.test(text)
      // Asked for its pull request's description in the repository's template, it writes under the first heading, and ticks a box it shouldn't.
      const finish = async () => {
        const answer = await call('finish_step', { summary: 'Did the task.' })
        const template = /~~~~~markdown\n([\s\S]*?)\n~~~~~/.exec(answer)?.[1]
        if (template === undefined) return answer
        const text = template.replace(/^(#+ .*)$/m, '$1\n\nDid the task, in the template.').replace('[ ]', '[x]')
        return await call('finish_step', { summary: 'Did the task.', descriptions: [{ text }] })
      }
      if (text.includes('[lead:finish]') || (toldToGoOn && session.markers.has('[lead:finish]'))) {
        if (session.markers.has('[lead:edit]')) commitIn(session.cwd, 'change.txt', 'Change it')
        if (!session.markers.has('[lead:scratch]')) return await finish()
        appendFileSync(join(session.cwd, 'scratch.log'), 'trying things\n')
        const answer = await call('finish_step', { summary: 'Did the task.' })
        if (!/These aren.t committed/.test(answer)) return answer
        rmSync(join(session.cwd, 'scratch.log'))
        return await finish()
      }
      // What people said on the task's pull request, and its checks.
      if (available.has('reply_on_pull_request') && session.markers.has('[lead:answer]') && / commented on /.test(text)) {
        const thread = /\(thread (\S+)\)/.exec(text)?.[1]
        return await call('reply_on_pull_request', {
          body: 'Seconds, the same as charges.',
          ...(thread === undefined ? {} : { thread_id: thread }),
        })
      }
      // Fixed and committed, for the person to push.
      if (session.markers.has('[lead:fix]') && text.startsWith('Checks failed')) {
        commitIn(session.cwd, 'fixed.txt', 'Fix the failing check')
        return 'Fixed the failing check, and committed it.'
      }
      // Works until it is stopped: for a lead that goes in the middle of its step.
      if (text.includes('[lead:wait]')) {
        for (let waited = 0; !session.cancelled && waited < 5_000; waited += 10) await pause(10)
        return 'Stopped working.'
      }
      return undefined
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
      const drafted = await call('draft_task', {
        title,
        description: `Retry the checkout call. ${markers.join(' ')}`,
        ...(link === undefined ? {} : { issue: link }),
      })
      const slug = /Drafted ([^\s,.]+)/.exec(drafted)?.[1] ?? ''
      return await call('propose_plan', {
        task: slug,
        lead: { agent: 'claude-code', reason: 'It knows the code.' },
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
            agentCapabilities: { loadSession: false, mcpCapabilities: { http: true, sse: false }, sessionCapabilities: { close: {} } },
            authMethods: [],
            agentInfo: { name: 'fake-agent', version: '0.0.0' },
            _meta: { steering: { supported: true } },
          }
    })
    .onRequest(acp.methods.agent.session.new, ({ params }) => {
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
        cwd: params.cwd,
        tools: (() => {
          const server = params.mcpServers.find((candidate) => 'type' in candidate && candidate.type === 'http')
          return server === undefined || !('url' in server)
            ? undefined
            : { url: server.url, headers: Object.fromEntries(server.headers.map((header) => [header.name, header.value])) }
        })(),
        markers: new Set(),
        played: new Set(),
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
    .onNotification(acp.methods.agent.session.cancel, ({ params }) => {
      const session = sessionOf(params.sessionId)
      session.cancelled = true
      if (options.keepsRequests !== true) session.abort?.abort()
    })
    .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
      const session = sessionOf(params.sessionId)
      session.cancelled = false
      const text = params.prompt.map((block) => (block.type === 'text' ? block.text : '')).join('')
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

      // A lead that stalls or loops, where a marker says so.
      const stalled = await playStall(session, text, update)
      if (stalled !== undefined) return stalled
      // With Althar's tools, a marker in the prompt says which role to play.
      const played = await playRole(session, text)
      // Stopped while it played its part, the turn was cancelled, as an agent says.
      if (played !== undefined && session.cancelled) return { stopReason: 'cancelled' }
      if (played !== undefined) {
        await say(played)
        return ended()
      }

      const resumed = text.includes("not allowed by the project's rules")
      if (resumed && !session.stubborn) {
        await say('carrying on without it')
        return ended()
      }
      if (text === scenarios.stubborn) session.stubborn = true
      const scenario = resumed ? scenarios.stubborn : text

      switch (scenario) {
        case scenarios.commandChoices:
        case scenarios.fileEdit:
        case scenarios.stubborn: {
          const command = scenario === scenarios.commandChoices
          const toolCall = {
            toolCallId: 'call-2',
            title: command ? 'Run make deploy' : 'Edit app.ts',
            kind: command ? ('execute' as const) : ('edit' as const),
            // As agents do, the command itself, which the title only describes.
            ...(command ? { rawInput: { command: 'make deploy' } } : {}),
          }
          await update({ sessionUpdate: 'tool_call', ...toolCall, status: 'pending' })
          const chosen = await ask(toolCall, command ? commandOptions : fileEditOptions)
          await update({
            sessionUpdate: 'tool_call_update',
            toolCallId: 'call-2',
            status: chosen.startsWith('allow') ? 'completed' : 'failed',
          })
          await say(`chosen=${chosen}`)
          return session.cancelled || chosen === 'cancel' || chosen === 'cancelled' ? { stopReason: 'cancelled' } : ended()
        }
        case scenarios.question: {
          const answer = await client.request<acp.CreateElicitationResponse, acp.CreateElicitationRequest>(
            acp.methods.client.elicitation.create,
            {
              sessionId: params.sessionId,
              mode: 'form',
              message: 'Which database?',
              requestedSchema: {
                type: 'object',
                properties: { database: { type: 'string', enum: ['postgres', 'sqlite'] } },
                required: ['database'],
              },
            },
          )
          await say(
            answer.action === 'accept'
              ? `answer=${JSON.stringify((answer as { readonly content?: unknown }).content)}`
              : `answer=${answer.action}`,
          )
          return ended()
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
        case scenarios.afterTurn:
          await say('Done')
          setTimeout(() => void update({ sessionUpdate: 'available_commands_update', availableCommands: [] }), 20)
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
