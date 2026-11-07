import { describe, expect, it } from 'vitest'

import { firstErrorLine, startFailureOf } from '../src/startFailure'
import { recorded } from '../src/testing/recorded'

/*
 * Why an agent couldn't start or be reached (DEV-196), read from what each
 * agent and the system really said. Each fixture is a verbatim output, with
 * where it came from; the classes are the ones a person can act on.
 */

describe('an agent that isn’t installed', () => {
  it.each([
    // Node's spawn, for a command not on the PATH (Node 24).
    ['spawn claude ENOENT', 'node'],
    ['Error: spawn codex ENOENT', 'node'],
    // A shell running it by name (bash), and Windows' cmd.exe.
    ['sh: 1: opencode: command not found', 'sh'],
    ["'grok' is not recognized as an internal or external command,\r\noperable program or batch file.", 'cmd.exe'],
  ])('%s (%s)', (said) => {
    expect(startFailureOf(said)).toBe('not_installed')
  })
})

describe('an agent that isn’t signed in', () => {
  it.each([
    // Claude Code 2.1.319's bundle: no sign-in, interactive and not (`-p`, the SDK, ACP).
    ['Not logged in · Please run /login', 'Claude Code'],
    ['Authentication required · Sign in again to continue', 'Claude Code'],
    ['Invalid API key · Fix external API key', 'Claude Code'],
    ['Please run /login · API Error: 401 Unauthorized', 'Claude Code'],
    // Claude Code 1.0.x (anthropics/claude-code#551).
    ['Invalid API key · Please run /login', 'Claude Code'],
    // Claude Code's ACP adapter, refusing a session for its sign-in (-32000).
    ['Authentication required', 'claude-agent-acp'],
    // Codex's `codex login status` (codex-rs/cli/src/login.rs), and a request sent with no sign-in (protocol/src/error.rs).
    ['Not logged in', 'Codex'],
    // Its template, `unexpected status 401 Unauthorized: {message}`, with the API's message left out.
    ['unexpected status 401 Unauthorized: …', 'Codex'],
    // OpenCode 2.2.5, a provider with no key (2 November 2026, recorded in failures.test.ts), and its Claude Code integration.
    ['Authentication required: provider authentication required', 'OpenCode'],
    ['Claude Code is not logged in. Run `claude auth login` in a terminal.', 'OpenCode'],
  ])('%s (%s)', (said) => {
    expect(startFailureOf(said)).toBe('signed_out')
  })

  it('takes a refusal the failure table classed as a sign-in, whatever its words', () => {
    expect(startFailureOf('Internal error', true)).toBe('signed_out')
  })
})

describe('an agent whose sign-in ended', () => {
  it.each([
    // Claude Code 2.1.319's bundle: a login past its end, at its time limit, or revoked; interactive and not.
    ['Login expired · Please run /login', 'Claude Code'],
    ['Failed to authenticate: OAuth session expired and could not be refreshed', 'Claude Code'],
    ['Login reached its time limit · Please run /login', 'Claude Code'],
    [
      'Failed to authenticate: this login reached its time limit and cannot be renewed. Run `claude auth login` to sign in again, or use `claude setup-token` and set CLAUDE_CODE_OAUTH_TOKEN for unattended jobs',
      'Claude Code',
    ],
    ['Failed to authenticate: this login reached its time limit · Sign in again to continue', 'Claude Code'],
    ['OAuth token revoked · Please run /login', 'Claude Code'],
    ['Failed to authenticate: OAuth token revoked. Please log in again or contact your administrator.', 'Claude Code'],
    // Claude Code 2.1.12 (anthropics/claude-code#19078), the API's own words.
    [
      'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth token has expired. Please obtain a new token or refresh your existing token."},"request_id":"req_011"} · Please run /login',
      'Claude Code',
    ],
    // Codex, a ChatGPT sign-in whose refresh failed for good (codex-rs/login/src/auth/manager.rs).
    ['Your access token could not be refreshed because your refresh token has expired. Please log out and sign in again.', 'Codex'],
    ['Your access token could not be refreshed because your refresh token was already used. Please log out and sign in again.', 'Codex'],
    ['Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again.', 'Codex'],
    ['Your access token could not be refreshed. Please log out and sign in again.', 'Codex'],
    // OpenCode 2.2.6, an integration to sign in to again.
    ['Reconnect OpenCode Console to continue', 'OpenCode'],
    ['Sign in with SSO again to use Anthropic', 'OpenCode'],
  ])('%s (%s)', (said) => {
    expect(startFailureOf(said)).toBe('sign_in_ended')
  })

  it('wins over the plain sign-in its words also say, though the failure table classed it as one', () => {
    expect(startFailureOf('Login expired · Please run /login', true)).toBe('sign_in_ended')
  })
})

