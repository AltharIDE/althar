import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { ChangeTarget, RepositoryRole } from '../../foundations/vocabulary'
import { ProjectRepositories, type ProjectRepository } from './ProjectRepositories'

const MERIDIAN: ProjectRepository[] = [
  {
    id: 'api',
    name: 'meridian-api',
    where: '~/code/meridian-api',
    branch: 'main',
    remote: 'github.com/meridian/api',
    role: RepositoryRole.Service,
    tasks: 2,
  },
  {
    id: 'web',
    name: 'meridian-web',
    where: '~/code/meridian-web',
    branch: 'refund-status',
    remote: 'github.com/you/meridian-web',
    role: RepositoryRole.Frontend,
    fork: { fork: 'you/meridian-web', upstream: 'meridian/web', target: ChangeTarget.Fork },
    tasks: 0,
  },
  {
    id: 'infra',
    name: 'infra',
    where: '~/code/infra',
    branch: 'main',
    role: RepositoryRole.Infrastructure,
    tasks: 1,
  },
]

const meta = {
  title: 'Screens/ProjectRepositories',
  component: ProjectRepositories,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ maxWidth: 760 }}>{Story()}</div>],
  args: {
    project: 'Meridian',
    repositories: MERIDIAN,
    onRoleChange: fn(),
    onTargetChange: fn(),
    onLeaveOut: fn(),
    onAdd: fn(),
  },
} satisfies Meta<typeof ProjectRepositories>
export default meta
type Story = StoryObj<typeof meta>

/** Three repositories: one a fork, two changed by tasks under way, one with no remote. */
export const Default: Story = {}

/** The last one stays: there is no way to leave it out. */
export const One: Story = {
  args: { repositories: MERIDIAN.slice(0, 1) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button', { name: /Leave out/ })).toBeNull()
  },
}

/** Without a folder picker, nothing is added here. */
export const NoAdding: Story = { args: { onAdd: undefined } }

/** The last change didn't happen, and says why. */
export const Failed: Story = { args: { error: 'Althar couldn’t read that folder.' } }

export const LeavingOut: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Leave out meridian-web' }))
    await expect(args.onLeaveOut).toHaveBeenCalledWith('web')
  },
}

export const Adding: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Add a folder' }))
    await expect(args.onAdd).toHaveBeenCalledOnce()
  },
}

export const ChangingRole: Story = {
  play: async ({ args, canvasElement }) => {
    const page = within(document.body)
    await userEvent.click(within(canvasElement).getByRole('combobox', { name: 'Role of infra' }))
    await userEvent.click(await page.findByRole('option', { name: 'Library' }))
    await expect(args.onRoleChange).toHaveBeenCalledWith('infra', RepositoryRole.Library)
  },
}

/** A fork's pull requests can open on the repository it came from instead. */
export const ChangingTarget: Story = {
  play: async ({ args, canvasElement }) => {
    const page = within(document.body)
    await userEvent.click(within(canvasElement).getByRole('combobox', { name: 'Where tasks open pull requests' }))
    await userEvent.click(await page.findByRole('option', { name: 'Pull requests on meridian/web' }))
    await expect(args.onTargetChange).toHaveBeenCalledWith('web', ChangeTarget.Upstream)
  },
}
