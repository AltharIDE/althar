import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { QuitQuestion } from '../src/main/quitWork'
import { QuitDialog } from '../src/renderer/features/quit/QuitDialog'
import { fakeHost } from './fixtures'

/* Quit with work under way, asked in the window: what it stops, and the person's answer to main. */

const question: QuitQuestion = { work: { leads: 2, reviews: 1, runs: 0, left: 0 }, background: true, update: '0.7.0' }

const asked = () => {
  let ask: (question: unknown) => void = () => undefined
  const answer = vi.fn()
  const host = fakeHost({
    quit: {
      onAsk: (listener) => {
        ask = listener
        return () => undefined
      },
      answer,
    },
  })
  return { host, answer, ask: (said: unknown) => act(() => ask(said)) }
}

describe('quit with work under way', () => {
  it('asks nothing until main asks, and says what it stops, what keeps working and the update that waits', () => {
    const { host, ask } = asked()
    render(<QuitDialog host={host} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    ask(question)
    screen.getByRole('dialog', { name: 'Quit Althar?' })
    screen.getByText('Quitting stops 2 leads at work and 1 review.')
    screen.getByText('Althar 0.7.0 waits for the work to finish. Quitting installs it now.')
    screen.getByRole('button', { name: 'Keep working in the background' })
  })

  it('offers no background where the edge has none, and no update where none waits', () => {
    const { host, ask } = asked()
    render(<QuitDialog host={host} />)
    ask({ ...question, background: false, update: null })
    expect(screen.queryByRole('button', { name: 'Keep working in the background' })).toBeNull()
    expect(screen.queryByText(/waits for the work/)).toBeNull()
  })

  it.each([
    ['Quit anyway', 'quit'],
    ['Keep working in the background', 'background'],
    ['Cancel', 'cancel'],
  ])('answers %s to main, and closes', async (button, said) => {
    const { host, answer, ask } = asked()
    render(<QuitDialog host={host} />)
    ask(question)
    await userEvent.click(screen.getByRole('button', { name: button }))
    expect(answer).toHaveBeenCalledExactlyOnceWith(said)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('says it may stop work where the runtime could not count it', () => {
    const { host, ask } = asked()
    render(<QuitDialog host={host} />)
    ask({ ...question, work: { leads: 0, reviews: 0, runs: 0, left: 0 } })
    screen.getByText('Quitting may stop work that is under way.')
  })

  it('closes when main says it is answered', () => {
    const { host, ask } = asked()
    render(<QuitDialog host={host} />)
    ask(question)
    ask(null)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('is nothing where the page has no way to be asked', () => {
    render(<QuitDialog host={fakeHost()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
