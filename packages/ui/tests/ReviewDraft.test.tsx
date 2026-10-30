import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { REVIEW_DRAFT } from '../src/fixtures/reviews'
import { Outside, ReviewDraftState, ReviewVerdict } from '../src/foundations/vocabulary'
import { ReviewDraft, reviewDraftText } from '../src/thread/ReviewDraft/ReviewDraft'

const pending = { ...REVIEW_DRAFT, state: ReviewDraftState.Pending }

describe('ReviewDraft', () => {
  it('offers only the controls it has callbacks for', () => {
    const { rerender } = render(<ReviewDraft {...pending} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.getByText('Request changes')).toBeInTheDocument()
    rerender(<ReviewDraft {...pending} onPost={vi.fn()} />)
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([reviewDraftText.post])
    rerender(<ReviewDraft {...pending} onPost={vi.fn()} onChange={vi.fn()} onDiscard={vi.fn()} />)
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      reviewDraftText.discard,
      reviewDraftText.edit,
      reviewDraftText.post,
    ])
  })

  it('says who suggests what where it doesn’t know who drafted it, and nothing of whom it posts as', () => {
    render(<ReviewDraft {...pending} drafter={undefined} as={undefined} />)
    expect(screen.getByText('The lead suggests Request changes')).toBeInTheDocument()
    expect(screen.getByText('ninemate')).toBeInTheDocument()
    expect(screen.getByText('Posts 3 of 3 comments')).toBeInTheDocument()
  })

  it('asks for a verdict before posting with none, and stops asking once one is chosen', () => {
    const onPost = vi.fn()
    const { rerender } = render(<ReviewDraft {...pending} verdict={null} outside={Outside.Fork} onPost={onPost} onVerdict={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: reviewDraftText.post }))
    expect(onPost).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(reviewDraftText.verdictMissing)
    rerender(<ReviewDraft {...pending} verdict={ReviewVerdict.Comment} outside={Outside.Fork} onPost={onPost} onVerdict={vi.fn()} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: reviewDraftText.post }))
    expect(onPost).toHaveBeenCalledTimes(1)
  })

  it('posts again after it failed or may have, and says it failed even without a reason', () => {
    const onPost = vi.fn()
    const { rerender } = render(<ReviewDraft {...pending} state={ReviewDraftState.Failed} onPost={onPost} />)
    expect(screen.getByText('Couldn’t post it on GitHub.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: reviewDraftText.postAgain }))
    rerender(<ReviewDraft {...pending} state={ReviewDraftState.Uncertain} onPost={onPost} />)
    expect(screen.getByText('This may be on GitHub already.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: reviewDraftText.postAgain }))
    expect(onPost).toHaveBeenCalledTimes(2)
  })

  it('ignores presses on Post while it is posting, and lets nothing change', () => {
    const onPost = vi.fn()
    const onKeep = vi.fn()
    render(
      <ReviewDraft {...pending} state={ReviewDraftState.Posting} onPost={onPost} onKeep={onKeep} onChange={vi.fn()} onDiscard={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: reviewDraftText.post }))
    fireEvent.click(screen.getAllByRole('switch')[0] as HTMLElement)
    expect(onPost).not.toHaveBeenCalled()
    expect(onKeep).not.toHaveBeenCalled()
  })

  it('edits each comment’s words as well as the summary', () => {
    const onChange = vi.fn()
    render(<ReviewDraft {...pending} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: reviewDraftText.edit }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Comment on src/webhooks/retry.ts:41' }), { target: { value: '  A deadline.  ' } })
    fireEvent.click(screen.getByRole('button', { name: reviewDraftText.save }))
    expect(onChange).toHaveBeenCalledWith({
      summary: REVIEW_DRAFT.summary,
      comments: [
        { id: 'c1', body: REVIEW_DRAFT.comments[0].body },
        { id: 'c2', body: 'A deadline.' },
        { id: 'c3', body: REVIEW_DRAFT.comments[2].body },
      ],
    })
  })

  it('folds once posted, with the lead’s verdict where none was chosen, and once discarded', () => {
    const { rerender } = render(
      <ReviewDraft
        {...pending}
        state={ReviewDraftState.Posted}
        verdict={null}
        suggested={ReviewVerdict.Comment}
        comments={[REVIEW_DRAFT.comments[0]]}
      />,
    )
    expect(screen.getByText('Comment')).toBeInTheDocument()
    expect(screen.getByText(/1 comment$/)).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    rerender(<ReviewDraft {...pending} state={ReviewDraftState.Discarded} />)
    expect(screen.getByText(reviewDraftText.discarded)).toBeInTheDocument()
  })

  it('takes a ref on its line as on its card', () => {
    const ref = vi.fn()
    render(<ReviewDraft {...pending} state={ReviewDraftState.Posted} ref={ref} />)
    expect(ref).toHaveBeenCalledWith(expect.any(HTMLElement))
    const held = { current: null as HTMLElement | null }
    render(<ReviewDraft {...pending} state={ReviewDraftState.Discarded} ref={held} />)
    expect(held.current).toBeInstanceOf(HTMLElement)
  })
})
