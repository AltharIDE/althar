import type { Meta, StoryObj } from '@storybook/react-vite'

import { fn } from 'storybook/test'

import { OPUS, UNKNOWN_MODEL } from '../../fixtures/models'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { Cite, FileRef } from '../Inline/Inline'
import { Prose, Turn } from './Turn'
import { States, statesOn } from '../../storybook/States'

const meta = {
  title: 'Thread/Turn',
  component: Turn,
  decorators: [threadDecorator],
  args: {
    who: OPUS,
    at: '2h ago',
    children: (
      <Prose>Refunds now share the partner budget with charges and answer 429 with Retry-After in seconds. Tests and lint pass.</Prose>
    ),
  },
} satisfies Meta<typeof Turn>
export default meta
type Story = StoryObj<typeof meta>

export const Agent: Story = {}
export const Coordinator: Story = {
  args: {
    who: { name: 'Coordinator' },
    children: <Prose>Task 432, from MER-231. This is the plan; change anything before it starts.</Prose>,
  },
}
/** Copy and Quote, which otherwise wait for hover or focus. */
export const WithActions: Story = { args: { actions: '2.4k tokens', forceActions: true, copy: 'Done with the reference.', onQuote: fn() } }
/** A continuation: no name line. */
export const Bare: Story = { args: { bare: true } }
export const WithReferences: Story = {
  args: {
    children: (
      <Prose>
        Charges apply the limit in <FileRef path="src/charges/limit.ts" line={42} />; the refund router was added after and never wrapped. I
        will share the partner’s bucket, since the spec counts both against one limit
        <Cite n={1}>
          <b>rate-limits.md</b> · “Refunds and charges draw on one budget per partner.”
        </Cite>
        . Refund writes stay fail-fast, not queued
        <Cite n={2}>
          <b>Knowledge · canonical</b> · Refund writes are fail-fast, not queued. Decided on task 402.
        </Cite>
        .
      </Prose>
    ),
  },
}
export const Dim: Story = {
  args: { bare: true, children: <Prose dim>Leaving it alone is a yes: it starts when the count runs out.</Prose> },
}
/** A model with no mark: its name alone. */
export const NoMark: Story = { args: { who: UNKNOWN_MODEL } }

export const AllStates: Story = {
  parameters: statesOn({
    hover: '[class*="actions"] button:first-child',
    focus: '[class*="actions"] button:last-of-type',
    pressed: '[class*="actions"] button:first-child',
  }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'a model', node: <Turn {...args} /> },
        { state: 'the coordinator', node: <Turn {...args} who={{ name: 'Coordinator' }} /> },
        { state: 'no lab', node: <Turn {...args} who={UNKNOWN_MODEL} /> },
        { state: 'bare', node: <Turn {...args} bare /> },
        { state: 'actions', node: <Turn {...args} actions="2.4k tokens" forceActions copy="Done." onQuote={() => {}} /> },
        {
          state: 'copy, hover',
          force: 'hover',
          node: <Turn {...args} actions="2.4k tokens" forceActions copy="Done." onQuote={() => {}} />,
        },
        {
          state: 'quote, focus',
          force: 'focus',
          node: <Turn {...args} actions="2.4k tokens" forceActions copy="Done." onQuote={() => {}} />,
        },
        { state: 'copy only', node: <Turn {...args} actions="2.4k tokens" forceActions copy="Done." /> },
      ]}
    />
  ),
}
