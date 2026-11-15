import { render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { userEvent } from 'storybook/test'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MergeButton, type MergeStanding } from '../src/primitives/MergeButton/MergeButton'
import { landings } from '../src/primitives/MergeFeel/feel'
import { MergeFeel, type MergeFeelStage } from '../src/primitives/MergeFeel/MergeFeel'

/*
 * What a merge feels like where it is pressed (feel.ts): the press answered
 * in Merge's place, the dot into where it stands, the landing, loud only for
 * the first of many, and only fading with less motion. A browser plays the
 * motion; here, what it is asked to play.
 */

interface Run {
  target: Element
  frames: Keyframe[]
}

/** Element.animate, recording what it is asked to run. */
function compositor() {
  const runs: Run[] = []
  const animate = vi.fn(function (this: Element, frames: Keyframe[]) {
    runs.push({ target: this, frames })
    return { cancel: vi.fn(), finished: Promise.resolve() } as unknown as Animation
  })
  Object.defineProperty(HTMLElement.prototype, 'animate', { value: animate, configurable: true, writable: true })
  return runs
}

/** A card in the window, where the person can see it. */
const onScreen = () =>
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 10,
    y: 10,
    left: 10,
    top: 10,
    right: 200,
    bottom: 100,
    width: 190,
    height: 90,
    toJSON: () => ({}),
  })

const lessMotion = () =>
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({ matches: query.includes('reduce'), addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  })

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'animate')
  Reflect.deleteProperty(window, 'matchMedia')
  vi.restoreAllMocks()
})

const ran = (runs: Run[], what: string) => runs.filter((run) => String((run.target as HTMLElement).className).includes(what))

/** A card with Merge to press while it can be, and Merge's knot, where its merge goes. */
function Card({ stage }: { stage: MergeFeelStage | null }) {
  return (
    <div data-testid="card">
      <span data-testid="knot" data-merge-target="knot" />
      {(stage === 'ready' || stage === 'merging') && (
        <button type="button" data-merge="">
          Merge
        </button>
      )}
      <MergeFeel stage={stage} />
    </div>
  )
}

describe('many landing at once', () => {
  it('plays the first seen in full, and the rest quietly until a quiet spell', () => {
    let now = 0
    const land = landings(() => now)
    expect(land(true)).toEqual({ loud: true, delay: 0 })
    now = 1000
    expect(land(true).loud).toBe(false)
    // Each landing seen keeps the spell going.
    now = 3500
    expect(land(true).loud).toBe(false)
    now = 7000
    expect(land(true).loud).toBe(true)
  })

  it('keeps the spell as it was for a landing nobody sees', () => {
    let now = 0
    const land = landings(() => now)
    expect(land(false).loud).toBe(false)
    now = 500
    expect(land(true).loud).toBe(true)
  })

  it('settles those read at once one after another, down the page', () => {
    let now = 0
    const land = landings(() => now)
    expect([land(true), land(true), land(true)].map((one) => one.delay)).toEqual([0, 90, 180])
    now = 1000
    expect(land(true).delay).toBe(0)
  })
})

describe('a merge, felt on its card', () => {
  it('goes up as a dot into where it stands once queued, and lands with a burst and a thump', async () => {
    const runs = compositor()
    onScreen()
    const { rerender } = render(<Card stage="ready" />)
    rerender(<Card stage="merging" />)
    rerender(<Card stage="queued" />)
    // Where Merge was, gathering, and the dot it gathers into, going up.
    expect(ran(runs, 'ghost')).toHaveLength(1)
    await waitFor(() => expect(ran(runs, 'dot').some((run) => String(run.frames[1]?.transform).includes('translate'))).toBe(true))
    // The knot answers as the dot comes to it.
    await waitFor(() => expect(runs.some((run) => run.target === screen.getByTestId('knot'))).toBe(true))
    rerender(<Card stage="merged" />)
    expect(runs.filter((run) => run.target === screen.getByTestId('knot')).at(-1)?.frames[0]?.transform).toMatch(/^scale/)
    expect(ran(runs, 'spark').length).toBeGreaterThan(5)
    expect(runs.some((run) => run.target === screen.getByTestId('card') && String(run.frames[1]?.transform).includes('translateY'))).toBe(
      true,
    )
  })

  it('plays nothing for a card that opens merged, or in its queue', () => {
    const runs = compositor()
    onScreen()
    const { rerender } = render(<Card stage="merged" />)
    rerender(<Card stage="merged" />)
    render(<Card stage="queued" />)
    expect(runs).toHaveLength(0)
  })

  it('only fades with less motion: nothing travels, grows or bursts', async () => {
    lessMotion()
    const runs = compositor()
    onScreen()
    const { rerender } = render(<Card stage="ready" />)
    rerender(<Card stage="queued" />)
    rerender(<Card stage="merged" />)
    await waitFor(() => expect(runs.length).toBeGreaterThan(0))
    expect(ran(runs, 'spark')).toHaveLength(0)
    expect(ran(runs, 'dot')).toHaveLength(0)
    for (const run of runs) for (const frame of run.frames) expect(frame.transform).toBeUndefined()
  })
})

describe('Merge, pressed', () => {
  it('keeps its place and width, says Merging, and answers the press', async () => {
    const runs = compositor()
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(132)
    function Pressable() {
      const [standing, setStanding] = useState<MergeStanding | null>(null)
      return (
        <MergeButton onMerge={() => setStanding('merging')} standing={standing}>
          Accept and merge
        </MergeButton>
      )
    }
    render(<Pressable />)
    await userEvent.click(screen.getByRole('button', { name: 'Accept and merge' }))
    const said = screen.getByRole('status')
    expect(said).toHaveTextContent('Merging')
    expect(said.style.minWidth).toBe('132px')
    expect(screen.queryByRole('button', { name: 'Accept and merge' })).not.toBeInTheDocument()
    // It gives under the press and springs back.
    expect(runs.some((run) => run.target === said && run.frames[0]?.transform === 'scale(0.94)')).toBe(true)
  })

  it('shows Merging still, unanswered, where it was pressed elsewhere', () => {
    const runs = compositor()
    render(<MergeButton onMerge={vi.fn()} standing="merging" />)
    expect(screen.getByRole('status')).toHaveTextContent('Merging')
    expect(runs).toHaveLength(0)
  })
})
