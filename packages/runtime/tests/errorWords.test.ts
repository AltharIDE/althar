import { assert, describe, it } from '@effect/vitest'
import { AgentExited, AgentRequestFailed, AgentStartFailed, classify } from '@althar/provider-adapters'
import { Cause, Duration } from 'effect'

import { CliSignedOut } from '../src/Connections'
import { CoordinatorUnavailable } from '../src/Coordinator'
import { AlreadyDelivered, ChangedSinceSeen, ImageRefused, RuleOnAnotherList, RulesChanged, SessionFailed } from '../src/errors'
import { ReviewDraftClosed, ReviewDraftIncomplete } from '../src/Reviews'
import { StartTimedOut } from '../src/Sessions'
import { agentSaid, expected, signedOutWords, signInEndedWords, stuckWhyOf, summarize, unreachableWords, words } from '../src/words'
import { thisDevice } from '../src/device'

/*
 * What the window says when something the person asked for couldn't be done:
 * the errors the API's other tests don't reach, each in the sentence the
 * person reads, and which of them are theirs to put right.
 */

const name = (agentId: string) => (agentId === 'codex' ? 'Codex' : agentId)
const said = (error: unknown) => words(error, name).message

describe('the words for what went wrong', () => {
  it('says an agent that took too long to start as the runtime timed it', () => {
    const slow = new StartTimedOut({ agentId: 'codex', agentName: 'Codex', after: Duration.minutes(2) })
    assert.strictEqual(agentSaid(slow), 'Timed out after 2m waiting for Codex to set up a session.')
    // Through a failed start, and for the window: the same sentence.
    assert.strictEqual(summarize(Cause.fail(slow)), 'Timed out after 2m waiting for Codex to set up a session.')
    assert.strictEqual(said(slow), 'Timed out after 2m waiting for Codex to set up a session.')
  })

  it('says what went wrong in its first line, where no agent said it', () => {
    assert.strictEqual(summarize(Cause.fail(new Error('Disk full'))), 'Disk full.')
    assert.strictEqual(summarize(Cause.die('The store went away!')), 'The store went away!')
  })

  it('asks which repositories a task changes, where the project lists none', () => {
    assert.strictEqual(said({ _tag: 'RepositoriesNeeded' }), "Say which of the project's repositories the task changes: .")
    assert.strictEqual(said({ _tag: 'RepositoriesNeeded', unknown: ['mobile'] }), 'The project has no repository called mobile. It has .')
  })

  it('names an image refused without a name as an image', () => {
    assert.strictEqual(said(new ImageRefused({ reason: 'unsupported', name: null })), "An image isn't a PNG, JPEG, GIF or WebP image.")
    assert.strictEqual(said(new ImageRefused({ reason: 'missing', name: 'shot.png' })), "shot.png isn't kept any more. Add it again.")
    assert.strictEqual(said(new ImageRefused({ reason: 'too_many', name: null })), 'A message can carry at most 10 images.')
    assert.strictEqual(said(new ImageRefused({ reason: 'unkept', name: 'shot.png' })), 'Images can’t be sent here.')
  })

  it('says why the coordinator can’t start, and what to do', () => {
    assert.strictEqual(
      said(new CoordinatorUnavailable({ agentId: 'codex', agentName: 'Codex' })),
      "Codex isn't signed in. Sign it in, or pick another agent for the coordinator.",
    )
  })

  it('says an allow rule on another list as one command or as commands starting so, and which list', () => {
    assert.strictEqual(
      said(new RuleOnAnotherList({ pattern: 'git push', exact: false, list: 'never' })),
      'Commands starting “git push” are on “Never”. Take them off “Never” first.',
    )
    assert.strictEqual(
      said(new RuleOnAnotherList({ pattern: 'rm -rf dist', exact: true, list: 'never' })),
      '“rm -rf dist” is on “Never”. Take it off “Never” first.',
    )
    assert.strictEqual(
      said(new RulesChanged({ projectId: 'p', revision: 3, expected: 2 })),
      "The project's rules changed meanwhile. Make the change again.",
    )
  })

  it('says a message already with the agent can’t be taken back', () => {
    assert.strictEqual(said(new AlreadyDelivered({ itemId: 'i' })), 'The agent already has that message.')
  })

  it('says a git command it can’t name as git, with what git said', () => {
    assert.strictEqual(said({ _tag: 'GitFailed', stderr: 'fatal: not a git repository\n' }), "git  didn't work: not a git repository.")
  })

  it('says a branch that moved since the person looked, so nothing was pushed', () => {
    assert.strictEqual(
      said(new ChangedSinceSeen({ taskId: 't', what: 'branch' })),
      'The branch changed since you looked. Look again, then push.',
    )
  })

  it('says why a review draft can’t change or be posted', () => {
    assert.deepStrictEqual(
      ['posted', 'discarded', 'posting', 'archived'].map((state) => said(new ReviewDraftClosed({ draftId: 'd', state }))),
      [
        'That review is posted already. Change it on GitHub.',
        'That review draft was discarded.',
        'That review is being posted now.',
        'That review draft can’t change now.',
      ],
    )
    assert.deepStrictEqual(
      (['verdict', 'summary', 'comment'] as const).map((missing) => said(new ReviewDraftIncomplete({ draftId: 'd', missing }))),
      ['Choose a verdict before you post the review.', 'A review needs a summary.', 'Write the comment, or drop it.'],
    )
  })

  it('says a command-line tool that isn’t signed in to the host', () => {
    assert.strictEqual(said(new CliSignedOut({ tool: 'gh', host: 'github.com' })), `gh isn't signed in to github.com on ${thisDevice()}.`)
  })

  it('counts the person’s mistakes as theirs to put right, and the runtime’s own as worth the log', () => {
    for (const reason of ['RuleOnAnotherList', 'RulesChanged', 'AlreadyDelivered', 'ReviewDraftClosed', 'CliSignedOut'])
      assert.isTrue(expected.has(reason), reason)
    for (const reason of ['GitFailed', 'StartTimedOut', 'CoordinatorUnavailable', 'Unknown']) assert.isFalse(expected.has(reason), reason)
  })
})

