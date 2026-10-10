import * as acp from '@agentclientprotocol/sdk'
import type { ToolKind } from '@althar/domain'
import { Cause, Data, DateTime, Deferred, Duration, Effect, Exit, Option, PubSub, Queue, Ref, Scope, Stream } from 'effect'

import { AgentExited, AgentRequestFailed, type AgentStartFailed, OptionUnavailable, TurnInProgress } from './errors'
import { type ConfigOption, normalize, normalizeOptions, normalizeUsage, type PermissionScope, type SessionEvent } from './events'
import { type Classified, classify, structuredFailure, structuredFailureCapability } from './failures'
import { type CapturedFrame, type OwnedProcess, type ProcessExit, spawnOwned, type StopReport } from './process'
import type { LaunchSpec, PermissionMeanings } from './registry'

/*
 * One connection to one agent over ACP (docs/architecture/03). It negotiates
 * capabilities, starts sessions in the mode it is told (never a bypass mode,
 * ADR-007), runs one turn at a time per session, answers permission requests
 * with the narrowest option that carries out the caller's decision, resumes a
 * turn a rejection stopped, and classifies every failure. No ACP type appears in its interface, so a native
 * adapter for one agent (ADR-002) can stand in without callers changing.
 */

/** An agent that runs in this process, for tests: the fake agent in `@althar/provider-adapters/testing`. */
export interface InProcessAgent {
  readonly _tag: 'InProcessAgent'
  readonly app: acp.AgentApp
}

export type Transport =
  /** The agent runs as a process Althar owns. `capture` receives the raw protocol, numbered, in both directions. */
  | { readonly _tag: 'Process'; readonly spec: LaunchSpec; readonly cwd: string; readonly capture?: (frame: CapturedFrame) => void }
  | { readonly _tag: 'InProcess'; readonly agent: InProcessAgent }

export type PermissionOptionKind = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'

export interface PermissionOption {
  readonly optionId: string
  readonly name: string
  readonly kind: PermissionOptionKind
}

export interface PermissionRequest {
  readonly sessionId: string
  readonly toolCallId: string
  readonly title: string
  readonly kind: ToolKind
  readonly rawInput?: unknown
  /** The files the action touches, as the agent reported them. */
  readonly paths: ReadonlyArray<string>
  readonly options: ReadonlyArray<PermissionOption>
}

/** Althar's decision on a permission request, from the project's rules. `reason` is told to the agent when a rejection stops its turn. */
export interface PermissionDecision {
  readonly decision: 'allow' | 'reject'
  readonly reason?: string
}

/** What was sent back for a decision: an option (and how far it reaches), or a cancelled request. */
export interface PermissionAnswer {
  readonly optionId: string | null
  readonly scope: PermissionScope | null
  /** The agent stops its turn on this answer. */
  readonly stopsTurn: boolean
}

const NO_MEANINGS: PermissionMeanings = { rejectAndContinue: [], rejectAndStop: [], allowScopes: {} }

/**
 * The option Althar sends for a decision (ADR-007). Never an "always"
 * option: the agent could remember it, and later requests would stop reaching
 * Althar.
 * - Allow: an option for this action; failing that, one for the rest of the
 *   turn; failing that, the request is cancelled.
 * - Reject: an option that skips the action and carries on; failing that, one
 *   that stops the turn; failing that, the request is cancelled, which also
 *   stops it.
 */
export const answerFor = (
  options: ReadonlyArray<PermissionOption>,
  decision: PermissionDecision['decision'],
  meanings: PermissionMeanings = NO_MEANINGS,
): PermissionAnswer => {
  if (decision === 'allow') {
    const scopeOf = (option: PermissionOption): PermissionScope | undefined =>
      meanings.allowScopes[option.optionId] ?? (option.kind === 'allow_once' ? 'once' : undefined)
    const allowed = options.filter((option) => option.kind === 'allow_once' || option.optionId in meanings.allowScopes)
    const chosen = allowed.find((option) => scopeOf(option) === 'once') ?? allowed.find((option) => scopeOf(option) === 'turn')
    return chosen === undefined
      ? { optionId: null, scope: null, stopsTurn: true }
      : { optionId: chosen.optionId, scope: scopeOf(chosen) ?? 'once', stopsTurn: false }
  }
  const stops = (option: PermissionOption) => meanings.rejectAndStop.includes(option.optionId)
  const rejections = options.filter((option) => option.kind === 'reject_once')
  const carriesOn =
    rejections.find((option) => meanings.rejectAndContinue.includes(option.optionId)) ?? rejections.find((option) => !stops(option))
  const stopping = rejections.find(stops)
  const chosen = carriesOn ?? stopping
  return chosen === undefined
    ? { optionId: null, scope: null, stopsTurn: true }
    : { optionId: chosen.optionId, scope: 'once', stopsTurn: chosen === stopping }
}

