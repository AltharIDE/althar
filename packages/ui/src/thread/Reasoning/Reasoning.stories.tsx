import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { useFakeStream } from '../../fixtures/stream'
import { States, statesParameters } from '../../storybook/States'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { Reasoning, Thinking } from './Reasoning'

/** Thinking as Claude Code gives it: the thinking itself, its first sentence what it set out to do. */
const THOUGHT =
  'Charges wrap the handler in withPartnerLimit. Refunds were added later behind their own router and never picked it up. The limiter keys by partner id, so refunds and charges should share a bucket or partners get double the budget. Check which the spec wants before writing anything.'

/** Thinking as Codex gives it: its model’s summary, each part under a heading of its own. */
const SUMMARY = `**Checking how the refund router is wrapped**

The charge router wraps its handler in \`withPartnerLimit\`; the refund router, added later, doesn't.

**Tracing the limiter's bucket to the partner id**

The limiter keys by partner id, so refunds can share the charge bucket without a second budget.`

const meta = {
  title: 'Thread/Reasoning',
  component: Reasoning,
  decorators: [threadDecorator],
  args: { took: '14s', source: THOUGHT },
} satisfies Meta<typeof Reasoning>
export default meta
type Story = StoryObj<typeof meta>

/** Done: one line, how long it thought and what about, from its first sentence. */
export const Folded: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const row = c.getByRole('button', { name: /Thought for 14s/ })
    await expect(row).toHaveTextContent('Charges wrap the handler in withPartnerLimit')
    await userEvent.click(row)
    await waitFor(() => expect(c.getByText(/should share a bucket/)).toBeVisible())
  },
}
/** Codex’s thinking folds to its latest heading. */
export const FoldedToItsHeading: Story = { args: { source: SUMMARY, took: '6s' } }
export const Open: Story = { args: { defaultOpen: true } }
/** Before the first word: the model is thinking and has nothing to show. */
export const BeforeTheFirstWord: Story = { render: () => <Thinking>Reading the webhook delivery tests</Thinking> }

/** Thinking now: its last few lines in a quiet window under what it is on, the oldest fading out at the top. */
export const Live: Story = { args: { live: true, source: `${THOUGHT} ${THOUGHT}`, took: undefined } }
/** Thinking now, as Codex does: under its latest heading. */
export const LiveUnderItsHeading: Story = { args: { live: true, source: SUMMARY, took: undefined } }
/** Thinking, folded all the same: the lead's, as it settles a review. Its line says what it is on; it opens when asked. */
export const LiveQuiet: Story = { args: { live: true, quiet: true, source: SUMMARY, took: undefined } }

/** It streams as it thinks, then folds to its line when it moves on, and starts again. */
export const ThinkingThenFolding: Story = {
  render: function ThinkingThenFolding() {
    const [round, setRound] = useState(0)
    const { text, done } = useFakeStream(round % 2 === 0 ? SUMMARY : THOUGHT)
    const [held, setHeld] = useState(false)
    // Done, it folds; a moment later it thinks again.
    useEffect(() => {
      if (!done) return
      const fold = window.setTimeout(() => setHeld(true), 400)
      const again = window.setTimeout(() => {
        setHeld(false)
        setRound((one) => one + 1)
      }, 3600)
      return () => {
        window.clearTimeout(fold)
        window.clearTimeout(again)
      }
    }, [done])
    return <Reasoning key={round} source={text} live={!held} {...(held ? { took: '9s' } : {})} />
  },
}

export const AllStates: Story = {
  parameters: statesParameters,
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'thinking', node: <Thinking /> },
        { state: 'thinking, saying what', node: <Thinking>Reading the webhook delivery tests</Thinking> },
        { state: 'thinking, counted', node: <Thinking took="12s" /> },
        { state: 'thinking, longer than usual', node: <Thinking took="34s" slow /> },
        { state: 'live', node: <Reasoning source={THOUGHT} live /> },
        { state: 'live, under its heading', node: <Reasoning source={SUMMARY} live /> },
        { state: 'live, quiet', node: <Reasoning source={SUMMARY} live quiet /> },
        ...(['folded', 'hover', 'focus', 'pressed'] as const).map((state) => ({
          state,
          force: state === 'folded' ? undefined : state,
          node: <Reasoning {...args} />,
        })),
        { state: 'folded, to its heading', node: <Reasoning source={SUMMARY} took="6s" /> },
        { state: 'under a second', node: <Reasoning source={THOUGHT} /> },
        { state: 'open', node: <Reasoning {...args} defaultOpen /> },
      ]}
    />
  ),
}
