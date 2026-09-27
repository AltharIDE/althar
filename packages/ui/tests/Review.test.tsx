import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { FINDINGS, FINDINGS_YOURS, PROJECT } from '../src/fixtures/meridian'
import { GEMINI_PRO, SONNET } from '../src/fixtures/models'
import { FindingState, FindingsReach, Verdict } from '../src/foundations/vocabulary'
import { Review, reviewText as t, type Finding } from '../src/thread/Review/Review'

const TWO = [{ model: SONNET }, { model: GEMINI_PRO }]
const review = (findings: Finding[], props: Partial<Parameters<typeof Review>[0]> = {}) => {
  const onFindingsChange = vi.fn()
  render(
    <Review
      n={3}
      of={6}
      reviewers={TWO}
      verdict={Verdict.Changes}
      project={PROJECT}
      defaultFindings={findings}
      defaultOpen
      onFindingsChange={onFindingsChange}
      {...props}
    />,
  )
  return onFindingsChange
}
const latest = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)?.[0] as Finding[]

describe('Review', () => {
  it('tells the lead what to do instead of a finding that waits on you', () => {
    const changed = review(FINDINGS_YOURS)
    const yours = within(screen.getByText(t.needsCall).closest('li')!)
    fireEvent.click(yours.getByRole('button', { name: t.sayWhat }))
    const field = screen.getByRole('textbox', { name: t.tellPlaceholder })
    expect(field).toHaveFocus()
    /* an empty answer is not sent */
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(changed).not.toHaveBeenCalled()
    fireEvent.change(field, { target: { value: 'Keep one bucket; note it in the docs' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(latest(changed).find((f) => f.state === FindingState.Told)?.told).toBe('Keep one bucket; note it in the docs')
  })

  it('closes the form with Escape or Cancel, without changing anything', () => {
    const changed = review(FINDINGS_YOURS)
    const yours = within(screen.getByText(t.needsCall).closest('li')!)
    fireEvent.click(yours.getByRole('button', { name: t.sayWhat }))
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(yours.getByRole('button', { name: t.sayWhat }))
    fireEvent.click(yours.getByRole('button', { name: t.cancel }))
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(changed).not.toHaveBeenCalled()
  })

  it('dismisses a finding that waits on you, and takes it back', () => {
    const changed = review(FINDINGS_YOURS)
    const yours = screen.getByText(t.needsCall).closest('li')!
    fireEvent.click(within(yours).getByRole('button', { name: t.dismiss }))
    expect(latest(changed).some((f) => f.state === FindingState.Dismissed && f.was === FindingState.Yours)).toBe(true)
  })

  it('in a pass over every finding, each can be told or fixed', () => {
    const open = FINDINGS.map((f) => ({ ...f, state: FindingState.Open }))
    const changed = review(open, { reach: FindingsReach.All })
    const [tell] = screen.getAllByRole('button', { name: t.sayWhat })
    fireEvent.click(tell!)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Do it the other way' } })
    fireEvent.click(screen.getByRole('button', { name: t.send }))
    expect(latest(changed).filter((f) => f.state === FindingState.Told)).toHaveLength(1)
    const [fix] = screen.getAllByRole('button', { name: t.haveFixed })
    fireEvent.click(fix!)
    expect(latest(changed).filter((f) => f.state === FindingState.ToFix)).toHaveLength(1)
  })

  it('skips a dismissal reason, or saves one', () => {
    const open = FINDINGS.map((f) => ({ ...f, state: FindingState.Open }))
    const changed = review(open)
    fireEvent.click(screen.getAllByRole('button', { name: t.dismiss })[0]!)
    fireEvent.click(screen.getByRole('button', { name: /Add a reason/ }))
    fireEvent.click(screen.getByRole('button', { name: t.skip }))
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Add a reason/ }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(latest(changed).find((f) => f.state === FindingState.Dismissed)?.reason).toBeUndefined()
  })
})
