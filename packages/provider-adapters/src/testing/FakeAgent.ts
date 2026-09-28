import * as acp from '@agentclientprotocol/sdk'

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
  /** Reports the session's mode and model. */
  settings: 'settings',
  /** The process exits mid-turn. Only when the agent runs as a process. */
  exit: 'exit',
} as const

export const USAGE_LIMIT_MESSAGE = 'Claude AI usage limit reached|1759075200'

export interface FakeAgentOptions {
  /** What `exit` does. The process entry point exits the process. */
  readonly exit?: () => void
  /**
   * How it offers modes: as a config option (the default, as Claude Code,
   * Codex and OpenCode do), as legacy session modes, or not at all.
   */
  readonly modes?: 'config' | 'legacy' | 'none'
  /** Answer `initialize` with the protocol version and nothing else. */
  readonly bare?: boolean
}

interface SessionState {
  mode: string
  model: string
  cancelled: boolean
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

export const fakeAgent = (options: FakeAgentOptions = {}): acp.AgentApp => {
  const modes = options.modes ?? 'config'
  const configOptions = (session: SessionState): Array<acp.SessionConfigOption> =>
    modes === 'config' ? [modeOption(session), modelOption(session)] : [modelOption(session)]
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
            agentCapabilities: { loadSession: false, mcpCapabilities: { http: true, sse: false } },
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
      if (params.configId === 'mode' && MODES.includes(value)) session.mode = value
      else if (params.configId === 'model' && MODELS.includes(value)) session.model = value
      else throw acp.RequestError.invalidParams(params, `No option ${params.configId}=${value}`)
      return { configOptions: configOptions(session) }
    })
    .onNotification(acp.methods.agent.session.cancel, ({ params }) => {
      sessionOf(params.sessionId).cancelled = true
    })
    .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
      const session = sessionOf(params.sessionId)
      session.cancelled = false
      const text = params.prompt.map((block) => (block.type === 'text' ? block.text : '')).join('')
      const update = (value: acp.SessionUpdate) =>
        client.notify(acp.methods.client.session.update, { sessionId: params.sessionId, update: value })
      const say = (said: string) => update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: said } })
      const ended = (usage?: acp.Usage): acp.PromptResponse => ({ stopReason: 'end_turn', ...(usage === undefined ? {} : { usage }) })

      switch (text) {
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
              ? { toolCallId: 'call-1', title: 'Write hello.txt', kind: 'edit' as const, rawInput: { path: 'hello.txt' } }
              : { toolCallId: 'call-1', title: 'Write hello.txt' }
          await update({ sessionUpdate: 'tool_call', ...toolCall, status: 'pending' })
          const answer = await client.request<acp.RequestPermissionResponse, acp.RequestPermissionRequest>(
            acp.methods.client.session.requestPermission,
            {
              sessionId: params.sessionId,
              toolCall,
              options: permissionOptions(text === scenarios.toolAlwaysOnly),
            },
          )
          const chosen = answer.outcome.outcome === 'selected' ? answer.outcome.optionId : 'cancelled'
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
