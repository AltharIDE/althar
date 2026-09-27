import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'

import { Stream, Streamed } from './Stream'
import { States } from '../../storybook/States'

const REPLY =
  'The refund router retries twice before it gives up, and the second retry ignores the partner limit. I moved the limit check into the retry path and added a test that fails on main.\n\nNext I’ll run the refund suite and then hand this to review.'

const prose = { margin: '0 0 10px', maxWidth: 560, fontSize: 'var(--prose-size)', lineHeight: 'var(--prose-lh)' }

/* Restarts every few seconds, so the motion can be watched. */
function Looping() {
  const [run, setRun] = useState(0)
  useEffect(() => {
    const t = window.setTimeout(() => setRun((r) => r + 1), 9000)
    return () => window.clearTimeout(t)
  }, [run])
  return <Streamed key={run} content={REPLY} />
}

const meta = { title: 'Primitives/Stream', component: Stream, args: { content: REPLY } } satisfies Meta<typeof Stream>
export default meta
type Story = StoryObj<typeof meta>

/** A whole reply, arrived and finished. */
export const Finished: Story = {
  render: (args) => (
    <div style={prose}>
      <Stream {...args} as="p" />
    </div>
  ),
}

/** Arriving now: words released at an even pace from uneven bursts. */
export const Streaming: Story = {
  render: () => (
    <div style={prose}>
      <Looping />
    </div>
  ),
}

/** Mid-word, not done: the half-word is held back. */
export const HeldBack: Story = {
  args: { content: 'The refund router retries tw', done: false },
  render: (args) => (
    <div style={prose}>
      <Stream {...args} />
    </div>
  ),
}

/** Seen before: shows whole, no animation. */
export const Seen: Story = {
  render: () => (
    <div style={prose}>
      <Stream content={REPLY} id="story-seen" />
    </div>
  ),
}

/** Arriving, held back mid-word, finished, and seen before (shown whole at once). */
export const AllStates: Story = {
  render: () => (
    <States
      size="wide"
      cells={[
        {
          state: 'arriving',
          node: (
            <div style={prose}>
              <Looping />
            </div>
          ),
        },
        {
          state: 'held back',
          node: (
            <div style={prose}>
              <Stream content="The refund router retries tw" done={false} />
            </div>
          ),
        },
        {
          state: 'finished',
          node: (
            <div style={prose}>
              <Stream content={REPLY} />
            </div>
          ),
        },
        {
          state: 'seen',
          node: (
            <div style={prose}>
              <Stream content={REPLY} id="all-states-seen" />
            </div>
          ),
        },
      ]}
    />
  ),
}
