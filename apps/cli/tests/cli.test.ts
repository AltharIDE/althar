import type { LiveEvent } from '@charrette/runtime'
import { assert, describe, it } from '@effect/vitest'

import { parseLine } from '../src/input'
import { defaultProfile, defaultWorktrees, parseOptions } from '../src/options'
import { printer } from '../src/printer'

describe('the command line', () => {
  const defaults = { profile: '/profile', worktrees: '/worktrees' }

  it('reads the folder, the task and the agent', () => {
    assert.deepStrictEqual(
      parseOptions(['~/work/app', '--task', ' Retry checkout ', '--agent', 'codex', '--model', 'gpt-6-sol'], defaults),
      {
        options: {
          folder: '~/work/app',
          task: 'Retry checkout',
          agent: 'codex',
          model: 'gpt-6-sol',
          profile: '/profile',
          worktrees: '/worktrees',
        },
      },
    )
    assert.deepStrictEqual(parseOptions(['.', '--task', 'x', '--profile', '/p', '--worktrees', '/w'], defaults), {
      options: { folder: '.', task: 'x', agent: 'claude-code', profile: '/p', worktrees: '/w' },
    })
  })

  it.each([
    [[], 'Name the folder to open.'],
    [['.'], 'Give the task a title with --task.'],
    [['.', '--task'], '--task needs a value.'],
    [['.', '--task', '--agent'], '--task needs a value.'],
    [['.', '--task', 'x', '--colour', 'red'], 'There is no --colour option.'],
    [['a', 'b', '--task', 'x'], 'One folder at a time; also got b.'],
  ])('says what is wrong with %j', (args, error) => {
    assert.deepStrictEqual(parseOptions(args, defaults), { error })
  })

  it('keeps the profile where the platform keeps app data, unless told otherwise', () => {
    assert.strictEqual(defaultProfile({}, 'darwin', '/Users/ada'), '/Users/ada/Library/Application Support/Charrette')
    assert.strictEqual(defaultProfile({}, 'linux', '/home/ada'), '/home/ada/.local/share/charrette')
    assert.strictEqual(defaultProfile({ XDG_DATA_HOME: '/data' }, 'linux', '/home/ada'), '/data/charrette')
    assert.strictEqual(defaultProfile({ CHARRETTE_PROFILE: '/p' }, 'darwin', '/Users/ada'), '/p')
    assert.strictEqual(defaultWorktrees({}, '/Users/ada'), '/Users/ada/Charrette')
    assert.strictEqual(defaultWorktrees({ CHARRETTE_WORKTREES: '/w' }, '/Users/ada'), '/w')
  })
})

describe('input', () => {
  it.each([
    ['fix the test', { _tag: 'Say', text: 'fix the test' }],
    ['   ', { _tag: 'Nothing' }],
    ['/interrupt use the helper', { _tag: 'Interrupt', text: 'use the helper' }],
    ['/i stop', { _tag: 'Interrupt', text: 'stop' }],
    ['/interrupt', { _tag: 'Unknown', message: 'Say what to do instead: /interrupt <text>' }],
    ['/model opus', { _tag: 'Model', model: 'opus' }],
    ['/model', { _tag: 'Unknown', message: 'Name one model: /model <id>' }],
    ['/agent opencode', { _tag: 'Agent', agent: 'opencode' }],
    ['/agent codex gpt-6-sol', { _tag: 'Agent', agent: 'codex', model: 'gpt-6-sol' }],
    ['/agent', { _tag: 'Unknown', message: 'Name the agent: /agent <id> [model]' }],
    ['/allow', { _tag: 'Answer', decision: 'allow' }],
    ['/reject not on main', { _tag: 'Answer', decision: 'reject', reason: 'not on main' }],
    ['/stop', { _tag: 'Stop' }],
    ['/quit', { _tag: 'Quit' }],
    ['/exit', { _tag: 'Quit' }],
    ['/help', { _tag: 'Help' }],
    ['/?', { _tag: 'Help' }],
    ['/dance', { _tag: 'Unknown', message: 'There is no /dance. Type /help for the commands.' }],
  ])('reads %j', (line, action) => {
    assert.deepStrictEqual(parseLine(line), action)
  })
})

