import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ProjectInk, TaskStatus } from '@althar/ui'

import { EXAMPLE, IslandPicture, MenuPicture, shownGlance } from '../src/renderer/features/settings/EdgePicture'

/* What Settings draws of the edge of the screen: the home's own work where there is some, a busy moment where there's none. */

const MERIDIAN = { seed: 'meridian', ink: ProjectInk.Clay, name: 'meridian' }

describe('the edge, pictured in settings', () => {
  it('draws the home’s own work, and a busy moment only where nothing waits or runs', () => {
    const quiet = {
      waiting: 0,
      running: 1,
      lines: [{ id: 't1', status: TaskStatus.Running, project: MERIDIAN, title: 'Retry the checkout call' }],
    }
    expect(shownGlance(quiet)).toBe(quiet)
    expect(shownGlance({ waiting: 0, running: 0, lines: [] })).toBe(EXAMPLE)
    expect(shownGlance(undefined)).toBe(EXAMPLE)
    const menu = render(<MenuPicture glance={quiet} />)
    expect(menu.container.textContent).toContain('Retry the checkout call')
    menu.unmount()
    const island = render(<IslandPicture glance={EXAMPLE} />)
    expect(island.container.textContent).toContain('Publish the SDK to npm')
    expect(island.container.textContent).toContain('Permission')
  })
})
