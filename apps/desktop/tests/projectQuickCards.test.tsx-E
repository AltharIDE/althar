import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ProjectQuickCards } from '../src/renderer/features/projectSettings/ProjectQuickCards'
import type { ProjectSettingsModel } from '../src/renderer/features/projectSettings/useProjectSettings'
import { projectRules } from './fixtures'

/*
 * A project's quick cards, at the top of its settings' side: what is changed most in it, a round switch each, whose name
 * opens the Tasks where each is said.
 */

const model = (over: Partial<typeof projectRules> | null = {}) =>
  ({
    rules:
      over === null
        ? null
        : { ...projectRules, pushCommits: true, postScreenshots: false, moveIssues: true, resolveConflicts: false, ...over },
    setPushCommits: vi.fn(),
    setPostScreenshots: vi.fn(),
    setMoveIssues: vi.fn(),
    setResolveConflicts: vi.fn(),
  }) as unknown as ProjectSettingsModel

describe('the project’s quick cards', () => {
  it('are one switch each for what a project pushes, posts, moves along and resolves, saying what each does while on', () => {
    render(<ProjectQuickCards model={model()} onOpen={vi.fn()} />)
    const push = screen.getByRole('switch', { name: 'Push as it goes' })
    expect(push.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('Each commit')).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Screenshots' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('switch', { name: 'Issues follow' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('In Progress to Done')).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Conflicts' }).getAttribute('aria-checked')).toBe('false')
    // What is off says so; nothing says what a switch that is plainly on does beyond its name.
    expect(screen.getAllByText('Off')).toHaveLength(2)
  })

  it('turn the project’s rule on or off with a press, and a name opens the Tasks', async () => {
    const tasks = model()
    const onOpen = vi.fn()
    render(<ProjectQuickCards model={tasks} onOpen={onOpen} />)
    await userEvent.click(screen.getByRole('switch', { name: 'Screenshots' }))
    expect(tasks.setPostScreenshots).toHaveBeenCalledWith(true)
    await userEvent.click(screen.getByRole('switch', { name: 'Push as it goes' }))
    expect(tasks.setPushCommits).toHaveBeenCalledWith(false)
    await userEvent.click(screen.getByRole('button', { name: /^Conflicts/ }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('are not drawn before the project’s rules are read, so the side doesn’t draw cards that then change', () => {
    render(<ProjectQuickCards model={model(null)} onOpen={vi.fn()} />)
    expect(screen.queryByRole('switch')).toBeNull()
  })
})
