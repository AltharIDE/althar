import type * as acp from '@agentclientprotocol/sdk'

/*
 * What agents said when their connection failed, recorded on 25 October 2026
 * by driving each adapter over ACP, as Althar does (asking for Claude Code's
 * structured failures), against an API host that wasn't there, couldn't be
 * looked up, dropped the connection, or answered with an error:
 * claude-agent-acp 0.95.0, codex-acp 2.2.2 and OpenCode 1.18. Only the ids
 * are shortened. The fake agent replays them, and the failure tests read them.
 *
 * - Claude Code retries by itself first, saying so as warnings ("Reconnecting
 *   to Claude, attempt 1 of 10.", ten over three minutes when nothing
 *   answers), then ends the turn `end_turn`, having used no tokens, with the
 *   failure on the prompt's response: never as an error.
 * - Codex, offline, never ends its turn: it waits for the network, saying so
 *   every minute. An API host that answers with errors it retries five times,
 *   then ends the turn as Claude Code does.
 * - OpenCode retries quietly for about a minute, then fails the prompt with a
 *   JSON-RPC internal error.
 */

const failure = (failed: {
  readonly id: string
  readonly category: string
  readonly severity: 'warning' | 'error'
  readonly title: string
  readonly actions: ReadonlyArray<string>
}) => ({ jetbrains: { air: { version: 1, sessionFailure: { revision: 1, ...failed } } } })

/** A turn's response that used nothing, as Claude Code ends one it gave up on. */
const claudeEnded = (title: string, category = 'service'): acp.PromptResponse => ({
  stopReason: 'end_turn',
  usage: { inputTokens: 0, outputTokens: 0, cachedReadTokens: 0, cachedWriteTokens: 0, totalTokens: 0 },
  _meta: {
    quota: {
      token_count: {
        totalTokens: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        cachedWriteTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
      },
      model_usage: [],
    },
    ...failure({ id: 'turn:error', category, severity: 'error', title, actions: ['retry'] }),
  },
})

/** Claude Code's warning as it tries again by itself, and the turn it then gives up, with what it says. */
const claudeGaveUp = (retrying: { readonly category: string; readonly title: string }, title: string, category = 'service') => ({
  retrying: claudeRetrying(retrying.category, retrying.title),
  ended: claudeEnded(title, category),
  title,
})

/** Claude Code's warning as it tries again by itself. */
const claudeRetrying = (category: string, title: string): acp.SessionUpdate => ({
  sessionUpdate: 'session_info_update',
  _meta: failure({ id: 'session:session-error:1', category, severity: 'warning', title, actions: [] }),
})

export const recorded = {
  claude: {
    /** Nothing listening at the API's address. */
    refused: claudeGaveUp(
      { category: 'connection', title: 'Reconnecting to Claude, attempt 1 of 10.' },
      'API Error: Connection refused — a firewall or proxy may be blocking it (ECONNREFUSED)',
    ),
    /** The API's name can't be looked up: the computer is offline. */
    offline: claudeGaveUp(
      { category: 'connection', title: 'Reconnecting to Claude, attempt 1 of 10.' },
      "API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)",
    ),
    /** The connection dropped mid-request. */
    dropped: claudeGaveUp(
      { category: 'connection', title: 'Reconnecting to Claude, attempt 1 of 10.' },
      'API Error: Connection dropped (ECONNRESET)',
    ),
    serverError: claudeGaveUp(
      { category: 'service', title: 'Retrying Claude, attempt 1 of 10.' },
      'API Error: 500 Internal server error. This is a server-side issue, usually temporary — try again in a moment. If it persists, check your inference gateway (127.0.0.1:51768).',
    ),
    overloaded: claudeGaveUp(
      { category: 'service', title: 'Retrying Claude, attempt 1 of 10.' },
      'API Error: 529 Overloaded. This is a server-side issue, usually temporary — try again in a moment. If it persists, check your inference gateway (127.0.0.1:51769).',
    ),
    rateLimited: claudeGaveUp(
      { category: 'limit', title: 'Retrying Claude, attempt 1 of 10.' },
      'API Error: Request rejected (429) · Rate limited',
      'limit',
    ),
  },
  codex: {
    /** Offline: it waits for the network, its turn never ending. */
    waiting: {
      sessionUpdate: 'session_info_update',
      _meta: failure({
        id: 'turn:error',
        category: 'connection',
        severity: 'warning',
        title: 'Reconnecting... waiting for network',
        actions: [],
      }),
    } satisfies acp.SessionUpdate,
    /** Errors from the API host, retried five times, then given up on. */
    serverError: {
      retrying: {
        sessionUpdate: 'session_info_update',
        _meta: failure({ id: 'turn:error', category: 'connection', severity: 'warning', title: 'Reconnecting... 2/5', actions: [] }),
      } satisfies acp.SessionUpdate,
      ended: {
        stopReason: 'end_turn',
        usage: null,
        _meta: {
          quota: { token_count: null, model_usage: [] },
          ...failure({
            id: 'turn:error',
            category: 'service',
            severity: 'error',
            title: 'We’re currently experiencing high demand, which may cause temporary errors.',
            actions: ['retry', 'new_session'],
          }),
        },
      } satisfies acp.PromptResponse,
    },
  },
  opencode: {
    /** Nothing listening at the API's address: the prompt fails. */
    refused: {
      code: -32603,
      message: 'Internal error: Cannot connect to API: Unable to connect. Is the computer able to access the url?',
      data: { service: 'session', errorName: 'APIError' },
    },
    serverError: { code: -32603, message: 'Internal error: Internal server error', data: { service: 'session', errorName: 'APIError' } },
  },
} as const
