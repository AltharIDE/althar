import * as acp from '@agentclientprotocol/sdk'
import type { ToolKind } from '@althar/domain'
import { Cause, Data, DateTime, Deferred, Duration, Effect, Exit, Option, PubSub, Queue, Ref, Scope, Stream } from 'effect'

import { AgentExited, AgentRequestFailed, type AgentStartFailed, OptionUnavailable, TurnInProgress } from './errors'
import {
  type ConfigOption,
  normalize,
  normalizeOptions,
  normalizeUsage,
  type PermissionScope,
  type SessionEvent,
  terminalOutputCapability,
} from './events'
import { type Classified, classify, structuredFailure, structuredFailureCapability } from './failures'
import {
  asyncTasksCapability,
  type BackgroundEvent,
  stopBackgroundMethod,
  type StopBackgroundResponse,
  takingBackground,
} from './background'
import { type CapturedFrame, type OwnedProcess, type ProcessExit, spawnOwned, type StopReport } from './process'
import { type Question, type QuestionAnswer, type QuestionField, questionFields } from './questions'
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
  /**
   * The agent runs as a process Althar owns. `capture` receives the raw protocol, numbered, in both directions; `stderr`, what
   * the process writes there, for the app's log.
   */
  | {
      readonly _tag: 'Process'
      readonly spec: LaunchSpec
      readonly cwd: string
      readonly capture?: (frame: CapturedFrame) => void
      readonly stderr?: (chunk: string, pid: number) => void
    }
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

/** Althar's permission decision. Coordinator denials are explained at the next turn boundary, even when the provider's rejection carries on. */
export interface PermissionDecision {
  readonly decision: 'allow' | 'reject'
  readonly reason?: string
  readonly decidedBy?: 'coordinator'
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
  /** It takes images in a prompt (ACP's `promptCapabilities.image`); without it, a prompt is text only. */
  readonly images: boolean
}

/** An image sent in a prompt, after its text: its bytes in base64, and what they are. */
export interface PromptImage {
  readonly data: string
  readonly mimeType: string
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
  /**
   * The mode to start in: a session never runs in the mode the agent
   * defaults to (ADR-007). Null only for an agent that has no modes and asks
   * by what `meta` holds it to (the registry's entry says so): one that
   * offers modes after all is refused, as its entry no longer says what it is.
   */
  readonly mode: string | null
  /** The id of the agent's mode option (the registry's `options.mode`). Without it, the option in the `mode` category is used. */
  readonly modeOptionId?: string
  readonly mcpServers?: ReadonlyArray<McpServer>
  readonly additionalDirectories?: ReadonlyArray<string>
  /** Extra `_meta` for `session/new`: the registry's `sessionMeta`. */
  readonly meta?: Readonly<Record<string, unknown>>
  /**
   * Config options held at a value for the session's whole life, such as one
   * that approves every request while on (Copilot's `allow_all`): set as it
   * starts, where the agent offers them, and set back whenever the agent says
   * one moved. Where it can't be set back, the turn is stopped as failed, and
   * the session takes no more prompts.
   */
  readonly held?: Readonly<Record<string, string>>
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
   * stopped early, so nothing it says reaches a later turn. Images go after
   * the text, in their order, only to an agent that takes them
   * (`AgentInfo.images`): the caller says what became of any it can't.
   * `started` runs once the prompt is sent and the turn can be interrupted,
   * so what it sets off may stop the turn at once.
   */
  prompt(
    text: string,
    images?: ReadonlyArray<PromptImage>,
    started?: Effect.Effect<void>,
  ): Stream.Stream<SessionEvent, Failure | TurnInProgress>
  /** Updates that arrive between turns, such as the agent changing its own mode. */
  readonly events: Stream.Stream<SessionEvent>
  /** Asks the agent to stop the current turn; the turn then ends with `cancelled`. */
  readonly cancel: Effect.Effect<void, Failure>
  /** Cancels the current turn, if there is one, and waits until it has ended. The start of interrupt-and-continue. */
  readonly interrupt: Effect.Effect<void, Failure>
  /** Sets a config option, such as the model, and returns every option as the agent now reports it. */
  setOption(configId: string, value: string): Effect.Effect<ReadonlyArray<ConfigOption>, Failure | OptionUnavailable>
  /** Stops a command it left running (background.ts); whether there was one to stop. Closing the session stops them all. */
  stopBackground(id: string): Effect.Effect<boolean, Failure>
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
  /**
   * Answers a question the agent asks the person. Without it the agent is
   * offered no way to ask (no form elicitation), so it asks in what it says
   * or decides for itself. It is interrupted if the agent withdraws the
   * question or Althar cancels the turn.
   */
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
  /** A stopping rejection or coordinator denial to explain at the next turn boundary. */
  resumeWith: string | undefined
  resumes: number
  cancelled: boolean
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

