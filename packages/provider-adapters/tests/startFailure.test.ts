import { describe, expect, it } from 'vitest'

import { closingErrorLine, closingFailureOf, firstErrorLine, startFailureOf } from '../src/startFailure'
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

  it('is only the adapter’s own spawn of its CLI, for an agent that started: a shell’s is a hook’s or a tool’s', () => {
    expect(startFailureOf('Error: spawn /usr/local/bin/claude ENOENT', false, true)).toBe('not_installed')
    expect(startFailureOf('sh: 1: prettier: command not found', false, true)).toBeUndefined()
  })
})

describe('what an agent that started wrote', () => {
  it('names no class from a line about an MCP server, a hook or a plugin', () => {
    expect(startFailureOf('MCP client for `linear` failed to start: HTTP error: 401 Unauthorized')).toBeUndefined()
    expect(startFailureOf('PreToolUse hook: sh: 1: prettier: command not found')).toBeUndefined()
    expect(startFailureOf('plugin "jira": getaddrinfo ENOTFOUND jira.internal')).toBeUndefined()
  })

  it('takes a 401 only as a status a request got, never a bare number or "unauthorized" alone', () => {
    expect(startFailureOf('API Error: 401 Unauthorized')).toBe('signed_out')
    expect(startFailureOf('HTTP/1.1 401 Unauthorized')).toBe('signed_out')
    expect(startFailureOf('Error: expected 401 rows, read 400')).toBeUndefined()
    expect(startFailureOf('Unauthorized')).toBeUndefined()
  })

  it('is classed by its last few lines alone, the last first', () => {
    const above = (last: string) =>
      ['Not logged in · Please run /login', 'Loaded 12 skills', 'Resuming session', 'Indexing workspace', last].join('\n')
    expect(closingFailureOf(above('Error: Cannot find module "./auth"'))).toBeUndefined()
    expect(closingFailureOf('Indexing workspace\nNot logged in · Please run /login\nGoodbye')).toBe('signed_out')
    expect(closingFailureOf('MCP server "github" failed: 401 Unauthorized\nError: config.toml is not valid TOML')).toBeUndefined()
    expect(closingFailureOf('')).toBeUndefined()
  })

  it('is said by the last line among its last few that reads as an error, with its detail', () => {
    expect(
      closingErrorLine(
        'MCP client for `linear` failed to start: 401\nLoaded 12 skills\nIndexing\nError: Cannot find module "./auth"\n    at run',
      ),
    ).toBe('Error: Cannot find module "./auth"')
    expect(closingErrorLine('Error: invalid config at ~/.codex/config.toml\n  line 4: unknown key "modle"')).toBe(
      'Error: invalid config at ~/.codex/config.toml: line 4: unknown key "modle"',
    )
    expect(closingErrorLine('warming up\ndone')).toBe('done')
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

  it('keeps the line under it that says what to fix: indented, `line N:`, or after one ending in a colon', () => {
    expect(firstErrorLine('Error: invalid config at ~/.codex/config.toml\n  line 4: unknown key "modle"')).toBe(
      'Error: invalid config at ~/.codex/config.toml: line 4: unknown key "modle"',
    )
    expect(firstErrorLine('Error: invalid config\nline 4: unknown key "modle"')).toBe('Error: invalid config: line 4: unknown key "modle"')
    expect(firstErrorLine('Error: could not parse settings.json:\nUnexpected token } in JSON')).toBe(
      'Error: could not parse settings.json: Unexpected token } in JSON',
    )
    expect(firstErrorLine('error: 502 Bad Gateway\n<html>…</html>')).toBe('error: 502 Bad Gateway')
  })

  it('else by its last line, or nothing', () => {
    expect(firstErrorLine('warming up\nout of memory\n')).toBe('out of memory')
    expect(firstErrorLine('')).toBe('')
  })
})

describe('an agent at another version than what drives it', () => {
  it.each([
    // claude-agent-acp 0.110.1 driving the hoisted Claude Code 2.1.326, 24 November 2026: session/new's `data.details`.
    ["Claude Code process exited with code 1. stderr: error: unknown option '--initialize-fields=settings'", 'Claude Code'],
    // Each agent asked for an option it doesn't know, on 24 November 2026: Claude Code 2.1.323 and Copilot CLI 1.0.30
    // (Commander), Codex 0.169.0 and Grok Build 1.0.77 (clap), OpenCode 2.3.0.
    ["error: unknown option '--althar-unknown-flag'", 'Claude Code, Copilot'],
    ["error: unexpected argument '--althar-unknown-flag' found", 'Codex, Grok Build'],
    ['Unrecognized flag: --althar-unknown-flag in command opencode', 'OpenCode'],
    // The same, in the words of the parsers of the agents not installed here: yargs (Gemini CLI, Qwen Code), Click (Kimi
    // Code), argparse (Mistral Vibe), picocli (Junie), from each parser's own source.
    ['Unknown argument: experimental-acp', 'Gemini CLI, Qwen Code'],
    ["Error: No such command 'acp'.", 'Kimi Code'],
    ['vibe-acp: error: unrecognized arguments: --acp', 'Mistral Vibe'],
    ["Unknown option: '--acp'", 'Junie'],
    // Claude Code 2.1.323 driven by Agent SDK 0.3.326 (claude-cli.ts in claude-agent-acp 0.110.1).
    ['Claude Code is too old to read MCP servers from the initialize request', 'Claude Code'],
    // Althar's own check before it starts one (bundledPrograms.ts).
    ["Claude Code's own program is version 0.3.326, and its adapter needs 0.3.330.", 'Althar'],
  ])('%s (%s)', (said) => {
    expect(startFailureOf(said)).toBe('version_mismatch')
  })

  it('is its sign-in where it stopped for that, and never an MCP server’s or a hook’s', () => {
    expect(startFailureOf('Claude Code process exited with code 1. stderr: Not logged in · Please run /login')).toBe('signed_out')
    expect(startFailureOf("MCP server 'github': error: unknown option '--stdio'")).toBeUndefined()
  })

  it('is read from an agent that stopped, by its last lines', () => {
    expect(closingFailureOf("Starting ACP server\nerror: unexpected argument '--acp' found\n\nUsage: grok [OPTIONS]")).toBe(
      'version_mismatch',
    )
  })
})

describe('an agent a part of which is missing', () => {
  it.each([
    // Agent SDK 0.3.330's `query`, and claude-agent-acp 0.110.1's `claudeCliPath`, where the platform package isn't installed.
    [
      'Native CLI binary for darwin-arm64 not found. Reinstall @anthropic-ai/claude-agent-sdk without --omit=optional, or set options.pathToClaudeCodeExecutable.',
      'Agent SDK',
    ],
    [
      'Claude native binary not found for darwin-arm64. Reinstall @anthropic-ai/claude-agent-sdk without --omit=optional, or set CLAUDE_CODE_EXECUTABLE.',
      'claude-agent-acp',
    ],
    // @openai/codex 0.171.0's bin/codex.js.
    ['Missing optional dependency @openai/codex-darwin-arm64. Reinstall Codex: npm install -g @openai/codex@latest', 'Codex'],
    // Althar's own check before it starts one (bundledPrograms.ts).
    ["Claude Code's own program for this computer (@anthropic-ai/claude-agent-sdk-darwin-arm64 0.3.330) is missing.", 'Althar'],
  ])('%s (%s)', (said) => {
    expect(startFailureOf(said)).toBe('incomplete')
  })
})

describe('an agent that stopped while it started', () => {
  it.each([
    // Agent SDK 0.3.330, its Claude Code process gone with nothing said, and the query it held closed.
    ['Claude Code process exited with code 137', 'Agent SDK'],
    ['Query closed before response received', 'Agent SDK'],
    // claude-agent-acp 0.110.1, its Claude Code process gone under a session.
    ['The Claude Agent process exited unexpectedly. Please start a new session.', 'claude-agent-acp'],
    // A Rust agent's panic (Codex, Grok Build), and a signal.
    ["thread 'main' panicked at src/main.rs:12:5", 'Codex, Grok Build'],
    ['codex app-server terminated by signal SIGSEGV', 'Codex'],
  ])('%s (%s)', (said) => {
    expect(startFailureOf(said)).toBe('crashed')
  })
})
