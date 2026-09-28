import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { threadDecorator } from '../../storybook/ThreadFrame'
import { Question } from './Question'
import { States, statesOn } from '../../storybook/States'

const meta = {
  title: 'Thread/Question',
  component: Question,
  decorators: [threadDecorator],
  args: {
    question: 'Should a partner over the limit get the refund queued, or refused?',
    options: [
      { id: 'refuse', label: 'Refuse with 429 and Retry-After', note: 'matches charges' },
      { id: 'queue', label: 'Queue it and return 202', note: 'conflicts with a canonical entry' },
    ],
    onAnswer: fn(),
  },
} satisfies Meta<typeof Question>
export default meta
type Story = StoryObj<typeof meta>

export const Asks: Story = {}
export const Answering: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: /Answer/ }))
    await expect(args.onAnswer).not.toHaveBeenCalled()
    await expect(c.getByRole('alert')).toHaveTextContent('Pick one, or write your own')
    await userEvent.click(c.getByRole('radio', { name: /Refuse with 429/ }))
    await userEvent.click(c.getByRole('button', { name: /Answer/ }))
    await expect(args.onAnswer).toHaveBeenCalledWith({ optionId: 'refuse' })
    await expect(document.activeElement).toHaveTextContent('Refuse with 429 and Retry-After')
  },
}
export const InYourWords: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.type(c.getByRole('textbox', { name: /Something else/ }), 'Refuse, but log it for partner success')
    await userEvent.keyboard('{Enter}')
    await expect(args.onAnswer).toHaveBeenCalledWith({ words: 'Refuse, but log it for partner success' })
  },
}

/** Answered, then taken back: the question asks again. */
export const Undoing: Story = {
  args: { onUndo: fn() },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.keyboard('{Tab}')
    await userEvent.keyboard('2')
    await userEvent.click(c.getByRole('button', { name: /Answer/ }))
    await expect(args.onAnswer).toHaveBeenCalledWith({ optionId: 'queue' })
    await userEvent.click(c.getByRole('button', { name: 'Undo' }))
    await expect(args.onUndo).toHaveBeenCalledWith({ optionId: 'queue' })
    await expect(c.getByRole('radiogroup')).toBeInTheDocument()
  },
}

export const AllStates: Story = {
  parameters: statesOn({
    hover: '[role=radiogroup] label:nth-of-type(2)',
    focus: '[role=radiogroup] input:checked',
    pressed: 'button[type="submit"]',
  }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'nothing picked', node: <Question {...args} /> },
        { state: 'an option', node: <Question {...args} defaultPick={{ optionId: 'refuse' }} /> },
        { state: 'something else', node: <Question {...args} defaultPick={{ words: 'Refuse, but log it' }} /> },
        { state: 'option, hover', force: 'hover', node: <Question {...args} /> },
        { state: 'option, focus', force: 'focus', node: <Question {...args} defaultPick={{ optionId: 'queue' }} /> },
        { state: 'answered', node: <Question {...args} defaultAnswer={{ optionId: 'refuse' }} onUndo={() => {}} /> },
        { state: 'answered in words', node: <Question {...args} defaultAnswer={{ words: 'Refuse, but log it for partner success' }} /> },
        { state: 'answer, pressed', force: 'pressed', node: <Question {...args} defaultPick={{ optionId: 'refuse' }} /> },
      ]}
    />
  ),
}
