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

  it('says Althar crashed on it, goes on without it, and reports it as the pull request step', async () => {
    const onReport = vi.fn()
    const onAnswer = show(stuck({ step: 'publish', why: 'restarted', agentId: null }), onReport)
    expect(await screen.findByText('Althar stopped unexpectedly twice while this step ran.')).toBeTruthy()
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

/** The card's buttons, in order, the first the way to take. */
const buttonsOf = async (step: StuckStep) => {
  show(step, () => {})
  const names = (await screen.findAllByRole('button')).map((button) => button.textContent)
  document.body.innerHTML = ''
  return names
}

describe('the ways on each card offers', () => {
  const report = 'Report this'

  it('offers a lead’s step only what fits what went wrong, the way to take first', async () => {
    const tell = ['Tell the lead', 'Hand to another agent', 'Abandon this step', report]
    const offered: Record<string, ReadonlyArray<string | null>> = {}
    for (const why of [
      'no_report',
      'session_ended',
      'transient',
      'failed_to_start',
      'restarted',
      'stalled',
      'looping',
      'over_budget',
      'refused',
    ] as const)
      offered[why] = await buttonsOf(stuck({ why }))
    expect(offered).toEqual({
      // The lead's own work went wrong: told what to do instead.
      no_report: tell,
      stalled: tell,
      looping: tell,
      refused: tell,
      over_budget: ['Let Codex carry on', 'Tell the lead', 'Hand to another agent', 'Abandon this step', report],
      // Althar, the service or the session failed, not the work: nothing to tell the lead, so its agent starts again.
      session_ended: ['Start Codex again', 'Hand to another agent', 'Abandon this step', report],
      restarted: ['Start Codex again', 'Hand to another agent', 'Abandon this step', report],
      transient: ['Try again', 'Hand to another agent', 'Abandon this step', report],
      failed_to_start: ['Try again', 'Hand to another agent', 'Abandon this step', report],
    })
  })

  it('says a step Althar crashed on in plain words, and starts its agent again on the agent it was on', async () => {
    const onAnswer = show(stuck({ why: 'restarted' }))
    expect(await screen.findByText('Althar stopped unexpectedly twice while this step ran.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Tell the lead' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Start Codex again' }))
    expect(onAnswer).toHaveBeenCalledWith('st1', { kind: 'retry', agentId: 'codex' })
  })

  it('never tells a review what to do: another reviewer for its own trouble, the same again where it was cut off', async () => {
    expect(await buttonsOf(stuck({ step: 'review', why: 'stalled' }))).toEqual([
      'Review with another agent',
      'Review again',
      'Skip the review',
      report,
    ])
    expect(await buttonsOf(stuck({ step: 'review', why: 'restarted' }))).toEqual([
      'Review again',
      'Review with another agent',
      'Skip the review',
      report,
    ])
    expect(await buttonsOf(stuck({ step: 'review', why: 'round_limit', agentId: 'codex', open: 2 }))).toEqual([
      'Review again',
      'Review with another agent',
      'Accept it as it is',
      report,
    ])
  })

  it('offers an agent out of usage, with no one named to take over, to another first, never to be told', async () => {
    expect(await buttonsOf(stuck({ why: 'usage_limit' }))).toEqual([
      'Hand to another agent',
      'Try Codex again',
      'Abandon this step',
      report,
    ])
  })

  it('offers a signed-out agent its sign-in first, then trying again, never telling it', async () => {
    const onSignIn = vi.fn()
    const { client } = fakeClient()
    const step = stuck({ why: 'signed_out' })
    withServices(
      <StuckCall request={request(step)} stuck={step} agents={agents} agentName={() => 'Codex'} onAnswer={vi.fn()} onSignIn={onSignIn} />,
      client,
    )
    expect((await screen.findAllByRole('button')).map((button) => button.textContent)).toEqual([
      'Sign in again',
      'Try again',
      'Hand to another agent',
      'Abandon this step',
    ])
  })

  it('offers the pull request only trying again or going on without it', async () => {
    expect(await buttonsOf(stuck({ step: 'publish', why: 'failed_to_start', agentId: null }))).toEqual([
      'Try again',
      'Go on without it',
      report,
    ])
  })
})

describe('trying a step again', () => {
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
