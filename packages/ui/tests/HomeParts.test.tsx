import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { NOTCH } from '../src/fixtures/edge'
import { HALYARD, MERIDIAN } from '../src/fixtures/home'
import { HomeRest } from '../src/home/HomeRest/HomeRest'
import { Island } from '../src/home/Island/Island'
import { NeedLine } from '../src/home/NeedLine/NeedLine'
import { type ProjectListItem, ProjectList, QUIET_FOLD } from '../src/home/ProjectList/ProjectList'
import { SinceRow } from '../src/home/SinceRow/SinceRow'

/* Home's parts, each at a case its stories don't reach. */

describe('Home’s parts', () => {
  it('says one call needs you in the island, with its mark only a picture where nothing opens the app', () => {
    render(<Island notch={NOTCH} waiting={1} />)
    expect(screen.getByRole('button', { name: '1 needs you' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open Althar' })).not.toBeInTheDocument()
  })

  it('sets a call with nothing under its title apart', () => {
    render(<NeedLine kind="Question" project={MERIDIAN} title="Which ledger does this read?" />)
    expect(screen.getByRole('article', { name: /Which ledger does this read\?/ })).toHaveClass('alone')
  })

  it('folds the one quiet project away under a line saying so', () => {
    const busy = (i: number): ProjectListItem => ({ id: `p${i}`, project: { ...HALYARD, name: `Busy ${i}` }, yours: 1, tasks: [] })
    render(
      <ProjectList
        projects={[...Array.from({ length: QUIET_FOLD }, (_, i) => busy(i)), { id: 'quiet', project: MERIDIAN, yours: 0, tasks: [] }]}
      />,
    )
    expect(screen.getByRole('button', { name: '1 quiet project' })).toBeInTheDocument()
  })

  it('says which task something happened to', () => {
    render(<SinceRow icon="pr" task="418" what="Pull request #1191 opened" at="12:58" />)
    expect(screen.getByText('418')).toHaveTextContent('Task 418')
  })

  it('lies down when it leaves, still, with nothing listening for when it has', () => {
    render(<HomeRest title="Nothing needs you" motion="still" leaving />)
    expect(screen.getByRole('heading', { name: 'Nothing needs you' }).closest('section')).toHaveClass('leaving')
  })
})

describe('a call asking for focus', () => {
  it('doesn’t take it once it stops asking before it got it', async () => {
    const { rerender } = render(<NeedLine kind="Question" project={MERIDIAN} title="Which ledger?" focusOnMount />)
    rerender(<NeedLine kind="Question" project={MERIDIAN} title="Which ledger?" />)
    await Promise.resolve()
    expect(screen.getByRole('article', { name: /Which ledger\?/ })).not.toHaveFocus()
  })
})
