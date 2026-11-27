import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ProjectTabs } from '../src/chrome/ProjectTabs/ProjectTabs'
import { MARKED } from '../src/fixtures/marks'
import { BETTER, FEATURES, FOLLOW, LEAD, RELEASE_0_10, RELEASE_0_9, RELEASES, ROADMAP } from '../src/fixtures/whatsNew'
import { ComingNext } from '../src/screens/ComingNext/ComingNext'
import { YourWorkers } from '../src/screens/WhatsNew/YourWorkers'
import { compareVersions, dated, firstSentence, named } from '../src/screens/WhatsNew/notes'
import { Releases } from '../src/screens/WhatsNew/Releases'
import { WhatsNew, type WhatsNewProps } from '../src/screens/WhatsNew/WhatsNew'

/*
 * Althar's own page after an update: how a line of the notes is read, the
 * releases new to the person, What's new's parts each there only where it has
 * something to show, the lead's picture going round its beats, Coming next's
 * cards and their ways out, and Althar's tab among the window's.
 */

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('a line of the notes', () => {
  it('is named where it starts with a short name and a colon, and the rest starts high', () => {
    expect(named('Goals: give a lead a goal.')).toEqual({ name: 'Goals', rest: 'Give a lead a goal.' })
    expect(named('Long threads open smoothly.')).toEqual({ name: null, rest: 'Long threads open smoothly.' })
    expect(named(': nothing before it')).toEqual({ name: null, rest: ': nothing before it' })
    expect(named(`${'A very long opening clause that runs on'}: and then`).name).toBeNull()
  })

  it('reads as its first sentence, past its name', () => {
    expect(firstSentence('Goals: give a lead a goal. It keeps going.')).toBe('Give a lead a goal.')
    expect(firstSentence('One sentence only')).toBe('One sentence only')
  })

  it('is dated by its day and month, or by its ISO date where that isn’t one', () => {
    expect(dated('2026-11-20', 'en-GB')).toBe('20 November')
    expect(dated('soon')).toBe('soon')
  })

  it('orders versions by their numbers, not their letters', () => {
    expect(compareVersions('0.9.0', '0.10.0')).toBeLessThan(0)
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0)
    expect(compareVersions('0.10.0', '0.10')).toBe(0)
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(0)
  })
})

