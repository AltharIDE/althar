import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RuntimeState } from '../src/foundations/vocabulary'
import type { RuntimeEntry } from '../src/setup/Runtimes/Runtimes'
import { Welcome, type WelcomeProps, type WelcomeStep } from '../src/screens/Welcome/Welcome'

const READY: RuntimeEntry = { id: 'claude-code', name: 'Claude Code', state: RuntimeState.Ready, version: '2.4.1' }
const SIGNED_OUT: RuntimeEntry = { id: 'codex', name: 'Codex', state: RuntimeState.SignedOut }
const FOUND = [
  { id: 'meridian', name: 'meridian', where: '~/Projects/meridian' },
  { id: 'halyard', name: 'halyard', where: '~/Projects/halyard' },
]

/* As the app keeps it: the step, what is ticked and its name, and the project once made. */
function FirstRun({ start, ...props }: Partial<WelcomeProps> & { start?: WelcomeStep }) {
  const [step, setStep] = useState<WelcomeStep>(start ?? (props.toured === true ? 'agents' : 'ask'))
  const [picked, setPicked] = useState<readonly string[]>(props.picked ?? [])
  const [made, setMade] = useState(props.made ?? false)
  return (
    <Welcome
      runtimes={[READY, SIGNED_OUT]}
      repositories={FOUND}
      name={FOUND.find((r) => r.id === picked[0])?.name ?? ''}
      onNameChange={vi.fn()}
      onAdd={vi.fn()}
      hosts={<p>The hosts</p>}
      trackers={<p>The trackers</p>}
      onOpen={vi.fn()}
      still
      {...props}
      step={step}
      onStepChange={setStep}
      picked={picked}
      onPick={(id) => setPicked((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]))}
      made={made}
      onCreate={() => {
        props.onCreate?.()
        setMade(true)
      }}
    />
  )
}

