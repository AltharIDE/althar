import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FERROUS, HALYARD, MERIDIAN, PROJECT_LIST, SINCE, TESSERA } from '../src/fixtures/home'
import { type HomeNeed, type HomeProject, Home } from '../src/screens/Home/Home'

/* Home's words, as they count what needs you and what happened, and the calls arriving after rest. */

const need = (key: string, project: typeof MERIDIAN): HomeNeed => ({ key, project, line: <p>A call from {project.name}</p> })
const fresh = (project: typeof MERIDIAN, id: string): HomeProject => ({ id, project, yours: 0, note: 'No tasks yet', fresh: true })

afterEach(() => vi.restoreAllMocks())

describe('Home’s words', () => {
  it('counts the projects instead of naming them past three', () => {
    render(
      <Home
        waiting={4}
        needs={[need('a', MERIDIAN), need('b', HALYARD), need('c', TESSERA), need('d', FERROUS)]}
        running={[]}
        since={[]}
        looked="3 h ago"
        projects={PROJECT_LIST}
      />,
    )
    expect(screen.getByText('in 4 projects')).toBeInTheDocument()
  })

  it('says one thing happened since you looked', () => {
    render(
      <Home waiting={1} needs={[need('a', MERIDIAN)]} running={[]} since={SINCE.slice(0, 1)} looked="3 h ago" projects={PROJECT_LIST} />,
    )
    expect(screen.getByRole('button', { name: '1 thing since you looked, 3 h ago' })).toBeInTheDocument()
  })

  it('says one more new project waits under Projects', () => {
    render(
      <Home
        waiting={0}
        running={[]}
        since={[]}
        looked="3 h ago"
        projects={[fresh(MERIDIAN, 'm'), fresh(HALYARD, 'h'), fresh(TESSERA, 't'), fresh(FERROUS, 'f')]}
        onTalk={() => {}}
      />,
    )
    expect(screen.getByText('1 more under Projects')).toBeInTheDocument()
  })
})

describe('the calls arriving after rest', () => {
  /* Headings are among what arrives, and nothing else here animates them. */
  const arrivals = () => {
    const animate = vi.fn()
    Object.defineProperty(HTMLHeadingElement.prototype, 'animate', { value: animate, configurable: true, writable: true })
    return animate
  }
  afterEach(() => void delete (HTMLHeadingElement.prototype as unknown as Record<string, unknown>).animate)

  const fromRest = () => {
    const { rerender } = render(<Home waiting={0} running={[]} since={[]} looked="3 h ago" projects={[fresh(MERIDIAN, 'm')]} />)
    rerender(<Home waiting={1} needs={[need('a', MERIDIAN)]} running={[]} since={[]} looked="3 h ago" projects={[fresh(MERIDIAN, 'm')]} />)
  }

  it('arrive one after another', () => {
    const animate = arrivals()
    fromRest()
    expect(animate).toHaveBeenCalled()
  })

  it('come at once, without arriving, for reduced motion', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    } as unknown as MediaQueryList)
    const animate = arrivals()
    fromRest()
    expect(screen.getByRole('heading', { name: '1 thing needs you' })).toBeInTheDocument()
    expect(screen.getByText('A call from Meridian')).toBeInTheDocument()
    expect(animate).not.toHaveBeenCalled()
  })
})