describe('the releases', () => {
  it('say which are new to the person, and open each one’s notes by kind', () => {
    render(<Releases releases={RELEASES} from="0.8.0" />)
    expect(screen.getAllByText('New since 0.8.0')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /^0\.9\.0/ }))
    const notes = screen.getByRole('button', { name: /^0\.9\.0/ }).closest('.release')!
    expect(within(notes as HTMLElement).getByRole('heading', { name: 'Improved' })).toBeInTheDocument()
    expect(within(notes as HTMLElement).getByRole('heading', { name: 'Fixed' })).toBeInTheDocument()
  })

  it('link the rest on the site only where its address is safe', () => {
    const { rerender } = render(<Releases releases={RELEASES} more="https://althar.ai/changelog" moreFrom="0.7.0" />)
    expect(screen.getByRole('link', { name: /0\.7\.0 and earlier/ })).toHaveAttribute('href', 'https://althar.ai/changelog')
    rerender(<Releases releases={RELEASES} more="javascript:alert(1)" moreFrom="0.7.0" />)
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('show nothing where there are none', () => {
    const { container } = render(<Releases releases={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

const whatsNew = (props: Partial<WhatsNewProps> = {}) =>
  render(
    <WhatsNew
      release={RELEASE_0_10}
      lead={LEAD}
      features={FEATURES}
      better={BETTER}
      follow={FOLLOW}
      releases={RELEASES}
      onComing={vi.fn()}
      {...props}
    />,
  )

describe('What’s new', () => {
  it('says the jump the update made, where it made one', () => {
    whatsNew({ from: '0.9.0' })
    expect(screen.getByLabelText('Updated from 0.9.0 to 0.10.0')).toBeInTheDocument()
  })

  it('says the version alone after a first install', () => {
    whatsNew()
    expect(screen.queryByLabelText(/Updated from/)).toBeNull()
    expect(screen.getAllByText('0.10.0').length).toBeGreaterThan(0)
  })

  it('draws the first two features large and widens the last row to fill it', () => {
    const { container } = whatsNew()
    const tiles = [...container.querySelectorAll('[class*="tiles"] > li')]
    expect(tiles.map((tile) => tile.className.includes('big'))).toEqual([true, true, false, false, false, false])
    expect(tiles.map((tile) => tile.className.includes('wide'))).toEqual([false, false, false, false, false, true])
    const five = whatsNew({ features: FEATURES.slice(0, 5) }).container
    expect([...five.querySelectorAll('[class*="tiles"] > li')].map((tile) => tile.className.includes('big'))).toEqual([
      true,
      true,
      false,
      false,
      false,
    ])
    const three = whatsNew({ features: FEATURES.slice(0, 3) }).container
    expect(three.querySelector('[class*="tiles"] > li:last-child')?.className).toContain('wide')
    const four = whatsNew({ features: FEATURES.slice(0, 4) }).container
    expect([...four.querySelectorAll('[class*="tiles"] > li')].every((tile) => tile.className.includes('big'))).toBe(true)
  })

  it('takes the person into a feature where it has a way in', () => {
    whatsNew()
    fireEvent.click(screen.getByRole('button', { name: 'Add an agent' }))
    expect(FEATURES[3]?.way?.onPress).toHaveBeenCalled()
  })

  it('leaves out the lead’s picture, the tiles and what feels better where there are none', () => {
    whatsNew({ lead: { title: 'Undo, files and all', why: 'Take a turn back.' }, features: [], better: [], release: RELEASE_0_9 })
    expect(screen.getByRole('heading', { level: 1, name: /^Undo,\s+files and all$/ })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Where the work runs now' })).toBeNull()
    expect(screen.queryByRole('heading', { name: /Also in/ })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Better everywhere' })).toBeNull()
  })

  it('links where Althar is followed, each in the browser, and none whose address isn’t safe', () => {
    whatsNew({ follow: [...FOLLOW, { kind: 'x', href: 'javascript:alert(1)', handle: 'nope' }] })
    const links = screen.getAllByRole('link', { name: /GitHub|Discord|X|LinkedIn/ })
    expect(links.map((link) => link.getAttribute('target'))).toEqual(['_blank', '_blank', '_blank', '_blank'])
    expect(screen.queryByText('nope')).toBeNull()
  })

  it('goes to Coming next where it can', () => {
    const onComing = vi.fn()
    const { rerender } = whatsNew({ onComing })
    fireEvent.click(screen.getByRole('button', { name: 'See what’s coming next' }))
    expect(onComing).toHaveBeenCalledOnce()
    rerender(<WhatsNew release={RELEASE_0_10} lead={LEAD} features={[]} better={[]} follow={FOLLOW} releases={RELEASES} />)
    expect(screen.queryByRole('button', { name: 'See what’s coming next' })).toBeNull()
  })
})

describe('the lead drawn', () => {
  const story = (container: HTMLElement) => Number((container.querySelector('svg') as SVGElement).style.getPropertyValue('--t'))
  const count = (container: HTMLElement) => container.querySelector('.count')?.textContent

  it('stands where its host puts it: one worker close up, then the fleet all at work', () => {
    const { container, rerender } = render(<YourWorkers at={0.3} />)
    // runner-1 has the task: one agent at work.
    expect(story(container)).toBeCloseTo(0.3 * 0.86, 3)
    expect(count(container)).toBe('1')
    rerender(<YourWorkers at={1} />)
    expect(count(container)).toBe('44')
  })

  it('plays its own loop while on screen: the task goes out, then the fleet joins', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
    const { container } = render(<YourWorkers />)
    // The observer sees it on screen a moment after it's drawn.
    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      vi.advanceTimersByTime(17_000 * 0.3)
    })
    expect(story(container)).toBeGreaterThan(0.28)
    expect(story(container)).toBeLessThan(0.32)
    expect(count(container)).toBe('1')
    await act(async () => {
      vi.advanceTimersByTime(17_000 * 0.5)
    })
    expect(Number(count(container))).toBeGreaterThan(30)
  })

  it('can be paused, holding where it is and moving no more, and played on from there', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
    const { container } = render(<YourWorkers />)
    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      vi.advanceTimersByTime(17_000 * 0.2)
    })
    const svg = container.querySelector('svg') as SVGElement
    expect(svg).toHaveAttribute('data-playing')
    fireEvent.click(screen.getByRole('button', { name: 'Pause the animation' }))
    const held = story(container)
    expect(svg).not.toHaveAttribute('data-playing')
    await act(async () => {
      vi.advanceTimersByTime(17_000 * 0.3)
    })
    expect(story(container)).toBe(held)
    fireEvent.click(screen.getByRole('button', { name: 'Play the animation' }))
    await act(async () => {
      vi.advanceTimersByTime(17_000 * 0.1)
    })
    expect(story(container)).toBeGreaterThan(held + 0.08)
    expect(story(container)).toBeLessThan(held + 0.12)
  })

  it('pauses the work along its wires where the host plays its story', async () => {
    const { container } = render(<YourWorkers at={1} />)
    await act(async () => {
      await Promise.resolve()
    })
    const svg = container.querySelector('svg') as SVGElement
    expect(svg).toHaveAttribute('data-playing')
    fireEvent.click(screen.getByRole('button', { name: 'Pause the animation' }))
    expect(svg).not.toHaveAttribute('data-playing')
    expect(count(container)).toBe('44')
  })

  it('rests on the fleet with motion reduced', () => {
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: query.includes('reduce'),
          media: query,
          addEventListener() {},
          removeEventListener() {},
        }) as unknown as MediaQueryList,
    )
    const { container } = render(<YourWorkers />)
    expect(story(container)).toBeCloseTo(0.88, 3)
    expect(count(container)).toBe('44')
    expect(screen.getByRole('figure')).toHaveAccessibleName(/dozens of workers/)
    // Nothing moves, so there is nothing to pause.
    expect(screen.queryByRole('button', { name: /animation/ })).toBeNull()
  })
})

