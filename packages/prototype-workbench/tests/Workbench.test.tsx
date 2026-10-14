import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { prototype, type Prototype } from '../src/prototype'
import { useShared } from '../src/shared'
import { Workbench } from '../src/Workbench'

/*
 * A prototype of a button in three directions, at two states, with Today:
 * each direction says which it is and the state it is drawn at, and keeps a
 * count every direction shares.
 */
function Counted({ label, state }: { label: string; state: string }) {
  const [count, setCount] = useShared('count', 0)
  return (
    <div>
      <p>
        {label} at {state}
      </p>
      <button type="button" onClick={() => setCount((was) => was + 1)}>
        Pressed {count} times
      </button>
      <input aria-label="Notes" />
    </div>
  )
}

const buttons = prototype<{ word: string }>({
  title: 'Save button',
  states: [
    { key: 'idle', name: 'Idle' },
    { key: 'saving', name: 'Saving' },
  ],
  fixtures: (state) => ({ word: state === 'saving' ? 'Saving…' : 'Save' }),
  today: { render: ({ state }) => <Counted label="Today’s button" state={state} /> },
  directions: [
    { key: 'A', name: 'Quiet', render: ({ state }) => <Counted label="Quiet button" state={state} /> },
    { key: 'B', name: 'Ink', render: ({ fixtures }) => <p>Ink button says {fixtures.word}</p> },
    {
      key: 'C',
      name: 'Signal',
      render: ({ state, side }) => (
        <p>
          Signal button at {state}
          {side ? ', beside the others' : ''}
        </p>
      ),
    },
  ],
})

const open = <F,>(definition: Prototype<F>, search = '') => {
  window.history.replaceState(null, '', `/${search}`)
  return render(<Workbench prototype={definition} />)
}

const bar = () => within(screen.getByRole('contentinfo', { name: 'Directions and states' }))
const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key, ...init })