/** A question the agent asks the person, such as Claude's AskUserQuestion, with the fields of the answer it wants. */
export interface Question {
  readonly sessionId?: string
  readonly message: string
  readonly fields: Readonly<Record<string, unknown>>
  readonly required: ReadonlyArray<string>
}

export type QuestionAnswer =
  | { readonly action: 'accept'; readonly content: Readonly<Record<string, string | number | boolean | ReadonlyArray<string>>> }
  | { readonly action: 'decline' }
  | { readonly action: 'cancel' }

export interface AgentInfo {
  readonly name: string
  readonly version?: string
  readonly protocolVersion: number
  readonly loadSession: boolean
  readonly closeSession: boolean
  /** The agent says it accepts input during a turn (an extension some agents advertise in `_meta`). */
  readonly steering: boolean
  readonly mcp: { readonly http: boolean; readonly sse: boolean }
  readonly authMethods: ReadonlyArray<string>
}

/** An MCP server a session may use. Althar gives every session its own tools this way. */
export type McpServer =
  | {
      readonly type: 'stdio'
      readonly name: string
      readonly command: string
      readonly args: ReadonlyArray<string>
      readonly env: Readonly<Record<string, string>>
    }
  | { readonly type: 'http'; readonly name: string; readonly url: string; readonly headers: Readonly<Record<string, string>> }

export interface NewSessionOptions {
  readonly cwd: string
  /** The mode to start in. Required: a session never runs in the mode the agent defaults to (ADR-007). */
  readonly mode: string
  /** The id of the agent's mode option (the registry's `options.mode`). Without it, the option in the `mode` category is used. */
  readonly modeOptionId?: string
  readonly mcpServers?: ReadonlyArray<McpServer>
  readonly additionalDirectories?: ReadonlyArray<string>
  /** Extra `_meta` for `session/new`: the registry's `sessionMeta`. */
  readonly meta?: Readonly<Record<string, unknown>>
}

type Failure = AgentRequestFailed | AgentExited

export interface AgentSession {
  readonly sessionId: string
  /** The session's config options as last reported. */
  readonly options: Effect.Effect<ReadonlyArray<ConfigOption>>
  /** The mode the session is in, as last set or reported. */
  readonly mode: Effect.Effect<string>
  /**
   * Sends a prompt and streams the turn, ending with `TurnEnded`. One turn
   * runs at a time: a prompt while one is running fails with
   * `TurnInProgress`. A turn reads to its own end even if the stream is
   * stopped early, so nothing it says reaches a later turn.
   */
  /** `onStarted` runs after the prompt is sent and the turn can be interrupted. */
  prompt(text: string, onStarted?: Effect.Effect<void>): Stream.Stream<SessionEvent, Failure | TurnInProgress>
  /** Updates that arrive between turns, such as the agent changing its own mode. */
  readonly events: Stream.Stream<SessionEvent>
  /** Asks the agent to stop the current turn; the turn then ends with `cancelled`. */
  readonly cancel: Effect.Effect<void, Failure>
  /** Cancels the current turn, if there is one, and waits until it has ended. The start of interrupt-and-continue. */
  readonly interrupt: Effect.Effect<void, Failure>
  /** Sets a config option, such as the model, and returns every option as the agent now reports it. */
  setOption(configId: string, value: string): Effect.Effect<ReadonlyArray<ConfigOption>, Failure | OptionUnavailable>
}

export interface ProcessInfo {
  readonly pid: number
  readonly osStartedAt?: string
  readonly environmentDigest: string
  /** Completes once the connection's scope has stopped the process group, with what it took. */
  readonly stopped: Effect.Effect<StopReport>
}