describe('an agent that can’t reach its servers', () => {
  it.each([
    // Recorded against an API host that wasn't there (src/testing/recorded.ts, 25 October 2026).
    [recorded.claude.offline.title, 'Claude Code, offline'],
    [recorded.claude.refused.title, 'Claude Code, refused'],
    [recorded.codex.waiting._meta.jetbrains.air.sessionFailure.title, 'Codex, offline'],
    [recorded.opencode.refused.message, 'OpenCode, refused'],
    // Claude Code 2.1.319's bundle, and as people reported it (anthropics/claude-code#35094, #71188).
    ['API Error: No internet route — check your connection or VPN (ENETUNREACH)', 'Claude Code'],
    ['API Error: Unable to connect to API. Check your internet connection', 'Claude Code'],
    ['Unable to connect to API (ConnectionRefused)', 'Claude Code'],
    // Codex (protocol/src/error.rs), with what reqwest says under it.
    ['Connection failed: error sending request for url (https://chatgpt.com/backend-api/codex/responses)', 'Codex'],
    // OpenCode 2.2.6, its own server (packages/cli/src/services/server-connection.ts).
    ['Could not reach server at http://127.0.0.1:4096: fetch failed', 'OpenCode'],
    // Node's resolver, the name not looked up.
    ['getaddrinfo ENOTFOUND api.anthropic.com', 'node'],
  ])('%s (%s)', (said) => {
    expect(startFailureOf(said)).toBe('unreachable')
  })

  it('is not a connection that dropped mid-way, or a server’s own trouble: the agent reached them', () => {
    expect(startFailureOf('stream disconnected before completion: error decoding response body')).toBeUndefined()
    expect(startFailureOf(recorded.claude.dropped.title)).toBeUndefined()
    expect(startFailureOf(recorded.claude.serverError.title)).toBeUndefined()
    expect(startFailureOf(recorded.opencode.serverError.message)).toBeUndefined()
  })
})

describe('anything else', () => {
  it('is no class, for its own first error line to say', () => {
    expect(startFailureOf('The process has run out of memory')).toBeUndefined()
    expect(startFailureOf('no such column: project_id')).toBeUndefined()
    // Claude Code's sign-in error it says may be the network's: neither, so its own words say it.
    expect(startFailureOf('Authentication error · This may be a temporary network issue, please try again')).toBeUndefined()
  })

  it('is said by the first line that reads as an error, past a stack’s frames and colours', () => {
    expect(
      firstErrorLine(
        'Loading plugins…\n\u001b[91mError: \u001b[0mCannot find module "./auth"\n    at Module._resolveFilename (node:internal)\n    at run\n',
      ),
    ).toBe('Error: Cannot find module "./auth"')
    expect(firstErrorLine('thread main panicked at src/main.rs:12:5:\nfailed to read config.toml')).toBe('failed to read config.toml')
  })

  it('else by its last line, or nothing', () => {
    expect(firstErrorLine('warming up\nout of memory\n')).toBe('out of memory')
    expect(firstErrorLine('')).toBe('')
  })
})
