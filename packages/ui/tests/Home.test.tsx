import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { FERROUS, HALYARD, MERIDIAN, PROJECT_LIST, RUNNING, SINCE, TESSERA } from '../src/fixtures/home'
import { QUIET_FOLD } from '../src/home/ProjectList/ProjectList'
import { type HomeNeed, type HomeProject, Home } from '../src/screens/Home/Home'

const need = (key: string, project: typeof MERIDIAN, words: string): HomeNeed => ({ key, project, line: <p>{words}</p> })

const home = (props: Partial<Parameters<typeof Home>[0]> = {}) =>
  render(
    <Home
      waiting={1}
      needs={[need('a', MERIDIAN, 'A call')]}
      running={RUNNING}
      since={SINCE}
      looked="3 h ago"
      projects={PROJECT_LIST}
      {...props}
    />,
  )

describe('Home', () => {
  it('says how many need you and where, beside their marks, and rings nothing', () => {
    const { container } = home({ waiting: 2, needs: [need('a', MERIDIAN, 'A call'), need('b', HALYARD, 'Another')] })
    expect(screen.getByRole('heading', { name: '2 things need you', level: 2 })).toBeInTheDocument()
    expect(screen.getByText('in Meridian and Halyard')).toBeInTheDocument()
    expect(container.querySelectorAll('[class*="ping"]')).toHaveLength(0)
  })

  it('names and marks only the projects whose calls still wait, keeping a line just answered where it was', () => {
    const { container } = home({
      waiting: 1,
      needs: [need('a', MERIDIAN, 'A call'), { ...need('b', HALYARD, 'Answered'), answered: true }],
    })
    expect(screen.getByText('in Meridian')).toBeInTheDocument()
    expect(screen.queryByText('in Meridian and Halyard')).toBeNull()
    expect(container.querySelectorAll('header [class*="stack"] > *')).toHaveLength(1)
    expect((container.querySelector('main') as HTMLElement).style.getPropertyValue('--wash-2')).toBe('')
    // The answered line stays, under its project.
    expect(within(screen.getByRole('region', { name: 'Halyard' })).getByText('Answered')).toBeInTheDocument()
  })

  it('gathers the calls under the project each is from, in the order the first came', () => {
    home({ waiting: 3, needs: [need('a', MERIDIAN, 'First'), need('b', HALYARD, 'Second'), need('c', MERIDIAN, 'Third')] })
    const groups = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)
    expect(groups).toEqual(['Meridian', 'Halyard'])
    const meridian = screen.getByRole('region', { name: 'Meridian' })
    expect(
      within(meridian)
        .getAllByText(/First|Third/)
        .map((line) => line.textContent),
    ).toEqual(['First', 'Third'])
    expect(within(meridian).queryByText('Second')).toBeNull()
  })

  it('washes the middle in the inks of the projects that need you, and only then', () => {
    const { container, unmount } = home({ waiting: 2, needs: [need('a', MERIDIAN, 'A call'), need('b', HALYARD, 'Another')] })
    const middle = container.querySelector('main') as HTMLElement
    expect(middle.style.getPropertyValue('--wash-1')).toBe(`var(--project-${MERIDIAN.ink})`)
    expect(middle.style.getPropertyValue('--wash-2')).toBe(`var(--project-${HALYARD.ink})`)
    unmount()
    const rest = render(<Home waiting={0} running={[]} since={[]} looked="3 h ago" projects={PROJECT_LIST} />)
    expect((rest.container.querySelector('main') as HTMLElement).style.getPropertyValue('--wash-1')).toBe('')
  })

  it('keeps the work in progress in the projects’ list, not in the middle', () => {
    home({ onOpenProject: vi.fn() })
    const projects = screen.getByRole('complementary', { name: 'Projects' })
    // Meridian has two tasks in progress: its row says so, under its name.
    expect(within(projects).getByRole('button', { name: /^Meridian.*2 tasks in progress/ })).toBeInTheDocument()
    expect(screen.queryByText('Repair token refresh on privilege change')).toBeNull()
  })

  it('opens a project from its row', () => {
    const onOpenProject = vi.fn()
    home({ onOpenProject })
    const projects = screen.getByRole('complementary', { name: 'Projects' })
    fireEvent.click(within(projects).getByRole('button', { name: /^Ferrous/ }))
    expect(onOpenProject).toHaveBeenCalledWith('ferrous')
  })

  it('says only what is off under a project’s name', () => {
    home()
    const projects = screen.getByRole('complementary', { name: 'Projects' })
    // Halyard has one held for a reset; Meridian has nothing off.
    expect(within(projects).getByText('1 held for a reset')).toBeInTheDocument()
    expect(within(projects).getAllByText(/held|stopped/)).toHaveLength(1)
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

  it('folds what the loop did into one line, which opens to what it happened to', () => {
    const onOpenEvent = vi.fn()
    home({ onOpenEvent })
    const line = screen.getByRole('button', { name: '5 things since you looked, 3 h ago' })
    expect(screen.queryByRole('button', { name: 'Pull request #1191 opened' })).toBeNull()
    fireEvent.click(line)
    fireEvent.click(screen.getByRole('button', { name: 'Pull request #1191 opened' }))
    expect(onOpenEvent).toHaveBeenCalledWith('s1')
  })

  it('folds the quiet projects away only once there are many', () => {
    const quiet = (i: number): HomeProject => ({
      id: `q${i}`,
      project: { ...FERROUS, seed: `q${i}`, name: `Quiet ${i}` },
      yours: 0,
    })
    const { unmount } = home({ projects: [...PROJECT_LIST, quiet(1)], onOpenProject: vi.fn() })
    expect(screen.getByRole('button', { name: /^Quiet 1/ })).toBeInTheDocument()
    unmount()
    home({ projects: [...PROJECT_LIST, ...Array.from({ length: QUIET_FOLD }, (_, i) => quiet(i))], onOpenProject: vi.fn() })
    expect(screen.queryByRole('button', { name: /^Quiet 1/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: `${QUIET_FOLD + 1} quiet projects` }))
    expect(screen.getByRole('button', { name: /^Quiet 1/ })).toBeInTheDocument()
  })
})

const fresh = (project: typeof MERIDIAN, id: string): HomeProject => ({
  id,
  project,
  yours: 0,
  note: 'No tasks yet',
  fresh: true,
})
const worked = (project: typeof MERIDIAN, id: string): HomeProject => ({ id, project, yours: 0, note: 'Last task Monday' })

describe('Home at rest', () => {
  const rest = (props: Partial<Parameters<typeof Home>[0]> = {}) =>
    render(
      <Home waiting={0} running={[]} since={[]} looked="3 h ago" projects={[fresh(MERIDIAN, 'meridian')]} onTalk={vi.fn()} {...props} />,
    )

  it('offers one new project’s coordinator in place of the calls', () => {
    const onTalk = vi.fn()
    rest({ onTalk })
    expect(screen.getByRole('heading', { name: 'Nothing in Meridian yet' })).toBeInTheDocument()
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

  it('offers no way to a coordinator it can’t open', () => {
    rest({ onTalk: undefined })
    expect(screen.getByRole('heading', { name: 'Nothing in Meridian yet' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Talk to/ })).toBeNull()
  })

  it('rests while work is in progress, so long as nothing needs you, with the marks of where it moves', () => {
    rest({ projects: PROJECT_LIST, running: RUNNING, since: SINCE })
    expect(screen.getByRole('heading', { name: 'Nothing needs you' })).toBeInTheDocument()
    // Halyard's held task isn't moving, but its other is: four tasks in three projects.
    expect(screen.getByText('4 tasks moving in 3 projects.')).toBeInTheDocument()
    expect(screen.getAllByText('Tessera')).toHaveLength(2)
    expect(screen.getByRole('button', { name: '5 things since you looked, 3 h ago' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Talk to/ })).toBeNull()
  })

  it('still offers a new project’s coordinator beside projects that have had work', () => {
    rest({ projects: [worked(HALYARD, 'h'), fresh(MERIDIAN, 'm')] })
    expect(screen.getByRole('heading', { name: 'Nothing needs you' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Talk to Meridian’s coordinator' })).toBeInTheDocument()
  })

  it('leaves for the calls when one comes, and comes back when it is answered', () => {
    const { rerender } = rest()
    rerender(
      <Home
        waiting={1}
        needs={[need('a', MERIDIAN, 'A call')]}
        running={[]}
        since={[]}
        looked="3 h ago"
        projects={[fresh(MERIDIAN, 'meridian')]}
      />,
    )
    expect(screen.queryByRole('heading', { name: 'Nothing in Meridian yet' })).toBeNull()
    expect(screen.getByRole('heading', { name: '1 thing needs you' })).toBeInTheDocument()
    rerender(<Home waiting={0} running={[]} since={[]} looked="3 h ago" projects={[fresh(MERIDIAN, 'meridian')]} />)
    expect(screen.getByRole('heading', { name: 'Nothing in Meridian yet' })).toBeInTheDocument()
  })
})
