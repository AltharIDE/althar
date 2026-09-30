import * as acp from '@agentclientprotocol/sdk'

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
} as const

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
  /** Leave a permission request open when the turn is cancelled, for Charrette to answer. */
  readonly keepsRequests?: boolean
}

interface SessionState {
  mode: string
  model: string
  cancelled: boolean
  stubborn: boolean
  abort: AbortController | undefined
  directories: number
  mcpServers: number
}

const MODES = ['ask', 'read-only', 'bypass']
const MODELS = ['small', 'large']

const modeOption = (session: SessionState): acp.SessionConfigOption => ({
  id: 'mode',
  name: 'Mode',
  category: 'mode',
  type: 'select',
  currentValue: session.mode,
  options: MODES.map((value) => ({ value, name: value })),
})

const modelOption = (session: SessionState): acp.SessionConfigOption => ({
  id: 'model',
  name: 'Model',
  category: 'model',
  type: 'select',
  currentValue: session.model,
  options: [{ group: 'all', name: 'All', options: MODELS.map((value) => ({ value, name: value })) }],
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
  const configOptions = (session: SessionState): Array<acp.SessionConfigOption> =>
    modes === 'config' || modes === 'stuck' ? [modeOption(session), modelOption(session)] : [modelOption(session)]
  const sessions = new Map<string, SessionState>()
  let created = 0
  const sessionOf = (sessionId: string): SessionState => {
    const session = sessions.get(sessionId)
    if (session === undefined) throw acp.RequestError.invalidParams({ sessionId }, 'Unknown session')
    return session
  }

  return acp
    .agent({ name: 'fake-agent' })
    .onRequest(acp.methods.agent.initialize, () =>
      options.bare === true
        ? { protocolVersion: acp.PROTOCOL_VERSION }
        : {
            protocolVersion: acp.PROTOCOL_VERSION,
            agentCapabilities: { loadSession: false, mcpCapabilities: { http: true, sse: false }, sessionCapabilities: { close: {} } },
            authMethods: [],
            agentInfo: { name: 'fake-agent', version: '0.0.0' },
            _meta: { steering: { supported: true } },
          },
    )
    .onRequest(acp.methods.agent.session.new, ({ params }) => {
      created += 1
      const sessionId = `fake-${created}`
      const session: SessionState = {
        mode: 'bypass',
        model: 'small',
        cancelled: false,
        stubborn: false,
        abort: undefined,
        directories: params.additionalDirectories?.length ?? 0,
        mcpServers: params.mcpServers.length,
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
      else if (params.configId === 'model' && MODELS.includes(value)) session.model = value
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
            title: 'mcp.charrette.draft_task',
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
