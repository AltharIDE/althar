import type { Meta, StoryObj } from '@storybook/react-vite'

import { CODEX } from '../../fixtures/models'
import { Looping } from '../../fixtures/stream'
import { States } from '../../storybook/States'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { proseClass, Turn } from '../../thread/Turn/Turn'
import { Stream } from './Stream'

const REPLY =
  'The refund router retries twice before it gives up, and the second retry ignores the partner limit. I moved the limit check into the retry path and added a test that fails on main.\n\nNext I’ll run the refund suite and then hand this to review.'

const prose = { margin: '0 0 10px', maxWidth: 560, fontSize: 'var(--prose-size)', lineHeight: 'var(--prose-lh)' }

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
      <Looping content={REPLY} />
    </div>
  ),
}

/** In an agent's turn, in the thread's prose. */
export const InATurn: Story = {
  decorators: [threadDecorator],
  render: () => (
    <Turn model={CODEX} at="now">
      <Looping content={REPLY} className={proseClass} />
    </Turn>
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

/** Already watched once, as when you come back to a thread: shown whole, no animation. */
export const Seen: Story = {
  render: () => (
    <div style={prose}>
      <Stream content={REPLY} animate={false} />
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
              <Looping content={REPLY} />
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
              <Stream content={REPLY} animate={false} />
            </div>
          ),
        },
      ]}
    />
  ),
}
