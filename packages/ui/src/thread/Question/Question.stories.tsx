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
      { label: 'Refuse with 429 and Retry-After', note: 'matches charges' },
      { label: 'Queue it and return 202', note: 'conflicts with a canonical entry' },
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
    await expect(c.getByRole('button', { name: /Answer/ })).toBeDisabled()
    await userEvent.click(c.getByRole('radio', { name: /Refuse with 429/ }))
    await userEvent.click(c.getByRole('button', { name: /Answer/ }))
    await expect(args.onAnswer).toHaveBeenCalledWith('Refuse with 429 and Retry-After')
  },
}
export const InYourWords: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.type(c.getByRole('textbox', { name: /Something else/ }), 'Refuse, but log it for partner success')
    await userEvent.keyboard('{Enter}')
    await expect(args.onAnswer).toHaveBeenCalledWith('Refuse, but log it for partner success')
  },
}

export const AllStates: Story = {
  parameters: statesOn({ hover: 'fieldset label:nth-of-type(2)', focus: 'fieldset input:checked', pressed: 'button[type="submit"]' }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'nothing picked', node: <Question {...args} /> },
        { state: 'an option', node: <Question {...args} defaultPick={0} /> },
        { state: 'something else', node: <Question {...args} defaultPick={args.options.length} /> },
        { state: 'option, hover', force: 'hover', node: <Question {...args} /> },
        { state: 'option, focus', force: 'focus', node: <Question {...args} defaultPick={1} /> },
        { state: 'answer, pressed', force: 'pressed', node: <Question {...args} defaultPick={0} /> },
      ]}
    />
  ),
}