describe('the workbench', () => {
  it('opens on the first direction at the first state, says so in the address and the tab, and lists every direction in the bar', () => {
    open(buttons)
    expect(screen.getByText('Quiet button at idle')).toBeInTheDocument()
    expect(window.location.search).toBe('?d=A&s=idle')
    expect(document.title).toBe('Quiet · Save button')
    expect(bar().getByText('Save button')).toBeInTheDocument()
    expect(
      bar()
        .getAllByRole('radio')
        .map((item) => item.textContent),
    ).toEqual(['Today', 'A Quiet', 'B Ink', 'C Signal', 'Idle', 'Saving'])
    expect(bar().getByRole('radio', { name: 'A Quiet' })).toHaveAttribute('aria-checked', 'true')
  })

  it('opens on the direction and state the address names', () => {
    open(buttons, '?d=c&s=saving&keep=me')
    expect(screen.getByText('Signal button at saving')).toBeInTheDocument()
    expect(window.location.search).toBe('?d=C&s=saving&keep=me')
  })

  it('swaps the direction in place when one is pressed in the bar, keeping the state', () => {
    open(buttons, '?s=saving')
    const stage = screen.getByRole('main')
    fireEvent.click(bar().getByRole('radio', { name: 'B Ink' }))
    expect(screen.getByText('Ink button says Saving…')).toBeInTheDocument()
    expect(screen.queryByText(/Quiet button/)).not.toBeInTheDocument()
    expect(screen.getByRole('main')).toBe(stage)
    expect(window.location.search).toBe('?d=B&s=saving')
    // Pressing the one shown leaves it shown.
    fireEvent.click(bar().getByRole('radio', { name: 'B Ink' }))
    expect(screen.getByText('Ink button says Saving…')).toBeInTheDocument()
  })

  it('shows another state from the states picker, with its fixtures', () => {
    open(buttons, '?d=B')
    fireEvent.click(bar().getByRole('radio', { name: 'Saving' }))
    expect(screen.getByText('Ink button says Saving…')).toBeInTheDocument()
    expect(window.location.search).toBe('?d=B&s=saving')
  })

  it('switches with the keys: numbers, the arrows, and [ and ] for the states', () => {
    open(buttons)
    act(() => void press('3'))
    expect(screen.getByText('Signal button at idle')).toBeInTheDocument()
    act(() => void press('ArrowLeft'))
    expect(screen.getByText('Ink button says Save')).toBeInTheDocument()
    act(() => void press('0'))
    expect(screen.getByText('Today’s button at idle')).toBeInTheDocument()
    act(() => void press(']'))
    expect(screen.getByText('Today’s button at saving')).toBeInTheDocument()
    expect(window.location.search).toBe('?d=today&s=saving')
  })

  it('takes a key it uses from the page, and leaves the rest', () => {
    open(buttons)
    expect(press('2')).toBe(false)
    expect(press('x')).toBe(true)
    // B is shown already.
    expect(press('2')).toBe(true)
  })

  it('leaves the keys alone while the person types, or holds ⌘', () => {
    open(buttons)
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Notes' }), { key: '2' })
    act(() => void press('2', { metaKey: true }))
    expect(screen.getByText('Quiet button at idle')).toBeInTheDocument()
  })

  it('keeps what was done in one direction as the person switches to another and back', () => {
    open(buttons)
    fireEvent.click(screen.getByRole('button', { name: 'Pressed 0 times' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pressed 1 times' }))
    act(() => void press('0'))
    expect(screen.getByRole('button', { name: 'Pressed 2 times' })).toBeInTheDocument()
    act(() => void press('1'))
    expect(screen.getByRole('button', { name: 'Pressed 2 times' })).toBeInTheDocument()
  })

  it('hides the bar with H for a clean look, and shows it again from its corner', () => {
    open(buttons)
    act(() => void press('h'))
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument()
    expect(window.location.search).toBe('?d=A&s=idle&bar=0')
    fireEvent.click(screen.getByRole('button', { name: /Show bar/ }))
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
  })

  it('opens with the bar hidden where the address says so', () => {
    open(buttons, '?bar=0')
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument()
  })

  describe('side by side', () => {
    it('stands every direction next to the others at the same state, each named', () => {
      open(buttons, '?s=saving')
      fireEvent.click(bar().getByRole('switch', { name: 'Side by side' }))
      const panes = screen.getAllByRole('region')
      expect(panes.map((pane) => pane.getAttribute('aria-label'))).toEqual(['Today', 'Quiet', 'Ink', 'Signal'])
      expect(within(panes[3] as HTMLElement).getByText('Signal button at saving, beside the others')).toBeInTheDocument()
      expect(within(panes[2] as HTMLElement).getByText('Ink button says Saving…')).toBeInTheDocument()
      expect(window.location.search).toBe('?d=A&s=saving&side=all')
      expect(document.title).toBe('Side by side · Save button')
    })

    it('takes directions out and puts them back from the bar, never the last one', () => {
      open(buttons, '?side=all')
      fireEvent.click(bar().getByRole('button', { name: 'Today' }))
      fireEvent.click(bar().getByRole('button', { name: 'C Signal' }))
      expect(screen.getAllByRole('region').map((pane) => pane.getAttribute('aria-label'))).toEqual(['Quiet', 'Ink'])
      expect(window.location.search).toBe('?d=A&s=idle&side=A,B')
      fireEvent.click(bar().getByRole('button', { name: 'B Ink' }))
      fireEvent.click(bar().getByRole('button', { name: 'A Quiet' }))
      expect(screen.getAllByRole('region').map((pane) => pane.getAttribute('aria-label'))).toEqual(['Quiet'])
      fireEvent.click(bar().getByRole('button', { name: 'C Signal' }))
      expect(screen.getAllByRole('region').map((pane) => pane.getAttribute('aria-label'))).toEqual(['Quiet', 'Signal'])
    })

    it('goes on and off with S, and back to the direction shown before', () => {
      open(buttons, '?d=B')
      act(() => void press('s'))
      expect(screen.getAllByRole('region')).toHaveLength(4)
      act(() => void press('2'))
      expect(screen.getAllByRole('region')).toHaveLength(3)
      act(() => void press('S'))
      expect(screen.queryAllByRole('region')).toHaveLength(0)
      expect(screen.getByText('Ink button says Save')).toBeInTheDocument()
    })

    it('shares what was done in one direction with the others beside it', () => {
      open(buttons, '?side=today,A')
      const [today, quiet] = screen.getAllByRole('region') as [HTMLElement, HTMLElement]
      fireEvent.click(within(quiet).getByRole('button', { name: 'Pressed 0 times' }))
      expect(within(today).getByRole('button', { name: 'Pressed 1 times' })).toBeInTheDocument()
    })

    it('scales a direction designed at a width down to fit its column', () => {
      const observed: ResizeObserverCallback[] = []
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(callback: ResizeObserverCallback) {
            observed.push(callback)
          }
          observe() {}
          disconnect() {}
        },
      )
      open({ ...buttons, width: 1200 }, '?side=A,B')
      act(() => {
        for (const callback of observed) callback([{ contentRect: { width: 400 } } as ResizeObserverEntry], {} as ResizeObserver)
      })
      const [quiet] = screen.getAllByRole('region') as [HTMLElement]
      const designed = within(quiet).getByText('Quiet button at idle').closest('[style]') as HTMLElement
      expect(designed.style.width).toBe('1200px')
      expect(Number(designed.style.zoom)).toBeCloseTo(1 / 3)
      vi.unstubAllGlobals()
    })

    it('has nothing to put side by side where there is one direction', () => {
      open(prototype({ title: 'One', directions: [{ key: 'A', name: 'Only', render: () => <p>Only</p> }] }))
      expect(bar().queryByRole('switch')).not.toBeInTheDocument()
      expect(bar().queryByText('State')).not.toBeInTheDocument()
    })
  })

  it('lists its keys', () => {
    open(buttons)
    fireEvent.click(bar().getByRole('button', { name: 'Keys' }))
    const keys = screen.getByRole('dialog', { name: 'Keys' })
    expect(within(keys).getByText('Show Today')).toBeInTheDocument()
    expect(within(keys).getByText('Previous or next state')).toBeInTheDocument()
    expect(within(keys).getByText('Hide or show this bar')).toBeInTheDocument()
  })

  it('names each direction’s key for assistive technology', () => {
    open(buttons)
    expect(bar().getByRole('radio', { name: 'Today' })).toHaveAttribute('aria-keyshortcuts', '0')
    expect(bar().getByRole('radio', { name: 'C Signal' })).toHaveAttribute('aria-keyshortcuts', '3')
  })

  it('says in its place that a direction failed to draw, and draws it again at another state', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const failing = prototype({
      title: 'Failing',
      states: [
        { key: 'bad', name: 'Bad' },
        { key: 'good', name: 'Good' },
      ],
      directions: [
        {
          key: 'A',
          name: 'Brittle',
          render: ({ state }) => {
            if (state === 'bad') throw new Error('No card for this state')
            return <p>Brittle, drawn</p>
          },
        },
        { key: 'B', name: 'Sturdy', render: () => <p>Sturdy, drawn</p> },
      ],
    })
    open(failing)
    expect(screen.getByRole('alert')).toHaveTextContent('Brittle failed to draw.No card for this state')
    act(() => void press('2'))
    expect(screen.getByText('Sturdy, drawn')).toBeInTheDocument()
    act(() => void press('1'))
    act(() => void press(']'))
    expect(screen.getByText('Brittle, drawn')).toBeInTheDocument()
    vi.restoreAllMocks()
  })

  it('says what is wrong with a prototype in its place', () => {
    open(
      prototype({
        title: 'Muddled',
        directions: [
          { key: 'A', name: 'One', render: () => null },
          { key: 'a', name: 'Two', render: () => null },
        ],
      }),
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Two directions have the key A: each needs its own.')
  })

  it('says a prototype with no directions needs one, even with Today', () => {
    open(prototype({ title: 'Empty', today: { name: 'The app', render: () => <p>The app today</p> }, directions: [] }))
    expect(screen.getByRole('alert')).toHaveTextContent('It has no directions')
  })

  it('draws a new version of the prototype in place, keeping what is shown', () => {
    const { rerender } = open(buttons, '?d=B&s=saving')
    rerender(
      <Workbench
        prototype={{ ...buttons, directions: buttons.directions.map((direction) => ({ ...direction, name: `${direction.name}, again` })) }}
      />,
    )
    expect(bar().getByRole('radio', { name: 'B Ink, again' })).toHaveAttribute('aria-checked', 'true')
    rerender(<Workbench prototype={{ ...buttons, directions: buttons.directions.filter((direction) => direction.key !== 'B') }} />)
    expect(screen.getByText('Quiet button at saving')).toBeInTheDocument()
  })

  it('lets a script show any view and wait until it is drawn, as the screenshot helper does', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0))
    open(buttons)
    const handle = window.__workbench
    expect(handle).toMatchObject({
      title: 'Save button',
      directions: [
        { key: 'today', name: 'Today' },
        { key: 'A', name: 'Quiet' },
        { key: 'B', name: 'Ink' },
        { key: 'C', name: 'Signal' },
      ],
      states: [
        { key: 'idle', name: 'Idle' },
        { key: 'saving', name: 'Saving' },
      ],
    })
    await act(() => handle?.show({ direction: 'B', state: 'saving', bar: false }))
    expect(screen.getByText('Ink button says Saving…')).toBeInTheDocument()
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument()
    expect(window.__workbench?.shown).toEqual({ direction: 'B', state: 'saving', side: null, bar: false })
    vi.unstubAllGlobals()
  })
})