describe('the words for what went wrong, for the refusals the API’s tests don’t reach', () => {
  it('says a project with no name for its repository, and a branch that isn’t there or can’t be made', () => {
    assert.strictEqual(said({ _tag: 'RepositoryRefused', reason: 'unnamed' }), 'Name the project first: its repository is named after it.')
    assert.strictEqual(
      said({ _tag: 'BranchNotFound', repository: 'app', branch: 'release/2' }),
      'app has no branch release/2, on its remote or here.',
    )
    assert.strictEqual(said({ _tag: 'BranchRefused', message: 'A branch can’t be called “a b”.' }), 'A branch can’t be called “a b”.')
    assert.strictEqual(said({ _tag: 'AutomationRefused', message: 'That automation is paused.' }), 'That automation is paused.')
  })

  it('names a file refused without a name as a file, and says one refused for a reason it doesn’t know', () => {
    assert.strictEqual(said({ _tag: 'FileRefused', reason: 'missing', name: null }), "A file isn't there any more. Add it again.")
    assert.strictEqual(said({ _tag: 'FileRefused', reason: 'nowhere', name: null }), "The task's folder isn't ready yet.")
    assert.strictEqual(said({ _tag: 'FileRefused', reason: 'cursed', name: 'a.txt' }), "Althar can't send that file.")
  })

  it('says how a git command ended where git itself said nothing', () => {
    assert.strictEqual(
      said({ _tag: 'GitFailed', args: ['-c', 'core.quotepath=off', 'fetch'], stderr: '', reason: 'the clone is locked' }),
      "git fetch couldn't complete: the clone is locked.",
    )
    // No command to name: git alone.
    assert.strictEqual(
      said({ _tag: 'GitFailed', args: ['-c', 'a=b'], stderr: '', timedOut: true }),
      'git  got no answer in its time, so Althar stopped waiting. Try again.',
    )
    assert.strictEqual(
      said({ _tag: 'GitFailed', stderr: '', signal: 'SIGTERM' }),
      'git  was stopped (SIGTERM) before it was done. Try again.',
    )
    assert.strictEqual(said({ _tag: 'GitFailed', args: ['push'], stderr: '' }), "git push didn't work.")
  })

  it('keeps all a git command said, and how it ended, for its Details', () => {
    const failed = (ended: object) => words({ _tag: 'GitFailed', args: ['fetch'], stderr: 'fatal: no\n', ...ended }, name)
    assert.deepStrictEqual(failed({ code: 128 }), {
      reason: 'GitFailed',
      message: "git fetch didn't work: no.",
      detail: 'fatal: no\nExit code 128.',
    })
    assert.strictEqual(failed({ signal: 'SIGKILL' }).detail, 'fatal: no\nStopped by SIGKILL.')
    assert.strictEqual(failed({ timedOut: true, timeout: 30_000 }).detail, 'fatal: no\nStopped waiting after 30 seconds with no answer.')
    assert.isUndefined(words({ _tag: 'GitFailed', args: ['fetch'], stderr: ' ', code: 1 }, name).detail)
  })

  it('names the settings that let protected files be pushed, however many', () => {
    const protectedBy = (needs: ReadonlyArray<string>, held = 'skills/a.md') =>
      said({ _tag: 'PushRefused', remote: 'origin', why: 'protected', needs, said: held })
    assert.strictEqual(
      protectedBy([]),
      'Nothing was pushed: skills/a.md is a skill or OpenSpec file, which stays on this computer. To push it, turn on what it needs in the project’s Settings, under Repository files.',
    )
    assert.strictEqual(
      protectedBy(['writeSkills', 'writeOpenSpec', 'pushProtected'], 'skills/a.md, openspec/b.md'),
      'Nothing was pushed: skills/a.md, openspec/b.md are skill or OpenSpec files, which stay on this computer. To push them, turn on “Write Althar-managed skills”, “Write OpenSpec artifacts” and “Push skill/OpenSpec files” in the project’s Settings, under Repository files.',
    )
  })

  it('says a folder changed since it was seen, and issue changes that can’t change now', () => {
    assert.strictEqual(
      said(new ChangedSinceSeen({ taskId: 'task_1', what: 'folder' })),
      'The task’s folder changed since you looked. Look again, then remove it.',
    )
    assert.strictEqual(said({ _tag: 'ChangesClosed', state: 'applied' }), 'Those changes are applied already.')
    assert.strictEqual(said({ _tag: 'ChangesClosed', state: 'lost' }), 'Those issue changes can’t change now.')
  })

  it('says a merge the lead is resolving, and a submodule in the way, with or without their files', () => {
    const merge = (why: string, files?: ReadonlyArray<string>) =>
      said({ _tag: 'CantMerge', why, into: 'main', detail: 'the merge stopped', ...(files === undefined ? {} : { files }) })
    assert.strictEqual(merge('resolving', ['src/a.ts']), 'It conflicts with main in a.ts. The lead is resolving it.')
    assert.strictEqual(merge('resolving'), 'It conflicts with main in the merge stopped. The lead is resolving it.')
    assert.strictEqual(
      merge('submodule', ['vendor/lib']),
      'Submodule vendor/lib has uncommitted changes, or isn’t at the commit recorded for it.',
    )
    assert.strictEqual(merge('submodule'), 'Submodule the merge stopped has uncommitted changes, or isn’t at the commit recorded for it.')
  })
})