    /** The commands each session left running, as the agent last said, so closing it can stop them. */
    const leftRunning = new Map<string, Set<string>>()
    const heardBackground = (sessionId: string, event: BackgroundEvent) => {
      const running = leftRunning.get(sessionId) ?? new Set<string>()
      leftRunning.set(sessionId, running)
      if (event._tag === 'BackgroundStarted') running.add(event.id)
      if (event._tag === 'BackgroundEnded') running.delete(event.id)
      receive(sessionId, { _tag: 'Event', event })
    }

    /** Permission requests and questions waiting for an answer, by session: each entry drops its request. */
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
        const explain = decision === 'reject' && (chosen.stopsTurn || decided.decidedBy === 'coordinator')
        receive(params.sessionId, {
          _tag: 'Event',
          event: { _tag: 'PermissionAnswered', toolCallId: request.toolCallId, decision, ...chosen },
          ...(explain
            ? {
                resumeWith: `${request.title} was not allowed by ${decided.decidedBy === 'coordinator' ? 'the coordinator' : "the project's rules"}${reason === undefined ? '' : `: ${reason}`}. Carry on without it.`,
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

    /**
     * Asks the person through the caller. The question is dropped, and
     * answered `cancel`, when the agent withdraws it or Althar cancels the
     * turn, as a permission request is. The agent going is not the agent
     * withdrawing it: the question still waits, and the caller lets it go
     * when the session ends (ADR-021).
     */
    const askQuestion = (params: acp.CreateElicitationRequest, fromAgent: AbortSignal): Promise<acp.CreateElicitationResponse> => {
      if (options.onQuestion === undefined || params.mode !== 'form' || !('requestedSchema' in params))
        return Promise.resolve({ action: 'cancel' })
      const sessionId = 'sessionId' in params && typeof params.sessionId === 'string' ? params.sessionId : undefined
      const toolCallId = 'toolCallId' in params && typeof params.toolCallId === 'string' ? params.toolCallId : undefined
      return asked(sessionId, toolCallId, params.message, questionFields(params.requestedSchema, params.message), fromAgent).then(
        (answer): acp.CreateElicitationResponse =>
          answer.action === 'accept'
            ? { action: 'accept', content: { ...answer.content } as Record<string, string | number | boolean | Array<string>> }
            : { action: answer.action },
      )
    }

    /*
     * A permission request that is the model asking the person (the registry's
     * `questions`: Antigravity's `interaction_` tool calls, one option for each
     * answer, all `allow_once`): a question of one choice, never the rules', as
     * the rules would allow the first answer. With no one to ask, it is cancelled.
     */
    const askChoice = (params: acp.RequestPermissionRequest, fromAgent: AbortSignal): Promise<acp.RequestPermissionResponse> => {
      if (options.onQuestion === undefined) return Promise.resolve(CANCELLED)
      const toolCall = params.toolCall as { readonly toolCallId: string; readonly title?: string | null }
      const known = calls.get(`${params.sessionId}\u0000${toolCall.toolCallId}`)
      const asking = toolCall.title?.trim() || known?.title?.trim() || 'The agent asks you to choose.'
      const field: QuestionField = {
        id: 'answer',
        question: asking,
        type: 'choice',
        options: params.options.map((option) => ({ value: option.optionId, label: option.name })),
        multiple: false,
        required: true,
      }
      return asked(params.sessionId, toolCall.toolCallId, asking, [field], fromAgent).then((answer) => {
        const chosen = answer.action === 'accept' ? answer.content.answer : undefined
        return typeof chosen === 'string' && params.options.some((option) => option.optionId === chosen)
          ? { outcome: { outcome: 'selected', optionId: chosen } }
          : CANCELLED
      })
    }

    /** Asks the person, until the agent withdraws the question or the connection closes; a cancel where no one could. */
    const asked = (
      sessionId: string | undefined,
      toolCallId: string | undefined,
      message: string,
      fields: ReadonlyArray<QuestionField>,
      fromAgent: AbortSignal,
    ): Promise<QuestionAnswer> => {
      const ask = options.onQuestion
      if (ask === undefined) return Promise.resolve({ action: 'cancel' })
      // What it said just before: since its last tool call, or else the last it said before that, in this turn.
      const heard = sessionId === undefined ? undefined : said.get(sessionId)
      const before = heard?.current.trim() || heard?.last.trim() || ''
      const question: Question = {
        ...(sessionId === undefined ? {} : { sessionId }),
        ...(toolCallId === undefined ? {} : { toolCallId }),
        message,
        fields,
        ...(before === '' ? {} : { said: before }),
      }
      const dropped = new AbortController()
      const drop = () => dropped.abort()
      // The connection closing aborts every request still open on it, before the agent could say anything.
      const withdrawn = () => {
        if (!connection.signal.aborted) drop()
      }
      const pending = sessionId === undefined ? undefined : waitingIn(sessionId)
      pending?.add(drop)
      fromAgent.addEventListener('abort', withdrawn, { once: true })
      return Effect.runPromiseWith(context)(ask(question), { signal: dropped.signal })
        .then(
          (answer): QuestionAnswer => (dropped.signal.aborted ? { action: 'cancel' } : answer),
          (): QuestionAnswer => ({ action: 'cancel' }),
        )
        .finally(() => {
          pending?.delete(drop)
          fromAgent.removeEventListener('abort', withdrawn)
        })
    }

    /*
     * What each tool call said about itself, by session and call. Codex asks
     * permission for an MCP tool with no title or input of its own; the call
     * it asks about said both when it began, so the request takes them from it.
     */
    const calls = new Map<string, { title?: string; kind?: string; rawInput?: unknown }>()
    /**
     * What the agent has said in its turn, by session: its words since its
     * last tool call, and the last it said before that. A question it asks
     * carries them, as what it said before asking.
     */
    const said = new Map<string, { current: string; last: string }>()
    const hear = (sessionId: string, update: acp.SessionUpdate) => {
      const heard = said.get(sessionId) ?? { current: '', last: '' }
      if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') heard.current += update.content.text
      else if (update.sessionUpdate === 'tool_call' && heard.current.trim() !== '') {
        heard.last = heard.current
        heard.current = ''
      } else if (update.sessionUpdate === 'tool_call') heard.current = ''
      said.set(sessionId, heard)
    }

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
        hear(params.sessionId, params.update)
        receive(params.sessionId, { _tag: 'Update', update: params.update })
      })
      .onRequest(acp.methods.client.session.requestPermission, (request) =>
        options.permissions?.questions !== undefined && request.params.toolCall.toolCallId.startsWith(options.permissions.questions)
          ? askChoice(request.params, request.signal)
          : answerPermission(described(request.params), request.signal),
      )
      .onRequest(acp.methods.client.elicitation.create, (request) => askQuestion(request.params, request.signal))

    let owned: OwnedProcess | undefined
    let connection: acp.ClientConnection
    if (options.transport._tag === 'Process') {
      const { capture, stderr } = options.transport
      owned = yield* spawnOwned(options.transport.spec, options.transport.cwd, {
        ...(capture === undefined ? {} : { capture }),
        ...(stderr === undefined ? {} : { stderr }),
      })
      connection = app.connect(takingBackground(acp.ndJsonStream(owned.stdin, owned.stdout), heardBackground))
    } else {
      // In process, over a pair of streams, so what it leaves running is taken off them as a process's would be.
      const toAgent = new TransformStream<acp.AnyMessage, acp.AnyMessage>()
      const toClient = new TransformStream<acp.AnyMessage, acp.AnyMessage>()
      const peer = options.transport.agent.app.connect({ readable: toAgent.readable, writable: toClient.writable })
      const client = app.connect(takingBackground({ readable: toClient.readable, writable: toAgent.writable }, heardBackground))
      void client.closed.then(() => peer.close())
      void peer.closed.then(() => client.close())
      connection = client
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
        clientCapabilities: {
          // A way to ask only where someone answers: without it Claude Code turns AskUserQuestion off.
          ...(options.onQuestion === undefined ? {} : { elicitation: { form: {} } }),
          // What the agent says of itself, such as a command stopped, as a notice rather than in its own words.
          session: { notices: {} },
          _meta: {
            jetbrains: {
              air: {
                ...structuredFailureCapability.jetbrains.air,
                capabilities: [...structuredFailureCapability.jetbrains.air.capabilities, asyncTasksCapability],
              },
            },
            ...terminalOutputCapability,
          },
        },
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
      images: capabilities.promptCapabilities?.image === true,
    }

    /** Asks the agent to stop a command a session left running; whether it did. */
    const stopBackground = (sessionId: string, id: string) =>
      Effect.map(
        call(stopBackgroundMethod, () =>
          connection.agent.request<StopBackgroundResponse>(stopBackgroundMethod, { sessionId, asyncTaskId: id }),
        ),
        (response) => response.stopped === true,
      )

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
              // What it left running is stopped first: it runs in a process group of its own, which stopping the agent's misses.
              for (const id of leftRunning.get(response.sessionId) ?? []) {
                if (connection.signal.aborted) break
                yield* Effect.ignore(stopBackground(response.sessionId, id).pipe(Effect.timeout(Duration.seconds(2))))
              }
              leftRunning.delete(response.sessionId)
              sessions.delete(response.sessionId)
              waiting.delete(response.sessionId)
              yield* Queue.shutdown(state.inbox)
              if (info.closeSession && !connection.signal.aborted) {
                yield* Effect.ignore(
                  call('session/close', () => connection.agent.request(acp.methods.agent.session.close, { sessionId: response.sessionId })),
                )
              }
            }),
          // Interruptible so the runtime's startup timeout can cut off a handshake that hangs; don't make it uninterruptible.
          { interruptible: true },
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
         * neither can't be made to ask, so the session is refused, unless it
         * is one that asks by its `_meta` and is started with no mode.
         */
        const modeOption = modeOptionOf(yield* Ref.get(current))
        const legacy = started.modes
        const legacyIds = legacy?.availableModes.map((candidate) => candidate.id) ?? []
        if (sessionOptions.mode === null) {
          if (modeOption !== undefined || legacyIds.length > 0) {
            return yield* new OptionUnavailable({
              configId: modeOption?.id ?? 'mode',
              value: '',
              available: modeOption?.values ?? legacyIds,
            })
          }
        } else if (modeOption !== undefined) {
          yield* setOption(modeOption.id, sessionOptions.mode)
          if ((yield* Ref.get(mode)) !== sessionOptions.mode) {
            return yield* new OptionUnavailable({ configId: modeOption.id, value: sessionOptions.mode, available: modeOption.values })
          }
        } else if (legacy !== null && legacy !== undefined) {
          const modeId = sessionOptions.mode
          if (!legacyIds.includes(modeId)) return yield* new OptionUnavailable({ configId: 'mode', value: modeId, available: legacyIds })
          yield* call('session/set_mode', () => connection.agent.request(acp.methods.agent.session.setMode, { sessionId, modeId }))
          yield* Ref.set(mode, modeId)
        } else {
          return yield* new OptionUnavailable({ configId: 'mode', value: sessionOptions.mode, available: [] })
        }

