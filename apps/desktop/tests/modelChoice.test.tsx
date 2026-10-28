import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ModelChoice, type ModelChoiceProps } from '../src/renderer/shared/ModelChoice'
import { agents, fakeClient } from './fixtures'
import { withServices } from './render'

/*
 * Who runs a conversation, picked: where a turn is under way, another
 * agent's model asks first, from the pinned models and from every model;
 * the agent's own models don't. A pick made for something else can be taken
 * off it.
 */

const offered = agents.filter((agent) => agent.signIn !== 'signed_out')

const show = (props: Partial<ModelChoiceProps> = {}) => {
  const onChange = vi.fn()
  withServices(
    <ModelChoice
      owner="Coordinator"
      agents={offered}
      value={{ agentId: 'claude-code', model: 'opus', effort: 'high' }}
      onChange={onChange}
      handover={{ ask: (to, from) => `${to} takes over from ${from}, stopping its turn.` }}
      {...props}
    />,
    fakeClient().client,
  )
  return onChange
}

describe('picking who runs a conversation under way', () => {
  it('asks before another agent takes over, and changes the agent’s own model at once', async () => {
    const onChange = show()
    await userEvent.click(await screen.findByRole('button', { name: 'Coordinator: Claude Opus High' }))
    await userEvent.click(await screen.findByRole('radio', { name: /gpt-5\.2-codex/ }))
    const ask = await screen.findByRole('group', { name: 'Codex takes over from Claude Code, stopping its turn.' })
    expect(onChange).not.toHaveBeenCalled()
    await userEvent.click(within(ask).getByRole('button', { name: 'Switch' }))
    expect(onChange).toHaveBeenCalledWith({ agentId: 'codex', model: 'gpt-5.2-codex', effort: null })
    onChange.mockClear()
    // Still open on its models, it changes to one of the same agent's without asking, on the effort in use.
    await userEvent.click(await screen.findByRole('radio', { name: /Claude Code default/ }))
    expect(onChange).toHaveBeenCalledWith({ agentId: 'claude-code', model: 'default', effort: 'high' })
  })

  it('asks in the picker, opened again, for another agent’s model picked from every model', async () => {
    const onChange = show()
    await userEvent.click(await screen.findByRole('button', { name: 'Coordinator: Claude Opus High' }))
    await userEvent.click(screen.getByRole('button', { name: /All models/ }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Use gpt-5.2' }))
    const ask = await screen.findByRole('group', { name: 'Codex takes over from Claude Code, stopping its turn.' })
    await userEvent.click(within(ask).getByRole('button', { name: 'Cancel' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('names an agent it no longer offers by its id, as the one taken over from', async () => {
    show({ value: { agentId: 'aider', model: null, effort: null } })
    await userEvent.click(await screen.findByRole('button', { name: /^Coordinator: / }))
    await userEvent.click(await screen.findByRole('radio', { name: /gpt-5\.2-codex/ }))
    expect(await screen.findByRole('group', { name: 'Codex takes over from aider, stopping its turn.' })).toBeTruthy()
  })
})

describe('a pick made for something else', () => {
  it('can be taken off it, in the words given', async () => {
    const onRemove = vi.fn()
    show({ owner: 'Review', onRemove, text: { remove: 'Drop this reviewer' } })
    await userEvent.click(await screen.findByRole('button', { name: 'Review: Claude Opus High' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Drop this reviewer' }))
    expect(onRemove).toHaveBeenCalled()
  })
})
