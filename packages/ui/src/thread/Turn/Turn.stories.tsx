import type { Meta, StoryObj } from '@storybook/react-vite'

import { fn } from 'storybook/test'

import { OPUS, UNKNOWN_MODEL } from '../../fixtures/models'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { Cite, FileRef } from '../Inline/Inline'
import { Prose, Turn } from './Turn'
import { States } from '../../storybook/States'

const meta = {
  title: 'Thread/Turn',
  component: Turn,
  decorators: [threadDecorator],
  args: {
    model: OPUS,
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
    model: undefined,
    voice: 'Coordinator',
    children: <Prose>Task 432, from MER-231. This is the plan; change anything before it starts.</Prose>,
  },
}
/** Copy and Quote, which wait for hover or focus; shown here as when hovered. */
export const WithActions: Story = {
  args: { meta: '2.4k tokens', copy: 'Done with the reference.', onQuote: fn() },
  parameters: { pseudo: { hover: ['article'] } },
}
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
export const NoMark: Story = { args: { model: UNKNOWN_MODEL } }

/* the turn is hovered or focused so its actions show; the state then lands on one of them */
const turnIn = (force: string) => `[data-force='${force}'] > article`
const action = (force: string, which: string) => `[data-force='${force}'] [class*="actions"] button:${which}`

export const AllStates: Story = {
  parameters: {
    pseudo: {
      hover: [turnIn('hover'), action('hover', 'first-child')],
      focusWithin: [`[data-force='focus'] [class*="actions"]`],
      focusVisible: [action('focus', 'last-of-type')],
      focus: [action('focus', 'last-of-type')],
      active: [turnIn('pressed'), action('pressed', 'first-child')],
    },
  },
  render: (args) => {
    /* the speaker is one of two kinds; every cell names its own */
    const said = { at: args.at, children: args.children }
    return (
      <States
        size="thread"
        cells={[
          { state: 'a model', node: <Turn {...said} model={OPUS} /> },
          { state: 'the coordinator', node: <Turn {...said} voice="Coordinator" /> },
          { state: 'no lab', node: <Turn {...said} model={UNKNOWN_MODEL} /> },
          { state: 'bare', node: <Turn {...said} model={OPUS} bare /> },
          { state: 'actions, not hovered', node: <Turn {...said} model={OPUS} meta="2.4k tokens" copy="Done." onQuote={() => {}} /> },
          {
            state: 'copy, hover',
            force: 'hover',
            node: <Turn {...said} model={OPUS} meta="2.4k tokens" copy="Done." onQuote={() => {}} />,
          },
          {
            state: 'quote, focus',
            force: 'focus',
            node: <Turn {...said} model={OPUS} meta="2.4k tokens" copy="Done." onQuote={() => {}} />,
          },
          { state: 'copy only, hover', force: 'hover', node: <Turn {...said} model={OPUS} meta="2.4k tokens" copy="Done." /> },
        ]}
      />
    )
  },
}
