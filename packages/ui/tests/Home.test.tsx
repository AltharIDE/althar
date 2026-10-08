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

  it('keeps the projects beside the stream: nothing opens in their place', () => {
    home({ onOpenTask: vi.fn() })
    expect(screen.getByRole('complementary', { name: 'Projects' })).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Beside the home' })).toBeNull()
  })

  it('calls the second section in progress, and rings nothing in the stream', () => {
    const { container } = home({ waiting: 2, needs: [<p key="a">A call</p>] })
    expect(screen.getByRole('region', { name: /In progress/ })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /Running/ })).toBeNull()
    expect(container.querySelectorAll('[class*="ping"]')).toHaveLength(0)
  })

  it('says nothing waits when the calls come as an empty list', () => {
    home({ needs: [].map(() => null) })
    expect(screen.getByText('Nothing is waiting on you.')).toBeInTheDocument()
  })

  it('opens what something the loop did happened to, by its id', () => {
    const onOpenEvent = vi.fn()
    home({ onOpenEvent })
    fireEvent.click(screen.getByRole('button', { name: 'Pull request #1191 opened' }))
    expect(onOpenEvent).toHaveBeenCalledWith('s1')
  })

  it('says what is empty', () => {
    home({ running: [], since: [] })
    expect(screen.getByText('Nothing is waiting on you.')).toBeInTheDocument()
    expect(screen.getByText('Nothing is in progress.')).toBeInTheDocument()
    expect(screen.getByText('Nothing has happened since.')).toBeInTheDocument()
  })
})