describe('the printer', () => {
  const agent = (event: Extract<LiveEvent, { _tag: 'Agent' }>['event']): LiveEvent => ({ _tag: 'Agent', threadId: 't', event })

  it('streams the message, and gives everything else a line of its own', () => {
    const out = printer('t')
    const events: ReadonlyArray<LiveEvent> = [
      { _tag: 'SessionStarted', threadId: 't', sessionId: 's', agentId: 'codex', model: 'gpt-6-sol' },
      { _tag: 'TurnStarted', threadId: 't', turnId: 'u' },
      agent({ _tag: 'AgentThought', text: 'Hmm' }),
      agent({ _tag: 'AgentThought', text: 'more' }),
      agent({ _tag: 'AgentMessage', text: 'Hel' }),
      agent({ _tag: 'AgentMessage', text: 'lo' }),
      agent({ _tag: 'ToolCall', toolCallId: 'c', title: 'bun test', kind: 'execute', status: 'pending' }),
      agent({ _tag: 'ToolCallUpdate', toolCallId: 'c', status: 'in_progress' }),
      agent({ _tag: 'ToolCallUpdate', toolCallId: 'c', status: 'completed' }),
      agent({ _tag: 'ToolCallUpdate', toolCallId: 'd', status: 'failed', title: 'make deploy' }),
      agent({
        _tag: 'Plan',
        entries: [
          { content: 'Write it', status: 'completed' },
          { content: 'Test it', status: 'pending' },
        ],
      }),
      agent({ _tag: 'Notice', severity: 'warning', title: 'Context is filling up' }),
      agent({ _tag: 'AgentFailure', severity: 'error', classified: { failure: 'usage_limit', message: 'Out of quota' } }),
      agent({ _tag: 'PermissionAnswered', toolCallId: 'd', decision: 'reject', optionId: 'decline', scope: 'once', stopsTurn: false }),
      agent({ _tag: 'PermissionAnswered', toolCallId: 'e', decision: 'allow', optionId: null, scope: null, stopsTurn: true }),
      agent({ _tag: 'Resumed', reason: 'x' }),
      agent({ _tag: 'ModeChanged', modeId: 'plan', byAgent: true }),
      agent({ _tag: 'ModeChanged', modeId: 'ask', byAgent: false }),
      agent({ _tag: 'ContextUsage', used: 1, size: 2 }),
      { _tag: 'TurnEnded', threadId: 't', turnId: 'u', state: 'failed', errorClass: 'usage_limit' },
      { _tag: 'TurnEnded', threadId: 'other', turnId: 'v', state: 'completed' },
      { _tag: 'SessionEnded', threadId: 't', sessionId: 's', state: 'completed' },
    ]
    assert.strictEqual(
      events.map((event) => out.print(event)).join(''),
      [
        '● codex (gpt-6-sol) started.',
        '· thinking',
        'Hello',
        '→ bun test',
        '  ✓ bun test',
        '  ✗ make deploy',
        'Plan:\n  ✓ Write it\n  · Test it',
        '! Context is filling up',
        '! Out of quota',
        '  rejected (decline)',
        '  allowed',
        '  resumed after the rejection',
        '● The agent moved to its plan mode.',
        '— failed (usage_limit)',
        '● The session ended: completed.',
        '',
      ].join('\n'),
    )
  })

  it('remembers the question waiting, until it is answered or withdrawn', () => {
    const out = printer('t')
    assert.strictEqual(
      out.print({
        _tag: 'AttentionNeeded',
        threadId: 't',
        attentionId: 'a',
        title: 'make deploy',
        reason: 'Deploying or publishing always asks.',
      }),
      '? make deploy\n  Deploying or publishing always asks. Answer with /allow or /reject [reason].\n',
    )
    assert.strictEqual(out.waiting, 'a')
    assert.strictEqual(out.print({ _tag: 'AttentionClosed', threadId: 't', attentionId: 'b', outcome: 'answered' }), '')
    assert.strictEqual(out.waiting, 'a')
    assert.strictEqual(
      out.print({ _tag: 'AttentionClosed', threadId: 't', attentionId: 'a', outcome: 'withdrawn' }),
      '? The question was withdrawn.\n',
    )
    assert.isUndefined(out.waiting)
    out.print({ _tag: 'AttentionNeeded', threadId: 't', attentionId: 'c', title: 'x', reason: 'y' })
    assert.strictEqual(out.print({ _tag: 'AttentionClosed', threadId: 't', attentionId: 'c', outcome: 'answered' }), '')
    assert.isUndefined(out.waiting)
  })

  it('starts a line after a streamed message, and says the session started without a model', () => {
    const out = printer('t')
    out.print(agent({ _tag: 'AgentMessage', text: 'Done' }))
    assert.strictEqual(out.print(agent({ _tag: 'AgentThought', text: 'Hmm' })), '\n· thinking')
    assert.strictEqual(out.print(agent({ _tag: 'AgentMessage', text: 'Ok' })), '\nOk')
    assert.strictEqual(out.print({ _tag: 'SessionStarted', threadId: 't', sessionId: 's', agentId: 'codex' }), '\n● codex started.\n')
    out.print(agent({ _tag: 'AgentThought', text: 'Hmm' }))
    assert.strictEqual(out.print(agent({ _tag: 'ToolCall', toolCallId: 'x', title: 'ls', kind: 'execute', status: 'pending' })), '\n→ ls\n')
  })
})
