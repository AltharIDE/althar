import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { TaskLaunch } from '../src/coordinator/TaskLaunch/TaskLaunch'
import { Reasoning, Thinking } from '../src/thread/Reasoning/Reasoning'
import { WorkNow } from '../src/thread/WorkedFor/WorkedFor'

/*
 * Words at work have a light passing over them: a copy of the words, drawn by its style from what the sheen carries,
 * which moves while they stand still. The copy is never text: it is read, found and copied once, as the words alone.
 */

/** The sheen over some words: what it carries, and that nothing reads it. */
const sheenIn = (words: HTMLElement) => {
  const sheen = words.querySelector<HTMLElement>('.sheen')
  return sheen === null ? null : { words: sheen.dataset.words, hidden: sheen.getAttribute('aria-hidden'), text: sheen.textContent }
}

describe('the light over words at work', () => {
  it('passes over what a model says it is thinking about, read once', () => {
    render(<Thinking>Reading the webhook tests</Thinking>)
    const words = screen.getByText('Reading the webhook tests')
    expect(sheenIn(words)).toEqual({ words: 'Reading the webhook tests', hidden: 'true', text: '' })
    expect(screen.getByRole('status')).toHaveTextContent(/^Reading the webhook tests$/)
  })

  it('passes over Thinking where it says nothing more, and over no words it can’t carry', () => {
    const { rerender } = render(<Thinking />)
    expect(sheenIn(screen.getByText('Thinking'))?.words).toBe('Thinking')
    rerender(
      <Thinking>
        <em>Reading</em>
      </Thinking>,
    )
    expect(screen.getByRole('status').querySelector('.sheen')).toBeNull()
  })

  it('passes over a thought’s heading while it is thought, and is gone once it is done', () => {
    const { rerender } = render(<Reasoning live source={'**Tracing the limiter**\n\nThe bucket is keyed by partner.'} />)
    const button = screen.getByRole('button', { name: 'Tracing the limiter' })
    expect(sheenIn(button.querySelector('.shimmer') as HTMLElement)?.words).toBe('Tracing the limiter')
    rerender(<Reasoning source={'**Tracing the limiter**\n\nThe bucket is keyed by partner.'} took="6s" />)
    expect(screen.getByRole('button').querySelector('.sheen')).toBeNull()
  })

  it('passes over the step a turn is on', () => {
    render(<WorkNow>Reading MEMORY.md</WorkNow>)
    expect(sheenIn(screen.getByText('Reading MEMORY.md'))).toEqual({ words: 'Reading MEMORY.md', hidden: 'true', text: '' })
  })

  it('passes over what a task’s draft is at', () => {
    render(
      <TaskLaunch
        task="812"
        title=""
        project="Meridian"
        picker={() => null}
        onStart={() => undefined}
        steps={[{ id: 'implement', label: 'Implement', agents: [] }]}
        drafting={{ phase: 'writing' }}
      />,
    )
    expect(sheenIn(screen.getByText('Writing the brief…'))).toEqual({ words: 'Writing the brief…', hidden: 'true', text: '' })
  })
})
