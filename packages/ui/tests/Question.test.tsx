import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DATABASE, FIRST_PARTNER, OVER_LIMIT, WAITING, WHO_HEARS } from '../src/fixtures/meridian'
import { Question, questionText } from '../src/thread/Question/Question'

const form = () => screen.getByRole('form', { name: /^Needs your answer/ })
/* past the microtask that moves focus to the line */
const settle = () => act(async () => {})

describe('Question, keys', () => {
  it('ignores keys with a modifier, keys past the options, and keys typed into a field', () => {
    render(<Question parts={[OVER_LIMIT]} />)
    fireEvent.keyDown(form(), { key: '2', metaKey: true })
    fireEvent.keyDown(form(), { key: '7' })
    fireEvent.keyDown(form(), { key: 'x' })
    fireEvent.keyDown(screen.getByRole('textbox', { name: questionText.otherField }), { key: '1' })
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked()
  })

  it('picks something else with its key and puts focus in its field', () => {
    render(<Question parts={[OVER_LIMIT]} defaultPick={{ 'over-limit': { optionIds: ['refuse'] } }} />)
    fireEvent.keyDown(form(), { key: '3' })
    expect(screen.getByRole('radio', { name: questionText.other })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Refuse/ })).not.toBeChecked()
    expect(screen.getByRole('textbox', { name: questionText.otherField })).toHaveFocus()
  })

  it('names each option by what it is, and describes it by what it means', () => {
    render(<Question parts={[DATABASE]} />)
    const postgres = screen.getByRole('radio', { name: 'Postgres, beside refunds' })
    expect(postgres).toHaveAccessibleDescription(DATABASE.options[0]?.note ?? '')
    expect(screen.getByText(DATABASE.options[1]?.note ?? '')).toBeVisible()
  })

  it('with several questions, picks only in the one with focus', () => {
    render(<Question parts={[DATABASE, WAITING]} />)
    fireEvent.keyDown(screen.getByRole('button', { name: /Answer/ }), { key: '1' })
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked()
    const [, wait] = screen.getAllByRole('radiogroup')
    if (!wait) throw new Error('no second question')
    fireEvent.keyDown(wait.querySelector('input') ?? wait, { key: '2' })
    expect(screen.getByRole('radio', { name: 'An hour' })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Postgres/ })).not.toBeChecked()
  })

  it('toggles several picks, and their own words, with keys', () => {
    const onAnswer = vi.fn()
    render(<Question parts={[WHO_HEARS]} onAnswer={onAnswer} />)
    fireEvent.keyDown(form(), { key: '1' })
    fireEvent.keyDown(form(), { key: '3' })
    fireEvent.keyDown(form(), { key: '1' })
    fireEvent.keyDown(form(), { key: '4' })
    const words = screen.getByRole('textbox', { name: questionText.otherField })
    expect(words).toHaveFocus()
    expect(screen.getByRole('checkbox', { name: questionText.other })).toBeChecked()
    fireEvent.change(words, { target: { value: '  Finance, once a day  ' } })
    fireEvent.submit(form())
    expect(onAnswer).toHaveBeenCalledWith({ notify: { optionIds: ['oncall'], words: 'Finance, once a day' } })
  })

  it('leaves out own words that are switched off or empty', () => {
    const onAnswer = vi.fn()
    render(<Question parts={[WHO_HEARS]} onAnswer={onAnswer} defaultPick={{ notify: { optionIds: ['success'], words: 'Finance' } }} />)
    expect(screen.getByRole('checkbox', { name: questionText.other })).toBeChecked()
    fireEvent.keyDown(form(), { key: '4' })
    expect(screen.getByRole('checkbox', { name: questionText.other })).not.toBeChecked()
    fireEvent.submit(form())
    expect(onAnswer).toHaveBeenLastCalledWith({ notify: { optionIds: ['success'] } })
  })

  it('ignores keys and Enter while the answer is on its way', () => {
    const onAnswer = vi.fn()
    render(<Question parts={[OVER_LIMIT]} answer={null} answering onAnswer={onAnswer} />)
    fireEvent.keyDown(form(), { key: '1' })
    fireEvent.submit(form())
    expect(screen.getByRole('radio', { name: /Refuse/ })).not.toBeChecked()
    expect(onAnswer).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: questionText.otherField })).toBeDisabled()
  })
})

describe('Question, what is missing', () => {
  it('says each kind of question needs its own kind of answer', () => {
    render(
      <Question
        parts={[{ ...DATABASE, words: false }, { ...WHO_HEARS, words: false }, FIRST_PARTNER, { ...WHO_HEARS, id: 'notify-words' }]}
      />,
    )
    fireEvent.submit(form())
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual([
      questionText.missingPick,
      questionText.missingManyPick,
      questionText.missingWords,
      questionText.missingMany,
    ])
    expect(screen.queryAllByRole('radio', { name: questionText.other })).toHaveLength(0)
    expect(screen.getByRole('radio', { name: /Postgres/ })).toHaveFocus()
    const words = screen.getByRole('textbox', { name: FIRST_PARTNER.question })
    expect(words).toHaveAttribute('aria-invalid', 'true')
    fireEvent.change(words, { target: { value: 'Acme' } })
    expect(words).not.toHaveAttribute('aria-invalid')
    expect(screen.getAllByRole('alert')).toHaveLength(3)
  })

  it('counts something else picked with nothing written as no answer', () => {
    const onAnswer = vi.fn()
    render(<Question parts={[OVER_LIMIT]} onAnswer={onAnswer} />)
    fireEvent.click(screen.getByRole('radio', { name: questionText.other }))
    fireEvent.change(screen.getByRole('textbox', { name: questionText.otherField }), { target: { value: '   ' } })
    fireEvent.submit(form())
    expect(onAnswer).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(questionText.missing)
  })

  it('names several questions by the count, and none above them when the agent said nothing', () => {
    const { container } = render(<Question parts={[DATABASE, WAITING]} />)
    expect(form()).toHaveAccessibleName('Needs your answer · 2 questions')
    expect(container.querySelector('p')?.textContent).toBe('Which database should the refund queue live in?')
  })
})

