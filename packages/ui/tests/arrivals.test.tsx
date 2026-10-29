import { act, render } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MOTION } from '../src/lib/motion'
import { Thread } from '../src/thread/Thread/Thread'
import { Turn } from '../src/thread/Turn/Turn'

/*
 * jsdom animates nothing: `animate` records what it was asked, and the clock
 * is the test's, so a thread can be in its first moments or past them.
 */

let played: Array<{ el: Element; keyframes: Keyframe[]; timing: KeyframeAnimationOptions }> = []
let now = 0
let visible = true
let reduced = false
let own: Element[] = []

class FakeCSSAnimation {
  readonly effect = { getComputedTiming: () => ({ iterations: 1 }) }
}

beforeEach(() => {
  played = []
  now = 0
  visible = true
  reduced = false
  own = []
  Element.prototype.animate = function animate(this: Element, keyframes, timing) {
    played.push({ el: this, keyframes: keyframes as Keyframe[], timing: timing as KeyframeAnimationOptions })
    return {} as Animation
  }
  Element.prototype.getAnimations = function getAnimations(this: Element) {
    return own.includes(this) ? [new FakeCSSAnimation() as unknown as Animation] : []
  }
  vi.stubGlobal('CSSAnimation', FakeCSSAnimation)
  Object.defineProperty(Element.prototype, 'checkVisibility', { value: () => visible, configurable: true })
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({ matches: reduced && query.includes('reduce') }) as MediaQueryList)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (Element.prototype as Partial<Element>).animate
  delete (Element.prototype as Partial<Element>).getAnimations
  delete (Element.prototype as Partial<Element>).checkVisibility
})

function Shown({ said, working = [] }: { said: ReadonlyArray<string>; working?: ReadonlyArray<string> }) {
  return (
    <Thread label="Thread">
      {said.map((one) => (
        <p key={one}>{one}</p>
      ))}
      <Turn voice="Lead">
        {working.map((one) => (
          <div key={one}>
            <span>{one}</span>
          </div>
        ))}
      </Turn>
    </Thread>
  )
}

/** Renders it, past its first moments, and changes it to `next`. */
async function changed(first: Parameters<typeof Shown>[0], next: Parameters<typeof Shown>[0]) {
  const view = render(<Shown {...first} />)
  now = 1000
  view.rerender(<Shown {...next} />)
  await act(async () => {})
  return view
}

const text = (el: Element) => el.textContent

describe('useArrivals, in a thread', () => {
  it('brings in what lands in the thread or a turn, rising a little as it fades in', async () => {
    await changed({ said: ['a'] }, { said: ['a', 'b'], working: ['edit'] })
    expect(played.map((one) => text(one.el))).toEqual(['b', 'edit'])
    expect(played[0]!.keyframes).toEqual([
      { opacity: 0, translate: '0px 6px' },
      { opacity: 1, translate: '0px 0px' },
    ])
    expect(played[0]!.timing).toEqual(MOTION.enter)
  })

  it('leaves still what changes inside something already there', async () => {
    const view = await changed({ said: ['a'], working: ['edit'] }, { said: ['a'], working: ['edit'] })
    view.container.querySelector('span')!.append(document.createElement('b'))
    await act(async () => {})
    expect(played).toEqual([])
  })

  it('leaves still what the thread is drawn with as it opens', async () => {
    const view = render(<Shown said={['a']} />)
    now = 200
    view.rerender(<Shown said={['a', 'b']} />)
    await act(async () => {})
    expect(played).toEqual([])
  })

  it('leaves still a thread drawn afresh, where one thing takes another’s place, and while hidden', async () => {
    await changed({ said: ['a'] }, { said: ['a', '1', '2', '3', '4', '5', '6', '7'] })
    expect(played).toEqual([])
    await changed({ said: ['a'] }, { said: ['b'] })
    expect(played).toEqual([])
    visible = false
    await changed({ said: ['a'] }, { said: ['a', 'b'] })
    expect(played).toEqual([])
  })

  it('leaves alone what comes in by an animation of its own', async () => {
    const view = render(<Shown said={['a']} />)
    now = 1000
    const card = document.createElement('div')
    own.push(card)
    view.container.querySelector('section')!.append(card)
    await act(async () => {})
    expect(played).toEqual([])
  })

  it('only fades with reduced motion', async () => {
    reduced = true
    await changed({ said: ['a'] }, { said: ['a', 'b'] })
    expect(played[0]!.keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }])
  })

  it('still gives its element to a ref of the consumer’s', () => {
    const held = createRef<HTMLElement>()
    const called = vi.fn()
    const one = render(
      <Thread label="Thread" ref={held}>
        <p>a</p>
      </Thread>,
    )
    expect(held.current?.tagName).toBe('SECTION')
    one.unmount()
    render(
      <Thread label="Thread" ref={called}>
        <p>a</p>
      </Thread>,
    )
    expect(called).toHaveBeenCalledWith(expect.any(HTMLElement))
  })
})
