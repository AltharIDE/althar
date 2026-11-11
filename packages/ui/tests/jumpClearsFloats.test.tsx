import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Composer } from '../src/composer/Composer/Composer'

/*
 * The Latest pill rests above the composer's pill row by one variable: the
 * composer tells its face how tall what floats on its edge is, and the pill's
 * rule reads it. Layout is a browser's, so the real clearance is in the
 * TaskFace stories (browser only); here the two ends are kept joined.
 */
const host = (above?: React.ReactNode) =>
  render(
    <div data-floats-host data-testid="host">
      <Composer value="" onChange={() => {}} onSubmit={() => {}} placeholder="Tell the lead" above={above} />
    </div>,
  )

afterEach(() => vi.restoreAllMocks())

describe('the Latest pill and the composer’s pill row', () => {
  it('publishes the height of what floats on the edge, and withdraws it with the row', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(26)
    const { getByTestId, rerender } = host(<button>PR #317</button>)
    expect(getByTestId('host').style.getPropertyValue('--composer-floats')).toBe('26px')
    rerender(
      <div data-floats-host data-testid="host">
        <Composer value="" onChange={() => {}} onSubmit={() => {}} placeholder="Tell the lead" />
      </div>,
    )
    expect(getByTestId('host').style.getPropertyValue('--composer-floats')).toBe('')
  })

  it('has the pill rest above it, and keep its 12px place when nothing floats', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/thread/TaskFace/TaskFace.module.css'), 'utf8')
    const rule = /\.jump\s*\{[^}]*\}/.exec(css)?.[0] ?? ''
    expect(rule).toMatch(/bottom:\s*calc\(var\(--composer-floats,\s*0px\)\s*\+\s*12px\)/)
  })
})
