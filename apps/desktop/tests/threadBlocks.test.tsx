import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ThreadItem } from '@althar/contracts'

import { heardVerb, logLines, ThreadBlocks } from '../src/renderer/shared/ThreadBlocks'
import { blocksOf } from '../src/renderer/shared/thread'
import { fakeClient, items } from './fixtures'
import { withServices } from './render'

/*
 * A thread's blocks as the window draws them, on their own, as the
 * coordinator's thread has them: Althar's lines, a step's report, what was
 * heard from outside, an agent's question, Althar setting up, and a turn's
 * work, with what the project's rules let through.
 */

const show = (
  thread: ReadonlyArray<ThreadItem>,
  props: {
    project?: string
    openFile?: (path: string) => void
    onTryAgain?: () => void
    onSignIn?: (agentId: string) => void
    onCompact?: () => void
  } = {},
) => {
  const { client } = fakeClient()
  const blocks = blocksOf({ items: thread, turnRunning: false, worktree: '/w/meridian' }, new Map(), () => 'just now')
  withServices(<ThreadBlocks blocks={blocks} threadId="th1" worktree="/w/meridian" {...props} />, client)
  return client
}

const ended = (code: number | null, last: string | null = null) => ({
  at: '2026-09-29T12:05:00.000Z',
  code,
  timedOut: false,
  stopped: false,
  last,
})

describe('Althar setting up a worktree', () => {
  it('says the setup a repository keeps for it, as it runs and once it went through', () => {
    show([items.setup({ kept: true }), items.setup({ kept: true, ended: ended(0) }), items.setup({ ended: ended(0) })])
    expect(screen.getByText('Setting up meridian…')).toBeTruthy()
    expect(screen.getByText('Set up meridian')).toBeTruthy()
    expect(screen.getByText('Installed dependencies in meridian')).toBeTruthy()
  })

  it('shows a setup that failed with nothing printed as its command alone', () => {
    show([items.setup({ kept: true, ended: ended(1) })])
    expect(screen.getByText('Couldn’t set up meridian.')).toBeTruthy()
    expect(screen.getByText('bun install --frozen-lockfile')).toBeTruthy()
  })
})

describe('Althar’s lines and a step’s report', () => {
  it('draws what Althar says as a line across the thread, and leaves a step’s report to the task’s rounds', () => {
    show([
      items.notice({ source: 'runtime', title: 'Codex took over from Claude Code.' }, null),
      items.step({ summary: 'Added the retry.' }),
    ])
    expect(screen.getByText('Codex took over from Claude Code.')).toBeTruthy()
    expect(screen.queryByText('Added the retry.')).toBeNull()
  })
})

describe('what was heard from outside', () => {
  it('says where a comment was left, by file, with no line where it named none', () => {
    show([items.arrival({ path: 'src/retry.ts', line: null })])
    expect(screen.getByText(/PR #12 · src\/retry\.ts$/)).toBeTruthy()
    // Nothing to pass on from here.
    expect(screen.queryByRole('button', { name: 'Pass it on' })).toBeNull()
  })

  it('counts failed checks among those it heard of, and says them failed where it heard of no others', () => {
    const checks = (failed: number | null, passed: number | null) => {
      const heard = items.arrival({ kind: 'checks', failed, passed })
      return heard.kind === 'arrival' ? heardVerb(heard.content) : null
    }
    expect(checks(2, null)).toBe('Checks failed on')
    expect(checks(null, null)).toBe('Checks passed on')
    expect(checks(1, 3)).toBe('1 of 4 checks failed on')
  })

  it('reads a check’s log without its times, to its end where nothing marked it failed', () => {
    expect(logLines('2026-10-07T09:00:00.1234567Z Run npm test\n2026-10-07T09:00:01Z 3 failed\n\n')).toEqual(['Run npm test', '3 failed'])
  })
})

describe('an agent’s question', () => {
  it('heads one of several questions with what the agent asked, and can’t be answered where the screen takes no answer', () => {
    const fields = [
      { id: 'db', question: 'Which database?', type: 'text' as const, options: [], multiple: false, required: false },
      { id: 'cache', question: 'Which cache?', type: 'text' as const, options: [], multiple: false, required: false },
    ]
    show([items.question({ message: 'Two things first', fields })])
    expect(screen.getByText('Two things first')).toBeTruthy()
    expect(screen.getByText('Which cache?')).toBeTruthy()
  })

  it('says one withdrawn without saying why was withdrawn as its turn ended', () => {
    show([items.question({ state: 'withdrawn', withdrawn: null })])
    expect(screen.getByText(/The agent went on without an answer\./)).toBeTruthy()
  })
})

describe('a turn’s work', () => {
  it('says what the project’s rules let through, by the project’s name, each by its command or what it touched', async () => {
    show(
      [
        items.you('Tidy it'),
        items.tool({
          title: 'git status',
          toolKind: 'execute',
          command: 'git status',
          allowedBy: { pattern: 'git status', match: 'prefix' },
        }),
        items.tool({
          title: 'Read README.md',
          locations: [{ path: '/w/meridian/README.md' }],
          allowedBy: { pattern: 'README.md', match: 'exact' },
        }),
        items.says('Tidied.'),
      ],
      { project: 'meridian' },
    )
    expect(screen.getByText(/Allowed 2 requests/)).toBeTruthy()
    expect(screen.getByText(/by meridian’s rules/)).toBeTruthy()
  })

  it('shows an agent’s warning among its work, and a turn that only thought has nothing to copy', async () => {
    show([items.you('Go'), items.notice({ severity: 'warning', title: 'Context is filling up' }), items.thinks('Where is the call?')])
    await userEvent.click(screen.getByRole('button', { name: /orked/ }))
    expect(screen.getByText('Context is filling up')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Copy/ })).toBeNull()
  })

  it('opens a long command’s output to the whole command, as well as what it printed', async () => {
    const long = 'cd /w/meridian && FORCE_COLOR=0 bun run test -- --reporter=dot --bail'
    const client = show([
      items.you('Test it'),
      items.tool({
        title: long,
        toolKind: 'execute',
        command: long,
        label: 'bun run test',
        output: { kept: true, lines: 2, bytes: 40, dropped: 0, error: null },
        exit: 0,
      }),
      items.says('Passed.'),
    ])
    await userEvent.click(screen.getByRole('button', { name: /orked/ }))
    await userEvent.click(screen.getByRole('button', { name: /bun run test/ }))
    expect(await screen.findByText(/refunds\/router/)).toBeTruthy()
    expect(client.readOutput).toHaveBeenCalledWith('th1', expect.any(String))
    expect(screen.getByText(long)).toBeTruthy()
  })

  it('opens a file it handed back in the person’s editor', async () => {
    const openFile = vi.fn()
    show(
      [
        items.you('Export it'),
        items.hands('Here.', {
          files: [{ path: '/w/meridian/report.csv', how: 'linked', mediaType: 'text/csv', bytes: null, title: null }],
        }),
      ],
      { openFile },
    )
    await userEvent.click(screen.getByRole('button', { name: /Open/ }))
    expect(openFile).toHaveBeenCalledWith('/w/meridian/report.csv')
  })
})

