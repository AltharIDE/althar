import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PROJECT_LIST, RUNNING, SINCE } from '../src/fixtures/home'
import { Home } from '../src/screens/Home/Home'

const home = (props: Partial<Parameters<typeof Home>[0]> = {}) =>
  render(<Home waiting={0} running={RUNNING} since={SINCE} looked="3 h ago" projects={PROJECT_LIST} {...props} />)

describe('Home', () => {
  it('opens a running task and a project by their ids', () => {
    const onOpenTask = vi.fn()
    const onOpenProject = vi.fn()
    home({ onOpenTask, onOpenProject })
    fireEvent.click(screen.getByRole('button', { name: 'Rate-limit the admin routes per token' }))
    expect(onOpenTask).toHaveBeenCalledWith('h207')
    fireEvent.click(screen.getByRole('button', { name: /^Ferrous/ }))
    expect(onOpenProject).toHaveBeenCalledWith('ferrous')
  })

  it('offers to open a folder only when it can', () => {
    const onOpenFolder = vi.fn()
    const { unmount } = home({ onOpenFolder })
    fireEvent.click(screen.getByRole('button', { name: /Open a folder/ }))
    expect(onOpenFolder).toHaveBeenCalled()
    unmount()
    home()
    expect(screen.queryByRole('button', { name: /Open a folder/ })).toBeNull()
  })

  it('gives the projects’ place to the dock while something is open in it', () => {
    home({ dock: <p>In the dock</p> })
    expect(screen.getByText('In the dock')).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Projects' })).toBeNull()
  })

  it('says what is empty, and marks the task open in the dock', () => {
    const { container } = home({ running: RUNNING, current: 'h207', since: [] })
    expect(screen.getByText('Nothing is waiting on you.')).toBeInTheDocument()
    expect(screen.getByText('Nothing has happened since.')).toBeInTheDocument()
    expect(container.querySelectorAll('[aria-current="true"]')).toHaveLength(1)
  })
})
