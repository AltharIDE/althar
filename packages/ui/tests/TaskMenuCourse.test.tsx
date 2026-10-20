import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { TaskMenu } from '../src/chrome/TaskMenu/TaskMenu'

const menu = () => within(screen.getByRole('menu', { name: 'This task' }))
/* The menu's rows in order, by the name each is read by, a separator as a rule. */
const rows = () =>
  Array.from(
    screen
      .getByRole('menu', { name: 'This task' })
      .querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="separator"]'),
  ).map((row) => {
    if (row.getAttribute('role') === 'separator') return '—'
    const label = row.getAttribute('aria-labelledby')
    return (label === null ? null : document.getElementById(label)?.textContent) ?? row.textContent
  })

describe('the task’s menu', () => {
  it('skips the review of the work under way', () => {
    const onSkipReview = vi.fn()
    render(<TaskMenu defaultOpen onSkipReview={onSkipReview} />)
    fireEvent.click(menu().getByRole('menuitem', { name: /Skip the review/ }))
    expect(onSkipReview).toHaveBeenCalledOnce()
  })

  it('groups what moves it on and what you do with it, then its settings, then what stops or ends it', () => {
    render(
      <TaskMenu
        defaultOpen
        onStartNow={vi.fn()}
        onRename={vi.fn()}
        onStop={vi.fn()}
        onAbandon={vi.fn()}
        conflicts={{ choice: 'project', project: true, onChange: vi.fn() }}
        allowEverything={{ on: false, project: false, onChange: vi.fn() }}
      />,
    )
    expect(rows()).toEqual([
      'Start now',
      'Rename',
      '—',
      'Project (on)',
      'On',
      'Off',
      'Allow everything on this task',
      '—',
      'Stop the task',
      'Abandon',
    ])
  })

  it('sets no rule before the first group it shows', () => {
    const { unmount } = render(<TaskMenu defaultOpen conflicts={{ choice: 'project', project: true, onChange: vi.fn() }} />)
    expect(rows()[0]).not.toBe('—')
    expect(rows()).not.toContain('—')
    unmount()
    render(<TaskMenu defaultOpen allowEverything={{ on: false, project: false, onChange: vi.fn() }} onAbandon={vi.fn()} />)
    expect(rows()).toEqual(['Allow everything on this task', '—', 'Abandon'])
  })

  it('changes how its conflicts go in place, the menu staying open', () => {
    const onChange = vi.fn()
    render(<TaskMenu defaultOpen conflicts={{ choice: 'on', project: false, onChange }} />)
    const choices = within(menu().getByRole('group', { name: 'Resolve conflicts automatically' }))
    expect(choices.getByRole('menuitemradio', { name: 'On' })).toHaveAttribute('aria-checked', 'true')
    expect(choices.getByRole('menuitemradio', { name: 'Project (off)' })).toHaveAccessibleDescription(
      'As the project setting, which is off.',
    )
    fireEvent.click(choices.getByRole('menuitemradio', { name: 'Project (off)' }))
    expect(onChange).toHaveBeenCalledWith('project')
    expect(screen.getByRole('menu', { name: 'This task' })).toBeInTheDocument()
  })

  it('turns allowing everything on and off with its switch, the menu staying open', () => {
    const onChange = vi.fn()
    render(<TaskMenu defaultOpen allowEverything={{ on: true, project: false, onChange }} />)
    const item = menu().getByRole('menuitemcheckbox', { name: 'Allow everything on this task' })
    expect(item).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(item)
    expect(onChange).toHaveBeenCalledWith(false)
    expect(screen.getByRole('menu', { name: 'This task' })).toBeInTheDocument()
  })

  it('says on its button where the task resolves conflicts otherwise than its project', () => {
    const button = () => screen.getByRole('button', { name: 'More for this task' })
    const { rerender } = render(<TaskMenu conflicts={{ choice: 'on', project: false, onChange: vi.fn() }} />)
    expect(button()).toHaveAccessibleDescription('Resolve conflicts automatically: on')
    rerender(<TaskMenu conflicts={{ choice: 'off', project: true, onChange: vi.fn() }} />)
    expect(button()).toHaveAccessibleDescription('Resolve conflicts automatically: off')
    rerender(<TaskMenu conflicts={{ choice: 'on', project: true, onChange: vi.fn() }} />)
    expect(button()).not.toHaveAttribute('aria-describedby')
  })

  it('holds allowing everything on where its project allows everything, and opens its rules where it can', () => {
    const { unmount } = render(<TaskMenu defaultOpen allowEverything={{ on: false, project: true, onChange: vi.fn() }} />)
    const shown = menu().getByRole('menuitemcheckbox', { name: /Allow everything/ })
    expect(shown).toHaveAttribute('aria-checked', 'true')
    expect(shown).toHaveAttribute('aria-disabled', 'true')
    expect(shown).toHaveAccessibleDescription(/On for every task in this project/)
    unmount()
    const onRules = vi.fn()
    const onChange = vi.fn()
    render(<TaskMenu defaultOpen allowEverything={{ on: false, project: true, onChange }} onRules={onRules} />)
    fireEvent.click(menu().getByRole('menuitem', { name: /Allow everything/ }))
    expect(onRules).toHaveBeenCalledOnce()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('says what the highlighted item does at its foot, one line each otherwise', () => {
    render(<TaskMenu defaultOpen onStop={vi.fn()} onAbandon={vi.fn()} />)
    const stop = menu().getByRole('menuitem', { name: /Stop the task/ })
    expect(stop).toHaveAccessibleDescription(/Every agent on it stops/)
    const foot = () => screen.queryByText(/Every agent on it stops/, { selector: '[aria-hidden="true"]' })
    expect(foot()).toBeNull()
    fireEvent.focus(stop)
    expect(foot()).toBeInTheDocument()
    fireEvent.blur(stop)
    expect(foot()).toBeNull()
  })
})
