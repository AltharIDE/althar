import * as acp from '@agentclientprotocol/sdk'
import type { ToolKind } from '@charrette/domain'
import { Data, DateTime, Deferred, Duration, Effect, Ref, type Scope, Stream } from 'effect'

import { AgentExited, AgentRequestFailed, type AgentStartFailed, OptionUnavailable } from './errors'
import { type ConfigOption, normalize, normalizeOptions, normalizeUsage, type SessionEvent } from './events'
import { classify } from './failures'
import { type OwnedProcess, type ProcessExit, spawnOwned } from './process'
import type { LaunchSpec } from './registry'

/*
 * One connection to one agent over ACP (docs/architecture/03). It negotiates
 * capabilities, starts sessions in the mode it is told (never a bypass mode,
 * ADR-007), streams each turn as normalized events, answers permission
 * requests through the caller with a one-time option only, and classifies
 * every failure.
 */

export type Transport =
  /** The agent runs as a process Charrette owns. */
  | { readonly _tag: 'Process'; readonly spec: LaunchSpec; readonly cwd: string }
  /** The agent runs in this process. For tests, with the fake agent. */
  | { readonly _tag: 'InProcess'; readonly agent: acp.AgentApp }

export interface PermissionOption {
  readonly optionId: string
  readonly name: string
  readonly kind: acp.PermissionOptionKind
}

export interface PermissionRequest {
  readonly sessionId: string
  readonly toolCallId: string
  readonly title: string
  readonly kind: ToolKind
  readonly rawInput?: unknown
  readonly options: ReadonlyArray<PermissionOption>
}

export type PermissionDecision = 'allow' | 'reject'

/**
 * The option Charrette sends back for a decision: always a one-time option.
 * If Charrette sent "allow always", the agent could remember the rule itself,
 * and later requests would stop reaching Charrette (ADR-007). When the agent
 * offers no one-time option for the decision, there is none, and the request
 * is cancelled instead.
 */
export const oneTimeOption = (options: ReadonlyArray<PermissionOption>, decision: PermissionDecision): PermissionOption | undefined =>
  options.find((option) => option.kind === (decision === 'allow' ? 'allow_once' : 'reject_once'))

export interface AgentInfo {
  readonly name: string
  readonly version?: string
  readonly protocolVersion: number
  readonly loadSession: boolean
  /** The agent says it accepts input during a turn (an extension some agents advertise in `_meta`). */
  readonly steering: boolean
  readonly mcp: { readonly http: boolean; readonly sse: boolean }
  readonly authMethods: ReadonlyArray<string>
}

export interface NewSessionOptions {
  readonly cwd: string
  /** The mode to start in. Required: a session never starts in whatever mode the agent defaults to (ADR-007). */
  readonly mode: string
  readonly mcpServers?: ReadonlyArray<acp.McpServer>
  readonly additionalDirectories?: ReadonlyArray<string>
}

type Failure = AgentRequestFailed | AgentExited

export interface AgentSession {
  readonly sessionId: string
  /** The session's config options as last reported. */
  readonly options: Effect.Effect<ReadonlyArray<ConfigOption>>
  /** Sends a prompt and streams the turn, ending with `TurnEnded`. */
  prompt(text: string): Stream.Stream<SessionEvent, Failure>
  /** Asks the agent to stop the current turn; the turn then ends with `cancelled`. */
  readonly cancel: Effect.Effect<void, Failure>
  /** Sets a config option, such as the model, and returns every option as the agent now reports it. */
  setOption(configId: string, value: string): Effect.Effect<ReadonlyArray<ConfigOption>, Failure | OptionUnavailable>
}

export interface AgentConnection {
  readonly info: AgentInfo
  /** The process id, when the agent runs as a process. */
  readonly pid?: number
  /** Completes when the agent's process exits or its connection closes. */
  readonly closed: Effect.Effect<ProcessExit>
  newSession(options: NewSessionOptions): Effect.Effect<AgentSession, Failure | OptionUnavailable>
}

export interface ConnectOptions {
  readonly transport: Transport
  /** Decides a permission request. The runtime answers from the project's rules (docs/architecture/03). */
  readonly onPermission: (request: PermissionRequest) => Effect.Effect<PermissionDecision>
}

