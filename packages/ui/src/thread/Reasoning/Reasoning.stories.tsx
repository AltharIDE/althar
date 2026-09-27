import type { Meta, StoryObj } from '@storybook/react-vite'

import { threadDecorator } from '../../storybook/ThreadFrame'
import { Reasoning, Thinking } from './Reasoning'
import { States, statesParameters } from '../../storybook/States'

const THOUGHT =
  'Charges wrap the handler in withPartnerLimit. Refunds were added later behind their own router and never picked it up. The limiter keys by partner id, so refunds and charges should share a bucket or partners get double the budget. Check which the spec wants before writing anything.'

const meta = {
  title: 'Thread/Reasoning',
  component: Reasoning,
  decorators: [threadDecorator],
  args: { took: '14s', children: THOUGHT },
} satisfies Meta<typeof Reasoning>
export default meta
type Story = StoryObj<typeof meta>

export const Folded: Story = {}
export const Open: Story = { args: { defaultOpen: true } }
/** Before the first word: the model is thinking and has nothing to show. */
export const BeforeTheFirstWord: Story = { render: () => <Thinking>Reading the webhook delivery tests</Thinking> }

export const AllStates: Story = {
  parameters: statesParameters,
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'thinking', node: <Thinking /> },
        { state: 'thinking, saying what', node: <Thinking>Reading the webhook delivery tests</Thinking> },
        ...(['folded', 'hover', 'focus', 'pressed'] as const).map((state) => ({
          state,
          force: state === 'folded' ? undefined : state,
          node: <Reasoning {...args} />,
        })),
        { state: 'open', node: <Reasoning {...args} defaultOpen /> },
      ]}
    />
  ),
}
