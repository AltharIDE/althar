import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Brand } from '../../foundations/brands/brands'
import { FirstConnections, type FirstConnectionsService } from './FirstConnections'

const GITHUB: FirstConnectionsService = { id: 'github', name: 'GitHub', brand: Brand.GitHub }
const HOSTS: FirstConnectionsService[] = [
  GITHUB,
  { id: 'gitlab', name: 'GitLab', brand: Brand.GitLab },
  { id: 'bitbucket', name: 'Bitbucket', brand: Brand.Bitbucket },
]
const TRACKERS: FirstConnectionsService[] = [
  { id: 'linear', name: 'Linear', brand: Brand.Linear },
  { id: 'jira', name: 'Jira', brand: Brand.Jira },
  { id: 'trello', name: 'Trello', brand: Brand.Trello },
]

const onConnect = fn()

const meta = {
  title: 'Setup/FirstConnections',
  component: FirstConnections,
  decorators: [(Story) => <div style={{ width: 520 }}>{Story()}</div>],
  args: { host: { service: GITHUB, where: 'northwind/meridian' }, trackers: TRACKERS, onConnect, onHide: fn() },
} satisfies Meta<typeof FirstConnections>
export default meta
type Story = StoryObj<typeof meta>

/** The project's code is on GitHub, which isn't connected, and no tracker is: two rows. The trackers wait behind one menu. */
export const OnGitHub: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const [host, trackers] = c.getAllByRole('button', { name: 'Connect' })
    if (host === undefined || trackers === undefined) throw new Error('A Connect for the host and one for the trackers')
    await userEvent.click(host)
    await expect(onConnect).toHaveBeenCalledWith('github')
    await userEvent.click(trackers)
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: 'Linear' }))
    await expect(onConnect).toHaveBeenCalledWith('linear')
  },
}

/** Its code names no host: every host waits behind one Connect, as the trackers do. */
export const NoHostNamed: Story = { args: { host: undefined, hosts: HOSTS } }

/** A code host is connected: only a tracker is asked for. */
export const OnlyIssues: Story = { args: { host: undefined } }

/** A walk in, open in place of the rows. */
export const Walking: Story = {
  args: { walk: <p style={{ margin: 0, padding: '24px 0', textAlign: 'center' }}>The service’s walk in, as the app opens it.</p> },
}

/** Everything connected: nothing to show. */
export const AllConnected: Story = { args: { host: undefined, trackers: [] } }
