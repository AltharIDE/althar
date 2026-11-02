import { screen, within } from '@testing-library/react'
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

/** The agents list the one model an OpenCode provider refused, or, with `fixtureModels`, those of the fixtures. */
const show = (step: StuckStep, onReport?: (step: string) => void, onSignIn?: (agentId: string) => void, fixtureModels = false) => {
  const { client } = fakeClient(
    fixtureModels
      ? {}
      : {
          getModels: vi.fn(async () => [
            {
              agentId: 'codex',
              models: [
                {
                  id: 'opencode-go/deepseek-v4.1-flash',
                  name: 'OpenCode Go/DeepSeek V4.1 Flash',
                  description: null,
                  efforts: [],
                  effort: null,
                },
              ],
              model: null,
              effort: null,
              defaults: [],
              blocked: [],
              probing: false,
              images: null,
            },
          ]),
        },
  )
  const onAnswer = vi.fn()
  withServices(
    <StuckCall
      request={request(step)}
      stuck={step}
      agents={agents}
      agentName={(id) => (id === 'codex' ? 'Codex' : '')}
      onAnswer={onAnswer}
      {...(onReport === undefined ? {} : { onReport })}
      {...(onSignIn === undefined ? {} : { onSignIn })}
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

describe('a sign-in a provider within the agent refused', () => {
  const refused = stuck({
    step: 'review',
    why: 'signed_out',
    detail: 'Authentication required: provider authentication required',
    model: 'opencode-go/deepseek-v4.1-flash',
    provider: 'opencode-go',
  })

  it('names the provider and the model, with the agent’s own words under it, and signs in to that provider', async () => {
    const onSignIn = vi.fn()
    show(refused, undefined, onSignIn)
    expect(await screen.findByText('OpenCode Go refused the sign-in for DeepSeek V4.1 Flash.')).toBeTruthy()
    expect(screen.getByText('Authentication required: provider authentication required')).toBeTruthy()
    expect(screen.queryByText(/is signed out/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Sign in to OpenCode Go' }))
    expect(onSignIn).toHaveBeenCalledWith('codex')
  })

  it('names the provider by its id where its agent doesn’t list the model', async () => {
    show({ ...refused, model: 'opencode-go/glm-9', provider: 'opencode-go' }, undefined, vi.fn())
    expect(await screen.findByRole('button', { name: 'Sign in to opencode-go' })).toBeTruthy()
  })

  it('says the agent is signed out where no provider is named, still with its words under it', async () => {
    show({ ...refused, model: undefined, provider: undefined }, undefined, vi.fn())
    expect(await screen.findByText('Codex is signed out.')).toBeTruthy()
    expect(screen.getByText('Authentication required: provider authentication required')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign in again' })).toBeTruthy()
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

describe('handing a step on to a model', () => {
  const opened = async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Review with another agent' }))
  }

  it('offers every model but the one whose failure it was, and hands the step to the one picked, another of the same agent’s too', async () => {
    const onAnswer = show(
      stuck({ step: 'review', why: 'signed_out', agentId: 'codex', model: 'gpt-5.2-codex' }),
      undefined,
      undefined,
      true,
    )
    await opened()
    // Suggested: another maker's model, not the one that ran out.
    await userEvent.click(await screen.findByRole('button', { name: /^Review: / }))
    expect(screen.queryByRole('radio', { name: /gpt-5\.2-codex/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /All models/ }))
    const all = within(await screen.findByRole('dialog'))
    expect(all.queryByRole('button', { name: 'Use gpt-5.2-codex' })).toBeNull()
    await userEvent.click(all.getByRole('button', { name: 'Use gpt-5.2' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Review' }))
    expect(onAnswer).toHaveBeenCalledWith('st1', { kind: 'retry', agentId: 'codex', model: 'gpt-5.2' })
    expect(await screen.findByText('Reviewing with gpt-5.2')).toBeTruthy()
  })

  it('leaves out no model where the step stalled, and suggests another maker’s', async () => {
    const onAnswer = show(stuck({ step: 'review', why: 'stalled', agentId: 'codex', model: 'gpt-5.2-codex' }), undefined, undefined, true)
    await opened()
    await userEvent.click(await screen.findByRole('button', { name: /^Review: Claude/ }))
    expect(screen.getByRole('radio', { name: /gpt-5\.2-codex/ })).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(onAnswer).toHaveBeenCalledWith('st1', { kind: 'retry', agentId: 'claude-code', model: 'default' })
  })

  it('hands the step on at the effort picked', async () => {
    const onAnswer = show(
      stuck({ step: 'review', why: 'stalled', agentId: 'claude-code', model: 'opus', effort: 'high' }),
      undefined,
      undefined,
      true,
    )
    await opened()
    await userEvent.click(await screen.findByRole('button', { name: /^Review: Codex|^Review: gpt-5/ }))
    await userEvent.click(await screen.findByRole('radio', { name: 'Extra high' }))
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(onAnswer).toHaveBeenCalledWith('st1', { kind: 'retry', agentId: 'codex', model: 'gpt-5.2-codex', effort: 'extra-high' })
  })
})
