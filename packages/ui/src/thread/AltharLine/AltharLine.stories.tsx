import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { OPUS } from '../../fixtures/models'
import { ToolKind, ToolState } from '../../foundations/vocabulary'
import { States } from '../../storybook/States'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Thread } from '../Thread/Thread'
import { Tool } from '../Tool/Tool'
import { WorkLine } from '../WorkLine/WorkLine'
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

/** Something that is now the person's. */
export const Warning: Story = {
  args: {
    tone: 'warning',
    children:
      'The lead couldn’t resolve the conflict with main, in 4 files. The merge isn’t committed: it’s yours to settle, or to ask the lead again.',
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

/**
 * A pull request that the default branch moved under and a check that failed, both settled by the lead without
 * the person, for the README (brand/src/screenshots.ts, healing): Althar finds the conflict and asks, the lead
 * merges and Althar pushes it, the check fails, the lead fixes it, the checks pass. The person did nothing.
 */
export const SettledWithoutYou: Story = {
  render: () => (
    <Thread label="Refund reason, with its lead">
      <AltharLine>Opened PR #412.</AltharLine>
      <AltharLine>PR #412 conflicts with main, in 4 files. Althar asked the lead to resolve it, as the project’s rules say.</AltharLine>
      <WorkLine who={OPUS} took="2m 41s" summary="merged main, edited 4 files, ran 2 commands">
        <Tool kind={ToolKind.Run} verb="Ran" target="git merge origin/main" state={ToolState.Done} />
        <Tool kind={ToolKind.Edit} verb="Edited" target="src/refunds/router.ts" state={ToolState.Done} />
        <Tool kind={ToolKind.Run} verb="Ran" target="bun run test refunds" state={ToolState.Done} />
      </WorkLine>
      <AltharLine>The lead resolved the conflict with main, in 4 files, and pushed the merge to PR #412.</AltharLine>
      <AltharLine>Checks failed on PR #412: test.</AltharLine>
      <WorkLine who={OPUS} took="1m 52s" summary="edited 2 files, ran 3 commands">
        <Tool kind={ToolKind.Edit} verb="Edited" target="src/refunds/limit.test.ts" state={ToolState.Done} />
        <Tool kind={ToolKind.Run} verb="Ran" target="bun run test" state={ToolState.Done} />
      </WorkLine>
      <AltharLine>The checks passed on PR #412.</AltharLine>
    </Thread>
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText(/conflicts with main, in 4 files/)).toBeInTheDocument()
    await expect(c.getByText('The checks passed on PR #412.')).toBeInTheDocument()
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
        { state: 'dark', node: <AltharLine {...args} />, dark: true },
      ]}
    />
  ),
}