describe('a coordinator that is signed out', () => {
  const signedOut = items.notice({
    severity: 'error',
    title: 'Claude Code is signed out.',
    description: 'Authentication required',
    failure: 'auth_required',
  })

  it('says so plainly, and offers Sign in again for its agent first, then Try again', async () => {
    const onSignIn = vi.fn()
    const onTryAgain = vi.fn()
    show([items.you('What is left on the checkout?'), signedOut], { onSignIn, onTryAgain })
    expect(screen.getByText('Claude Code is signed out.')).toBeTruthy()
    // The agent's own words stand under it, not as its headline.
    expect(screen.getByText('Authentication required')).toBeTruthy()
    const ways = screen.getAllByRole('button').filter((button) => ['Sign in again', 'Try again'].includes(button.textContent ?? ''))
    expect(ways.map((button) => button.textContent)).toEqual(['Sign in again', 'Try again'])
    await userEvent.click(screen.getByRole('button', { name: 'Sign in again' }))
    expect(onSignIn).toHaveBeenCalledWith('claude-code')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onTryAgain).toHaveBeenCalledOnce()
  })

  it('offers no Sign in again for a turn that failed for another reason', () => {
    show([items.you('Hi'), items.notice({ severity: 'error', title: "Claude Code couldn't answer.", failure: 'unknown' })], {
      onSignIn: vi.fn(),
      onTryAgain: vi.fn(),
    })
    expect(screen.queryByRole('button', { name: 'Sign in again' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('offers Compact for a context that is full', async () => {
    const onCompact = vi.fn()
    show([items.you('Hi'), items.notice({ severity: 'error', title: "Claude Code couldn't answer.", failure: 'context_full' })], {
      onCompact,
      onTryAgain: vi.fn(),
    })
    await userEvent.click(screen.getByRole('button', { name: 'Compact' }))
    expect(onCompact).toHaveBeenCalledOnce()
  })
})

describe('a turn that failed on its connection', () => {
  // As Claude Code's ends offline: it warns it reconnects, then the turn ends in its error (ADR-060).
  const reconnecting = items.notice({ severity: 'warning', title: 'Reconnecting to Claude, attempt 1 of 10.' })
  const failed = items.notice({
    severity: 'error',
    title: "Claude Code couldn't answer.",
    description: 'API Error: Connection error.',
  })

  it('offers Try again under it, which sends what the person said again', async () => {
    const onTryAgain = vi.fn()
    show([items.you('What is left on the checkout?'), reconnecting, failed], { onTryAgain })
    expect(screen.getByText(/API Error: Connection error\./)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onTryAgain).toHaveBeenCalledOnce()
  })

  it('offers it only under the last turn, where it ended in an error, and where the screen can try again', () => {
    const onTryAgain = vi.fn()
    show([items.you('Hi'), reconnecting, items.says('Back now.')], { onTryAgain })
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    document.body.innerHTML = ''
    show([items.you('Hi'), failed, items.you('Again'), items.says('Answered.')], { onTryAgain })
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    document.body.innerHTML = ''
    show([items.you('Hi'), failed])
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })
})
