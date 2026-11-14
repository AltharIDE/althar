import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'

import { States } from '../../storybook/States'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { AltharLine } from './AltharLine'

const meta = {
  title: 'Thread/AltharLine',
  component: AltharLine,
  decorators: [threadDecorator],
  args: { children: 'PR #157 conflicts with main, in 4 files. Althar asked the lead to resolve it, as the project’s rules say.' },
} satisfies Meta<typeof AltharLine>
export default meta
type Story = StoryObj<typeof meta>

/** Althar saying what the person should know, by name. */
export const Said: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Althar')).toBeInTheDocument()
  },
}

/** A task this task's lead started (ADR-097): its title opens it. */
export const StartedATask: Story = {
  args: {
    children: (
      <>
        Started <LinkButton onClick={() => undefined}>Built-in browser beside the conversation</LinkButton>
      </>
    ),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Built-in browser beside the conversation' })).toBeVisible()
  },
}

const RAW = JSON.stringify(
  {
    status: 200,
    body: {
      url: 'https://api.github.com/repos/AltharIDE/althar/pulls/698',
      html_url: 'https://github.com/AltharIDE/althar/pull/698',
      title: 'Errand notes: one short line, raw response folded',
      body: 'The note an errand step leaves was the person’s whole message and the host’s whole answer. '.repeat(8),
      user: { login: 'ninemate', url: 'https://api.github.com/users/ninemate' },
    },
  },
  null,
  2,
)

/** An errand step's note: one short line, the host's raw answer folded under Details and wrapped when open. */
export const WithDetails: Story = {
  args: {
    children: (
      <>
        Asked balazsotakomaiya to review <a href="https://github.com/AltharIDE/althar/pull/698">#698</a>
      </>
    ),
    details: RAW,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByText(/"status": 200/)).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Details' }))
    await expect(canvas.getByText(/"status": 200/)).toBeVisible()
  },
}

/** A long answer, open: it wraps at the column and keeps to a height, with no sideways scroll. */
export const LongNoteOpen: Story = {
  args: { children: 'Merged #662', details: RAW.repeat(4) },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Details' }))
    const block = await within(canvasElement).findByText(/"status": 200/)
    await expect(block.scrollWidth).toBeLessThanOrEqual(block.clientWidth)
  },
}

export const AllStates: Story = {
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'said', node: <AltharLine {...args} /> },
        {
          state: 'with a link',
          node: (
            <AltharLine>
              Opened <a href="https://github.com/acme/refunds/pull/142">PR #142</a>: Say why a refund is refused
            </AltharLine>
          ),
        },
        { state: 'warning', node: <AltharLine tone="warning">The lead couldn’t resolve the conflict with main, in 4 files.</AltharLine> },
        {
          state: 'warning, with its fix',
          node: (
            <AltharLine tone="warning">
              Claude Code is signed out. <LinkButton onClick={() => undefined}>Sign in</LinkButton>
            </AltharLine>
          ),
        },
        {
          state: 'warning, wrapping',
          node: (
            <AltharLine tone="warning">
              The lead couldn’t resolve the conflict with main, in 4 files. The merge isn’t committed: it’s yours to settle, or to ask the
              lead again.
            </AltharLine>
          ),
        },
      ]}
    />
  ),
}