describe('Coming next', () => {
  it('draws what’s being built first and largest, each card saying its stage and where to say what you’d need', () => {
    const { container } = render(<ComingNext items={ROADMAP} suggest="https://github.com/a/b/issues" talk="https://discord.gg/x" />)
    const cards = [...container.querySelectorAll('ol > li')]
    expect(cards[0]?.className).toContain('top')
    expect(within(cards[0] as HTMLElement).getByText('Being built')).toBeInTheDocument()
    expect(within(cards[4] as HTMLElement).getByText('Later')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /Say what you’d need/ })).toHaveLength(ROADMAP.length)
    expect(screen.getByRole('link', { name: /Suggest it on GitHub/ })).toHaveAttribute('href', 'https://github.com/a/b/issues')
    expect(screen.getByRole('link', { name: /Talk it over on Discord/ })).toHaveAttribute('href', 'https://discord.gg/x')
  })

  it('draws a card without a picture where the kit has none, and no way out whose address isn’t safe', () => {
    const { container } = render(
      <ComingNext
        items={[{ stage: 'next', title: 'Something else', detail: 'Not drawn yet.', say: 'javascript:alert(1)' }]}
        suggest="javascript:alert(1)"
        talk="https://discord.gg/x"
      />,
    )
    expect(container.querySelector('[data-picture]')).toBeNull()
    expect(screen.queryByRole('link', { name: /Say what you’d need/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /Suggest it on GitHub/ })).toBeNull()
  })
})

describe('Althar’s tab', () => {
  const project = MARKED[0]!
  const tabs = (althar: Parameters<typeof ProjectTabs>[0]['althar']) =>
    render(
      <ProjectTabs
        tabs={[{ id: project.id, name: project.name, seed: project.id, ink: project.ink, running: false, yours: 0 }]}
        current={project.id}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        lights="drawn"
        {...(althar === undefined ? {} : { althar })}
      />,
    )

  it('has the window alone while it is current', () => {
    tabs({ current: true, onSelect: vi.fn() })
    expect(screen.getByRole('button', { name: 'Althar' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: new RegExp(`^${project.name}`) })).not.toHaveAttribute('aria-current')
  })

  it('says there’s something new until it’s opened, and closes only where it can', () => {
    const onSelect = vi.fn()
    tabs({ current: false, news: true, onSelect })
    fireEvent.click(screen.getByRole('button', { name: 'Althar, what’s new in this version' }))
    expect(onSelect).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Close Althar' })).toBeNull()
  })

  it('isn’t there where the window has none', () => {
    tabs(undefined)
    expect(screen.queryByRole('button', { name: /^Althar/ })).toBeNull()
  })
})