describe('Question, answered and withdrawn', () => {
  it('says each answer as one phrase, an id it can’t name as itself, and a question left out as not answered', () => {
    render(
      <Question
        parts={[DATABASE, WAITING, WHO_HEARS]}
        defaultAnswer={{
          store: { optionIds: ['cockroach'] },
          notify: { optionIds: ['partner', 'success'], words: 'Finance' },
        }}
      />,
    )
    expect(screen.getByText('cockroach')).toBeInTheDocument()
    expect(screen.getByText('Not answered')).toBeInTheDocument()
    expect(screen.getByText('The partner, Partner success and Finance')).toBeInTheDocument()
  })

  it('offers Undo once, on the first line, and asks again with what was picked', () => {
    const onUndo = vi.fn()
    const onAnswer = vi.fn()
    render(<Question parts={[DATABASE, WAITING]} onAnswer={onAnswer} onUndo={onUndo} />)
    fireEvent.click(screen.getByRole('radio', { name: /Redis/ }))
    const [, waitWords] = screen.getAllByRole('textbox', { name: questionText.otherField })
    if (!waitWords) throw new Error('no field for the second question')
    fireEvent.change(waitWords, { target: { value: 'Until the next payout run' } })
    fireEvent.submit(form())
    const answer = { store: { optionIds: ['redis'] }, wait: { optionIds: [], words: 'Until the next payout run' } }
    expect(onAnswer).toHaveBeenCalledWith(answer)
    expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onUndo).toHaveBeenCalledWith(answer)
    expect(screen.getByRole('radio', { name: /Redis/ })).toBeChecked()
    expect(screen.getAllByRole('textbox', { name: questionText.otherField })[1]).toHaveValue('Until the next payout run')
  })

  it('moves focus to the first line when it is withdrawn while you are in it', async () => {
    const { rerender } = render(<Question parts={[DATABASE, WAITING]} />)
    const field = screen.getAllByRole('textbox', { name: questionText.otherField })[0]
    act(() => field?.focus())
    expect(screen.getByRole('radio', { name: questionText.other, checked: true })).toBeInTheDocument()
    rerender(<Question parts={[DATABASE, WAITING]} withdrawn="the lead stopped asking" />)
    await settle()
    expect(document.activeElement).toHaveTextContent(
      'Not answered· Which database should the refund queue live in?· the lead stopped asking',
    )
  })

  it('leaves focus alone when withdrawn with focus elsewhere, and says no reason when there is none', async () => {
    const { rerender } = render(<Question parts={[OVER_LIMIT]} />)
    act(() => screen.getByRole('radio', { name: /Refuse/ }).focus())
    act(() => screen.getByRole('radio', { name: /Refuse/ }).blur())
    rerender(<Question parts={[OVER_LIMIT]} withdrawn="" />)
    await settle()
    expect(document.activeElement).toBe(document.body)
    expect(screen.getByText('Not answered').closest('div')?.textContent).toBe(
      'Not answered· Should a partner over the limit get the refund queued, or refused?',
    )
  })

  it('moves focus to the line when answered elsewhere while you are in it', async () => {
    const { rerender } = render(<Question parts={[OVER_LIMIT]} answer={null} />)
    act(() => screen.getByRole('radio', { name: /Refuse/ }).focus())
    rerender(<Question parts={[OVER_LIMIT]} answer={{ 'over-limit': { optionIds: ['queue'] } }} />)
    await settle()
    expect(document.activeElement).toHaveTextContent('Queue it and return 202')
  })

  it('draws no question when given none', () => {
    const onAnswer = vi.fn()
    render(<Question parts={[]} onAnswer={onAnswer} />)
    fireEvent.submit(form())
    expect(onAnswer).toHaveBeenCalledWith({})
  })
})

describe('Question, the page stays put', () => {
  it('moves focus without scrolling the shell, answering or missing an answer, and leaves its scroll alone', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    const scroll = vi.fn()
    const shell = document.createElement('div')
    document.body.append(shell)
    render(<Question parts={[DATABASE, WAITING]} focusOnMount />, { container: shell })
    await settle()
    fireEvent.submit(form())
    await settle()
    fireEvent.click(screen.getByRole('radio', { name: /Postgres/ }))
    fireEvent.click(screen.getByRole('radio', { name: 'An hour' }))
    fireEvent.submit(form())
    await settle()
    expect(focus).toHaveBeenCalled()
    for (const call of focus.mock.calls) expect(call[0]).toEqual({ preventScroll: true })
    expect(scroll).not.toHaveBeenCalled()
    expect(shell.scrollTop).toBe(0)
    focus.mockRestore()
  })
})

describe('questionText.join', () => {
  it('joins what was said as a phrase', () => {
    expect(questionText.join([])).toBe('')
    expect(questionText.join(['Postgres'])).toBe('Postgres')
    expect(questionText.join(['Slack', 'email'])).toBe('Slack and email')
    expect(questionText.join(['Slack', 'email', 'a page'])).toBe('Slack, email and a page')
  })
})