        /** Each held option the agent offers that isn't where it is held, as it now says. */
        const held = Object.entries(sessionOptions.held ?? {})
        const loose = (all: ReadonlyArray<ConfigOption>) =>
          held.filter(([configId, value]) => {
            const option = all.find((candidate) => candidate.id === configId)
            return option !== undefined && String(option.currentValue) !== value
          })
        // Where the agent can't be held there, the session is refused, as for a mode it can't be put in: an agent that
        // answers yes and leaves the option where it was is held no more than one that answers no.
        for (const [configId, value] of loose(yield* Ref.get(current))) yield* setOption(configId, value)
        const [stillLoose] = loose(yield* Ref.get(current))
        if (stillLoose !== undefined) {
          const [configId, value] = stillLoose
          const option = (yield* Ref.get(current)).find((candidate) => candidate.id === configId)
          return yield* new OptionUnavailable({ configId, value, available: option?.type === 'select' ? option.values : [] })
        }

        const cancel = Effect.gen(function* () {
          const turn = yield* Ref.get(state.current)
          if (Option.isSome(turn)) turn.value.cancelled = true
          yield* call('session/cancel', () => connection.agent.notify(acp.methods.agent.session.cancel, { sessionId }))
          for (const drop of waiting.get(sessionId) ?? []) drop()
        })

