import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CODEX, GPT_MINI, OPUS, SONNET } from '../src/fixtures/models'
import { StepState, ToolState } from '../src/foundations/vocabulary'
import { ThreadShellProvider } from '../src/thread/Shell/Shell'
import { StepPanel, stepAudience, stepPanelText } from '../src/thread/StepPanel/StepPanel'
import { type SubAgent, SubAgents } from '../src/thread/SubAgents/SubAgents'

describe('a turn’s sub-agents', () => {
  const sub = (id: string, state: ToolState): SubAgent => ({
    id,
    label: `Read ${id}`,
    model: SONNET,
    state,
    meta: '12s',
    calls: <p>{`Calls of ${id}`}</p>,
  })
  const LIST = [
    sub('api', ToolState.Running),
    sub('db', ToolState.Done),
    sub('ui', ToolState.Failed),
    sub('docs', ToolState.Declined),
    sub('ops', ToolState.Cancelled),
  ]

  it('reads each one’s state after its name, the running one busy', () => {
    render(<SubAgents list={LIST} />)
    const items = within(screen.getByRole('list', { name: 'Sub-agents' })).getAllByRole('listitem')
    expect(items.map((item) => item.querySelector('[class*="label"]')?.textContent)).toEqual([
      'Read api, running',
      'Read db, done',
      'Read ui, failed',
      'Read docs, declined',
      'Read ops, cancelled',
    ])
    expect(items.map((item) => item.getAttribute('aria-busy'))).toEqual(['true', null, null, null, null])
  })

  it('opens one at a time to its calls, and closes it again', () => {
    const onOpenChange = vi.fn()
    render(<SubAgents list={LIST} onOpenChange={onOpenChange} />)
    fireEvent.click(screen.getByRole('button', { name: /^Read db/ }))
    expect(onOpenChange).toHaveBeenLastCalledWith('db')
    expect(screen.getByRole('button', { name: /^Read db/ })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: /^Read ui/ }))
    expect(screen.getByRole('button', { name: /^Read db/ })).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(screen.getByRole('button', { name: /^Read ui/ }))
    expect(onOpenChange).toHaveBeenLastCalledWith(null)
    expect(screen.getByRole('button', { name: /^Read ui/ })).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('a step’s own thread', () => {
  const step = { id: 'review', label: 'Review', n: 3, of: 4 }
  const panel = (props: Partial<Parameters<typeof StepPanel>[0]> = {}) =>
    render(<StepPanel step={step} agents={[OPUS]} body={(tab) => <p>{`Thread of ${tab}`}</p>} onClose={vi.fn()} {...props} />)

  it('shows one agent’s thread with no tabs, and what its result does', () => {
    panel()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.getByText(`Thread of ${OPUS.id}`)).toBeInTheDocument()
    expect(screen.getByText('step 3 of 4')).toBeInTheDocument()
    expect(screen.getByText('Returns a verdict and findings to the lead')).toBeInTheDocument()
  })

  it('gives two agents a tab each and one for both, starting on both', () => {
    const onTabChange = vi.fn()
    panel({ agents: [OPUS, CODEX], onTabChange })
    const tabs = within(screen.getByRole('tablist', { name: 'Whose thread' })).getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Both', expect.any(String), expect.any(String)])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('step 3 of 4 · 2 reviewers')).toBeInTheDocument()
    expect(screen.getByText('Combined into one list for the lead')).toBeInTheDocument()
    fireEvent.mouseDown(tabs[2]!)
    expect(onTabChange).toHaveBeenCalledWith(CODEX.id)
  })

  it('names the tab for every agent All where there are more than two, and starts where asked', () => {
    panel({ agents: [OPUS, CODEX, GPT_MINI], defaultTab: GPT_MINI.id, step: { ...step, state: StepState.Done } })
    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab')
    expect(tabs[0]).toHaveTextContent('All')
    expect(tabs[3]).toHaveAttribute('aria-selected', 'true')
  })

  it('starts on every agent’s tab where it has no agent yet', () => {
    panel({ agents: [] })
    expect(screen.getByText('Thread of all')).toBeInTheDocument()
  })

  it('opens the team’s instructions by their file’s name, or their title, where the host opens documents', () => {
    const openDoc = vi.fn()
    const instructions = { path: 'docs/review/REVIEW.md', body: '# Review' }
    const { rerender } = render(
      <ThreadShellProvider value={{ openDoc }}>
        <StepPanel step={step} agents={[OPUS]} instructions={instructions} body={() => null} onClose={vi.fn()} />
      </ThreadShellProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Instructions · REVIEW.md' }))
    expect(openDoc).toHaveBeenCalledWith(instructions)
    rerender(
      <ThreadShellProvider value={{ openDoc }}>
        <StepPanel step={step} agents={[OPUS]} instructions={{ title: 'How we review', body: '' }} body={() => null} onClose={vi.fn()} />
      </ThreadShellProvider>,
    )
    expect(screen.getByRole('button', { name: 'Instructions · How we review' })).toBeInTheDocument()
  })

  it('says who a message from each tab reaches', () => {
    const ref = { id: 'review', label: 'Review' }
    expect(stepAudience('all', ref, [OPUS, CODEX])).toBe('both reviewers')
    expect(stepAudience('all', ref, [OPUS, CODEX, SONNET])).toBe('all 3 reviewers')
    expect(stepAudience(CODEX.id, ref, [OPUS, CODEX])).toBe(CODEX.short)
    expect(stepAudience('all', ref, [OPUS])).toBe('Review')
    expect(stepPanelText.placeholder('both reviewers')).toBe('Message both reviewers. The lead does not hear it')
  })
})
