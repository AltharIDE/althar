import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { FERROUS, HALYARD, MERIDIAN, PROJECT_LIST, RUNNING, SINCE, TESSERA } from '../src/fixtures/home'
import { type HomeProject, Home, REST_SINCE } from '../src/screens/Home/Home'

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

  it('says what is empty in the stream', () => {
    home({ running: [], since: [], needs: [<p key="a">Allowed npm test</p>] })
    expect(screen.getByText('Nothing is in progress.')).toBeInTheDocument()
    expect(screen.getByText('Nothing has happened since.')).toBeInTheDocument()
  })
})

const fresh = (project: typeof MERIDIAN, id: string): HomeProject => ({
  id,
  project,
  running: 0,
  yours: 0,
  note: 'No tasks yet',
  fresh: true,
})
const worked = (project: typeof MERIDIAN, id: string): HomeProject => ({ id, project, running: 0, yours: 0, note: 'Last task Monday' })

describe('Home at rest', () => {
  const rest = (props: Partial<Parameters<typeof Home>[0]> = {}) =>
    render(
      <Home waiting={0} running={[]} since={[]} looked="3 h ago" projects={[fresh(MERIDIAN, 'meridian')]} onTalk={vi.fn()} {...props} />,
    )

  it('offers one new project’s coordinator in place of three empty sections', () => {
    const onTalk = vi.fn()
    rest({ onTalk })
    expect(screen.getByRole('heading', { name: 'Nothing in Meridian yet' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /In progress/ })).toBeNull()
    expect(screen.queryByText('Nothing is waiting on you.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Talk to Meridian’s coordinator' }))
    expect(onTalk).toHaveBeenCalledWith('meridian')
    expect(screen.getByRole('complementary', { name: 'Projects' })).toBeInTheDocument()
  })

  it('offers each new project’s coordinator, up to three, and says how many more', () => {
    rest({ projects: [fresh(MERIDIAN, 'm'), fresh(HALYARD, 'h'), fresh(TESSERA, 't'), fresh(FERROUS, 'f'), fresh(MERIDIAN, 'm2')] })
    expect(screen.getByRole('heading', { name: 'Nothing in your projects yet' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Talk to/ })).toHaveLength(3)
    expect(screen.getByText('2 more under Projects')).toBeInTheDocument()
  })

  it('says one more in the singular', () => {
    rest({ projects: [fresh(MERIDIAN, 'm'), fresh(HALYARD, 'h'), fresh(TESSERA, 't'), fresh(FERROUS, 'f')] })
    expect(screen.getByText('1 more under Projects')).toBeInTheDocument()
  })

  it('offers no way to a coordinator it can’t open', () => {
    rest({ onTalk: undefined })
    expect(screen.getByRole('heading', { name: 'Nothing in Meridian yet' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Talk to/ })).toBeNull()
  })

  it('is all quiet once projects have had work, with the last few things the loop did', () => {
    const onOpenEvent = vi.fn()
    rest({ projects: [worked(HALYARD, 'h'), fresh(MERIDIAN, 'm')], since: SINCE.slice(0, 2), onOpenEvent })
    expect(screen.getByRole('heading', { name: 'All quiet' })).toBeInTheDocument()
    expect(screen.getByText('Nothing needs you and nothing is in progress. Since you looked, 3 h ago:')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Talk to/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Pull request #1191 opened' }))
    expect(onOpenEvent).toHaveBeenCalledWith('s1')
  })

  it('is all quiet with nothing to add when nothing has happened since', () => {
    rest({ projects: [worked(HALYARD, 'h')] })
    expect(screen.getByRole('heading', { name: 'All quiet' })).toBeInTheDocument()
    expect(screen.getByText('Nothing needs you and nothing is in progress.')).toBeInTheDocument()
  })

  it('still offers a new project’s coordinator beside projects that have had work', () => {
    rest({ projects: [worked(HALYARD, 'h'), fresh(MERIDIAN, 'm')] })
    expect(screen.getByRole('heading', { name: 'All quiet' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Talk to Meridian’s coordinator' })).toBeInTheDocument()
  })

  it('shows the stream once the loop has done more than it rests over', () => {
    const many = Array.from({ length: REST_SINCE + 1 }, (_, i) => ({ ...SINCE[i % SINCE.length], id: `e${i}` })).filter(
      (event): event is (typeof SINCE)[number] => event.what !== undefined,
    )
    rest({ projects: [worked(HALYARD, 'h')], since: many })
    expect(screen.queryByRole('heading', { name: 'All quiet' })).toBeNull()
    expect(screen.getByRole('region', { name: /In progress/ })).toBeInTheDocument()
  })

  it('leaves for the stream when work comes, and comes back when it is gone', () => {
    const { rerender } = rest()
    rerender(<Home waiting={0} running={RUNNING} since={[]} looked="3 h ago" projects={[fresh(MERIDIAN, 'meridian')]} />)
    expect(screen.queryByRole('heading', { name: 'Nothing in Meridian yet' })).toBeNull()
    expect(screen.getByRole('region', { name: /In progress/ })).toBeInTheDocument()
    rerender(<Home waiting={0} running={[]} since={[]} looked="3 h ago" projects={[fresh(MERIDIAN, 'meridian')]} />)
    expect(screen.getByRole('heading', { name: 'Nothing in Meridian yet' })).toBeInTheDocument()
  })
})
