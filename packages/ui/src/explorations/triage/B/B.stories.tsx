import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'

import { CallCard } from '../../../board/CallCard/CallCard'
import { Prose } from '../../../thread/Turn/Turn'
import { Phase } from '../model'
import { Moments } from '../parts/Moments'
import { RunningCard } from '../parts/RunningCard'
import { liveOf, momentsOf, WAIT, type Draw } from '../parts/sheet'
import { Asked, CarriesOn, FirstStep, Groundwork } from '../parts/Threads'
import { APPROACH_SAID, ASKED, DUE, TASK } from '../world'
import { CheckpointLine } from './CheckpointLine'

/*
 * B. Inline, minimal. The lead says its approach in its own words, as it
 * would anyway, and the checkpoint is one quiet line after it: how many
 * things it is assuming, and when it carries on. Review opens the list. The
 * running card carries most of the signal.
 */

const noop = () => {}

const draw: Draw =
  ({ assumptions, still, open }) =>
  (c, on) => {
    const line = (
      <CheckpointLine
        assumptions={assumptions}
        checkpoint={c}
        on={on}
        wait={WAIT}
        due={DUE}
        still={still}
        defaultOpen={open}
        also={c.phase === Phase.Asking || c.phase === Phase.Answered}
      />
    )
    const turn = (() => {
      if (c.phase === Phase.Looking) return null
      if (c.phase === Phase.Asking || c.phase === Phase.Answered)
        return <Asked answered={c.phase === Phase.Answered} onAnswer={on.answer} also={line} />
      return (
        <>
          <Prose>{APPROACH_SAID}</Prose>
          {line}
          {c.phase === Phase.Continued && <CarriesOn />}
        </>
      )
    })()
    return {
      running: <RunningCard {...TASK} checkpoint={c} assumptions={assumptions} wait={WAIT} due={DUE} still={still} onOpen={noop} />,
      yours: c.phase === Phase.Asking ? <CallCard {...ASKED.call} onOpen={noop} /> : undefined,
      thread: (
        <>
          <FirstStep />
          <Groundwork busy={c.phase === Phase.Looking}>{turn}</Groundwork>
        </>
      ),
    }
  }

const NOTES = {
  empty: 'Nothing is added: the approach is in the lead’s own words, and the card goes from looking around to Implement.',
  one: 'Shown opened with Review. Closed, it is the same line as with three.',
  three: 'One line in the thread. The card on the board says the same, so it is seen from either.',
}

const meta = {
  title: 'Explorations/Triage checkpoint/B · Inline line',
  parameters: { layout: 'padded', controls: { disable: true } },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** The clock runs: open it, correct one, hold it, carry on; then answer the question. */
export const Try: Story = {
  render: () => <Moments moments={liveOf(draw)} live />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const live = within(c.getByRole('region', { name: 'Try it' }))
    await userEvent.click(live.getByRole('button', { name: /Review/ }))
    await userEvent.click(live.getByRole('button', { name: 'No, correct assumption 1' }))
    await expect(live.getByText('paused while you write')).toBeInTheDocument()
    await userEvent.type(live.getByRole('textbox', { name: /instead/ }), 'Refunds get their own budget{Enter}')
    await expect(live.getByText('· 1 corrected')).toBeInTheDocument()
    await userEvent.click(live.getByRole('button', { name: 'Hold' }))
    await expect(live.getByText('held by you')).toBeInTheDocument()
    await userEvent.click(live.getAllByRole('button', { name: 'Continue' })[0] ?? document.body)
    await expect(live.getByText('Assumed 3 things')).toBeInTheDocument()

    const asked = within(c.getByRole('region', { name: 'Try a question' }))
    await userEvent.click(asked.getByRole('radio', { name: /Refuse with 429/ }))
    await userEvent.click(asked.getByRole('button', { name: /Answer/ }))
    await expect(asked.getByText(/carried on with your answer/)).toBeInTheDocument()
  },
}

/** Every moment, on paper. */
export const Light: Story = { render: () => <Moments moments={momentsOf(draw, NOTES)} /> }

/** Every moment, in the exploration's provisional dark. */
export const Dark: Story = { render: () => <Moments moments={momentsOf(draw, NOTES)} dark /> }
