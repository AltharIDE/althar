import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fireEvent, fn, userEvent, within } from 'storybook/test'

import { MAP_HALYARD, MAP_HOSTS, MAP_MERIDIAN } from '../../fixtures/setup'
import { States } from '../../storybook/States'
import { ProjectRepositories } from './ProjectRepositories'

const meta = {
  title: 'Screens/ProjectRepositories',
  component: ProjectRepositories,
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div style={{ background: 'var(--n-2)', padding: '14px 48px 72px', minHeight: '100vh' }}>{Story()}</div>],
  args: {
    project: 'Meridian',
    repositories: MAP_MERIDIAN,
    hosts: MAP_HOSTS,
    worktrees: '~/Althar/meridian',
    onBack: fn(),
    onRoleChange: fn(),
    onTargetChange: fn(),
    onLeaveOut: fn(),
    onOpen: fn(),
    onConnect: fn(),
    onAdd: fn(),
    onDrop: fn(),
  },
} satisfies Meta<typeof ProjectRepositories>
export default meta
type Story = StoryObj<typeof meta>

/** The page itself, which takes the drops: what holds its heading. */
const pageOf = (canvasElement: HTMLElement) =>
  within(canvasElement).getByRole('heading', { level: 1 }).closest('header')?.parentElement ?? canvasElement

/** Meridian's three: where each is on this Mac, and where its work goes. */
export const Default: Story = {
  play: async ({ args, canvasElement }) => {
    const page = within(canvasElement)
    await expect(page.getByRole('heading', { level: 1, name: 'Repositories' })).toBeVisible()
    await expect(page.getByText('What Meridian’s tasks may change, and where their work goes')).toBeVisible()
    await userEvent.click(page.getByRole('button', { name: 'Back to Meridian' }))
    await expect(args.onBack).toHaveBeenCalledOnce()
  },
}

/** Halyard's one, a fork. */
export const OneFork: Story = { args: { project: 'Halyard', repositories: MAP_HALYARD, worktrees: '~/Althar/halyard' } }

/** A folder picked, being read: the button says it is busy, and the folder waits on the left. */
export const Adding: Story = {
  args: {
    repositories: MAP_MERIDIAN.slice(0, 2),
    reading: [{ id: 'reading', name: 'meridian-infra', where: '~/code/meridian-infra' }],
    adding: true,
  },
}

export const PickingAFolder: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Add a folder' }))
    await expect(args.onAdd).toHaveBeenCalledOnce()
  },
}

/** A folder held over the page says to let go, and dropped, adds it. */
export const DroppingAFolder: Story = {
  play: async ({ args, canvasElement }) => {
    const page = within(canvasElement)
    const root = pageOf(canvasElement)
    const folder = new File([], 'meridian-infra')
    const dataTransfer = { types: ['Files'], files: [folder] }
    await fireEvent.dragEnter(root, { dataTransfer })
    await expect(page.getByText('Let go to add it')).toBeVisible()
    await fireEvent.dragOver(root, { dataTransfer })
    await fireEvent.drop(root, { dataTransfer })
    await expect(args.onDrop).toHaveBeenCalledWith([folder])
    await expect(page.getByText('or drop a folder here')).toBeVisible()
  },
}

/** Something else held over the page, like text, isn't a folder, and a folder taken away again is let go. */
export const DraggingSomethingElse: Story = {
  play: async ({ args, canvasElement }) => {
    const page = within(canvasElement)
    const root = pageOf(canvasElement)
    await fireEvent.dragEnter(root, { dataTransfer: { types: ['text/plain'], files: [] } })
    await expect(page.getByText('or drop a folder here')).toBeVisible()
    await fireEvent.dragEnter(root, { dataTransfer: { types: ['Files'], files: [] } })
    await fireEvent.dragLeave(root, { dataTransfer: { types: ['Files'], files: [] } })
    await expect(page.getByText('or drop a folder here')).toBeVisible()
    await fireEvent.drop(root, { dataTransfer: { types: ['Files'], files: [] } })
    await expect(args.onDrop).not.toHaveBeenCalled()
  },
}

/** Without a folder picker, nothing is added here, and nothing says to drop one. */
export const NoAdding: Story = {
  args: { onAdd: undefined, onDrop: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button', { name: 'Add a folder' })).toBeNull()
  },
}

/** The last change didn't happen, and says why. */
export const Failed: Story = { args: { error: 'There’s no git repository in Downloads.' } }

/** At the window's least width. */
export const Narrow: Story = {
  decorators: [(Story) => <div style={{ width: 880 }}>{Story()}</div>],
}

export const AllStates: Story = {
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'three repositories', node: <ProjectRepositories {...args} /> },
        { state: 'one, a fork', node: <ProjectRepositories {...args} {...OneFork.args} /> },
        { state: 'adding', node: <ProjectRepositories {...args} {...Adding.args} /> },
        { state: 'failed', node: <ProjectRepositories {...args} {...Failed.args} /> },
        { state: 'no adding', node: <ProjectRepositories {...args} {...NoAdding.args} /> },
      ]}
    />
  ),
}