describe('why an agent couldn’t start or be reached (DEV-196)', () => {
  const exited = (stderr: string) => new AgentExited({ code: 1, signal: null, stderr })
  const refused = (failure: AgentRequestFailed['failure'], message: string) =>
    new AgentRequestFailed({ method: 'session/new', failure, message })

  it('says it isn’t installed, by its command', () => {
    assert.strictEqual(
      summarize(Cause.fail(new AgentStartFailed({ command: 'claude', reason: 'spawn claude ENOENT' }))),
      `claude isn't installed, or isn't on ${thisDevice()}'s PATH.`,
    )
    // An agent that started and then couldn't run its own CLI: the adapter's spawn of it, as claude-agent-acp's is.
    assert.strictEqual(
      agentSaid(
        exited('Error: spawn /usr/local/bin/claude ENOENT\n    at ChildProcess._handle.onexit (node:internal/child_process:286:19)'),
      ),
      `The agent isn't installed, or isn't on ${thisDevice()}'s PATH.`,
    )
  })

  it('keeps a reason on this computer that it stopped on in its own words, and says only that it stopped where it said nothing', () => {
    const said = agentSaid(
      exited(
        "Error: ENOTDIR: not a directory, mkdir '/home/p/ai-teacher/.codex/sessions'\n    at async Object.mkdir (node:internal/fs/promises:858:10)",
      ),
    )
    assert.match(said ?? '', /^The agent stopped: /)
    assert.include(said, '/home/p/ai-teacher/.codex/sessions')
    assert.strictEqual(agentSaid(exited('')), 'The agent stopped.')
  })

  it('takes no class from what an agent that started wrote further up, or of an MCP server, a hook or a tool', () => {
    // An MCP server refused at start-up, far above why the agent stopped.
    assert.strictEqual(
      agentSaid(
        exited(
          [
            'MCP client for `linear` failed to start: HTTP error: 401 Unauthorized',
            'Loaded 12 skills',
            'Resuming session 0198…',
            'Indexing workspace',
            'Error: Cannot find module "./auth"',
          ].join('\n'),
        ),
      ),
      'The agent stopped: Error: Cannot find module "./auth".',
    )
    // The same, just above the last line: still the MCP server's, not the agent's sign-in.
    assert.strictEqual(
      agentSaid(exited('MCP server "github" failed: 401 Unauthorized\nError: config.toml is not valid TOML')),
      'The agent stopped: Error: config.toml is not valid TOML.',
    )
    // A hook's shell, which can't find its own command: the agent is there.
    assert.strictEqual(
      agentSaid(exited('PreToolUse hook: sh: 1: prettier: command not found\nError: session/prompt was cancelled')),
      'The agent stopped: Error: session/prompt was cancelled.',
    )
    assert.strictEqual(agentSaid(exited('sh: 1: prettier: command not found')), 'The agent stopped: sh: 1: prettier: command not found.')
    // A tool's request that timed out, retried, before the agent stopped for another reason.
    assert.strictEqual(
      agentSaid(
        exited('fetch https://registry.npmjs.org/foo failed: ETIMEDOUT, retrying\nLoaded 3 tools\nIndexing\nfatal: not a git repository'),
      ),
      'The agent stopped: fatal: not a git repository.',
    )
    // A bare 401 isn't a sign-in: only a status the agent's own request got.
    assert.strictEqual(agentSaid(exited('Error: expected 401 rows, read 400')), 'The agent stopped: Error: expected 401 rows, read 400.')
  })

  it('takes out a credential the agent’s own line carried', () => {
    assert.strictEqual(
      agentSaid(
        exited(
          'Error: request to https://generativelanguage.googleapis.com/v1beta/models?key=AIzaSyA1b2C3d4E5f6G7h8I9j0KlMnOpQrStUvW failed',
        ),
      ),
      'The agent stopped: Error: request to https://generativelanguage.googleapis.com/v1beta/models?key=[REDACTED] failed.',
    )
    assert.strictEqual(
      agentSaid(
        refused('unknown', 'Error: upstream refused the request with Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc'),
      ),
      'Error: upstream refused the request with Authorization: [REDACTED] [REDACTED].',
    )
    // A key in a URL's query that isn't shaped as Google's: its name says it.
    assert.strictEqual(
      agentSaid(exited('Error: GET https://api.example.com/v1/models?api_key=c0ffee-1234-beef&limit=5 failed: 403')),
      'The agent stopped: Error: GET https://api.example.com/v1/models?api_key=[REDACTED]&limit=5 failed: 403.',
    )
    assert.strictEqual(
      summarize(
        Cause.fail(new AgentStartFailed({ command: 'codex', reason: 'invalid environment: OPENAI_API_KEY=sk-proj-abcdef123456 refused' })),
      ),
      "codex wouldn't start: invalid environment: OPENAI_API_KEY=[REDACTED] refused.",
    )
  })

  it('says it isn’t signed in, with the way back in', () => {
    assert.strictEqual(agentSaid(refused('auth_required', 'Authentication required')), signedOutWords)
    assert.strictEqual(agentSaid(exited('Not logged in · Please run /login')), signedOutWords)
  })

  it('says its sign-in ended, which a step’s call offers to sign in again as it does one signed out', () => {
    assert.strictEqual(agentSaid(refused('auth_required', 'Login expired · Please run /login')), signInEndedWords)
    assert.strictEqual(
      agentSaid(
        refused(
          'unknown',
          'Your access token could not be refreshed because your refresh token has expired. Please log out and sign in again.',
        ),
      ),
      signInEndedWords,
    )
    assert.strictEqual(agentSaid(exited('Failed to authenticate: OAuth session expired and could not be refreshed')), signInEndedWords)
  })

  it('gives a step that stopped on it the reason whose call offers its fix: signing in again, or installing it', () => {
    assert.strictEqual(stuckWhyOf(signedOutWords), 'signed_out')
    assert.strictEqual(stuckWhyOf(signInEndedWords), 'sign_in_ended')
    assert.strictEqual(stuckWhyOf(agentSaid(new AgentStartFailed({ command: 'codex', reason: 'spawn codex ENOENT' }))), 'not_installed')
    assert.strictEqual(stuckWhyOf(agentSaid(exited('/bin/sh: 1: claude: not found\nspawn claude ENOENT'))), 'not_installed')
    assert.isUndefined(stuckWhyOf(unreachableWords(thisDevice())))
    assert.isUndefined(stuckWhyOf('The agent stopped.'))
    assert.isUndefined(stuckWhyOf(null))
  })

  it('says its classes in straight apostrophes, as the line it follows does, and never names "the agent" after its name', () => {
    for (const line of [signInEndedWords, unreachableWords(thisDevice())]) {
      assert.notInclude(line, '’')
      assert.notMatch(line, /^The agent/)
    }
  })

  it('says the network is in the way, for a connection that failed, not a server’s own trouble', () => {
    assert.strictEqual(
      agentSaid(refused('transient', "API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)")),
      unreachableWords(thisDevice()),
    )
    assert.strictEqual(
      agentSaid(refused('transient', 'API Error: 529 Overloaded. This is a server-side issue, usually temporary — try again in a moment.')),
      'API Error: 529 Overloaded. This is a server-side issue, usually temporary — try again in a moment.',
    )
  })

  it('says a refusal’s first error line alone, where it gave several, with the line under it that says what to fix', () => {
    assert.strictEqual(
      agentSaid(refused('unknown', 'Loading MCP servers…\nError: invalid config at ~/.codex/config.toml\n  line 4: unknown key "modle"')),
      'Error: invalid config at ~/.codex/config.toml: line 4: unknown key "modle".',
    )
    assert.strictEqual(
      agentSaid(refused('unknown', 'Error: could not parse settings.json:\nUnexpected token } in JSON at position 212\nat JSON.parse')),
      'Error: could not parse settings.json: Unexpected token } in JSON at position 212.',
    )
    assert.strictEqual(
      agentSaid(exited('Error: invalid config at ~/.codex/config.toml\nline 4: unknown key "modle"')),
      'The agent stopped: Error: invalid config at ~/.codex/config.toml: line 4: unknown key "modle".',
    )
    assert.strictEqual(
      agentSaid(refused('transient', 'stream disconnected before completion\nerror: 502 Bad Gateway\n<html>…</html>')),
      'error: 502 Bad Gateway.',
    )
    assert.strictEqual(
      summarize(
        Cause.fail(new AgentStartFailed({ command: 'codex', reason: 'spawn codex EACCES\n    at ChildProcess._handle (node:internal)' })),
      ),
      "codex wouldn't start: spawn codex EACCES.",
    )
  })

  it('else says the agent’s own first error line', () => {
    assert.strictEqual(
      agentSaid(exited('Loading plugins…\nError: Cannot find module "./auth"\n    at Module._resolveFilename (node:internal)\n')),
      'The agent stopped: Error: Cannot find module "./auth".',
    )
  })
})

