import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { ChangeState } from '../../foundations/vocabulary'
import { GITHUB } from '../../fixtures/outputs'
import { ChangeSet } from '../../outputs/ChangeSet/ChangeSet'
import { States, statesParameters } from '../../storybook/States'
import { NextSteps } from '../NextStep/NextStep'
import { MergeButton } from './MergeButton'

const meta = {
  title: 'Primitives/MergeButton',
  component: MergeButton,
  args: { children: 'Accept and merge', onMerge: fn(), onBypassQueue: fn() },
  decorators: [
    (Story) => (
      <div style={{ minHeight: 220, padding: 16 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MergeButton>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const NoBypassPermission: Story = { args: { onBypassQueue: undefined } }
export const PermissionUnknown: Story = { args: { onBypassQueue: undefined } }
export const NoQueue: Story = { args: { onBypassQueue: undefined } }
export const Busy: Story = { args: { busy: true, children: 'Merging' } }
export const Disabled: Story = { args: { disabled: true } }
export const AlreadyQueued: Story = { args: { queued: true } }
export const QueuedWithoutPermission: Story = { args: { queued: true, onBypassQueue: undefined } }
export const Settled: Story = { args: { onMerge: undefined, onBypassQueue: undefined } }

export const MenuOpen: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Other ways to merge' }))
    await expect(within(document.body).getByRole('menuitem', { name: 'Merge without queue' })).toBeVisible()
  },
}

export const Keyboard: Story = {
  play: async ({ args, canvasElement }) => {
    const more = within(canvasElement).getByRole('button', { name: 'Other ways to merge' })
    more.focus()
    await userEvent.keyboard('{ArrowDown}')
    await within(document.body).findByRole('menu')
    await userEvent.keyboard('{Escape}')
    await expect(more).toHaveFocus()
    await expect(args.onMerge).not.toHaveBeenCalled()
    await expect(args.onBypassQueue).not.toHaveBeenCalled()
  },
}

const pr = [{ repo: 'meridian/api', number: 1191, url: 'https://github.com/meridian/api/pull/1191', files: [] }]

export const OnTask: Story = {
  render: (args) => (
    <div style={{ maxWidth: 680 }}>
      <ChangeSet
        state={ChangeState.Ready}
        host={GITHUB}
        prs={pr}
        target="main"
        needs={[{ kind: 'merge_queue', state: 'met' }]}
        actions={<MergeButton {...args} />}
      />
    </div>
  ),
}
export const Refused: Story = {
  render: (args) => (
    <div style={{ maxWidth: 680 }}>
      <ChangeSet
        state={ChangeState.Ready}
        host={GITHUB}
        prs={pr}
        error="GitHub no longer allows you to bypass this merge queue. Use the merge queue instead."
        actions={<MergeButton {...args} onBypassQueue={undefined} />}
      />
    </div>
  ),
}
export const Narrow: Story = {
  render: (args) => (
    <div style={{ width: 280 }}>
      <ChangeSet state={ChangeState.Ready} host={GITHUB} prs={pr} actions={<MergeButton {...args} />} />
    </div>
  ),
}

/** Whole change cards: requirements and terminal states keep their status and offer only their available actions. */
export const WorkflowStates: Story = {
  render: (args) => (
    <States
      size="thread"
      cells={[
        {
          state: 'Ready, queue available',
          node: (
            <ChangeSet
              state={ChangeState.Ready}
              host={GITHUB}
              prs={pr}
              target="main"
              needs={[{ kind: 'merge_queue', state: 'met' }]}
              actions={<MergeButton {...args} />}
            />
          ),
        },
        {
          state: 'Draft',
          node: <ChangeSet state={ChangeState.Draft} host={GITHUB} prs={pr} needs={[{ kind: 'draft', state: 'unmet' }]} />,
        },
        {
          state: 'Checks running',
          node: <ChangeSet state={ChangeState.Ready} host={GITHUB} prs={pr} needs={[{ kind: 'checks', state: 'waiting' }]} />,
        },
        {
          state: 'Checks failed',
          node: <ChangeSet state={ChangeState.Ready} host={GITHUB} prs={pr} needs={[{ kind: 'checks', state: 'unmet' }]} />,
        },
        {
          state: 'Queued, bypass allowed',
          node: <ChangeSet state={ChangeState.Queued} host={GITHUB} prs={pr} actions={<MergeButton {...args} queued />} />,
        },
        { state: 'Queued, no bypass', node: <ChangeSet state={ChangeState.Queued} host={GITHUB} prs={pr} /> },
        {
          state: 'Permission revoked',
          node: (
            <ChangeSet
              state={ChangeState.Ready}
              host={GITHUB}
              prs={pr}
              error="GitHub no longer allows you to bypass this merge queue."
              actions={<MergeButton {...args} onBypassQueue={undefined} />}
            />
          ),
        },
        { state: 'Merged', node: <ChangeSet state={ChangeState.Merged} host={GITHUB} prs={pr} /> },
      ]}
    />
  ),
}

/** The same action at rest, with a pointer, from the keyboard, pending, queued, and on a board card. */
export const AllStates: Story = {
  parameters: statesParameters,
  render: (args) => (
    <States
      size="wide"
      cells={[
        ...['rest', 'hover', 'focus', 'pressed'].map((state) => ({ state, node: <MergeButton {...args} /> })),
        { state: 'No permission', node: <MergeButton {...args} onBypassQueue={undefined} /> },
        { state: 'Permission unknown', node: <MergeButton {...args} onBypassQueue={undefined} /> },
        { state: 'No queue', node: <MergeButton {...args} onBypassQueue={undefined} /> },
        {
          state: 'Merging',
          node: (
            <MergeButton {...args} busy>
              Merging
            </MergeButton>
          ),
        },
        { state: 'Disabled', node: <MergeButton {...args} disabled /> },
        { state: 'In the queue', node: <MergeButton {...args} queued /> },
        {
          state: 'Board card',
          node: (
            <NextSteps>
              <MergeButton {...args} strip />
            </NextSteps>
          ),
        },
        {
          state: 'Board card, merging',
          node: (
            <NextSteps>
              <MergeButton {...args} strip busy>
                Merging
              </MergeButton>
            </NextSteps>
          ),
        },
      ]}
    />
  ),
}
