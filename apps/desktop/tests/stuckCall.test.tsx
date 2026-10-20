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
      'Codex stopped twice without saying whether the step is done, even after Althar reminded it. Review again, or skip the review.',
      'Codex has gone quiet: there has been no sign of work on this step for a while. Review again, or skip the review.',
      'Codex kept running `npm test` and got the same result each time. Review again, or skip the review.',
      "Codex has worked on this step for 3 hours since you last said anything, and isn't done. Review again, or skip the review.",
    ])
  })

  it('says what it can where its agent didn’t say what it ran, or for how long', () => {
    expect(stuckWords.what(stuck({ why: 'looping' }), 'Codex')).toBe(
      'Codex kept running the same thing and got the same result each time. Tell it to try something else, or hand the step to another agent.',
    )
    expect(stuckWords.what(stuck({ why: 'over_budget' }), 'Codex')).toBe(
      "Codex has worked on this step for a long time since you last said anything, and isn't done. Let it carry on if it seems to be getting somewhere, or hand the step to another agent.",
    )
  })

  it('counts the findings still open after the last review round, and says none where none are', () => {
    expect(stuckWords.what(stuck({ why: 'round_limit', open: 0 }), 'Codex')).toBe(
      "The work has been reviewed three times, and the lead's last changes haven't been reviewed yet. Review it again, or accept it as it is.",
    )
    expect(stuckWords.what(stuck({ why: 'round_limit', open: 3 }), 'Codex')).toBe(
      "The work has been reviewed three times, and the lead's last changes haven't been reviewed yet. 3 findings are still open. Review it again, or accept it as it is.",
    )
  })
})

describe('the pull request Althar couldn’t open', () => {
  it('asks for the host to be connected, then tries again as it was', async () => {
    const onAnswer = show(stuck({ step: 'publish', why: 'not_connected', agentId: null }))
    expect(
      await screen.findByText(
        "Althar isn't connected to this repository's host, so it can't push the branch or open the pull request. Connect it, then press Try again.",
      ),
    ).toBeTruthy()
    // Where the app can't report a problem, it offers none.
    expect(screen.queryByRole('button', { name: 'Report this' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onAnswer).toHaveBeenCalledWith('st1', { kind: 'retry', agentId: 'althar' })
  })

  it('says why it paused after restarts, goes on without it, and reports it as the pull request step', async () => {
    const onReport = vi.fn()
    const onAnswer = show(stuck({ step: 'publish', why: 'restarted', agentId: null }), onReport)
    expect(
      await screen.findByText(
        'Althar restarted twice while opening the pull request, so it paused in case that caused it. If you restarted Althar yourself, try again.',
      ),
    ).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Report this' }))
    expect(onReport).toHaveBeenCalledWith('Pull request')
    await userEvent.click(screen.getByRole('button', { name: 'Go on without it' }))
    expect(onAnswer).toHaveBeenCalledWith('st1', { kind: 'abandon' })
    expect(await screen.findByText('Went on without it')).toBeTruthy()
  })

  it('says what went wrong opening it, in the host’s words where it gave some', () => {
    expect(stuckWords.publishing(stuck({ step: 'publish', why: 'failed_to_start', detail: 'The branch is protected.' }))).toBe(
      "Althar couldn't open the pull request. The branch is protected. Try again, or go on without it.",
    )
  })
})