describe('the words for an agent that couldn’t start', () => {
  const request = (message: string) => new AgentRequestFailed({ method: 'session/new', failure: 'unknown', message })
  const installed = { bundled: false }

  it.each([
    // Each agent the person installs, refusing how Althar starts it, in its own parser's words (startFailure.test.ts).
    ["error: unexpected argument '--acp' found", 'Grok Build'],
    ["Error: No such command 'acp'.", 'Kimi Code'],
    ['Unknown argument: experimental-acp', 'Gemini CLI, Qwen Code'],
    ['vibe-acp: error: unrecognized arguments: --acp', 'Mistral Vibe'],
    ["Unknown option: '--acp'", 'Junie'],
    ['Unrecognized flag: --acp in command opencode', 'OpenCode'],
  ])('says %s (%s) as a version mismatch, to update the agent', (message) => {
    assert.strictEqual(
      summarize(Cause.fail(request(message)), installed),
      `Its program and what drives it are different versions: ${message.replace(/\.$/, '')}. Update it, then try again.`,
    )
  })

  it('says the same of one that stopped saying so, as Kimi Code does where it has no `acp` command', () => {
    const stopped = new AgentExited({
      code: 2,
      signal: null,
      stderr: "Usage: kimi [OPTIONS] COMMAND [ARGS]...\nError: No such command 'acp'.",
    })
    assert.strictEqual(
      agentSaid(stopped, installed),
      "Its program and what drives it are different versions: Error: No such command 'acp'. Update it, then try again.",
    )
  })

  it('says to reinstall Althar where Althar brings it', () => {
    assert.strictEqual(
      summarize(
        Cause.fail(request("Claude Code process exited with code 1. stderr: error: unknown option '--initialize-fields=settings'")),
        {
          bundled: true,
        },
      ),
      "Its program and what drives it are different versions: Claude Code process exited with code 1. stderr: error: unknown option '--initialize-fields=settings'. Reinstall Althar (in a checkout of Althar, run bun install), then try again.",
    )
    assert.strictEqual(
      summarize(
        Cause.fail(
          new AgentStartFailed({
            command: 'Codex',
            reason: 'Missing optional dependency @openai/codex-darwin-arm64. Reinstall Codex: npm install -g @openai/codex@latest',
          }),
        ),
        { bundled: true },
      ),
      'A part of it is missing: Missing optional dependency @openai/codex-darwin-arm64. Reinstall Codex: npm install -g @openai/codex@latest. Reinstall Althar (in a checkout of Althar, run bun install), then try again.',
    )
  })

  it('never says a bare "Internal error"', () => {
    assert.strictEqual(summarize(Cause.fail(request('Internal error'))), 'It gave no reason. What it wrote is in Althar’s agents log.')
    assert.strictEqual(
      said(new SessionFailed({ agentId: 'codex', reason: 'x', summary: summarize(Cause.fail(request('Internal error:'))) })),
      "Codex couldn't start. It gave no reason. What it wrote is in Althar’s agents log.",
    )
  })

  it('never says a bare "Internal error" in any class, a classified answer included', () => {
    // A transient one, as `classify` reads it from words in its data that it can't say: its words are no more than that.
    const transient = classify({ code: -32603, message: 'Internal error', data: { status: 503 } }, new Date())
    assert.strictEqual(transient.failure, 'transient')
    const said = summarize(Cause.fail(new AgentRequestFailed({ method: 'session/new', ...transient })))
    assert.notInclude(said, 'Internal error')
    assert.strictEqual(said, 'It gave no reason. What it wrote is in Althar’s agents log.')
    // Its reason in the data is said where it gives one.
    const reasoned = classify({ code: -32603, message: 'Internal error', data: { reason: 'upstream returned 503' } }, new Date())
    assert.strictEqual(summarize(Cause.fail(new AgentRequestFailed({ method: 'session/new', ...reasoned }))), 'upstream returned 503.')
    assert.strictEqual(
      summarize(Cause.fail(new AgentRequestFailed({ method: 'session/new', failure: 'auth_required', message: 'Internal error' }))),
      signedOutWords,
    )
  })

  it('says one that stopped on the way as that, with what it said', () => {
    assert.strictEqual(
      summarize(Cause.fail(request('Query closed before response received'))),
      'It stopped while starting: Query closed before response received.',
    )
  })
})