export interface AgentConnection {
  readonly info: AgentInfo
  /** The agent's process, when it runs as one. */
  readonly process?: ProcessInfo
  /** Completes when the agent's process exits or its connection closes. */
  readonly closed: Effect.Effect<ProcessExit>
  /** Starts a session; the scope closes it. */
  newSession(options: NewSessionOptions): Effect.Effect<AgentSession, Failure | OptionUnavailable, Scope.Scope>
}

export interface ConnectOptions {
  readonly transport: Transport
  /** Decides a permission request, from the project's rules (docs/architecture/03). It is interrupted if the agent withdraws the request. */
  readonly onPermission: (request: PermissionRequest) => Effect.Effect<PermissionDecision>
  /** What the agent's permission options mean: the registry's `permissions`. */
  readonly permissions?: PermissionMeanings
  /** Answers a question the agent asks the person. Without it, questions are cancelled. */
  readonly onQuestion?: (question: Question) => Effect.Effect<QuestionAnswer>
}

/** An error thrown by the SDK, before it is classified. */
class RawFailure extends Data.TaggedError('RawFailure')<{ readonly cause: unknown }> {}

/** How many times one turn is resumed after rejections that stopped it, before it is left stopped. */
const MAX_RESUMES = 3

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
  paths: (params.toolCall.locations ?? []).map((location) => location.path),
  options: params.options.map((option) => ({ optionId: option.optionId, name: option.name, kind: option.kind })),
})

const mcpServer = (server: McpServer): acp.McpServer =>
  server.type === 'stdio'
    ? {
        name: server.name,
        command: server.command,
        args: [...server.args],
        env: Object.entries(server.env).map(([name, value]) => ({ name, value })),
      }
    : {
        type: 'http',
        name: server.name,
        url: server.url,
        headers: Object.entries(server.headers).map(([name, value]) => ({ name, value })),
      }

interface Turn {
  readonly queue: Queue.Queue<SessionEvent, Failure | Cause.Done>
  readonly done: Deferred.Deferred<void>
  /** Set when a rejection stopped the turn: the reason it is resumed with. */
  resumeWith: string | undefined
  resumes: number
  failure: Classified | undefined
}

/** What reaches a session from the agent, in the order it arrived. */
type Inbound =
  | { readonly _tag: 'Update'; readonly update: acp.SessionUpdate }
  | { readonly _tag: 'Event'; readonly event: SessionEvent; readonly resumeWith?: string }
  | { readonly _tag: 'Stopped'; readonly response: acp.PromptResponse }
  | { readonly _tag: 'PromptFailed'; readonly cause: unknown }

interface SessionState {
  readonly inbox: Queue.Queue<Inbound>
  readonly current: Ref.Ref<Option.Option<Turn>>
  readonly between: PubSub.PubSub<SessionEvent>
}

const CANCELLED: acp.RequestPermissionResponse = { outcome: { outcome: 'cancelled' } }

