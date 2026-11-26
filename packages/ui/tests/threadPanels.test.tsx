import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SONNET } from '../src/fixtures/models'
import { ToolState } from '../src/foundations/vocabulary'
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
