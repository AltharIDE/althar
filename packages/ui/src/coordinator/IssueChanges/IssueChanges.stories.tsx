import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { CHANGES_IN_REVIEW, CHANGES_LINEAR, COMMENTED_LINEAR } from '../../fixtures/coordinator'
import { IssueChangesState } from '../../foundations/vocabulary'
import { States, statesOn } from '../../storybook/States'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { Turn } from '../../thread/Turn/Turn'
import { IssueChanges, type IssueChangesProps } from './IssueChanges'

const meta = {
  title: 'Coordinator/IssueChanges',
  component: IssueChanges,
  decorators: [threadDecorator],
  args: { ...CHANGES_LINEAR, state: IssueChangesState.Pending, onApply: fn(), onDiscard: fn() },
} satisfies Meta<typeof IssueChanges>
export default meta
type Story = StoryObj<typeof meta>

/** The coordinator's changes to two issues, on one card: nothing changes on Linear until you apply them. */
export const Pending: Story = {
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('article', { name: 'Issue changes · Linear' })).toBeInTheDocument()
    await expect(c.getByText('Status → Done')).toBeInTheDocument()
    await expect(c.getByText('Priority → Low · Labels +perf −bug · Assignee → Ana Ruiz')).toBeInTheDocument()
    await expect(c.getByRole('link', { name: /DEV-67/ })).toHaveAttribute('target', '_blank')
    await userEvent.click(c.getByRole('button', { name: 'Apply' }))
    await expect(args.onApply).toHaveBeenCalled()
  },
}

/** Althar's offer, as a task's pull request opened, to move its issue to review. */
export const ToReview: Story = {
  args: CHANGES_IN_REVIEW,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('PR #212 opened.')).toBeInTheDocument()
    await expect(c.getByText('Status → In Review')).toBeInTheDocument()
  },
}

/** Being applied: Apply shows it, and there is nothing to throw away meanwhile. */
export const Applying: Story = {
  args: { state: IssueChangesState.Applying },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('button', { name: 'Apply' })).toHaveAttribute('aria-busy', 'true')
    await expect(c.queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument()
  },
}

/** One issue changed and one didn't: each says so, and applying again tries what didn't. */
export const Failed: Story = {
  args: {
    state: IssueChangesState.Failed,
    issues: [
      { ...CHANGES_LINEAR.issues[0]!, applied: true },
      { ...CHANGES_LINEAR.issues[1]!, applied: false, error: 'Linear has no member called Ana Ruiz on the team Meridian.' },
    ],
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Not all of it applied.')).toBeInTheDocument()
    await expect(c.getByText('Applied')).toBeInTheDocument()
    await expect(c.getByText(/no member called Ana Ruiz/)).toBeInTheDocument()
    await expect(c.getByRole('button', { name: 'Apply again' })).toBeInTheDocument()
  },
}

/** Applied: one line with each issue and what changed on it. */
export const Applied: Story = {
  args: { state: IssueChangesState.Applied },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Changed')).toBeInTheDocument()
    await expect(c.getByRole('link', { name: /DEV-142/ })).toBeInTheDocument()
    await expect(c.queryByRole('button')).not.toBeInTheDocument()
  },
}

/** A lead's comment on its task's issue, posted at once: a line with its first words. */
export const Commented: Story = {
  args: { ...COMMENTED_LINEAR, state: IssueChangesState.Applied },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Commented on')).toBeInTheDocument()
    await expect(c.getByText(/Refunds now share the charge limiter/)).toBeInTheDocument()
  },
}

/** A lead linked its pull request to its task's issue, at once. */
export const Linked: Story = {
  args: {
    state: IssueChangesState.Applied,
    issues: [{ ...CHANGES_IN_REVIEW.issues[0]!, changes: [{ field: 'link', to: 'https://github.com/meridian/api/pull/212' }] }],
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Linked the pull request to')).toBeInTheDocument()
  },
}

/** Thrown away: a quiet line, what it would have changed struck through. */
export const Discarded: Story = { args: { state: IssueChangesState.Discarded } }

/** Where the consumer gives no callbacks, there are no buttons. */
export const WithoutActions: Story = {
  args: { onApply: undefined, onDiscard: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button')).not.toBeInTheDocument()
  },
}

/** Applying folds the card to its line, and focus goes there. */
export const ApplyingFolds: Story = {
  render: function Render(args: IssueChangesProps) {
    const [state, setState] = useState(IssueChangesState.Pending)
    return <IssueChanges {...args} state={state} onApply={() => setState(IssueChangesState.Applied)} />
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Apply' }))
    await expect(c.getByText('Changed')).toBeInTheDocument()
    await waitFor(() => expect(c.getByRole('article')).toHaveFocus())
  },
}

/** Where they come from: the coordinator, asked to tidy the board. */
export const InTheConversation: Story = {
  render: (args) => (
    <>
      <Turn voice="Coordinator" at="11:40">
        DEV-67 shipped with yesterday’s release, and the export isn’t urgent any more. Here are both, for you to apply.
      </Turn>
      <IssueChanges {...args} />
    </>
  ),
}

export const AllStates: Story = {
  parameters: statesOn({ hover: 'button:last-of-type', focus: 'button:last-of-type', pressed: 'button:last-of-type' }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'pending', node: <IssueChanges {...args} /> },
        { state: 'to review', node: <IssueChanges {...args} {...CHANGES_IN_REVIEW} /> },
        { state: 'hover', node: <IssueChanges {...args} {...CHANGES_IN_REVIEW} /> },
        { state: 'focus', node: <IssueChanges {...args} {...CHANGES_IN_REVIEW} /> },
        { state: 'pressed', node: <IssueChanges {...args} {...CHANGES_IN_REVIEW} /> },
        { state: 'applying', node: <IssueChanges {...args} state={IssueChangesState.Applying} /> },
        {
          state: 'failed',
          node: (
            <IssueChanges
              {...args}
              state={IssueChangesState.Failed}
              issues={[
                { ...CHANGES_LINEAR.issues[0]!, applied: true },
                { ...CHANGES_LINEAR.issues[1]!, applied: false, error: 'Linear took too long to answer.' },
              ]}
            />
          ),
        },
        { state: 'applied', node: <IssueChanges {...args} state={IssueChangesState.Applied} /> },
        { state: 'commented', node: <IssueChanges {...args} {...COMMENTED_LINEAR} state={IssueChangesState.Applied} /> },
        { state: 'discarded', node: <IssueChanges {...args} state={IssueChangesState.Discarded} /> },
        { state: 'no actions', node: <IssueChanges {...args} onApply={undefined} onDiscard={undefined} /> },
      ]}
    />
  ),
}
