import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ProjectScene } from '../src/screens/Welcome/scenes'
import { Station } from '../src/screens/Welcome/Station'

/*
 * A welcome scene's parts that change place glide there, from where they
 * were. Here the task card sits lower each time it is measured, as it would
 * when what is above it grows.
 */

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete (Element.prototype as unknown as Record<string, unknown>).animate
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetWidth
})

describe('a welcome scene', () => {
  it('glides a part that moved from where it was to where it is', async () => {
    vi.useFakeTimers()
    const animate = vi.fn()
    Object.defineProperty(Element.prototype, 'animate', { value: animate, configurable: true, writable: true })
    let lower = 0
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const top = this.hasAttribute('data-glide') ? 100 + 10 * lower++ : 0
      return { x: 0, y: top, left: 0, top, width: 120, height: 24, right: 120, bottom: top + 24, toJSON: () => ({}) } as DOMRect
    })
    /* laid out at the size it is drawn: the camera does not scale the scene here */
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 120 })
    render(
      <Station n={1} label="Project" x={0} y={0} shown built={false} instant={false}>
        <ProjectScene live instant={false} />
      </Station>,
    )
    for (let i = 0; i < 80; i++)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50)
      })
    const glides = animate.mock.calls.filter(([frames]) => /^translate\(0px, -\d+px\)$/.test(String((frames as Keyframe[])[0]?.transform)))
    expect(glides.length).toBeGreaterThan(0)
    expect((glides[0]![0] as Keyframe[]).at(-1)).toEqual({ transform: 'none' })
  })
})