        /**
         * A held option the agent moved and Althar couldn't set back: the
         * session no longer asks as it was started to, so its turn is stopped
         * and it takes no more prompts. A new one is held from its start.
         */
        let unheld: { readonly configId: string; readonly value: string } | undefined
        const unheldWords = (moved: { readonly configId: string; readonly value: string }) =>
          `The agent's ${moved.configId} moved, and Althar couldn't set it back to ${moved.value}, so it stopped the session.`

        /** What an update means here: the mode it changes, and a failure the agent reported in structured form. */
        const interpret = (update: acp.SessionUpdate) =>
          Effect.gen(function* () {
            const event = normalize(update)
            const events: Array<SessionEvent> = [event]
            if (event._tag === 'OptionsChanged') {
              yield* Ref.set(current, event.options)
              // A held option the agent moved goes back before anything else it says is read, for as long as an agent
              // that answers one request at a time may take; nothing Althar answers waits on this reader meanwhile.
              for (const [configId, value] of loose(event.options)) {
                const restored = yield* Effect.exit(setOption(configId, value).pipe(Effect.timeout(Duration.seconds(10))))
                // Set back only where the agent says it is: a yes that leaves it where it was is no.
                if (Exit.isSuccess(restored) && !loose(restored.value).some(([id]) => id === configId)) {
                  events.push({ _tag: 'Notice', severity: 'info', title: `Althar set the agent's ${configId} back to ${value}.` })
                  continue
                }
                // Left where it approves without asking, it goes no further: the turn fails, and nothing more is sent.
                unheld ??= { configId, value }
                const turn = Option.getOrUndefined(yield* Ref.get(state.current))
                if (turn !== undefined) turn.failure = { failure: 'unknown', message: unheldWords(unheld) }
                yield* Effect.ignore(cancel)
                events.push({ _tag: 'Notice', severity: 'error', title: unheldWords(unheld) })
              }
              const changed = modeOptionOf(yield* Ref.get(current))
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
        const send = (text: string, images: ReadonlyArray<PromptImage> = []) =>
          Effect.sync(() => {
            const prompt: Array<acp.ContentBlock> = [
              { type: 'text', text },
              // An agent that doesn't say it takes images is never sent one: ACP's baseline is text.
              ...(info.images
                ? images.map((image): acp.ContentBlock => ({ type: 'image', data: image.data, mimeType: image.mimeType }))
                : []),
            ]
            connection.agent.request(acp.methods.agent.session.prompt, { sessionId, prompt }).then(
              (response) => receive(sessionId, { _tag: 'Stopped', response }),
              (cause: unknown) => receive(sessionId, { _tag: 'PromptFailed', cause }),
            )
          })

        /** Explain pending refusals before ending the turn. ACP's permission response has no portable reason field. */
        const stopped = (turn: Turn, response: acp.PromptResponse) =>
          Effect.gen(function* () {
            if (!turn.cancelled && turn.resumeWith !== undefined && turn.resumes < MAX_RESUMES) {
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
                  if (turn !== undefined && inbound.resumeWith !== undefined)
                    turn.resumeWith = [turn.resumeWith, inbound.resumeWith]
                      .filter((line) => line !== undefined)
                      .join('\n')
                      .slice(0, 8000)
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
          images?: ReadonlyArray<PromptImage>,
          started: Effect.Effect<void> = Effect.void,
        ): Stream.Stream<SessionEvent, Failure | TurnInProgress> =>
          Stream.unwrap(
            Effect.gen(function* () {
              if (unheld !== undefined)
                return yield* new AgentRequestFailed({
                  method: 'session/set_config_option',
                  failure: 'unknown',
                  message: unheldWords(unheld),
                })
              const turn: Turn = {
                queue: yield* Queue.unbounded<SessionEvent, Failure | Cause.Done>(),
                done: yield* Deferred.make<void>(),
                resumeWith: undefined,
                resumes: 0,
                cancelled: false,
                failure: undefined,
              }
              const idle = yield* Ref.modify(state.current, (running) =>
                Option.isSome(running) ? [false, running] : [true, Option.some(turn)],
              )
              if (!idle) return yield* new TurnInProgress({ sessionId })
              // A new turn: what it says before a question is of this turn only.
              said.delete(sessionId)
              yield* send(text, images)
              yield* started
              return Stream.fromQueue(turn.queue)
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
          stopBackground: (id) => stopBackground(sessionId, id),
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
