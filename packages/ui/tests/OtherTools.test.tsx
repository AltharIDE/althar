import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Brand } from '../src/foundations/brands/brands'
import { OtherTools, type OtherToolTile } from '../src/setup/OtherTools/OtherTools'

/*
 * What other tools left, a tile each (docs/decisions/workspaces-and-runs.md, "Bringing in other tools' work"): a press
 * takes a whole tool or leaves it, its chevron opens what's in it to pick one by one, and Escape closes it.
 */

const TILES: OtherToolTile[] = [
  {
    id: 'conductor',
    name: 'Conductor',
    brand: Brand.Conductor,
    size: '2 worktrees',
    fact: '1 failing check',
    groups: [
      {
        title: 'Worktrees',
        items: [
          { key: 'a', title: 'Lima', at: '2h ago', facts: ['3 not committed'] },
          { key: 'b', title: 'Oslo' },
        ],
      },
      { title: 'Setup', items: [{ key: 's', title: 'Its setup script' }] },
    ],
  },
  {
    id: 'hand',
    name: 'By hand',
    icon: 'branch',
    size: '1 worktree',
    groups: [{ title: 'Worktrees', items: [{ key: 'h', title: 'Review' }] }],
  },
  { id: 'empty', name: 'Paradev', brand: Brand.Paradev, size: 'nothing', groups: [{ title: 'Worktrees', items: [] }] },
]

describe('other tools’ tiles', () => {
  it('takes a whole tool with a press, and leaves it with another once it is all taken', () => {
    const onPick = vi.fn()
    const { rerender } = render(<OtherTools tiles={TILES} picked={new Set()} onPick={onPick} />)
    fireEvent.click(screen.getByRole('button', { name: /^Conductor/ }))
    expect(onPick).toHaveBeenLastCalledWith(['a', 'b', 's'], true)
    rerender(<OtherTools tiles={TILES} picked={new Set(['a', 'b', 's'])} onPick={onPick} />)
    expect(screen.getByRole('button', { name: /^Conductor/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /^Conductor/ }))
    expect(onPick).toHaveBeenLastCalledWith(['a', 'b', 's'], false)
    // All and None over the tiles take and leave everything.
    fireEvent.click(screen.getAllByRole('button', { name: 'None' })[0] as HTMLElement)
    expect(onPick).toHaveBeenLastCalledWith(['a', 'b', 's', 'h'], false)
  })

  it('says how much of a tool part taken is', () => {
    render(<OtherTools tiles={TILES} picked={new Set(['a'])} onPick={() => undefined} />)
    expect(screen.getByRole('button', { name: /^Conductor/ })).toHaveTextContent('2 worktrees · 1 of 3')
    expect(screen.getByRole('button', { name: /^Conductor/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('opens what’s in a tool under its row to pick one by one, its groups with All and None, and closes on Escape', () => {
    const onPick = vi.fn()
    render(<OtherTools tiles={TILES} picked={new Set(['a'])} onPick={onPick} />)
    const inside = screen.getByRole('button', { name: 'What’s in Conductor' })
    fireEvent.click(inside)
    expect(inside).toHaveAttribute('aria-expanded', 'true')
    const lima = screen.getByRole('checkbox', { name: /Lima/ })
    expect(lima).toHaveAttribute('data-state', 'checked')
    fireEvent.click(screen.getByRole('checkbox', { name: /Oslo/ }))
    expect(onPick).toHaveBeenLastCalledWith(['b'], true)
    const worktrees = screen.getByRole('heading', { name: /Worktrees/ }).closest('section') as HTMLElement
    fireEvent.click(within(worktrees).getByRole('button', { name: 'All' }))
    expect(onPick).toHaveBeenLastCalledWith(['a', 'b'], true)
    // A group of one has no All and None of its own.
    const setup = screen.getByRole('heading', { name: /Setup/ }).closest('section') as HTMLElement
    expect(within(setup).queryByRole('button', { name: 'All' })).toBeNull()
    // Another tile takes the panel over; its own again closes it.
    fireEvent.click(screen.getByRole('button', { name: 'What’s in By hand' }))
    expect(screen.getByRole('button', { name: 'What’s in By hand' })).toHaveAttribute('aria-expanded', 'true')
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(screen.getByRole('button', { name: 'What’s in By hand' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens on the tile asked for, and says its words as given', () => {
    render(
      <OtherTools
        tiles={TILES}
        picked={new Set()}
        onPick={() => undefined}
        defaultOpen="hand"
        text={{ heading: 'Gefunden', inside: (tool) => `In ${tool}` }}
      />,
    )
    expect(screen.getByRole('heading', { name: /Gefunden/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'In By hand' })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'In By hand' }))
    expect(screen.getByRole('button', { name: 'In By hand' })).toHaveAttribute('aria-expanded', 'false')
  })
})
