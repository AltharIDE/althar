import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { AttentionRequest, StuckStep } from '@althar/contracts'

import { StuckCall, text as stuckWords } from '../src/renderer/features/task/StuckCall'
import { agents, fakeClient } from './fixtures'
import { withServices } from './render'

/*
 * A step that needs the person, on its own: what went wrong in words, for a
 * review as for a lead's step, and the pull request Althar opens itself,
 * tried again or gone on without.
 */

const stuck = (over: Partial<StuckStep>): StuckStep => ({
  step: 'implement',
  why: 'session_ended',
  detail: null,
  agentId: 'codex',
  round: 0,
  open: 0,
  ...over,
})

const request = (step: StuckStep): AttentionRequest => ({
  id: 'st1',
  kind: 'stuck',
  title: '',
  reason: '',
  command: null,
  createdAt: '2026-09-29T12:00:00.000Z',
  stuck: step,
})

const show = (step: StuckStep, onReport?: (step: string) => void) => {
  const { client } = fakeClient()
  const onAnswer = vi.fn()
  withServices(
    <StuckCall
      request={request(step)}
      stuck={step}
      agents={agents}
      agentName={(id) => (id === 'codex' ? 'Codex' : '')}
      onAnswer={onAnswer}
      {...(onReport === undefined ? {} : { onReport })}
    />,
    client,
  )
  return onAnswer
}

describe('why a review needed the person', () => {
  const review = (why: StuckStep['why'], detail: string | null = null) => stuckWords.what(stuck({ step: 'review', why, detail }), 'Codex')

  it('advises running it again or skipping it, whatever went wrong', () => {
    expect([review('no_report'), review('stalled'), review('looping', 'npm test'), review('over_budget', '3 hours')]).toEqual([
      'Codex stopped without saying whether the step is done.',
      'Codex has gone quiet.',
      'Codex keeps getting the same result.',
      'Codex has worked on this step for 3 hours.',
    ])
  })

  it('says what it can where its agent didn’t say what it ran, or for how long', () => {
    expect(stuckWords.what(stuck({ why: 'looping' }), 'Codex')).toBe('Codex keeps getting the same result.')
    expect(stuckWords.what(stuck({ why: 'over_budget' }), 'Codex')).toBe('Codex has worked on this step for a long time.')
  })

  it('counts the findings still open after the last review round, and says none where none are', () => {
    expect(stuckWords.what(stuck({ why: 'round_limit', open: 0 }), 'Codex')).toBe('Reviewed three times.')
    expect(stuckWords.what(stuck({ why: 'round_limit', open: 3 }), 'Codex')).toBe('Reviewed three times. 3 findings open.')
  })
})

describe('the pull request Althar couldn’t open', () => {
  it('asks for the host to be connected, then tries again as it was', async () => {
    const onAnswer = show(stuck({ step: 'publish', why: 'not_connected', agentId: null }))
    expect(await screen.findByText("Althar isn't connected to this repository's host.")).toBeTruthy()
    // Where the app can't report a problem, it offers none.
    expect(screen.queryByRole('button', { name: 'Report this' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onAnswer).toHaveBeenCalledWith('st1', { kind: 'retry', agentId: 'althar' })
  })

  it('says why it paused after restarts, goes on without it, and reports it as the pull request step', async () => {
    const onReport = vi.fn()
    const onAnswer = show(stuck({ step: 'publish', why: 'restarted', agentId: null }), onReport)
    expect(await screen.findByText('Paused after Althar restarted twice.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Report this' }))
    expect(onReport).toHaveBeenCalledWith('Pull request')
    await userEvent.click(screen.getByRole('button', { name: 'Go on without it' }))
    expect(onAnswer).toHaveBeenCalledWith('st1', { kind: 'abandon' })
    expect(await screen.findByText('Went on without it')).toBeTruthy()
  })

  it('says what went wrong opening it, in the host’s words where it gave some', () => {
    expect(stuckWords.publishing(stuck({ step: 'publish', why: 'failed_to_start', detail: 'The branch is protected.' }))).toBe(
      "Couldn't open the pull request. The branch is protected.",
    )
  })
})

describe('trying a step again', () => {
  it('offers it on every card, on the agent the step was on', async () => {
    for (const why of ['no_report', 'session_ended', 'failed_to_start', 'looping', 'refused', 'transient'] as const) {
      const onAnswer = show(stuck({ why }))
      await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))
      expect(onAnswer).toHaveBeenCalledWith('st1', { kind: 'retry', agentId: 'codex' })
      document.body.innerHTML = ''
    }
  })

  it('puts it first where the connection or the session failed, rather than the work', async () => {
    for (const [why, first] of [
      ['transient', 'Try again'],
      ['session_ended', 'Try again'],
      ['no_report', 'Tell the lead'],
    ] as const) {
      show(stuck({ why }))
      const buttons = await screen.findAllByRole('button')
      expect(buttons[0]).toHaveProperty('textContent', first)
      document.body.innerHTML = ''
    }
  })

  it('says whose service kept failing, and what it said', () => {
    expect(stuckWords.what(stuck({ why: 'transient', service: 'Anthropic', detail: 'API Error: 529 Overloaded' }), 'Claude Code')).toBe(
      "Anthropic's service kept failing.",
    )
    expect(stuckWords.what(stuck({ why: 'transient', step: 'review' }), 'OpenCode')).toBe("OpenCode's service kept failing.")
  })

  it('says what Althar tried for a failing service in one line, not one for each try', async () => {
    show(stuck({ why: 'transient', service: 'Anthropic' }))
    expect(await screen.findByText(/Tried again 3 times/)).toBeTruthy()
    expect(screen.queryByText(/Tried again after/)).toBeNull()
    expect(screen.getByText('Implement, after 3 tries')).toBeTruthy()
  })

  it('runs a review again on its reviewer, or hands it to another', async () => {
    const onAnswer = show(stuck({ step: 'review', why: 'stalled' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Review again' }))
    expect(onAnswer).toHaveBeenCalledWith('st1', { kind: 'retry', agentId: 'codex' })
  })
})