const heading = (name: string) => screen.getByRole('heading', { level: 1, name })

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the welcome’s tour', () => {
  it('walks its pages with Next and the arrows, then goes on to the agents and says the tour is over', () => {
    const onToured = vi.fn()
    render(<FirstRun onToured={onToured} />)
    expect(screen.getByText('Welcome to Althar')).toBeInTheDocument()
    expect(heading('Tell the coordinator what you want')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(heading('Agents from different makers')).toBeInTheDocument()
    expect(screen.queryByText('Welcome to Althar')).toBeNull()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Next' }), { key: 'ArrowRight' })
    expect(heading('Only the calls come to you')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Next' }), { key: 'ArrowLeft' })
    expect(heading('Agents from different makers')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(heading('Tell the coordinator what you want')).toBeInTheDocument()
    // Before the first page and after the last, the arrows go nowhere; with a key held, they are someone else's.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Next' }), { key: 'ArrowLeft' })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Next' }), { key: 'ArrowRight', metaKey: true })
    expect(heading('Tell the coordinator what you want')).toBeInTheDocument()
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(heading('Reviewed before you see it')).toBeInTheDocument()
    expect(onToured).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Set up Althar' }))
    expect(heading('Your agents')).toBeInTheDocument()
    expect(onToured).toHaveBeenCalledTimes(1)
    // In the setup the arrows are the page's: they move nothing.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Continue' }), { key: 'ArrowLeft' })
    expect(heading('Your agents')).toBeInTheDocument()
  })

  it('leaves the tour from any page with Skip', () => {
    const onToured = vi.fn()
    render(<FirstRun onToured={onToured} start="build" />)
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(heading('Your agents')).toBeInTheDocument()
    expect(onToured).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull()
  })

  it('leaves the tour out once it has been seen, from the track too', () => {
    render(<FirstRun toured start="ask" />)
    expect(heading('Your agents')).toBeInTheDocument()
    const track = screen.getByRole('list', { name: 'Steps' })
    expect(within(track).queryByText('Ask')).toBeNull()
    expect(within(track).getByText('Agents')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  })

  it('says each step as it arrives', () => {
    render(<FirstRun toured />)
    expect(screen.getByText('Step 1 of 4: Your agents')).toBeInTheDocument()
  })

  it('takes no arrows typed into a field', () => {
    render(<FirstRun />)
    const field = document.createElement('input')
    screen.getByRole('button', { name: 'Next' }).closest('section')?.append(field)
    fireEvent.keyDown(field, { key: 'ArrowRight' })
    expect(heading('Tell the coordinator what you want')).toBeInTheDocument()
  })
})

describe('the welcome’s agents', () => {
  it('goes on with one ready, and without one as the lesser choice', () => {
    const { unmount } = render(<FirstRun toured />)
    expect(screen.getByRole('list', { name: /Agents on/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveFocus()
    unmount()
    render(<FirstRun toured runtimes={[SIGNED_OUT]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue without one' }))
    expect(heading('Your first project')).toBeInTheDocument()
  })

  it('shows where the agents will be while they are asked', () => {
    render(<FirstRun toured runtimes={null} />)
    expect(screen.getByLabelText('Asking the agents')).toHaveAttribute('aria-busy', 'true')
  })

  it('says what went wrong on the step it belongs to, and the line at the foot only there', () => {
    render(<FirstRun toured error={{ step: 'agents', said: 'The runtime didn’t answer.' }} foot={<span>Crash reports</span>} />)
    expect(screen.getByRole('alert')).toHaveTextContent('The runtime didn’t answer.')
    expect(screen.getByText('Crash reports')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('Crash reports')).toBeNull()
  })
})

describe('the welcome’s project', () => {
  it('says what is missing when nothing is ticked, and makes the project of what is', () => {
    const onCreate = vi.fn()
    render(<FirstRun toured start="project" onCreate={onCreate} />)
    fireEvent.click(screen.getByRole('button', { name: /Make the project/ }))
    expect(screen.getByRole('alert')).toHaveTextContent('Tick a repository, or add a folder.')
    expect(onCreate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('checkbox', { name: /halyard/ }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Project name' })).toHaveValue('halyard')
    fireEvent.click(screen.getByRole('button', { name: /Make the project/ }))
    expect(onCreate).toHaveBeenCalledTimes(1)
    // Made, it goes on to its code, and the steps up to it are done with.
    expect(heading('Pull requests')).toBeInTheDocument()
    expect(screen.getByText('The hosts')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  })

  it('names the project as it is typed', () => {
    const onNameChange = vi.fn()
    render(<FirstRun toured start="project" picked={['meridian']} onNameChange={onNameChange} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Project name' }), { target: { value: 'Meridian' } })
    expect(onNameChange).toHaveBeenCalledWith('Meridian')
  })

  it('makes nothing while it is being made, and shows why it couldn’t be', () => {
    render(<FirstRun toured start="project" picked={['meridian']} creating error={{ step: 'project', said: 'It is gone.' }} />)
    expect(screen.getByRole('button', { name: /Make the project/ })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('It is gone.')
  })

  it('takes folders dropped on the window there, and says to let go while one is held over it', () => {
    const onDrop = vi.fn()
    render(<FirstRun toured start="project" onDrop={onDrop} />)
    const welcome = screen.getByRole('heading', { level: 1 }).closest('section')?.parentElement
    if (!welcome) throw new Error('No welcome')
    const file = new File([''], 'ops')
    const dataTransfer = { types: ['Files'], files: [file], dropEffect: 'none' }
    fireEvent.dragEnter(welcome, { dataTransfer })
    fireEvent.dragOver(welcome, { dataTransfer })
    expect(heading('Let go to add it')).toBeInTheDocument()
    fireEvent.drop(welcome, { dataTransfer })
    expect(onDrop).toHaveBeenCalledWith([file])
  })
})

describe('the welcome’s code host and tracker', () => {
  it('goes on from the code with Not now until a host is connected, then with Continue', () => {
    const { rerender } = render(<FirstRun toured start="code" made />)
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument()
    rerender(<FirstRun toured start="code" made hostConnected />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(heading('Issues')).toBeInTheDocument()
    expect(screen.getByText('The trackers')).toBeInTheDocument()
    // Back goes to the code, not to the project already made.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(heading('Pull requests')).toBeInTheDocument()
  })

  it('opens the project by its name on the last step, or as the project without one', () => {
    const onOpen = vi.fn()
    const { unmount } = render(<FirstRun toured start="issues" made picked={['meridian']} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open meridian' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
    unmount()
    render(<FirstRun toured start="issues" made />)
    expect(screen.getByRole('button', { name: 'Open the project' })).toBeInTheDocument()
  })
})

describe('the welcome where no tracker can be connected', () => {
  it('leaves out the step for issues, and opens the project from the code’s', () => {
    const onOpen = vi.fn()
    render(<FirstRun toured start="code" made picked={['meridian']} trackers={undefined} onOpen={onOpen} />)
    expect(within(screen.getByRole('list', { name: 'Steps' })).queryByText('Issues')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open meridian' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})

describe('a scene in the welcome', () => {
  it('plays live, scaled to fit its frame once measured, and again as either changes', () => {
    vi.useFakeTimers()
    const seen: (() => void)[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          seen.push(cb)
        }
        observe() {}
        disconnect() {}
      },
    )
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    Object.defineProperty(Element.prototype, 'animate', {
      value: vi.fn(() => ({ finish: vi.fn(), cancel: vi.fn() })),
      configurable: true,
      writable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { get: () => 600, configurable: true })
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { get: () => 400, configurable: true })
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 700, configurable: true })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { get: () => 330, configurable: true })
    render(<FirstRun still={false} start="review" />)
    const stage = document.querySelector<HTMLElement>('[data-stop]')?.parentElement
    expect(stage?.style.transform).toMatch(/scale\(0\.5\d+\)/)
    act(() => seen.forEach((f) => f()))
    act(() => {
      vi.advanceTimersByTime(12_000)
    })
    expect(screen.getAllByText('Reviewed by GPT-5.2 in 2 passes').length).toBeGreaterThan(0)
    delete (HTMLElement.prototype as { offsetWidth?: number }).offsetWidth
    delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
    delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight
  })
})
