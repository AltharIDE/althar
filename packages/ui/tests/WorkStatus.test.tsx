import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { WorkStatus } from '../src/chrome/WorkStatus/WorkStatus'

const rings = (container: HTMLElement) => container.querySelectorAll('[class*="ping"]').length

describe('WorkStatus', () => {
  it('rings the dot of what needs you only where asked, and never the running one', () => {
    const still = render(<WorkStatus running={3} yours={1} onYours={() => {}} />)
    expect(rings(still.container)).toBe(0)
    still.unmount()
    const home = render(<WorkStatus ring running={3} yours={1} onYours={() => {}} />)
    expect(rings(home.container)).toBe(1)
  })
})
