import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { SONNET } from '../../fixtures/models'
import {
  TRACK_CONFLICT,
  TRACK_DRAFTS,
  TRACK_FAILING,
  TRACK_FOUR,
  TRACK_MERGING,
  TRACK_ONE_MERGED,
  TRACK_ONE_READY,
  TRACK_QUEUED,
  TRACK_READY,
  TRACK_REFUSED,
} from '../../fixtures/outputs'
import { States, statesParameters } from '../../storybook/States'
import { CheckState } from '../../foundations/vocabulary'
import { Button } from '../../primitives/Button/Button'
import { Menu, MenuItem } from '../../primitives/Menu/Menu'
import { SplitButton } from '../../primitives/SplitButton/SplitButton'
import { ChangeTrack } from './ChangeTrack'

const accept = fn()
const ready = fn()
const one = fn()

/** As wide as it is beside what a task made; `alone`, as wide as the page gives it with nothing beside it. */
const SIDE = 360
const ALONE = 700

/** The press the change waits on, and each repository's own a menu away. */
const split = (label: string, signal: boolean, own: readonly string[], onClick = accept) => (
  <SplitButton
    variant={signal ? 'signal' : 'default'}
    moreLabel="Each on its own"
    onClick={onClick}
    menu={(trigger) => (
      <Menu trigger={trigger} label="Each on its own" align="end">
        {own.map((item) => (
          <MenuItem key={item} onSelect={one}>
            {item}
          </MenuItem>
        ))}
      </Menu>
    )}
  >
    {label}
  </SplitButton>
)

const meta = {
  title: 'Outputs/ChangeTrack',
  component: ChangeTrack,
  decorators: [(Story, { parameters }) => <div style={{ maxWidth: (parameters.width as number | undefined) ?? SIDE }}>{Story()}</div>],
  args: {
    stops: TRACK_READY,
    review: { state: CheckState.Passed, by: [SONNET] },
    actions: split('Accept and merge both', true, ['Merge engine only']),
    onReviewDiff: fn(),
    onOpenFile: fn(),
    diffKey: '⌘D',
  },
} satisfies Meta<typeof ChangeTrack>
export default meta
type Story = StoryObj<typeof meta>

/** fnt's engine !52 and frontend !27, every check passed, reviewed once for both: accepting merges engine, then frontend. */
export const Ready: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('list', { name: 'In the order they merge' })).toBeInTheDocument()
    await expect(c.getByRole('link', { name: 'Open engine !52 on GitLab' })).toBeInTheDocument()
    await expect(c.getByRole('button', { name: 'frontend’s checks: 10 checks passed' })).toBeInTheDocument()
    await expect(c.getAllByText(/Reviewed by/)).toHaveLength(1)
  },
}
/** Alone on the page: the button beside what it acts on, at its own width. */
export const ReadyAlone: Story = { parameters: { width: ALONE } }
/** Both drafts, their checks on their way: one press marks both ready, each on its own a menu away. */
export const BothDrafts: Story = {
  args: {
    stops: TRACK_DRAFTS,
    actions: split('Mark both ready for review', false, ['Mark engine ready for review', 'Mark frontend ready for review'], ready),
  },
}
/** engine ready, frontend still a draft. */
export const OneReady: Story = {
  args: { stops: TRACK_ONE_READY, actions: <Button onClick={ready}>Mark frontend ready for review</Button> },
}
/** frontend's e2e:chat failed, named on frontend's line alone; its lead is at it, so nothing to press. */
export const FailingInOne: Story = {
  args: { stops: TRACK_FAILING, actions: undefined },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'frontend’s checks: e2e:chat failed' }))
    await expect(c.getByText('bundle-size')).toBeVisible()
  },
}
/** frontend conflicts with main. */
export const ConflictInOne: Story = { args: { stops: TRACK_CONFLICT, actions: undefined } }
/** Accepted: engine merging, frontend after it. */
export const Merging: Story = {
  args: {
    stops: TRACK_MERGING,
    actions: (
      <Button variant="signal" busy>
        Accept and merge both
      </Button>
    ),
  },
}
/** engine in main's merge queue; frontend's merge waits until it lands. */
export const QueuedFirst: Story = { args: { stops: TRACK_QUEUED, actions: undefined } }
/** engine merged, frontend still open: what's left to merge. */
export const OneMerged: Story = { args: { stops: TRACK_ONE_MERGED, actions: split('Accept and merge frontend', true, []) } }
/** engine merged and GitLab refused frontend: why, on its stop; engine stays merged. */
export const Refused: Story = {
  args: { stops: TRACK_REFUSED, actions: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/^Not merged: main moved on/)).toBeInTheDocument()
  },
}
/** Four repositories on GitHub: the shared types merged, the API ready, the web app and the docs drafts. */
export const FourRepositories: Story = {
  args: {
    stops: TRACK_FOUR,
    actions: split(
      'Mark 2 drafts ready for review',
      false,
      ['Mark meridian-web ready for review', 'Mark meridian-docs ready for review'],
      ready,
    ),
  },
}
/** One repository's files, picked from the tabs: its own count, and the way into its diff. */
export const OneRepositorysFiles: Story = {
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('radio', { name: 'frontend' }))
    await expect(c.getByText('6 files')).toBeInTheDocument()
    await expect(c.queryByText('schema.ts')).not.toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: /Review the diff/ }))
    await expect(args.onOpenFile).toHaveBeenCalledWith('frontend/app/chat/page.tsx')
  },
}

export const AllStates: Story = {
  parameters: statesParameters,
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'both drafts', node: <ChangeTrack {...args} {...BothDrafts.args} /> },
        { state: 'one ready, one a draft', node: <ChangeTrack {...args} {...OneReady.args} /> },
        { state: 'checks failing in one', node: <ChangeTrack {...args} {...FailingInOne.args} /> },
        { state: 'a conflict in one', node: <ChangeTrack {...args} {...ConflictInOne.args} /> },
        { state: 'ready', node: <ChangeTrack {...args} /> },
        { state: 'merging, in order', node: <ChangeTrack {...args} {...Merging.args} /> },
        { state: 'the first in the merge queue', node: <ChangeTrack {...args} {...QueuedFirst.args} /> },
        { state: 'one merged, one open', node: <ChangeTrack {...args} {...OneMerged.args} /> },
        { state: 'one merged, one refused', node: <ChangeTrack {...args} {...Refused.args} /> },
        { state: 'four repositories', node: <ChangeTrack {...args} {...FourRepositories.args} /> },
      ]}
    />
  ),
}