export const connect = (options: ConnectOptions): Effect.Effect<AgentConnection, AgentStartFailed | Failure, Scope.Scope> =>
  Effect.gen(function* () {
    const context = yield* Effect.context<never>()
    const sessions = new Map<string, SessionState>()
    /** What arrived for a session before `session/new` returned, kept while one is starting. */
    const early = new Map<string, Array<Inbound>>()
    let starting = 0

    /*
     * Everything that reaches a session goes into its inbox the moment it
     * arrives: updates, permission answers, and the end of each prompt. The
     * SDK hands messages over in the order they came, and one reader per
     * session takes from the inbox, so a permission answer never overtakes
     * the tool call it answers, and a turn's last update never follows its end.
     */
    const receive = (sessionId: string, inbound: Inbound) => {
      const state = sessions.get(sessionId)
      if (state !== undefined) Queue.offerUnsafe(state.inbox, inbound)
      else if (starting > 0) early.set(sessionId, [...(early.get(sessionId) ?? []), inbound])
    }

    /** Permission requests waiting for a decision, by session: each entry drops its request. */
    const waiting = new Map<string, Set<() => void>>()
    const waitingIn = (sessionId: string) => {
      const found = waiting.get(sessionId) ?? new Set<() => void>()
      waiting.set(sessionId, found)
      return found
    }

    /**
     * Decides a permission request through the caller. The request is dropped,
     * answered `cancelled` and recorded as withdrawn, when the agent withdraws
     * it or when Althar cancels the turn (ACP: a client that cancels a turn
     * answers its pending requests itself).
     */
    const answerPermission = (params: acp.RequestPermissionRequest, fromAgent: AbortSignal): Promise<acp.RequestPermissionResponse> => {
      const request = permissionRequest(params)
      const dropped = new AbortController()
      const drop = () => dropped.abort()
      const pending = waitingIn(params.sessionId)
      pending.add(drop)
      fromAgent.addEventListener('abort', drop, { once: true })
      let settled = false
      // Recorded the moment the request is dropped, before the agent can end its turn.
      const withdraw = () => {
        if (settled) return
        settled = true
        receive(params.sessionId, { _tag: 'Event', event: { _tag: 'PermissionWithdrawn', toolCallId: request.toolCallId } })
      }
      dropped.signal.addEventListener('abort', withdraw, { once: true })
      const answer = (decided: PermissionDecision): acp.RequestPermissionResponse => {
        if (settled) return CANCELLED
        settled = true
        const { decision, reason } = decided
        const chosen = answerFor(request.options, decision, options.permissions)
        const stops = chosen.stopsTurn && decision === 'reject'
        receive(params.sessionId, {
          _tag: 'Event',
          event: { _tag: 'PermissionAnswered', toolCallId: request.toolCallId, decision, ...chosen },
          ...(stops
            ? {
                resumeWith: `${request.title} was not allowed by the project's rules${reason === undefined ? '' : `: ${reason}`}. Carry on without it.`,
              }
            : {}),
        })
        return chosen.optionId === null ? CANCELLED : { outcome: { outcome: 'selected', optionId: chosen.optionId } }
      }
      // A decision that fails is a rejection: nothing runs that Althar did not allow.
      return Effect.runPromiseWith(context)(options.onPermission(request), { signal: dropped.signal })
        .then(answer, () =>
          dropped.signal.aborted ? (withdraw(), CANCELLED) : answer({ decision: 'reject', reason: 'Althar could not decide' }),
        )
        .finally(() => {
          pending.delete(drop)
          fromAgent.removeEventListener('abort', drop)
        })
    }

    const askQuestion = (params: acp.CreateElicitationRequest): Promise<acp.CreateElicitationResponse> => {
      if (options.onQuestion === undefined || params.mode !== 'form' || !('requestedSchema' in params))
        return Promise.resolve({ action: 'cancel' })
      const schema = params.requestedSchema as {
        readonly properties?: Record<string, unknown>
        readonly required?: ReadonlyArray<string> | null
      }
      const question: Question = {
        ...('sessionId' in params && typeof params.sessionId === 'string' ? { sessionId: params.sessionId } : {}),
        message: params.message,
        fields: schema.properties ?? {},
        required: schema.required ?? [],
      }
      return Effect.runPromiseWith(context)(options.onQuestion(question)).then(
        (answer): acp.CreateElicitationResponse =>
          answer.action === 'accept'
            ? { action: 'accept', content: answer.content as Record<string, string | number | boolean | Array<string>> }
            : { action: answer.action },
        (): acp.CreateElicitationResponse => ({ action: 'cancel' }),
      )
    }

    /*
     * What each tool call said about itself, by session and call. Codex asks
     * permission for an MCP tool with no title or input of its own; the call
     * it asks about said both when it began, so the request takes them from it.
     */
    const calls = new Map<string, { title?: string; kind?: string; rawInput?: unknown }>()
    const remember = (sessionId: string, update: acp.SessionUpdate) => {
      if (update.sessionUpdate !== 'tool_call' && update.sessionUpdate !== 'tool_call_update') return
      const key = `${sessionId}\u0000${update.toolCallId}`
      const known = calls.get(key) ?? {}
      calls.set(key, {
        ...known,
        ...(update.title === undefined || update.title === null || update.title === '' ? {} : { title: update.title }),
        ...(update.kind === undefined || update.kind === null ? {} : { kind: update.kind }),
        ...(update.rawInput === undefined || update.rawInput === null ? {} : { rawInput: update.rawInput }),
      })
    }
    const described = (params: acp.RequestPermissionRequest): acp.RequestPermissionRequest => {
      const known = calls.get(`${params.sessionId}\u0000${params.toolCall.toolCallId}`)
      if (known === undefined) return params
      const { toolCall } = params
      return {
        ...params,
        toolCall: {
          ...toolCall,
          ...(toolCall.title === undefined || toolCall.title === null || toolCall.title === '' ? { title: known.title } : {}),
          ...(toolCall.kind === undefined || toolCall.kind === null ? { kind: known.kind as acp.ToolKind } : {}),
          ...(toolCall.rawInput === undefined || toolCall.rawInput === null ? { rawInput: known.rawInput } : {}),
        },
      }
    }

    // Updates are handled before anything else, so each is in its session's inbox before a later message is looked at.
    const app = acp
      .client({ name: 'althar' })
      .onNotification(acp.methods.client.session.update, ({ params }) => {
        remember(params.sessionId, params.update)
        receive(params.sessionId, { _tag: 'Update', update: params.update })
      })
      .onRequest(acp.methods.client.session.requestPermission, (request) => answerPermission(described(request.params), request.signal))
      .onRequest(acp.methods.client.elicitation.create, (request) => askQuestion(request.params))

    let owned: OwnedProcess | undefined
    let connection: acp.ClientConnection
    if (options.transport._tag === 'Process') {
      owned = yield* spawnOwned(
        options.transport.spec,
        options.transport.cwd,
        options.transport.capture === undefined ? {} : { capture: options.transport.capture },
      )
      connection = app.connect(acp.ndJsonStream(owned.stdin, owned.stdout))
    } else {
      connection = app.connect(options.transport.agent.app)
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
                Option.getOrUndefined(option),
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
      connection.agent.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: { elicitation: { form: {} }, _meta: structuredFailureCapability },
      }),
    )
    const capabilities = init.agentCapabilities ?? {}
    const steering =
      (init._meta as { readonly steering?: { readonly supported?: unknown } } | null | undefined)?.steering?.supported === true
    const info: AgentInfo = {
      name: init.agentInfo?.name ?? 'unknown',
      ...(init.agentInfo?.version === undefined ? {} : { version: init.agentInfo.version }),
      protocolVersion: init.protocolVersion,
      loadSession: capabilities.loadSession === true,
      closeSession: capabilities.sessionCapabilities?.close !== undefined && capabilities.sessionCapabilities.close !== null,
      steering,
      mcp: { http: capabilities.mcpCapabilities?.http === true, sse: capabilities.mcpCapabilities?.sse === true },
      authMethods: (init.authMethods ?? []).map((method) => method.id),
    }

    const startSession = (sessionOptions: NewSessionOptions): Effect.Effect<AgentSession, Failure | OptionUnavailable, Scope.Scope> =>
      Effect.gen(function* () {
        const state: SessionState = {
          inbox: yield* Queue.unbounded<Inbound>(),
          current: yield* Ref.make(Option.none<Turn>()),
          between: yield* PubSub.unbounded<SessionEvent>(),
        }
        starting += 1
        const started = yield* Effect.acquireRelease(
          call('session/new', () =>
            connection.agent.request(acp.methods.agent.session.new, {
              cwd: sessionOptions.cwd,
              mcpServers: (sessionOptions.mcpServers ?? []).map(mcpServer),
              ...(sessionOptions.additionalDirectories === undefined
                ? {}
                : { additionalDirectories: [...sessionOptions.additionalDirectories] }),
              ...(sessionOptions.meta === undefined ? {} : { _meta: { ...sessionOptions.meta } }),
            }),
          ).pipe(
            Effect.map((response) => {
              for (const inbound of early.get(response.sessionId) ?? []) Queue.offerUnsafe(state.inbox, inbound)
              early.delete(response.sessionId)
              sessions.set(response.sessionId, state)
              return response
            }),
            Effect.ensuring(
              Effect.sync(() => {
                starting -= 1
                if (starting === 0) early.clear()
              }),
            ),
          ),
          (response) =>
            Effect.gen(function* () {
              sessions.delete(response.sessionId)
              waiting.delete(response.sessionId)
              yield* Queue.shutdown(state.inbox)
              if (info.closeSession && !connection.signal.aborted) {
                yield* Effect.ignore(
                  call('session/close', () => connection.agent.request(acp.methods.agent.session.close, { sessionId: response.sessionId })),
                )
              }
            }),
        )
        const sessionId = started.sessionId
        const current = yield* Ref.make(normalizeOptions(started.configOptions))
        const mode = yield* Ref.make(started.modes?.currentModeId ?? '')
        const modeOptionOf = (all: ReadonlyArray<ConfigOption>) =>
          all.find((option) =>
            sessionOptions.modeOptionId === undefined ? option.category === 'mode' : option.id === sessionOptions.modeOptionId,
          )

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
            const modeNow = modeOptionOf(updated)
            if (modeNow !== undefined) yield* Ref.set(mode, String(modeNow.currentValue))
            return updated
          })

        /*
         * The mode is set before anything else, and checked. Agents expose it
         * as a config option, or as legacy session modes; an agent with
         * neither can't be made to ask, so the session is refused.
         */
        const modeOption = modeOptionOf(yield* Ref.get(current))
        const legacy = started.modes
        if (modeOption !== undefined) {
          yield* setOption(modeOption.id, sessionOptions.mode)
          if ((yield* Ref.get(mode)) !== sessionOptions.mode) {
            return yield* new OptionUnavailable({ configId: modeOption.id, value: sessionOptions.mode, available: modeOption.values })
          }
        } else if (legacy !== null && legacy !== undefined) {
          const available = legacy.availableModes.map((candidate) => candidate.id)
          if (!available.includes(sessionOptions.mode)) {
            return yield* new OptionUnavailable({ configId: 'mode', value: sessionOptions.mode, available })
          }
          yield* call('session/set_mode', () =>
            connection.agent.request(acp.methods.agent.session.setMode, { sessionId, modeId: sessionOptions.mode }),
          )
          yield* Ref.set(mode, sessionOptions.mode)
        } else {
          return yield* new OptionUnavailable({ configId: 'mode', value: sessionOptions.mode, available: [] })
        }

        /** What an update means here: the mode it changes, and a failure the agent reported in structured form. */
        const interpret = (update: acp.SessionUpdate) =>
          Effect.gen(function* () {
            const event = normalize(update)
            const events: Array<SessionEvent> = [event]
            if (event._tag === 'OptionsChanged') {
              yield* Ref.set(current, event.options)
              const changed = modeOptionOf(event.options)
              if (changed !== undefined && String(changed.currentValue) !== (yield* Ref.get(mode))) {
                yield* Ref.set(mode, String(changed.currentValue))
                events.push({ _tag: 'ModeChanged', modeId: String(changed.currentValue), byAgent: true })
              }
            } else if (event._tag === 'ModeChanged') {
              if (event.modeId === (yield* Ref.get(mode))) return []
              yield* Ref.set(mode, event.modeId)
            } else if (update.sessionUpdate === 'session_info_update') {
              const reported = structuredFailure(update._meta, yield* DateTime.nowAsDate)
              if (reported !== undefined) {
                const turn = yield* Ref.get(state.current)
                if (Option.isSome(turn) && reported.severity === 'error') turn.value.failure = reported.classified
                return [{ _tag: 'AgentFailure' as const, severity: reported.severity, classified: reported.classified }]
              }
            }
            return events
          })

        /** Passes an event to the current turn, or to the between-turns stream. */
        const deliver = (event: SessionEvent) =>
          Effect.flatMap(Ref.get(state.current), (turn) =>
            Option.isSome(turn) ? Effect.asVoid(Queue.offer(turn.value.queue, event)) : Effect.asVoid(PubSub.publish(state.between, event)),
          )

        const endTurn = (turn: Turn, ending: Effect.Effect<void>) =>
          Effect.gen(function* () {
            yield* Ref.set(state.current, Option.none())
            yield* ending
            yield* Deferred.succeed(turn.done, undefined)
          })

        /** Sends a prompt; how it ends arrives in the inbox, after every update it produced. */
        const send = (text: string) =>
          Effect.sync(() => {
            connection.agent.request(acp.methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text }] }).then(
              (response) => receive(sessionId, { _tag: 'Stopped', response }),
              (cause: unknown) => receive(sessionId, { _tag: 'PromptFailed', cause }),
            )
          })

        /** A prompt has stopped: resume it if a rejection stopped it, or end the turn. */
        const stopped = (turn: Turn, response: acp.PromptResponse) =>
          Effect.gen(function* () {
            if (turn.resumeWith !== undefined && turn.resumes < MAX_RESUMES) {
              const reason = turn.resumeWith
              turn.resumeWith = undefined
              turn.resumes += 1
              yield* Queue.offer(turn.queue, { _tag: 'Resumed', reason })
              yield* send(reason)
              return
            }
            const usage = normalizeUsage(response.usage)
            yield* endTurn(
              turn,
              Effect.gen(function* () {
                yield* Queue.offer(turn.queue, {
                  _tag: 'TurnEnded',
                  stopReason: response.stopReason,
                  ...(usage === undefined ? {} : { usage }),
                  ...(turn.failure === undefined ? {} : { failure: turn.failure }),
                })
                yield* Queue.end(turn.queue)
              }),
            )
          })

        /* One reader for the session's life. It reads everything, so a turn always reads to its own end. */
        yield* Effect.forkScoped(
          Effect.forever(
            Effect.gen(function* () {
              const inbound = yield* Queue.take(state.inbox)
              const turn = Option.getOrUndefined(yield* Ref.get(state.current))
              switch (inbound._tag) {
                case 'Update':
                  for (const event of yield* interpret(inbound.update)) yield* deliver(event)
                  return
                case 'Event':
                  if (turn !== undefined && inbound.resumeWith !== undefined) turn.resumeWith = inbound.resumeWith
                  return yield* deliver(inbound.event)
                case 'Stopped':
                  if (turn !== undefined) yield* stopped(turn, inbound.response)
                  return
                case 'PromptFailed': {
                  if (turn === undefined) return
                  const error = yield* Effect.flip(failure('session/prompt', inbound.cause))
                  return yield* endTurn(turn, Effect.asVoid(Queue.fail(turn.queue, error)))
                }
              }
            }),
          ),
        )

        const prompt = (
          text: string,
          onStarted: Effect.Effect<void> = Effect.void,
        ): Stream.Stream<SessionEvent, Failure | TurnInProgress> =>
          Stream.unwrap(
            Effect.gen(function* () {
              const turn: Turn = {
                queue: yield* Queue.unbounded<SessionEvent, Failure | Cause.Done>(),
                done: yield* Deferred.make<void>(),
                resumeWith: undefined,
                resumes: 0,
                failure: undefined,
              }
              const idle = yield* Ref.modify(state.current, (running) =>
                Option.isSome(running) ? [false, running] : [true, Option.some(turn)],
              )
              if (!idle) return yield* new TurnInProgress({ sessionId })
              yield* send(text)
              yield* onStarted
              return Stream.fromQueue(turn.queue)
            }),
          )

        const cancel = Effect.andThen(
          call('session/cancel', () => connection.agent.notify(acp.methods.agent.session.cancel, { sessionId })),
          Effect.sync(() => {
            for (const drop of waiting.get(sessionId) ?? []) drop()
          }),
        )

        const interrupt = Effect.gen(function* () {
          const turn = yield* Ref.get(state.current)
          if (Option.isNone(turn)) return
          yield* cancel
          yield* Deferred.await(turn.value.done)
        })

        return {
          sessionId,
          options: Ref.get(current),
          mode: Ref.get(mode),
          prompt,
          events: Stream.fromPubSub(state.between),
          cancel,
          interrupt,
          setOption,
        } satisfies AgentSession
      })

    /** Each session gets a scope of its own inside the caller's, so one that fails to start is closed at once. */
    const newSession = (sessionOptions: NewSessionOptions): Effect.Effect<AgentSession, Failure | OptionUnavailable, Scope.Scope> =>
      Effect.gen(function* () {
        const scope = yield* Scope.fork(yield* Scope.Scope, 'sequential')
        return yield* startSession(sessionOptions).pipe(
          Scope.provide(scope),
          Effect.onError((cause) => Scope.close(scope, Exit.failCause(cause))),
        )
      })

    return {
      info,
      ...(owned === undefined
        ? {}
        : {
            process: {
              pid: owned.pid,
              ...(owned.osStartedAt === undefined ? {} : { osStartedAt: owned.osStartedAt }),
              environmentDigest: owned.environmentDigest,
              stopped: Deferred.await(owned.stopped),
            },
          }),
      closed,
      newSession,
    } satisfies AgentConnection
  })
