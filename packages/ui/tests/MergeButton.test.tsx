import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from 'storybook/test'
import { describe, expect, it, vi } from 'vitest'

import { MergeButton } from '../src/primitives/MergeButton/MergeButton'
import { NextSteps } from '../src/primitives/NextStep/NextStep'

describe('the explicit choice to merge without a queue', () => {
  it.each([false, true])('keeps the normal merge primary, with strip=%s', async (strip) => {
    const normal = vi.fn()
    const bypass = vi.fn()
    const openTask = vi.fn()
    render(
      <div onClick={openTask}>
        <NextSteps>
          <MergeButton strip={strip} onMerge={normal} onBypassQueue={bypass}>
            Accept and merge
          </MergeButton>
        </NextSteps>
      </div>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Accept and merge' }))
    expect(normal).toHaveBeenCalledOnce()
    expect(bypass).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Other ways to merge' }))
    expect(normal).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Merge without queue' }))
    expect(bypass).toHaveBeenCalledOnce()
    if (strip) expect(openTask).not.toHaveBeenCalled()
  })

  it('supports keyboard selection and restores focus on Escape', async () => {
    const normal = vi.fn()
    const bypass = vi.fn()
    render(
      <MergeButton onMerge={normal} onBypassQueue={bypass}>
        Merge
      </MergeButton>,
    )
    const more = screen.getByRole('button', { name: 'Other ways to merge' })
    more.focus()
    await userEvent.keyboard('{ArrowDown}')
    await screen.findByRole('menu')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(more).toHaveFocus()
    expect(bypass).not.toHaveBeenCalled()
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(bypass).toHaveBeenCalledOnce()
    expect(normal).not.toHaveBeenCalled()
  })

  it('offers a normal button without an authorized bypass callback', () => {
    render(<MergeButton onMerge={vi.fn()}>Merge</MergeButton>)
    expect(screen.getByRole('button', { name: 'Merge' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Other ways to merge' })).not.toBeInTheDocument()
  })

  it.each([
    { busy: true, strip: true },
    { busy: true, strip: false },
    { busy: false, strip: true },
    { busy: false, strip: false },
  ])('prevents duplicate actions when pending or disabled: %j', async ({ busy, strip }) => {
    const normal = vi.fn()
    const bypass = vi.fn()
    render(
      <MergeButton onMerge={normal} onBypassQueue={bypass} busy={busy} disabled={!busy} strip={strip}>
        Merging
      </MergeButton>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Merging' }))
    expect(screen.getByRole('button', { name: 'Other ways to merge' })).toBeDisabled()
    expect(normal).not.toHaveBeenCalled()
    expect(bypass).not.toHaveBeenCalled()
  })

  it('lets an authorized person merge a queued PR directly without offering to queue it again', async () => {
    const normal = vi.fn()
    const bypass = vi.fn()
    render(
      <MergeButton queued onMerge={normal} onBypassQueue={bypass}>
        Merge
      </MergeButton>,
    )
    expect(screen.queryByRole('button', { name: 'Merge' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Other ways to merge' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Merge without queue' }))
    expect(bypass).toHaveBeenCalledOnce()
    expect(normal).not.toHaveBeenCalled()
  })

  it('has no action for a queued PR without bypass permission, or a settled PR', () => {
    const { rerender } = render(
      <MergeButton queued onMerge={vi.fn()}>
        Merge
      </MergeButton>,
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    rerender(<MergeButton />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('disables an open menu if the action starts or permission disappears', async () => {
    const bypass = vi.fn()
    const { rerender } = render(
      <MergeButton onMerge={vi.fn()} onBypassQueue={bypass}>
        Merge
      </MergeButton>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Other ways to merge' }))
    rerender(
      <MergeButton onMerge={vi.fn()} onBypassQueue={bypass} busy>
        Merge
      </MergeButton>,
    )
    expect(screen.getByRole('menuitem', { name: 'Merge without queue' })).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Merge without queue' }))
    expect(bypass).not.toHaveBeenCalled()
    rerender(<MergeButton onMerge={vi.fn()}>Merge</MergeButton>)
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
  })
})
