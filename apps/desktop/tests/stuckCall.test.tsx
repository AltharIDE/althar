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

  it('says how many rounds of review ran, whatever today’s setting is, and that the last fixes were not reviewed', () => {
    const said = (round: number, open = 0) => stuckWords.what(stuck({ why: 'round_limit', round, open }), 'Codex')
    expect(said(1)).toBe("Reviewed once; the last fixes weren't reviewed.")
    expect(said(2)).toBe("Reviewed twice; the last fixes weren't reviewed.")
    expect(said(3)).toBe("Reviewed 3 times; the last fixes weren't reviewed.")
    expect(said(5)).toBe("Reviewed 5 times; the last fixes weren't reviewed.")
    expect(said(1, 1)).toBe("Reviewed once; the last fixes weren't reviewed. 1 finding open.")
    expect(said(3, 3)).toBe("Reviewed 3 times; the last fixes weren't reviewed. 3 findings open.")
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
    const tell = ['Tell the lead', 'Continue with another model', 'Abandon this step', report]
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
      over_budget: ['Let Codex carry on', 'Tell the lead', 'Continue with another model', 'Abandon this step', report],
      // Althar, the service or the session failed, not the work: nothing to tell the lead, so its agent starts again.
      session_ended: ['Start Codex again', 'Continue with another model', 'Abandon this step', report],
      restarted: ['Start Codex again', 'Continue with another model', 'Abandon this step', report],
      transient: ['Try again', 'Continue with another model', 'Abandon this step', report],
      failed_to_start: ['Try again', 'Continue with another model', 'Abandon this step', report],
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
      'Review with another model',
      'Review again',
      'Skip the review',
      report,
    ])
    expect(await buttonsOf(stuck({ step: 'review', why: 'restarted' }))).toEqual([
      'Review again',
      'Review with another model',
      'Skip the review',
      report,
    ])
    expect(await buttonsOf(stuck({ step: 'review', why: 'round_limit', agentId: 'codex', open: 2 }))).toEqual([
      'Review again',
      'Review with another model',
      'Accept it as it is',
      report,
    ])
  })

  it('offers an agent out of usage, with no one named to take over, to another first, never to be told', async () => {
    expect(await buttonsOf(stuck({ why: 'usage_limit' }))).toEqual([
      'Continue with another model',
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
      'Continue with another model',
      'Abandon this step',
    ])
  })

  it('says a sign-in that ended as such, not signed out, and offers its sign-in first all the same', async () => {
    const onSignIn = vi.fn()
    const { client } = fakeClient()
    const step = stuck({ why: 'sign_in_ended', detail: 'Its sign-in has ended. Sign it in again in Settings, then try again.' })
    withServices(
      <StuckCall
        request={request(step)}
        stuck={step}
        agents={agents}
        agentName={() => 'Claude Code'}
        onAnswer={vi.fn()}
        onSignIn={onSignIn}
      />,
      client,
    )
    expect(await screen.findByText("Claude Code's sign-in has ended.")).toBeTruthy()
    expect(screen.queryByText(/is signed out/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Sign in again' }))
    expect(onSignIn).toHaveBeenCalledWith('codex')
  })

  it('offers an agent that isn’t installed its install in Settings first, then trying again', async () => {
    const onInstall = vi.fn()
    const { client } = fakeClient()
    const step = stuck({ why: 'not_installed', detail: "codex isn't installed, or isn't on this Mac's PATH." })
    withServices(
      <StuckCall request={request(step)} stuck={step} agents={agents} agentName={() => 'Codex'} onAnswer={vi.fn()} onInstall={onInstall} />,
      client,
    )
    expect((await screen.findAllByRole('button')).map((button) => button.textContent)).toEqual([
      'Install',
      'Try again',
      'Continue with another model',
      'Abandon this step',
    ])
    expect(screen.getByText(/^Codex isn't installed, or isn't on .+'s PATH\.$/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Install' }))
    expect(onInstall).toHaveBeenCalledWith('codex')
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

describe('handing a step on to a model', () => {
  /** The menu of models a review is handed on in. */
  const menu = async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Review with another model' }))
    return within(await screen.findByRole('menu', { name: 'Review with' }))
  }

  it('offers every model but the one whose failure it was, another maker’s first, and hands the step to the one picked, another of the same agent’s too', async () => {
    const onAnswer = show(
      stuck({ step: 'review', why: 'signed_out', agentId: 'codex', model: 'gpt-5.2-codex' }),
      undefined,
      undefined,
      true,
    )
    const models = await menu()
    expect(models.getAllByRole('menuitem')[0]?.textContent).toMatch(/Claude/)
    expect(models.queryByRole('menuitem', { name: /gpt-5\.2-codex/ })).toBeNull()
    await userEvent.click(models.getByRole('menuitem', { name: /All models/ }))
    const all = within(await screen.findByRole('dialog'))
    expect(all.queryByRole('button', { name: 'Use gpt-5.2-codex' })).toBeNull()
    await userEvent.click(all.getByRole('button', { name: 'Use gpt-5.2' }))
    expect(onAnswer).toHaveBeenCalledWith('st1', { kind: 'retry', agentId: 'codex', model: 'gpt-5.2' })
    expect(await screen.findByText('Reviewing with gpt-5.2')).toBeTruthy()
  })

  it('leaves out no model where the step stalled, and hands it to the one picked at once', async () => {
    const onAnswer = show(stuck({ step: 'review', why: 'stalled', agentId: 'codex', model: 'gpt-5.2-codex' }), undefined, undefined, true)
    const models = await menu()
    expect(models.getByRole('menuitem', { name: /gpt-5\.2-codex/ })).toBeTruthy()
    await userEvent.click(models.getAllByRole('menuitem')[0]!)
    expect(onAnswer).toHaveBeenCalledWith('st1', { kind: 'retry', agentId: 'claude-code', model: 'default' })
  })

  it('keeps the step’s effort where the agent it goes to offers it', async () => {
    const onAnswer = show(
      stuck({ step: 'review', why: 'stalled', agentId: 'claude-code', model: 'opus', effort: 'high' }),
      undefined,
      undefined,
      true,
    )
    const models = await menu()
    // Another maker's first, then the pins: Claude Code's own at the step's effort.
    expect(models.getAllByRole('menuitem')[0]?.textContent).toMatch(/gpt-5\.2-codex/)
    await userEvent.click(models.getByRole('menuitem', { name: /Claude|Default/ }))
    expect(onAnswer).toHaveBeenCalledWith('st1', { kind: 'retry', agentId: 'claude-code', model: 'default', effort: 'high' })
  })
})
