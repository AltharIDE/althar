import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { NextRow } from '../src/board/NextRow/NextRow'
import { TaskMenu } from '../src/chrome/TaskMenu/TaskMenu'
import { ModelPick } from '../src/composer/ModelPick/ModelPick'
import { TeamDialog } from '../src/coordinator/TeamDialog/TeamDialog'
import { CODEX, OPUS } from '../src/fixtures/models'
import { TaskEnd, Wait } from '../src/foundations/vocabulary'

describe('starting a plan, or changing its team, before it begins', () => {
  it('lets a row up next start, with its menu at its line’s end, and only where it is given', () => {
    const onStart = vi.fn()
    const { rerender } = render(
      <NextRow
        place={3}
        task="t"
        title="Coordinator merges"
        wait={Wait.You}
        reason="Held. Starts when you say"
        onStart={onStart}
        menu={<button type="button">More</button>}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(onStart).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'More' })).toBeTruthy()
    expect(screen.getByText('Held. Starts when you say')).toBeTruthy()
    rerender(<NextRow place={3} task="t" title="Coordinator merges" wait={Wait.You} reason="Held. Starts when you say" />)
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
  })

  it('lets a row up next hold, beside Start where it has both, and only where it is given', () => {
    const onHold = vi.fn()
    const { rerender } = render(
      <NextRow place={1} task="t" title="Waits for an agent" wait={Wait.Workers} reason="Next in line" onHold={onHold} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Hold' }))
    expect(onHold).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
    rerender(
      <NextRow place={1} task="t" title="Counting down" wait={Wait.Workers} reason="Starts in 12s" onStart={vi.fn()} onHold={onHold} />,
    )
    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Hold' })).toBeTruthy()
    rerender(<NextRow place={1} task="t" title="Held" wait={Wait.You} reason="Held" onStart={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Hold' })).toBeNull()
  })

  it('offers Hold in the task’s menu, under Start now, while its plan can be held', () => {
    const onHold = vi.fn()
    render(<TaskMenu defaultOpen onStartNow={vi.fn()} onHold={onHold} />)
    const items = within(screen.getByRole('menu', { name: 'This task' })).getAllByRole('menuitem')
    expect(
      items.map((item) => document.getElementById(item.getAttribute('aria-labelledby') ?? '')?.textContent ?? item.textContent),
    ).toEqual(['Start now', 'Hold'])
    fireEvent.click(items[1]!)
    expect(onHold).toHaveBeenCalledOnce()
  })

  it('opens the team from the task’s menu, under Start now', () => {
    const onChangeTeam = vi.fn()
    render(<TaskMenu defaultOpen onStartNow={vi.fn()} onChangeTeam={onChangeTeam} />)
    const items = within(screen.getByRole('menu', { name: 'This task' })).getAllByRole('menuitem')
    expect(
      items.map((item) => document.getElementById(item.getAttribute('aria-labelledby') ?? '')?.textContent ?? item.textContent),
    ).toEqual(['Start now', 'Change the team…'])
    fireEvent.click(items[1]!)
    expect(onChangeTeam).toHaveBeenCalledOnce()
  })

  it('opens the team from the model picker’s foot, closing the picker first', () => {
    const order: string[] = []
    render(
      <ModelPick
        model={OPUS}
        pinned={[OPUS, CODEX]}
        effort={null}
        defaultEffort={null}
        onChange={vi.fn()}
        onEffort={vi.fn()}
        owner="Lead"
        defaultOpen
        onOpenChange={(open) => order.push(open ? 'open' : 'closed')}
        onTeam={() => order.push('team')}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Change the team…' }))
    expect(order).toEqual(['closed', 'team'])
  })

  it('keeps the dialog’s choices until Save or Start, and offers Start only where it is given', () => {
    const onSave = vi.fn()
    const onStart = vi.fn()
    const onAdd = vi.fn()
    const steps = [
      { id: 'implement', label: 'Implement', picker: <span>Opus</span>, why: 'It knows the code.' },
      { id: 'review', label: 'Review', picker: null, skipped: true, onAdd },
    ]
    const { rerender } = render(
      <TeamDialog
        task="Coordinator merges"
        steps={steps}
        end={{ value: TaskEnd.DraftPr, onChange: vi.fn() }}
        onSave={onSave}
        onStart={onStart}
        onClose={vi.fn()}
      />,
    )
    const dialog = within(screen.getByRole('dialog', { name: 'Team' }))
    expect(dialog.getByText('It knows the code.')).toBeTruthy()
    expect(dialog.getByText('No review')).toBeTruthy()
    fireEvent.click(dialog.getByRole('button', { name: 'Add a review' }))
    expect(onAdd).toHaveBeenCalledOnce()
    fireEvent.click(dialog.getByRole('button', { name: 'Start' }))
    expect(onStart).toHaveBeenCalledOnce()
    expect(onSave).not.toHaveBeenCalled()

    rerender(<TeamDialog task="Coordinator merges" steps={steps} onClose={vi.fn()} error="It started with the team it had." />)
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.getByRole('alert').textContent).toBe('It started with the team it had.')
  })
})
