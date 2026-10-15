import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ProjectInk } from '@althar/ui'

import { EXAMPLE, IslandPicture, MenuPicture, shownGlance } from '../src/renderer/features/settings/EdgePicture'

/* What Settings draws of the edge of the screen: the home's own work where there is some, a busy moment where there's none. */

const MERIDIAN = { seed: 'meridian', ink: ProjectInk.Clay, name: 'meridian' }

describe('the edge, pictured in settings', () => {
  it('draws the home’s own calls and work, and a busy moment only where nothing waits or is in progress', () => {
    const quiet = { waiting: 0, needs: [], work: { inProgress: 1 } }
    expect(shownGlance(quiet)).toBe(quiet)
    expect(shownGlance({ waiting: 0, needs: [], work: { inProgress: 0 } })).toBe(EXAMPLE)
    expect(shownGlance(undefined)).toBe(EXAMPLE)
    const menu = render(<MenuPicture glance={quiet} />)
    // Running doesn't need the person: the work is one line under what does.
    expect(menu.container.textContent).toContain('Nothing needs you')
    expect(menu.container.textContent).toContain('1 in progress')
    menu.unmount()
    const island = render(
      <IslandPicture
        glance={{
          waiting: 1,
          needs: [{ id: 'c1', kind: 'Permission', project: MERIDIAN, title: 'Retry the checkout call', command: 'npm test' }],
          work: { inProgress: 2, held: 1 },
        }}
      />,
    )
    expect(island.container.textContent).toContain('Retry the checkout call')
    expect(island.container.textContent).toContain('Permission')
    expect(island.container.textContent).toContain('2 in progress · 1 held')
  })
})
