import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AgentCatalog, type AgentCatalogProps } from '../src/setup/AgentCatalog/AgentCatalog'

const item = {
  id: 'goose',
  name: 'Goose',
  description: 'An engineering agent',
  version: '1.2.3',
  guide: 'https://example.test/setup',
  command: 'goose',
  args: ['acp'],
  mode: 'approve',
  readerMode: 'approve',
}
const props = (): AgentCatalogProps => ({
  items: [item],
  connections: [],
  onSave: vi.fn(),
  onCheck: vi.fn(),
  onRemove: vi.fn(),
  onRefresh: vi.fn(),
  onGuide: vi.fn(),
})

describe('the agent catalog', () => {
  it('browses metadata and filters it without saving or checking a connection', () => {
    const p = props()
    render(<AgentCatalog {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Browse agents' }))
    expect(p.onRefresh).toHaveBeenCalledOnce()
    const dialog = screen.getByRole('dialog', { name: 'Connect an agent' })
    expect(within(dialog).getByText('Goose')).toBeVisible()
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Search agents' }), { target: { value: 'not-there' } })
    expect(within(dialog).getByText(/No agents match/)).toBeVisible()
    expect(p.onSave).not.toHaveBeenCalled()
    expect(p.onCheck).not.toHaveBeenCalled()
  })

  it('preserves registry provenance and literal arguments when saving a connection', () => {
    const p = props()
    render(<AgentCatalog {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Browse agents' }))
    fireEvent.click(screen.getByRole('button', { name: 'Connect Goose' }))
    fireEvent.change(screen.getByLabelText('Arguments'), { target: { value: '["acp","a space","$(nothing)"]' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save connection' }))
    expect(p.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ registryId: 'goose', registryVersion: '1.2.3', args: ['acp', 'a space', '$(nothing)'], mode: 'approve' }),
      expect.any(Function),
    )
    expect(p.onCheck).not.toHaveBeenCalled()
  })

  it('puts a validation error at the argument field and retains the draft when another settings section shows', () => {
    const p = props()
    const view = render(<AgentCatalog {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add command' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My agent' } })
    fireEvent.change(screen.getByLabelText('Executable'), { target: { value: '/path/to/agent' } })
    fireEvent.change(screen.getByLabelText('Arguments'), { target: { value: 'not json' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save connection' }))
    expect(screen.getByLabelText('Arguments')).toHaveFocus()
    expect(screen.getByRole('alert')).toHaveTextContent('Use a JSON array')
    expect(p.onSave).not.toHaveBeenCalled()
    view.rerender(<AgentCatalog {...p} active={false} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    view.rerender(<AgentCatalog {...p} />)
    expect(screen.getByLabelText('Name')).toHaveValue('My agent')
    expect(screen.getByLabelText('Arguments')).toHaveValue('not json')
  })

  it('keeps an unavailable platform out of Connect, and shows an offline catalog problem with a retry', () => {
    const p = props()
    render(<AgentCatalog {...p} items={[{ ...item, command: null }]} problem="The registry could not be reached." />)
    fireEvent.click(screen.getByRole('button', { name: 'Browse agents' }))
    expect(screen.getByRole('button', { name: 'Connect Goose' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('could not be reached')
    expect(screen.getByRole('button', { name: 'Refresh registry' })).toBeEnabled()
  })
  it('explains a qualification blocker without describing it as a missing platform', () => {
    render(<AgentCatalog {...props()} items={[{ ...item, command: null, problem: 'This agent’s Script tool bypasses permissions.' }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Browse agents' }))
    expect(screen.getByText('This agent’s Script tool bypasses permissions.')).toBeVisible()
    expect(screen.queryByText('No distribution for this device')).toBeNull()
    expect(screen.getByRole('button', { name: 'Connect Goose' })).toBeDisabled()
  })
})
