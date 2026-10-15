import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { OPUS } from '../../fixtures/models'
import { ToolKind, ToolState } from '../../foundations/vocabulary'
import { States, statesOn } from '../../storybook/States'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { Tool } from '../Tool/Tool'
import { WorkLine, WorkNote, WorkSaid } from './WorkLine'

const steps = (
  <>
    <Tool kind={ToolKind.Read} verb="Read" target="src/refunds/router.ts" state={ToolState.Done} />
    <WorkSaid source="The router already checks the window; the refusal just never says why. Adding the reason next." />
    <Tool kind={ToolKind.Edit} verb="Edited" target="src/refunds/router.ts" state={ToolState.Done} />
    <WorkNote>This task’s work is on a branch of its own now, althar/refund-reason, which stays on this Mac.</WorkNote>
    <Tool kind={ToolKind.Run} verb="Ran" target="bun run test refunds" state={ToolState.Done} />
  </>
)

const meta = {
  title: 'Thread/WorkLine',
  component: WorkLine,
  decorators: [threadDecorator],
  args: { took: '4m 12s', summary: 'edited 1 file, read 1 file, ran 1 command', children: steps },
} satisfies Meta<typeof WorkLine>
export default meta
type Story = StoryObj<typeof meta>

/** All of a round's work, one faint line; nothing under it while closed. */
export const Closed: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const row = c.getByRole('button', { name: /Worked 4m 12s/ })
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(row)
    await waitFor(() => expect(c.getByText(/The router already checks the window/)).toBeVisible())
  },
}

/** Opened: every step in order on a quiet sheet, what it said on the way among them. */
export const Open: Story = { args: { defaultOpen: true } }

/** While the lead works, the line says what it is on, in its own last words. */
export const Working: Story = {
  args: { live: true, took: '1m 12s', summary: 'Adding the reason to the refusal next' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: /Working · 1m 12s/ })).toHaveAttribute('aria-busy', 'true')
  },
}

/** At work with nothing done yet: the line alone, which doesn't open. */
export const JustStarted: Story = {
  args: { live: true, took: '4s', children: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button')).toBeNull()
  },
}

/** A round that said nothing: the line stands for it, with who worked. */
export const Quiet: Story = { args: { who: OPUS, took: '43s', summary: 'ran 7 commands' } }

export const AllStates: Story = {
  parameters: statesOn({ hover: 'button', focus: 'button', pressed: 'button' }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'closed', node: <WorkLine {...args} /> },
        { state: 'open', node: <WorkLine {...args} defaultOpen /> },
        { state: 'working', node: <WorkLine {...args} live took="1m 12s" summary="Adding the reason to the refusal next" /> },
        { state: 'just started', node: <WorkLine took="4s" live /> },
        { state: 'quiet round', node: <WorkLine {...args} who={OPUS} took="43s" summary="ran 7 commands" /> },
        { state: 'hover', node: <WorkLine {...args} /> },
        { state: 'focus', node: <WorkLine {...args} /> },
        { state: 'pressed', node: <WorkLine {...args} /> },
        { state: 'dark', node: <WorkLine {...args} defaultOpen />, dark: true },
      ]}
    />
  ),
}
