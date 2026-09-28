import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { FINDINGS, FINDINGS_YOURS } from '../src/fixtures/meridian'
import { GEMINI_PRO, SONNET } from '../src/fixtures/models'
import { FindingState, FindingsReach, Verdict } from '../src/foundations/vocabulary'
import { Review, reviewText as t, type FindingChange, type ReviewFinding, type ReviewProps } from '../src/thread/Review/Review'

const TWO = [{ model: SONNET }, { model: GEMINI_PRO }]
const review = (findings: readonly ReviewFinding[], props: Partial<ReviewProps> = {}) => {
  const onFindingsChange = vi.fn<(findings: readonly ReviewFinding[], change: FindingChange) => void>()
  render(
    <Review
      n={3}
      of={6}
      reviewers={TWO}
      verdict={Verdict.Changes}
      defaultFindings={findings}
      defaultOpen
      onFindingsChange={onFindingsChange}
      {...props}
    />,
  )
  return onFindingsChange
}
type Changed = ReturnType<typeof review>
const latest = (fn: Changed) => fn.mock.calls.at(-1)?.[0] ?? []
const lastChange = (fn: Changed) => fn.mock.calls.at(-1)?.[1]
const yoursRow = () => {
  const row = screen.getByText(t.needsCall).closest('li')
  if (!row) throw new Error('no finding waits on you')
  return row
}
const send = () => {
  const form = screen.getByRole('textbox').closest('form')
  if (!form) throw new Error('no note form')
  fireEvent.submit(form)
}

describe('Review', () => {
  it('tells the lead what to do instead of a finding that waits on you', () => {
    const changed = review(FINDINGS_YOURS)
    fireEvent.click(within(yoursRow()).getByRole('button', { name: t.sayWhat }))
    const field = screen.getByRole('textbox', { name: t.tellPlaceholder })
    expect(field).toHaveFocus()
    /* an empty answer is not sent, and says why */
    send()
    expect(changed).not.toHaveBeenCalled()
    expect(field).toHaveAccessibleDescription(t.emptyTell)
    fireEvent.change(field, { target: { value: 'Keep one bucket; note it in the docs' } })
    send()
    expect(latest(changed).find((f) => f.state === FindingState.Told)?.told).toBe('Keep one bucket; note it in the docs')
    expect(lastChange(changed)).toMatchObject({
      from: FindingState.Yours,
      to: FindingState.Told,
      note: 'Keep one bucket; note it in the docs',
    })
  })

  it('closes the form with Escape or Cancel, without changing anything', () => {
    const changed = review(FINDINGS_YOURS)
    fireEvent.click(within(yoursRow()).getByRole('button', { name: t.sayWhat }))
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(within(yoursRow()).getByRole('button', { name: t.sayWhat }))
    fireEvent.click(within(yoursRow()).getByRole('button', { name: t.cancel }))
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(changed).not.toHaveBeenCalled()
  })

  it('dismisses a finding that waits on you, and takes it back', () => {
    const changed = review(FINDINGS_YOURS)
    fireEvent.click(within(yoursRow()).getByRole('button', { name: t.dismiss }))
    expect(lastChange(changed)).toMatchObject({ from: FindingState.Yours, to: FindingState.Dismissed })
    fireEvent.click(screen.getByRole('button', { name: t.undo }))
    expect(lastChange(changed)).toMatchObject({ from: FindingState.Dismissed, to: FindingState.Yours })
  })

  it('in a pass over every finding, each can be told or fixed', () => {
    const open = FINDINGS.map((f) => ({ ...f, state: FindingState.Open }))
    const changed = review(open, { reach: FindingsReach.All })
    const [tell] = screen.getAllByRole('button', { name: t.sayWhat })
    if (!tell) throw new Error('no Say what to do')
    fireEvent.click(tell)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Do it the other way' } })
    fireEvent.click(screen.getByRole('button', { name: t.send }))
    expect(latest(changed).filter((f) => f.state === FindingState.Told)).toHaveLength(1)
    const [fix] = screen.getAllByRole('button', { name: t.haveFixed })
    if (!fix) throw new Error('no Have it fixed')
    fireEvent.click(fix)
    expect(latest(changed).filter((f) => f.state === FindingState.ToFix)).toHaveLength(1)
  })

  it('skips a dismissal reason, or asks for one before saving', () => {
    const open = FINDINGS.map((f) => ({ ...f, state: FindingState.Open }))
    const changed = review(open)
    const [dismiss] = screen.getAllByRole('button', { name: t.dismiss })
    if (!dismiss) throw new Error('no Dismiss')
    fireEvent.click(dismiss)
    fireEvent.click(screen.getByRole('button', { name: /Add a reason/ }))
    fireEvent.click(screen.getByRole('button', { name: t.skip }))
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Add a reason/ }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } })
    send()
    expect(screen.getByRole('textbox')).toHaveAccessibleDescription(t.emptyReason)
    expect(latest(changed).find((f) => f.state === FindingState.Dismissed)?.reason).toBeUndefined()
  })
})
