import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { CHANGE_DRAFT, CHANGE_HELD, CHANGE_MERGED, CHANGE_ONE_REPO, CHANGE_READY } from '../../fixtures/outputs'
import { States, statesParameters } from '../../storybook/States'
import { DiffStat } from '../../primitives/FileChanges/FileChanges'
import { ChangeSet } from './ChangeSet'

const meta = {
  title: 'Outputs/ChangeSet',
  component: ChangeSet,
  decorators: [(Story) => <div style={{ maxWidth: 860 }}>{Story()}</div>],
  args: { ...CHANGE_READY, onAccept: fn(), onSendBack: fn(), onReviewDiff: fn(), onOpenFile: fn(), diffKey: 'D' },
} satisfies Meta<typeof ChangeSet>
export default meta
type Story = StoryObj<typeof meta>

/** Every check passed: accepting is yours. Two repositories merge in order. */
export const Ready: Story = {}
/** Still being checked: a draft, with the review a rule added still running. */
export const Draft: Story = { args: CHANGE_DRAFT }
/** A check waits on your call; the change waits with it. */
export const Held: Story = { args: CHANGE_HELD }
export const Merged: Story = { args: CHANGE_MERGED }
/** One repository, and the lead reviewed its own work: the card says so. */
export const OneRepositorySameReviewer: Story = { args: CHANGE_ONE_REPO }
/** Without handlers there are no actions, and files are not links. */
export const ReadOnly: Story = { args: { onAccept: undefined, onSendBack: undefined, onReviewDiff: undefined, onOpenFile: undefined } }

export const Accepting: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Accept and merge both' }))
    await expect(args.onAccept).toHaveBeenCalledOnce()
    await userEvent.click(c.getByRole('button', { name: 'Open the diff of src/auth/session.ts' }))
    await expect(args.onOpenFile).toHaveBeenCalledWith('src/auth/session.ts')
  },
}

/** Sending it back asks for a note; the lead picks it up. */
export const SendingBack: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Send back' }))
    const field = c.getByRole('textbox')
    await expect(field).toHaveFocus()
    /* sent empty, it says what is missing */
    await userEvent.click(c.getByRole('button', { name: 'Send back' }))
    await expect(args.onSendBack).not.toHaveBeenCalled()
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    await userEvent.type(field, 'Keep the old cache for one release')
    await userEvent.click(c.getByRole('button', { name: 'Send back' }))
    await expect(args.onSendBack).toHaveBeenCalledWith('Keep the old cache for one release')
    await expect(c.getByRole('button', { name: 'Accept and merge both' })).toBeInTheDocument()
  },
}

export const Cancelling: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Send back' }))
    await userEvent.keyboard('{Escape}')
    await expect(c.queryByRole('textbox')).toBeNull()
    await userEvent.click(c.getByRole('button', { name: 'Send back' }))
    await userEvent.click(c.getByRole('button', { name: 'Cancel' }))
    await expect(args.onSendBack).not.toHaveBeenCalled()
  },
}

export const AllStates: Story = {
  parameters: statesParameters,
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'ready', node: <ChangeSet {...args} /> },
        { state: 'draft', node: <ChangeSet {...args} {...CHANGE_DRAFT} /> },
        { state: 'held', node: <ChangeSet {...args} {...CHANGE_HELD} /> },
        { state: 'merged', node: <ChangeSet {...args} {...CHANGE_MERGED} /> },
        { state: 'one repository, same reviewer', node: <ChangeSet {...args} {...CHANGE_ONE_REPO} /> },
        { state: 'read only', node: <ChangeSet {...args} {...ReadOnly.args} /> },
        { state: 'accepting', node: <ChangeSet {...args} accepting /> },
        { state: 'accept failed', node: <ChangeSet {...args} error="GitHub refused the merge: meridian-web is behind main." /> },
        { state: 'a host without a mark', node: <ChangeSet {...args} host={{ name: 'Gitea' }} /> },
        {
          state: 'diff stat',
          node: (
            <span style={{ display: 'inline-flex', gap: 16 }}>
              <DiffStat add={140} del={0} />
              <DiffStat add={90} del={34} />
              <DiffStat add={10} del={40} />
              <DiffStat add={0} del={0} />
            </span>
          ),
        },
      ]}
    />
  ),
}
