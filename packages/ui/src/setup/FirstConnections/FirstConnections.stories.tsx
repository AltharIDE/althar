import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { useState } from 'react'

import { Brand } from '../../foundations/brands/brands'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { ConnectCard, ConnectWays } from '../ConnectCard/ConnectCard'
import { ConnectActions } from '../ConnectCard/ConnectParts'
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

const WAYS = [
  { id: 'gh', title: 'Use gh’s sign-in', line: 'Signed in as balazs on this Mac', icon: 'terminal' as const },
  { id: 'token', title: 'Make a token', line: 'On GitHub’s token page, opened filled in', icon: 'lock' as const },
]

/** GitHub's walk in, as the app sets it in the card: from the card's left edge, Back on it too. */
const walkIn = (onBack: () => void) => (
  <div style={{ display: 'grid', justifyItems: 'start', gap: 14, paddingBottom: 8 }}>
    <ConnectCard
      brand={Brand.GitHub}
      title="Connect GitHub"
      line="For meridian: northwind/meridian"
      foot="Kept encrypted on this Mac"
      align="start"
      style={{ justifySelf: 'stretch' }}
    >
      <ConnectWays label="Ways to connect GitHub" ways={WAYS} onChoose={fn()} />
      <ConnectActions align="start">
        <LinkButton>On a company’s own server</LinkButton>
      </ConnectActions>
    </ConnectCard>
    <LinkButton onClick={onBack}>Back</LinkButton>
  </div>
)

/** As the app keeps it: Connect opens the walk in, Back goes back to the rows. */
function Walks(props: Parameters<typeof FirstConnections>[0]) {
  const [walking, setWalking] = useState(true)
  return (
    <FirstConnections
      {...props}
      onConnect={(service) => {
        onConnect(service)
        setWalking(true)
      }}
      {...(walking ? { walk: walkIn(() => setWalking(false)) } : {})}
    />
  )
}

/** A walk in, open in place of the rows, from the card's left edge; its height glides as it opens and closes. */
export const Walking: Story = {
  decorators: [(Story) => <div style={{ width: 640 }}>{Story()}</div>],
  render: (args) => <Walks {...args} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('heading', { name: 'Connect GitHub' })).toBeVisible()
    await userEvent.click(c.getByRole('button', { name: 'Back' }))
    await expect(c.getAllByRole('button', { name: 'Connect' })).toHaveLength(2)
  },
}

/** Everything connected: nothing to show. */
export const AllConnected: Story = { args: { host: undefined, trackers: [] } }
