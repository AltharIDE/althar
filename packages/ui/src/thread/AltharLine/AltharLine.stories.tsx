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

/** An errand's lines in the thread, in plain words: kept, on hold (two ways), resumed, a step failing, called off. */
export const ErrandLines: Story = {
  render: () => (
    <States
      size="thread"
      cells={[
        {
          state: 'on hold: a wait Althar can’t watch',
          node: (
            <AltharLine>
              Errand on hold: tag v0.9.0 — Althar can’t tell when it’s merged. Ask for it again to keep it another way.
            </AltharLine>
          ),
        },
        {
          state: 'on hold: two waits it can’t watch',
          node: (
            <AltharLine>
              Errand on hold: merge the 0.9.0 pull request, then tag v0.9.0 — Althar can’t tell when it’s open and its checks pass. Ask for
              it again to keep it another way.
            </AltharLine>
          ),
        },
        {
          state: 'on hold: an objection',
          node: (
            <AltharLine>
              Errand on hold: merge the 0.9.0 pull request, then tag v0.9.0 — #958 went back to a draft after you asked. Say go ahead to
              continue.
            </AltharLine>
          ),
        },
        {
          state: 'resumed',
          node: <AltharLine>Errand resumed: merge the 0.9.0 pull request once it’s open and its checks pass, then tag v0.9.0</AltharLine>,
        },
        {
          state: 'a step failed',
          node: <AltharLine tone="warning">Couldn’t do this: merge the 0.9.0 pull request — failed: The head moved.</AltharLine>,
        },
        {
          state: 'called off by the person',
          node: <AltharLine>Errand called off: merge the 0.9.0 pull request, then tag v0.9.0</AltharLine>,
        },
        {
          state: 'called off, with why',
          node: (
            <AltharLine>
              Errand called off: merge the 0.9.0 pull request, then tag v0.9.0 — #958 was closed on GitHub, so it isn’t merged
            </AltharLine>
          ),
        },
        { state: 'the last step done: the errand is done', node: <AltharLine>Merged #958. Errand done</AltharLine> },
      ]}
    />
  ),
}