/** An error thrown by the SDK, before it is classified. */
class RawFailure extends Data.TaggedError('RawFailure')<{ readonly cause: unknown }> {}

const toolKinds: ReadonlyArray<string> = ['read', 'edit', 'delete', 'move', 'search', 'execute', 'think', 'fetch', 'switch_mode', 'other']

const permissionRequest = (params: acp.RequestPermissionRequest): PermissionRequest => ({
  sessionId: params.sessionId,
  toolCallId: params.toolCall.toolCallId,
  title: params.toolCall.title ?? '',
  kind:
    params.toolCall.kind !== null && params.toolCall.kind !== undefined && toolKinds.includes(params.toolCall.kind)
      ? (params.toolCall.kind as ToolKind)
      : 'other',
  ...(params.toolCall.rawInput === undefined ? {} : { rawInput: params.toolCall.rawInput }),
  options: params.options.map((option) => ({ optionId: option.optionId, name: option.name, kind: option.kind })),
})

export const connect = (options: ConnectOptions): Effect.Effect<AgentConnection, AgentStartFailed | Failure, Scope.Scope> =>
  Effect.gen(function* () {
    const context = yield* Effect.context<never>()
    const answer = (params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> =>
      Effect.runPromiseWith(context)(
        Effect.map(options.onPermission(permissionRequest(params)), (decision) => {
          const option = oneTimeOption(params.options, decision)
          return option === undefined
            ? { outcome: { outcome: 'cancelled' as const } }
            : { outcome: { outcome: 'selected' as const, optionId: option.optionId } }
        }),
      )

    const app = acp
      .client({ name: 'charrette' })
      .onRequest(acp.methods.client.session.requestPermission, (request) => answer(request.params))

    let owned: OwnedProcess | undefined
    let connection: acp.ClientConnection
    if (options.transport._tag === 'Process') {
      owned = yield* spawnOwned(options.transport.spec, options.transport.cwd)
      connection = app.connect(acp.ndJsonStream(owned.stdin, owned.stdout))
    } else {
      connection = app.connect(options.transport.agent)
    }
    yield* Effect.addFinalizer(() => Effect.sync(() => connection.close()))

    const closed: Effect.Effect<ProcessExit> =
      owned === undefined
        ? Effect.as(
            Effect.promise(() => connection.closed.catch(() => undefined)),
            { code: null, signal: null },
          )
        : Deferred.await(owned.exited)

    /** Turns an SDK error into an agent that has gone, or a classified request failure. */
    const failure = (method: string, cause: unknown): Effect.Effect<never, Failure> =>
      Effect.gen(function* () {
        const exit =
          owned === undefined
            ? connection.signal.aborted
              ? { code: null, signal: null }
              : undefined
            : yield* Effect.map(Deferred.await(owned.exited).pipe(Effect.timeoutOption(Duration.millis(250))), (option) =>
                option._tag === 'Some' ? option.value : undefined,
              )
        if (exit !== undefined) {
          return yield* new AgentExited({ code: exit.code, signal: exit.signal, stderr: owned?.stderrTail() ?? '' })
        }
        const classified = classify(cause, yield* DateTime.nowAsDate)
        return yield* new AgentRequestFailed({ method, ...classified })
      })

    const call = <A>(method: string, run: () => Promise<A>): Effect.Effect<A, Failure> =>
      Effect.tryPromise({ try: run, catch: (cause) => new RawFailure({ cause }) }).pipe(
        Effect.catchTag('RawFailure', (raw) => failure(method, raw.cause)),
      )

    const init = yield* call('initialize', () =>
      connection.agent.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} }),
    )
    const capabilities = init.agentCapabilities ?? {}
    const steering =
      (init._meta as { readonly steering?: { readonly supported?: unknown } } | null | undefined)?.steering?.supported === true
    const info: AgentInfo = {
      name: init.agentInfo?.name ?? 'unknown',
      ...(init.agentInfo?.version === undefined ? {} : { version: init.agentInfo.version }),
      protocolVersion: init.protocolVersion,
      loadSession: capabilities.loadSession === true,
      steering,
      mcp: { http: capabilities.mcpCapabilities?.http === true, sse: capabilities.mcpCapabilities?.sse === true },
      authMethods: (init.authMethods ?? []).map((method) => method.id),
    }

    const newSession = (sessionOptions: NewSessionOptions): Effect.Effect<AgentSession, Failure | OptionUnavailable> =>
      Effect.gen(function* () {
        const active = yield* call('session/new', () =>
          connection.agent
            .buildSession({
              cwd: sessionOptions.cwd,
              mcpServers: [...(sessionOptions.mcpServers ?? [])],
              ...(sessionOptions.additionalDirectories === undefined
                ? {}
                : { additionalDirectories: [...sessionOptions.additionalDirectories] }),
            })
            .start(),
        )
        const sessionId = active.sessionId
        const current = yield* Ref.make(normalizeOptions(active.newSessionResponse.configOptions))

        const setOption = (configId: string, value: string) =>
          Effect.gen(function* () {
            const option = (yield* Ref.get(current)).find((candidate) => candidate.id === configId)
            if (option === undefined || (option.type === 'select' && !option.values.includes(value))) {
              return yield* new OptionUnavailable({ configId, value, available: option?.values ?? [] })
            }
            const response = yield* call('session/set_config_option', () =>
              connection.agent.request(acp.methods.agent.session.setConfigOption, { sessionId, configId, value }),
            )
            const updated = normalizeOptions(response.configOptions)
            yield* Ref.set(current, updated)
            return updated
          })

        /*
         * The mode is set before anything else happens in the session. Agents
         * expose it as a config option in the `mode` category, or as legacy
         * session modes; either way the result is checked.
         */
        const modeOption = (yield* Ref.get(current)).find((option) => option.category === 'mode')
        const legacy = active.modes
        if (modeOption !== undefined) {
          const after = yield* setOption(modeOption.id, sessionOptions.mode)
          const mode = after.find((option) => option.id === modeOption.id)
          if (mode?.currentValue !== sessionOptions.mode) {
            return yield* new OptionUnavailable({ configId: modeOption.id, value: sessionOptions.mode, available: modeOption.values })
          }
        } else if (legacy !== null && legacy !== undefined) {
          const available = legacy.availableModes.map((mode) => mode.id)
          if (!available.includes(sessionOptions.mode)) {
            return yield* new OptionUnavailable({ configId: 'mode', value: sessionOptions.mode, available })
          }
          yield* call('session/set_mode', () =>
            connection.agent.request(acp.methods.agent.session.setMode, { sessionId, modeId: sessionOptions.mode }),
          )
        } else {
          return yield* new OptionUnavailable({ configId: 'mode', value: sessionOptions.mode, available: [] })
        }

        const prompt = (text: string): Stream.Stream<SessionEvent, Failure> =>
          Stream.fromAsyncIterable(turn(active, text), (cause) => new RawFailure({ cause })).pipe(
            Stream.tap((event) => (event._tag === 'OptionsChanged' ? Ref.set(current, event.options) : Effect.void)),
            Stream.catchTag('RawFailure', (raw) => Stream.fromEffect(failure('session/prompt', raw.cause))),
          )

        const cancel = call('session/cancel', () => connection.agent.notify(acp.methods.agent.session.cancel, { sessionId }))

        return { sessionId, options: Ref.get(current), prompt, cancel, setOption } satisfies AgentSession
      })

    return {
      info,
      ...(owned === undefined ? {} : { pid: owned.pid }),
      closed,
      newSession,
    } satisfies AgentConnection
  })

/**
 * One turn: sends the prompt, then yields the session's updates until the
 * turn stops. A prompt that fails ends the stream with its error.
 */
async function* turn(active: acp.ActiveSession, text: string): AsyncGenerator<SessionEvent> {
  const done = active.prompt(text)
  const failed = done.then(
    () => new Promise<never>(() => {}),
    (error: unknown) => Promise.reject(error),
  )
  failed.catch(() => {})
  while (true) {
    const message = await Promise.race([active.nextUpdate(), failed])
    if (message.kind === 'stop') {
      const usage = normalizeUsage(message.response.usage)
      yield { _tag: 'TurnEnded', stopReason: message.stopReason, ...(usage === undefined ? {} : { usage }) }
      return
    }
    yield normalize(message.update)
  }
}
