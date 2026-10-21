import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { OPUS } from '../src/fixtures/models'
import { Brand } from '../src/foundations/brands/brands'
import { TaskStatus } from '../src/foundations/vocabulary'
import { Issue } from '../src/coordinator/Issue/Issue'
import { TaskCard } from '../src/coordinator/TaskCard/TaskCard'

/* The coordinator's cards, each at a case its stories don't reach. */

describe('the coordinator’s cards', () => {
  it('shows an issue whose address isn’t a web page as words, not a link', () => {
    render(<Issue mark={Brand.Linear} source="Linear" id="MER-231" title="Rate-limit refunds" href="linear://issue/MER-231" />)
    expect(screen.getByText('Rate-limit refunds')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('marks a task card found, with a line about it in its foot', () => {
    render(
      <TaskCard
        task="418"
        title="Repair token refresh"
        status={TaskStatus.Running}
        steps={[]}
        at={0}
        started="12:40"
        lead={OPUS}
        meta="2 files"
        found
      />,
    )
    expect(screen.getByRole('article', { name: 'Repair token refresh' })).toHaveClass('found')
    expect(screen.getByText('2 files')).toBeInTheDocument()
  })
})
