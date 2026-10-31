import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { MAP_HALYARD, MAP_HOSTS, MAP_MERIDIAN } from '../../fixtures/setup'
import { device } from '../../foundations/device'
import { Brand } from '../../foundations/brands/brands'
import { ChangeTarget, HostReach, RepositoryRole } from '../../foundations/vocabulary'
import { States, statesOn } from '../../storybook/States'
import { RepositoryMap } from './RepositoryMap'

const meta = {
  title: 'Setup/RepositoryMap',
  component: RepositoryMap,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ maxWidth: 1044, background: 'var(--n-2)', padding: '8px 0' }}>{Story()}</div>],
  args: {
    repositories: MAP_MERIDIAN,
    hosts: MAP_HOSTS,
    worktrees: '~/Althar/meridian',
    onRoleChange: fn(),
    onTargetChange: fn(),
    onLeaveOut: fn(),
    onOpen: fn(),
    onConnect: fn(),
    text: { leaveOut: 'Leave out of Meridian' },
  },
} satisfies Meta<typeof RepositoryMap>
export default meta
type Story = StoryObj<typeof meta>

/** Three folders: two on GitHub, which Althar is connected to, and one on GitLab, which it isn't, so its wire is dashed. */
export const Meridian: Story = {
  play: async ({ canvasElement }) => {
    const map = within(canvasElement)
    await expect(map.getByRole('list', { name: `On ${device.this}` }).querySelectorAll('li')).toHaveLength(3)
    await expect(map.getByRole('region', { name: 'GitHub' })).toHaveTextContent('Connected as balazs')
    await expect(map.getByRole('region', { name: 'GitLab' })).toHaveTextContent('Not connected')
    // Each card says where its work goes, as the wires draw it.
    await expect(map.getByText('Its work goes to meridian-ops/infra on GitLab.')).toBeInTheDocument()
    await expect(canvasElement.querySelectorAll('svg g')).toHaveLength(3)
  },
}

/** A fork: it pushes to yours, and its pull requests open on theirs, or on yours. */
export const Fork: Story = {
  args: { repositories: MAP_HALYARD, worktrees: '~/Althar/halyard' },
  play: async ({ args, canvasElement }) => {
    const map = within(canvasElement)
    await expect(map.getByText('Your fork')).toBeVisible()
    await expect(map.getByText('The repository it forks')).toBeVisible()
    // The only one stays: its menu opens it on GitHub, and nothing more.
    await userEvent.click(map.getByRole('button', { name: 'More for halyard-api' }))
    const page = within(document.body)
    await expect(page.queryByRole('menuitem', { name: /Leave out/ })).toBeNull()
    await userEvent.click(await page.findByRole('menuitem', { name: 'Open on GitHub' }))
    await expect(args.onOpen).toHaveBeenCalledWith('https://github.com/balazs/halyard-api')
  },
}

/** Where a fork's pull requests open, changed: its pull requests' wire goes there, and its card says so. */
export const ChangingTarget: Story = {
  args: Fork.args,
  render: function Changing(args) {
    const [repositories, setRepositories] = useState(args.repositories)
    return (
      <RepositoryMap
        {...args}
        repositories={repositories}
        onTargetChange={(id, target) => {
          args.onTargetChange(id, target)
          setRepositories((now) => now.map((one) => (one.id === id && one.fork ? { ...one, fork: { ...one.fork, target } } : one)))
        }}
      />
    )
  },
  play: async ({ args, canvasElement }) => {
    const map = within(canvasElement)
    await expect(map.getByText('pull requests')).toBeInTheDocument()
    await expect(map.getByText('It pushes to balazs/halyard-api on GitHub, and its pull requests open on halyard/api.')).toBeInTheDocument()
    await userEvent.click(map.getByRole('combobox', { name: 'Where halyard-api’s pull requests open' }))
    await userEvent.click(await within(document.body).findByRole('option', { name: 'balazs/halyard-api' }))
    await expect(args.onTargetChange).toHaveBeenCalledWith('halyard', ChangeTarget.Fork)
    // One wire now, to the fork, which it pushes to and opens its pull requests on.
    await expect(await map.findByText('pushes, pull requests')).toBeInTheDocument()
    await expect(canvasElement.querySelectorAll('svg g')).toHaveLength(1)
    await expect(
      map.getByText('It pushes to balazs/halyard-api on GitHub, and its pull requests open on balazs/halyard-api.'),
    ).toBeInTheDocument()
  },
}

/** A third folder being read, waiting under the others until its repositories are known. */
export const Reading: Story = {
  args: {
    repositories: MAP_MERIDIAN.slice(0, 2),
    reading: [{ id: 'reading', name: 'meridian-infra', where: '~/code/meridian-infra' }],
  },
}

/** A host whose sign-in stopped working: dashed until it is signed in again. */
export const SignInAgain: Story = {
  args: { hosts: MAP_HOSTS.map((host) => (host.id === 'github' ? { ...host, reach: HostReach.SignInAgain } : host)) },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Sign in to GitHub again' }))
    await expect(args.onConnect).toHaveBeenCalledWith('github')
  },
}

/** Connecting GitLab, from beside what connecting adds. */
export const Connecting: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Connect GitLab' }))
    await expect(args.onConnect).toHaveBeenCalledWith('gitlab')
  },
}

/**
 * The edges: a host Althar doesn't know, by its address; a company's own
 * GitLab; a repository not on this device; and one with no remote, whose
 * work stays here, unwired.
 */
