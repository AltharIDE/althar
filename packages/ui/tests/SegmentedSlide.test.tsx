import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Segmented } from '../src/primitives/Segmented/Segmented'

const OPTIONS = [
  { value: 'a', label: 'One' },
  { value: 'b', label: 'Two' },
  { value: 'c', label: 'Three' },
] as const

/* jsdom has no layout: give each option a place so the indicator has something to land on. */
function layout() {
  const lefts: Record<string, number> = { One: 2, Two: 60, Three: 140 }
  const widths: Record<string, number> = { One: 56, Two: 78, Three: 120 }
  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) {
    return lefts[this.textContent ?? ''] ?? 0
  })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return widths[this.textContent ?? ''] ?? 0
  })
}

function Example({ initial }: { initial: 'a' | 'b' | 'c' | null }) {
  const [v, setV] = useState<'a' | 'b' | 'c' | null>(initial)
  return <Segmented label="Pick" options={OPTIONS} value={v} onChange={setV} />
}

const indicator = (c: HTMLElement) => c.querySelector<HTMLElement>('[aria-hidden="true"][style*="translateX"]')

afterEach(() => vi.restoreAllMocks())

describe('Segmented indicator', () => {
  it('sits on the checked option and moves to the one chosen, sliding', () => {
    layout()
    const { container } = render(<Example initial="a" />)
    expect(indicator(container)).toHaveStyle({ width: '56px', transform: 'translateX(2px)' })
    expect(screen.getByRole('radiogroup').className).not.toMatch(/sliding/)

    fireEvent.click(screen.getByRole('radio', { name: 'Three' }))
    expect(indicator(container)).toHaveStyle({ width: '120px', transform: 'translateX(140px)' })
    expect(screen.getByRole('radiogroup').className).toMatch(/sliding/)
  })

  it('skips the transition under reduced motion', () => {
    layout()
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} }))
    const { container } = render(<Example initial="a" />)
    fireEvent.click(screen.getByRole('radio', { name: 'Two' }))
    expect(indicator(container)).toHaveStyle({ transform: 'translateX(60px)' })
    expect(screen.getByRole('radiogroup').className).not.toMatch(/sliding/)
    vi.unstubAllGlobals()
  })

  it('has no indicator without a value', () => {
    layout()
    const { container } = render(<Example initial={null} />)
    expect(indicator(container)).toBeNull()
  })
})
