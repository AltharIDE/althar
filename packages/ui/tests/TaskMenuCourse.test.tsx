import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { TaskMenu } from '../src/chrome/TaskMenu/TaskMenu'

const menu = () => within(screen.getByRole('menu', { name: 'This task' }))
/* The menu's rows in order, a separator as a rule. */
const rows = () =>
  Array.from(
    screen
      .getByRole('menu', { name: 'This task' })
      .querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="separator"]'),
  ).map((row) => (row.getAttribute('role') === 'separator' ? '—' : (row.querySelector('[class*="label"]')?.textContent ?? row.textContent)))

describe('the task’s menu', () => {
  it('skips the review of the work under way', () => {
    const onSkipReview = vi.fn()
    render(<TaskMenu defaultOpen onSkipReview={onSkipReview} />)
    fireEvent.click(menu().getByRole('menuitem', { name: /Skip the review/ }))
    expect(onSkipReview).toHaveBeenCalledOnce()
  })

  it('sets no rule before the first group it shows', () => {
    const { unmount } = render(<TaskMenu defaultOpen conflicts={{ choice: 'project', project: true, onChange: vi.fn() }} />)
    expect(rows()[0]).not.toBe('—')
    expect(rows()).not.toContain('—')
    unmount()
    render(<TaskMenu defaultOpen allowEverything={{ on: false, project: false, onChange: vi.fn() }} onAbandon={vi.fn()} />)
    expect(rows()).toEqual([expect.stringMatching(/^Allow everything/), '—', expect.stringMatching(/^Abandon/)])
  })

  it('sets the conflicts and allowing everything apart from what comes before them', () => {
    render(
      <TaskMenu
        defaultOpen
        onStop={vi.fn()}
        conflicts={{ choice: 'on', project: false, onChange: vi.fn() }}
        allowEverything={{ on: true, project: false, onChange: vi.fn() }}
      />,
    )
    expect(rows().filter((row) => row === '—')).toHaveLength(2)
    expect(menu().getByRole('menuitemradio', { name: /On for this task/ })).toHaveAttribute('aria-checked', 'true')
    expect(menu().getByRole('menuitemcheckbox', { name: /Allow everything/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('says beside its button where the task resolves conflicts otherwise than its project', () => {
    const { rerender } = render(<TaskMenu conflicts={{ choice: 'on', project: false, onChange: vi.fn() }} />)
    expect(screen.getByText('Resolve conflicts automatically: on')).toBeInTheDocument()
    rerender(<TaskMenu conflicts={{ choice: 'off', project: true, onChange: vi.fn() }} />)
    expect(screen.getByText('Resolve conflicts automatically: off')).toBeInTheDocument()
    rerender(<TaskMenu conflicts={{ choice: 'on', project: true, onChange: vi.fn() }} />)
    expect(screen.queryByText(/^Resolve conflicts automatically:/)).toBeNull()
  })

  it('holds allowing everything on where its project allows everything', () => {
    const onChange = vi.fn()
    render(<TaskMenu defaultOpen allowEverything={{ on: false, project: true, onChange }} />)
    const item = menu().getByRole('menuitemcheckbox', { name: /Allow everything/ })
    expect(item).toHaveAttribute('aria-checked', 'true')
    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveAccessibleDescription(/On for every task in this project/)
  })
})
