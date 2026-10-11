import { act, fireEvent, render, screen } from '@testing-library/react'
import { createRef, useState } from 'react'
import { describe, expect, it, onTestFinished, vi } from 'vitest'

import { IssueDraft, issueDraftText } from '../src/coordinator/IssueDraft/IssueDraft'
import { DRAFT_GITHUB, DRAFT_LINEAR, FILED_LINEAR } from '../src/fixtures/coordinator'
import { IssueDraftState } from '../src/foundations/vocabulary'

const pending = { ...DRAFT_LINEAR, state: IssueDraftState.Pending }

describe('IssueDraft', () => {
  it('offers only the buttons it has callbacks for', () => {
    const { rerender } = render(<IssueDraft {...pending} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    rerender(<IssueDraft {...pending} onFile={vi.fn()} />)
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([issueDraftText.file])
    rerender(<IssueDraft {...pending} onFile={vi.fn()} onChange={vi.fn()} onDiscard={vi.fn()} />)
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      issueDraftText.discard,
      issueDraftText.edit,
      issueDraftText.file,
    ])
  })

  it('files, and files again after it failed, with the reason shown', () => {
    const onFile = vi.fn()
    render(<IssueDraft {...pending} state={IssueDraftState.Failed} error="Linear is down." onFile={onFile} />)
    expect(screen.getByText('Couldn’t file it on Linear. Linear is down.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: issueDraftText.fileAgain }))
    expect(onFile).toHaveBeenCalledTimes(1)
  })

  it('says it failed even without a reason', () => {
    render(<IssueDraft {...pending} state={IssueDraftState.Failed} />)
    expect(screen.getByText('Couldn’t file it on Linear.')).toBeInTheDocument()
  })

  it('ignores presses on File while it is filing', () => {
    const onFile = vi.fn()
    render(<IssueDraft {...pending} state={IssueDraftState.Filing} onFile={onFile} onChange={vi.fn()} onDiscard={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: issueDraftText.file }))
    expect(onFile).not.toHaveBeenCalled()
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('edits: an empty title is said and focused, and a save reads the labels as a list', () => {
    const onChange = vi.fn()
    render(<IssueDraft {...pending} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: issueDraftText.edit }))
    const title = screen.getByRole('textbox', { name: issueDraftText.titleLabel })
    expect(title).toHaveFocus()
    fireEvent.change(title, { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: issueDraftText.save }))
    expect(onChange).not.toHaveBeenCalled()
    expect(title).toHaveAttribute('aria-invalid', 'true')
    expect(title).toHaveAccessibleDescription(issueDraftText.titleMissing)
    fireEvent.change(title, { target: { value: '  Honour Retry-After  ' } })
    fireEvent.change(screen.getByRole('textbox', { name: issueDraftText.bodyLabel }), { target: { value: 'Body' } })
    fireEvent.change(screen.getByRole('textbox', { name: issueDraftText.labelsLabel }), { target: { value: 'a, , b ,' } })
    fireEvent.click(screen.getByRole('button', { name: issueDraftText.save }))
    expect(onChange).toHaveBeenCalledWith({ title: 'Honour Retry-After', body: 'Body', labels: ['a', 'b'] })
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: issueDraftText.edit })).toHaveFocus()
  })

  it('keeps the form open while a save is under way', async () => {
    function Saving() {
      const [saving, setSaving] = useState(false)
      const save = () => {
        setSaving(true)
        window.setTimeout(() => setSaving(false), 0)
      }
      return <IssueDraft {...pending} saving={saving} onChange={save} />
    }
    render(<Saving />)
    fireEvent.click(screen.getByRole('button', { name: issueDraftText.edit }))
    fireEvent.click(screen.getByRole('button', { name: issueDraftText.save }))
    expect(screen.getByRole('button', { name: issueDraftText.save })).toHaveAttribute('aria-busy', 'true')
    await act(() => new Promise((done) => window.setTimeout(done, 10)))
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
  })

  it('takes its own Escape, and leaves other keys alone', () => {
    const outer = vi.fn()
    /* a panel round it that hears Escape */
    render(<IssueDraft {...pending} onChange={vi.fn()} />)
    document.body.addEventListener('keydown', outer)
    onTestFinished(() => document.body.removeEventListener('keydown', outer))
    fireEvent.click(screen.getByRole('button', { name: issueDraftText.edit }))
    const form = screen.getByRole('form', { name: issueDraftText.editing })
    expect(form).toHaveAttribute('data-own-escape')
    fireEvent.keyDown(screen.getByRole('textbox', { name: issueDraftText.titleLabel }), { key: 'a' })
    expect(form).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('textbox', { name: issueDraftText.titleLabel }), { key: 'Escape' })
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
    expect(outer).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: issueDraftText.edit })).toHaveFocus()
  })

  it('folds to a line that links to the filed issue in a new tab', () => {
    render(<IssueDraft {...pending} state={IssueDraftState.Filed} issue={FILED_LINEAR} onFile={vi.fn()} />)
    const link = screen.getByRole('link', { name: /^MER-244 ?\(opens in a new tab\)$/ })
    expect(link).toHaveAttribute('href', FILED_LINEAR.href)
    expect(link).toHaveAttribute('target', '_blank')
    expect(screen.getByText('Filed on Linear as')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('folds to a quiet line once discarded', () => {
    render(<IssueDraft {...DRAFT_GITHUB} state={IssueDraftState.Discarded} onDiscard={vi.fn()} />)
    expect(screen.getByText(issueDraftText.discarded)).toBeInTheDocument()
    expect(screen.getByText(DRAFT_GITHUB.title)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('gives its root to the consumer in every state', () => {
    const ref = createRef<HTMLElement>()
    const seen: (HTMLElement | null)[] = []
    const { rerender } = render(<IssueDraft {...pending} ref={ref} data-id="d1" />)
    expect(ref.current).toHaveAttribute('data-id', 'd1')
    rerender(<IssueDraft {...pending} state={IssueDraftState.Filed} issue={FILED_LINEAR} ref={ref} data-id="d1" />)
    expect(ref.current?.tagName).toBe('ARTICLE')
    expect(ref.current).toHaveAttribute('data-id', 'd1')
    rerender(<IssueDraft {...pending} state={IssueDraftState.Discarded} ref={(node) => void seen.push(node)} />)
    expect(seen.at(-1)?.tagName).toBe('ARTICLE')
  })

  it('takes its own words', () => {
    render(<IssueDraft {...pending} onFile={vi.fn()} text={{ file: 'Déposer', kicker: (s, c) => `Brouillon · ${s} · ${c}` }} />)
    expect(screen.getByRole('button', { name: 'Déposer' })).toBeInTheDocument()
    expect(screen.getByText('Brouillon · Linear · Meridian')).toBeInTheDocument()
  })
})
