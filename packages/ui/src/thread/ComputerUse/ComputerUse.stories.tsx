import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { chord, keys } from '../../foundations/keys'
import { ComputerPhase } from '../../foundations/vocabulary'
import { COMPUTER_ASK, COMPUTER_ASK_LONG, COMPUTER_LATEST, COMPUTER_LATEST_TALL } from '../../fixtures/computer'
import { States } from '../../storybook/States'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { type ComputerAnswer, ComputerUse, type ComputerUseProps } from './ComputerUse'

const meta = {
  title: 'Thread/ComputerUse',
  component: ComputerUse,
  decorators: [threadDecorator],
  args: {
    phase: ComputerPhase.Active,
    activity: 'Computer access approved.',
    onAnswer: fn(),
    onTakeOver: fn(),
    onResume: fn(),
    onStop: fn(),
  },
} satisfies Meta<typeof ComputerUse>
export default meta
type Story = StoryObj<typeof meta>

const asking = {
  phase: ComputerPhase.Asking,
  activity: 'Waiting for you to approve computer use.',
  ask: COMPUTER_ASK,
} satisfies Partial<ComputerUseProps>

/** It asks once, whether it may use this computer for its turn: why, and what a yes lets it do. */
export const Asks: Story = {
  args: asking,
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Asks to use this computer')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Allow for this turn' }))
    await expect(args.onAnswer).toHaveBeenCalledWith({ ask: 'ask-1', allow: true })
  },
}

export const Declines: Story = {
  args: asking,
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Not now' }))
    await expect(args.onAnswer).toHaveBeenCalledWith({ ask: 'ask-1', allow: false })
  },
}

/** On a Mac, the keys that stop it from anywhere, beside the answers. */
export const AsksWithStopKeys: Story = { args: { ...asking, stopKeys: chord(keys.shift, keys.mod, 'Esc') } }

/** On Linux with more than one display, a yes can't take in the screen. */
export const NoDisplay: Story = { args: { ...asking, ask: { ...COMPUTER_ASK, display: false } } }

/** Its reason runs long: it wraps, and the answers stay in their place. */
export const LongReason: Story = { args: { ...asking, ask: COMPUTER_ASK_LONG, stopKeys: chord(keys.shift, keys.mod, 'Esc') } }

/** What the person answered, at once, while the session takes it. */
export const Allowed: Story = { args: { ...asking, answered: { ask: 'ask-1', allow: true } } }

export const Declined: Story = { args: { ...asking, answered: { ask: 'ask-1', allow: false } } }

/** The answer couldn't be taken: the ask is back, with why. */
export const AnswerRefused: Story = { args: { ...asking, error: 'The computer session changed. Check its current state and try again.' } }

const session = { phase: ComputerPhase.Active } satisfies Partial<ComputerUseProps>

/** At work, in the foreground: what it does, Take over and Stop. */
export const AtWork: Story = { args: { ...session, activity: 'Using Writer in the foreground.' } }

/** On a Mac, Stop's keys from anywhere. */
export const StopKeys: Story = {
  args: { ...session, activity: 'Using Writer in the foreground.', stopKeys: chord(keys.shift, keys.mod, 'Esc') },
}

/** Its last picture, which opens full size. */
export const Observed: Story = {
  args: { ...session, activity: 'Observed Reader.', latest: COMPUTER_LATEST },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'View the latest view of Reader full size' }))
    await expect(within(canvasElement.ownerDocument.body).findByRole('dialog', { name: 'Latest view of Reader' })).resolves.toBeTruthy()
  },
}

/** A window taller than wide keeps its shape, in the same place. */
export const ObservedTall: Story = { args: { ...session, activity: 'Observed Simulator.', latest: COMPUTER_LATEST_TALL } }

/** The whole display. */
export const Display: Story = { args: { ...session, activity: 'Using the primary display in the foreground.' } }

/** Take over, pressed: on its way. */
export const TakingOver: Story = {
  args: { ...session, phase: ComputerPhase.Paused, activity: 'Observed Reader.', pending: 'Taking over…' },
}

/** The person has control: Resume hands it back. */
export const TakenOver: Story = { args: { ...session, phase: ComputerPhase.Paused, activity: 'You have control.' } }

/** A press the session refused. */
export const PressRefused: Story = {
  args: { ...session, activity: 'Observed Reader.', error: 'Althar could not reach the computer session.' },
}

/** Ended, and why. */
export const Stopped: Story = { args: { ...session, phase: ComputerPhase.Stopped, activity: 'The task’s turn ended.' } }

/** As the window drives it: an answer folds the ask at once, and the session takes it a moment later. */
function Playing() {
  const [answered, setAnswered] = useState<ComputerAnswer>()
  const [phase, setPhase] = useState(ComputerPhase.Asking)
  const answer = (given: ComputerAnswer) => {
    setAnswered(given)
    setPhase(ComputerPhase.Active)
  }
  return phase === ComputerPhase.Asking || answered === undefined ? (
    <ComputerUse phase={phase} activity="Waiting for you to approve computer use." ask={COMPUTER_ASK} onAnswer={answer} />
  ) : (
    <ComputerUse
      phase={phase}
      activity="Computer access approved."
      onTakeOver={() => setPhase(ComputerPhase.Paused)}
      onResume={() => setPhase(ComputerPhase.Active)}
      onStop={() => setPhase(ComputerPhase.Stopped)}
    />
  )
}

export const Plays: Story = {
  render: () => <Playing />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Allow for this turn' }))
    await userEvent.click(c.getByRole('button', { name: 'Take over' }))
    await expect(c.getByRole('button', { name: 'Resume' })).toBeInTheDocument()
  },
}

export const AllStates: Story = {
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'asks', node: <ComputerUse {...args} {...Asks.args} /> },
        { state: 'with stop keys', node: <ComputerUse {...args} {...AsksWithStopKeys.args} /> },
        { state: 'no display', node: <ComputerUse {...args} {...NoDisplay.args} /> },
        { state: 'long reason', node: <ComputerUse {...args} {...LongReason.args} /> },
        { state: 'refused', node: <ComputerUse {...args} {...AnswerRefused.args} /> },
        { state: 'allowed', node: <ComputerUse {...args} {...Allowed.args} /> },
        { state: 'declined', node: <ComputerUse {...args} {...Declined.args} /> },
        { state: 'at work', node: <ComputerUse {...args} {...AtWork.args} /> },
        { state: 'observed', node: <ComputerUse {...args} {...Observed.args} /> },
        { state: 'observed, tall', node: <ComputerUse {...args} {...ObservedTall.args} /> },
        { state: 'taking over', node: <ComputerUse {...args} {...TakingOver.args} /> },
        { state: 'taken over', node: <ComputerUse {...args} {...TakenOver.args} /> },
        { state: 'press refused', node: <ComputerUse {...args} {...PressRefused.args} /> },
        { state: 'stopped', node: <ComputerUse {...args} {...Stopped.args} /> },
      ]}
    />
  ),
}