export const Elsewhere: Story = {
  args: {
    hosts: [
      { id: 'forge', name: 'git.meridian.dev', reach: HostReach.Unknown },
      {
        id: 'gitlab-own',
        name: 'GitLab',
        instance: 'gitlab.meridian.dev',
        brand: Brand.GitLab,
        reach: HostReach.Connected,
        account: 'ops',
      },
    ],
    repositories: [
      {
        id: 'tools',
        name: 'meridian-tools',
        where: '~/code/meridian-tools',
        branch: 'main',
        role: RepositoryRole.Library,
        tasks: 0,
        remote: { host: 'forge', path: 'platform/meridian-tools' },
      },
      { id: 'deploy', name: 'deploy', role: RepositoryRole.Infrastructure, tasks: 1, remote: { host: 'gitlab-own', path: 'ops/deploy' } },
      { id: 'notes', name: 'meridian-notes', where: '~/code/meridian-notes', role: RepositoryRole.Docs, tasks: 0 },
    ],
  },
  play: async ({ canvasElement }) => {
    const map = within(canvasElement)
    await expect(map.getByText(`Not on ${device.this}`)).toBeVisible()
    await expect(map.getByText(`Stays on ${device.this}`)).toBeVisible()
    await expect(map.getByText(`Its work stays on ${device.this}.`)).toBeInTheDocument()
    await expect(map.getByRole('region', { name: 'git.meridian.dev' })).toHaveTextContent('Not a host Althar connects to')
    // Althar can't connect a host it doesn't know.
    await expect(map.queryByRole('button', { name: /Connect/ })).toBeNull()
  },
}

/** Long names and paths stay on one line, cut short. */
export const LongNames: Story = {
  args: {
    repositories: [
      {
        ...MAP_MERIDIAN[0],
        id: 'long',
        name: 'meridian-customer-facing-refund-and-chargeback-dashboard',
        where: '~/code/clients/meridian/customer-facing/refund-and-chargeback-dashboard',
        branch: 'feature/MER-1288-refund-banner-shows-pending-chargebacks-with-dates',
        role: RepositoryRole.Frontend,
        tasks: 0,
        remote: { host: 'github', path: 'meridian-payments-platform/customer-facing-refund-and-chargeback-dashboard' },
      },
      ...MAP_MERIDIAN.slice(1),
    ],
  },
}

/** At the window's least width: the gap narrows, the columns hold. */
export const Narrow: Story = {
  decorators: [(Story) => <div style={{ width: 784, background: 'var(--n-2)' }}>{Story()}</div>],
}

/** Before the project has had a task, its worktrees' folder isn't made. */
export const NoWorktreesYet: Story = { args: { worktrees: undefined } }

/** Without the consumer's ways to open, leave out or connect, none are offered. */
export const ReadOnly: Story = {
  args: { onLeaveOut: undefined, onOpen: undefined, onConnect: undefined },
  play: async ({ canvasElement }) => {
    const map = within(canvasElement)
    await expect(map.queryByRole('button', { name: /More for/ })).toBeNull()
    await expect(map.queryByRole('button', { name: /Connect/ })).toBeNull()
  },
}

export const LeavingOut: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'More for meridian-app' }))
    const item = await within(document.body).findByRole('menuitem', { name: /Leave out of Meridian/ })
    await expect(item).toHaveTextContent('The 2 tasks using it keep it')
    await userEvent.click(item)
    await expect(args.onLeaveOut).toHaveBeenCalledWith('app')
  },
}

/** One with nothing under way says nothing in its folder changes; one task keeps it. */
export const LeavingOutQuietly: Story = {
  play: async ({ canvasElement }) => {
    const map = within(canvasElement)
    const page = within(document.body)
    await userEvent.click(map.getByRole('button', { name: 'More for meridian-infra' }))
    await expect(await page.findByRole('menuitem', { name: /Leave out/ })).not.toHaveTextContent(/keep/)
    await userEvent.keyboard('{Escape}')
    await userEvent.click(map.getByRole('button', { name: 'More for meridian-api' }))
    await expect(await page.findByRole('menuitem', { name: /Leave out/ })).toHaveTextContent('The task using it keeps it')
  },
}

export const ChangingRole: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('combobox', { name: 'Role of meridian-infra' }))
    await userEvent.click(await within(document.body).findByRole('option', { name: 'Library' }))
    await expect(args.onRoleChange).toHaveBeenCalledWith('infra', RepositoryRole.Library)
  },
}

/** The menu's button at rest, hovered and focused, and the map in each of its looks; long names and no actions are their own stories. */
export const AllStates: Story = {
  parameters: statesOn({
    hover: 'li:first-child button',
    focus: 'li:first-child button',
    pressed: 'li:first-child button',
  }),
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'rest', node: <RepositoryMap {...args} /> },
        { state: 'hover', node: <RepositoryMap {...args} /> },
        { state: 'focus', node: <RepositoryMap {...args} /> },
        { state: 'fork', node: <RepositoryMap {...args} {...Fork.args} /> },
        { state: 'reading', node: <RepositoryMap {...args} {...Reading.args} /> },
        { state: 'sign in again', node: <RepositoryMap {...args} {...SignInAgain.args} /> },
        { state: 'elsewhere', node: <RepositoryMap {...args} {...Elsewhere.args} /> },
      ]}
    />
  ),
}
