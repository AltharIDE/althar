import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { BETTER, FEATURES, FOLLOW, LEAD, RELEASE_0_10, RELEASE_0_9, RELEASES } from '../../fixtures/whatsNew'
import { WhatsNew } from './WhatsNew'

/*
 * What's new after an update: from the release before, and from two before;
 * a release whose lead has no picture; narrow; and dark.
 */

const meta = {
  title: 'Screens/WhatsNew',
  component: WhatsNew,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div style={{ height: '100vh' }}>
        <Story />
      </div>
    ),
  ],
  args: {
    release: RELEASE_0_10,
    from: '0.9.0',
    lead: LEAD,
    features: FEATURES,
    better: BETTER,
    follow: FOLLOW,
    releases: RELEASES,
    more: { href: 'https://althar.ai/changelog', from: '0.7.0' },
    onComing: fn(),
  },
} satisfies Meta<typeof WhatsNew>
export default meta
type Story = StoryObj<typeof meta>

/** Updated from 0.9.0: the jump, the lead drawn, the tiles, what feels better, where to follow, and every release. */
export const FromTheReleaseBefore: Story = {
  play: async ({ args, canvasElement }) => {
    const page = within(canvasElement)
    await expect(page.getByLabelText('Updated from 0.9.0 to 0.10.0')).toBeInTheDocument()
    await expect(page.getByRole('heading', { level: 1, name: /^Your own host,\s+your own workers$/ })).toBeInTheDocument()
    await expect(page.getByRole('link', { name: /Join the Discord/ })).toHaveAttribute('href', 'https://discord.gg/QA2g8MwKda')
    await userEvent.click(page.getByRole('button', { name: 'See what’s coming next' }))
    await expect(args.onComing).toHaveBeenCalledOnce()
  },
}

/** Updated from 0.8.0: 0.9.0 is new to the person too, and says so. */
export const FromTwoBefore: Story = {
  args: { from: '0.8.0' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('New since 0.8.0')).toBeInTheDocument()
  },
}

/** A release whose lead has no picture and whose features are drawn by none: the rest of what's new a line each. */
export const PlainRelease: Story = {
  args: {
    release: RELEASE_0_9,
    from: '0.8.0',
    lead: { title: 'Undo, files and all', why: 'Take back a message you sent a task in its own worktree.' },
    features: [],
    also: [
      'Markdown files open rendered, with what changed marked.',
      'Steer or queue: choose what a message sent while an agent works does.',
    ],
    releases: RELEASES.slice(1),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('heading', { name: 'Also in 0.9.0' })).toBeInTheDocument()
    await expect(within(canvasElement).getByText(/Markdown files open rendered/)).toBeInTheDocument()
  },
}

export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: 880, height: '100vh' }}>
        <Story />
      </div>
    ),
  ],
}

export const Dark: Story = { globals: { theme: 'dark' } }
