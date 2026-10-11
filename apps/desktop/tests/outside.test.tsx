import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type Product, type ThreadSnapshot } from '@althar/contracts'
import { Brand, IssuePriority, IssueStatus } from '@althar/ui'

import { useConnections } from '../src/renderer/features/connections/useConnections'
import { useBoard } from '../src/renderer/features/board/useBoard'
import { connectionsOf, ConnectionsView, servicesOf } from '../src/renderer/features/connections/ConnectionsView'
import { ProjectView } from '../src/renderer/features/project/ProjectView'
import { useProject } from '../src/renderer/features/project/useProject'
import { useProjectMenu } from '../src/renderer/features/project/useProjectMenu'
import { text as stuckWords } from '../src/renderer/features/task/StuckCall'
import { TaskView } from '../src/renderer/features/task/TaskView'
import { useTask } from '../src/renderer/features/task/useTask'
import { issuePriority, issueStatus, productBrand, productName } from '../src/renderer/shared/products'
import { blocksOf } from '../src/renderer/shared/thread'
import {
  card,
  change,
  changed,
  connectionList,
  coordinatorSnapshot,
  fakeClient,
  fakeHost,
  GITHUB_TOKEN_PAGE,
  githubCheck,
  githubConnection,
  items,
  snapshot,
} from './fixtures'
import { withServices } from './render'

/*
 * What reaches outside, in the window: connecting code hosts and trackers,
 * a pasted link unfurled, what arrives on a task's pull request, the pull
 * request beside the thread, a task from an issue, and the plan's ending.
 */

function Connections() {
  return <ConnectionsView model={useConnections()} />
}

describe('connections', () => {
  const connect = async (service: number) => {
    const button = (await screen.findAllByRole('button', { name: 'Connect' }))[service]
    if (button === undefined) throw new Error('no Connect')
    await userEvent.click(button)
  }

  it('lists each service with where the projects’ code is, opens its ways in in place of the list, and disconnects', async () => {
    const { client, emit } = fakeClient()
    withServices(<Connections />, client)
    expect(await screen.findByText('Not connected · meridian’s code is here')).toBeTruthy()
    expect(screen.getByText('Not connected · Issues')).toBeTruthy()
    await connect(0)
    // gh is signed in on this Mac, so its sign-in is a way in, beside a token.
    const ways = await screen.findByRole('group', { name: 'Ways to connect GitHub' })
    expect(client.getConnectGuide).toHaveBeenCalledWith('github')
    expect(within(ways).getByRole('button', { name: /Use gh’s sign-in\s*Signed in as you on this Mac/ })).toBeTruthy()
    expect(within(ways).getByRole('button', { name: /Make a token\s*On GitHub’s token page, opened filled in/ })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Connect GitHub' })).toBeTruthy()
    expect(screen.getByText('For meridian: northwind/meridian-api')).toBeTruthy()
    expect(screen.getByText(/Kept encrypted on this Mac/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Back to code hosts and trackers' }))
    expect(await screen.findByText('Not connected · meridian’s code is here')).toBeTruthy()

    // Connected elsewhere: the list is read again, and says who; disconnecting takes it away.
    vi.mocked(client.listConnections).mockResolvedValue({ ...connectionList, connections: [githubConnection] })
    emit(changed('connection', 'conn1', null, null))
    expect(await screen.findByText('Signed in as you')).toBeTruthy()
    vi.mocked(client.listConnections).mockResolvedValue(connectionList)
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(client.disconnect).toHaveBeenCalledWith('conn1')
    await waitFor(() => expect(screen.queryByText('Signed in as you')).toBeNull())
  })

  it('makes a token on its page opened filled in, notices it on the clipboard as the window comes back, and says what it can do', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const token = 'github_pat_11ABXDEFGHIJKLMNOPQRSTUVWX7Qx'
    const host = fakeHost({ clipboardToken: vi.fn(async () => token) })
    const { client } = fakeClient({ connectToken: vi.fn(async () => githubConnection) })
    withServices(<Connections />, client, host)
    await connect(0)
    await userEvent.click(await screen.findByRole('button', { name: /Make a token/ }))
    expect(screen.getByRole('heading', { name: 'Make a token on GitHub' })).toBeTruthy()
    expect(screen.getByText('Step 1 of 3')).toBeTruthy()
    expect(screen.getByText('It opens with the name, northwind as the owner, 90 days and the permissions set.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Open GitHub’s token page' }))
    expect(open).toHaveBeenCalledWith(GITHUB_TOKEN_PAGE, '_blank')
    await userEvent.click(screen.getByRole('button', { name: 'See the 6 permissions it sets' }))
    expect(screen.getByText('Pull requests')).toBeTruthy()
    expect(screen.getByText('Under Repository access, choose Only select repositories: meridian-api.')).toBeTruthy()

    // Back from GitHub with the token copied: the clipboard is read once, and offers it.
    act(() => void window.dispatchEvent(new Event('focus')))
    expect(await screen.findByText('A GitHub token is on your clipboard')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Paste the token' })).toBeTruthy()
    expect(screen.getByText('github_pat_11ABX····7Qx')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Use it' }))
    expect(client.connectToken).toHaveBeenCalledWith({ product: 'github', token, webUrl: 'https://github.com' })

    // What it can do, as GitHub says.
    expect(await screen.findByRole('heading', { name: 'Connected as you' })).toBeTruthy()
    expect(client.checkConnection).toHaveBeenCalledWith('conn1')
    const can = screen.getByRole('list', { name: 'What GitHub lets Althar do' })
    expect(within(can).getByText('Reaches meridian-api').closest('li')?.textContent).toContain('northwind')
    expect(within(can).getByText('Open, update and merge pull requests')).toBeTruthy()
    expect(screen.getByText('The token runs out on 8 January 2027.')).toBeTruthy()
    expect(screen.getByText('Connected')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(await screen.findByText('Not connected · meridian’s code is here')).toBeTruthy()
    open.mockRestore()
  })

  it('takes a token pasted by hand; says on the check when the service doesn’t take one; and how to give it what it lacks', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const lacking = {
      ...githubCheck,
      lines: githubCheck.lines.map((line) =>
        line.need === 'changes'
          ? {
              ...line,
              state: 'no' as const,
              reason: {
                kind: 'permission' as const,
                permission: 'Pull requests',
                url: 'https://github.com/settings/personal-access-tokens',
              },
            }
          : line,
      ),
    }
    const { client } = fakeClient({
      connectToken: vi
        .fn()
        .mockRejectedValueOnce(new ApiError({ reason: 'ConnectorFailed', message: 'GitHub no longer takes it.', why: 'unauthorized' }))
        .mockRejectedValueOnce(new ApiError({ reason: 'ConnectorFailed', message: 'Althar couldn’t reach GitHub.', why: 'unreachable' }))
        .mockResolvedValue(githubConnection),
      checkConnection: vi.fn().mockResolvedValueOnce(lacking).mockResolvedValue(githubCheck),
    })
    withServices(<Connections />, client)
    await connect(0)
    await userEvent.click(await screen.findByRole('button', { name: /Make a token/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Paste it myself' }))
    const field = screen.getByLabelText('Paste it')
    expect(field.getAttribute('type')).toBe('password')
    await userEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(screen.getByText('Paste the token first')).toBeTruthy()
    await userEvent.type(field, 'github_pat_old{Enter}')

    // Not taken: said on the check, where its account would be, with a new one made or another pasted.
    expect(await screen.findByRole('heading', { name: 'GitHub didn’t take that token' })).toBeTruthy()
    expect(screen.getByText('GitHub didn’t take this token: it may be mistyped, revoked or run out.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Paste another' }))
    // Not reached: said under the field.
    await userEvent.type(screen.getByLabelText('Paste it'), 'github_pat_new{Enter}')
    expect(await screen.findByText('Althar couldn’t reach GitHub.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Check' }))

    // Taken, but without one thing a task needs: said on its line, with how to change it.
    expect(await screen.findByRole('heading', { name: 'This token can’t open pull requests' })).toBeTruthy()
    expect(screen.getByText('Pull requests isn’t allowed on this token, so a task would end on its branch.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Change it on GitHub' }))
    expect(open).toHaveBeenCalledWith('https://github.com/settings/personal-access-tokens', '_blank')
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(await screen.findByRole('heading', { name: 'Connected as you' })).toBeTruthy()
    expect(client.checkConnection).toHaveBeenCalledTimes(2)
    // Escape-like: back from the check is the token again.
    open.mockRestore()
  })

  it('takes gh’s sign-in, as gh has it', async () => {
    const { client } = fakeClient()
    withServices(<Connections />, client)
    await connect(0)
    await userEvent.click(await screen.findByRole('button', { name: /Use gh’s sign-in/ }))
    expect(screen.getByRole('heading', { name: 'Use gh’s sign-in' })).toBeTruthy()
    expect(screen.getByText('you on github.com')).toBeTruthy()
    expect(screen.getByText('repo, workflow, read:org')).toBeTruthy()
    expect(screen.getByText('Every repository you can, northwind’s included')).toBeTruthy()
    vi.mocked(client.connectCli).mockRejectedValueOnce(
      new ApiError({ reason: 'CliSignedOut', message: 'gh isn’t signed in to github.com on this Mac.' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Use this sign-in' }))
    expect(await screen.findByText('gh isn’t signed in to github.com on this Mac.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Use this sign-in' }))
    expect(client.connectCli).toHaveBeenLastCalledWith('github', 'https://github.com')
    expect(await screen.findByRole('heading', { name: 'Connected as you' })).toBeTruthy()
    expect(screen.getByText('gh’s token; it runs out when gh’s does.')).toBeTruthy()
    // Another way goes back to the ways.
  })

  it('connects a company’s own server by its address, asking what answers there', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const { client } = fakeClient({
      findServer: vi.fn(async (_service, webUrl: string) =>
        webUrl.includes('meridian')
          ? {
              product: 'github' as const,
              webUrl: 'https://git.meridian.dev',
              reason: null,
              tokenPage: 'https://git.meridian.dev/settings/tokens/new',
            }
          : { product: null, webUrl, reason: 'other' as const, tokenPage: null },
      ),
    })
    withServices(<Connections />, client)
    await connect(0)
    await userEvent.click(await screen.findByRole('button', { name: 'On a company’s own server' }))
    expect(screen.getByRole('heading', { name: 'Your company’s GitHub' })).toBeTruthy()
    const field = screen.getByLabelText('Server address')
    await userEvent.type(field, 'git.example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Make a token' }))
    expect(await screen.findByText('git.example.com isn’t a GitHub server')).toBeTruthy()
    await userEvent.clear(field)
    await userEvent.type(field, 'git.meridian.dev')
    expect(await screen.findByText('GitHub Enterprise Server answers at git.meridian.dev', {}, { timeout: 3000 })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Make a token' }))
    expect(screen.getByRole('heading', { name: 'Make a token on git.meridian.dev' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Open git.meridian.dev’s token page' }))
    expect(open).toHaveBeenCalledWith('https://git.meridian.dev/settings/tokens/new', '_blank')
    open.mockRestore()
  })

  it('signs a connection in again with a new token, keeping its site and email', async () => {
    const jira = {
      ...connectionList.products[1]!,
      product: 'jira_cloud' as const,
      service: 'jira' as const,
      name: 'Jira',
      hostedUrl: null,
      tokenNeeds: 'email' as const,
      tokenPrefixes: ['ATATT'],
    }
    const stopped = {
      ...githubConnection,
      id: 'conn9',
      product: 'jira_cloud' as const,
      name: 'Jira',
      webUrl: 'https://northwind.atlassian.net',
      account: { login: 'you@northwind.io', name: 'You' },
      auth: 'token' as const,
      state: 'reauth_required' as const,
    }
    const { client } = fakeClient({
      listConnections: vi.fn(async () => ({ ...connectionList, products: [jira], connections: [stopped], places: [] })),
      getConnectGuide: vi.fn(async () => ({
        service: 'jira' as const,
        places: [],
        clis: [],
        email: null,
        tokenPages: [
          {
            product: 'jira_cloud' as const,
            webUrl: 'https://northwind.atlassian.net',
            url: 'https://id.atlassian.com/manage-profile/security/api-tokens',
          },
        ],
      })),
      connectToken: vi.fn(async () => ({ ...stopped, state: 'ready' as const })),
      checkConnection: vi.fn(async () => ({
        connectionId: 'conn9',
        lines: [
          { need: 'site' as const, state: 'ok' as const, fact: 'northwind.atlassian.net', count: null, reason: null },
          { need: 'account' as const, state: 'ok' as const, fact: 'you@northwind.io', count: null, reason: null },
          { need: 'read' as const, state: 'ok' as const, fact: null, count: 4, reason: null },
          { need: 'comment' as const, state: 'ok' as const, fact: null, count: null, reason: null },
          { need: 'move' as const, state: 'ok' as const, fact: null, count: null, reason: null },
        ],
        expiresAt: null,
        renews: false,
        settings: 'https://id.atlassian.com/manage-profile/security/api-tokens',
      })),
    })
    withServices(<Connections />, client)
    expect(await screen.findByText('Its sign-in stopped working')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Sign in again' }))
    expect(await screen.findByRole('heading', { name: 'Make a new API token' })).toBeTruthy()
    expect(screen.getByText('Its token stopped working. Tasks can’t reach it until it’s back.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Paste it myself' }))
    expect(screen.getByRole('heading', { name: 'Paste the new token' })).toBeTruthy()
    // The site and the email stay: only the token is asked for.
    expect(screen.queryByLabelText('Your Atlassian account’s email')).toBeNull()
    await userEvent.type(screen.getByLabelText('Paste it'), 'ATATTnew{Enter}')
    expect(client.connectToken).toHaveBeenCalledWith({ product: 'jira_cloud', token: 'ATATTnew', connectionId: 'conn9' })
    expect(await screen.findByRole('heading', { name: 'Jira is back' })).toBeTruthy()
    expect(screen.getByText('4 projects')).toBeTruthy()
  })

  it('connects Trello with the Power-Up key its token is made for', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const trello = {
      ...connectionList.products[1]!,
      product: 'trello' as const,
      service: 'trello' as const,
      name: 'Trello',
      hostedUrl: 'https://trello.com',
      tokenNeeds: 'key' as const,
      tokenPrefixes: ['ATTA'],
      tokenHelpForKey: 'https://trello.com/1/authorize?response_type=token&key={key}',
      keyChecks: [
        { pattern: '^[0-9a-f]{64}$', says: 'That’s the Power-Up’s secret; paste its API key' },
        { pattern: '^(?![0-9a-f]{32}$)', says: 'An API key is 32 characters' },
      ],
    }
    const key = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
    const { client } = fakeClient({
      listConnections: vi.fn(async () => ({ ...connectionList, products: [trello], places: [] })),
      getConnectGuide: vi.fn(async () => ({
        service: 'trello' as const,
        places: [],
        clis: [],
        email: null,
        tokenPages: [{ product: 'trello' as const, webUrl: 'https://trello.com', url: 'https://trello.com/power-ups/admin' }],
      })),
    })
    withServices(<Connections />, client)
    await connect(0)
    // One way in: its first step at once, saying what it needs.
    expect(await screen.findByRole('heading', { name: 'Make a Power-Up key on Trello' })).toBeTruthy()
    expect(screen.getByText('A key of yours on Trello, then a token you allow for it')).toBeTruthy()
    const field = screen.getByLabelText('Power-Up API key')
    await userEvent.type(field, `${key}${key}{Enter}`)
    expect(screen.getByText('That’s the Power-Up’s secret; paste its API key')).toBeTruthy()
    await userEvent.clear(field)
    await userEvent.type(field, `${key}{Enter}`)
    expect(screen.getByRole('heading', { name: 'Allow Althar on Trello' })).toBeTruthy()
    expect(screen.getByText('Made for your key ····8f90: Althar, read and write, no expiry.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Open Trello’s allow page' }))
    expect(open).toHaveBeenCalledWith(`https://trello.com/1/authorize?response_type=token&key=${key}`, '_blank')
    await userEvent.click(screen.getByRole('button', { name: 'Paste it myself' }))
    await userEvent.type(screen.getByLabelText('Paste it'), 'ATTAtoken{Enter}')
    expect(client.connectToken).toHaveBeenCalledWith({ product: 'trello', token: 'ATTAtoken', webUrl: 'https://trello.com', key })
    open.mockRestore()
  })

  it('signs in in the browser by a code, then lets GitHub’s app into the projects’ owner', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    let state: 'waiting' | 'done' = 'waiting'
    const installing = {
      ...githubCheck,
      lines: githubCheck.lines.map((line) =>
        line.need === 'reach'
          ? {
              ...line,
              state: 'no' as const,
              reason: { kind: 'not_installed' as const, owner: 'northwind', url: 'https://github.com/apps/althar/installations/new' },
            }
          : line,
      ),
    }
    const { client } = fakeClient({
      listConnections: vi.fn(async () => ({
        ...connectionList,
        products: connectionList.products.map((product) => (product.product === 'github' ? { ...product, browserSignIn: true } : product)),
      })),
      getSignIn: vi.fn(async () => (state === 'waiting' ? { state } : { state, connectionId: 'conn1' })),
      checkConnection: vi.fn().mockResolvedValueOnce(installing).mockResolvedValue(githubCheck),
    })
    withServices(<Connections />, client)
    await connect(0)
    await userEvent.click(
      await screen.findByRole('button', { name: /Continue with GitHub\s*Approve in your browser, then let Althar into northwind/ }),
    )
    expect(client.startSignIn).toHaveBeenCalledWith('github', 'https://github.com')
    expect(await screen.findByText('ABCD-1234')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Type this code on GitHub' })).toBeTruthy()
    expect(open).toHaveBeenCalledWith('https://github.com/login/device', '_blank')
    state = 'done'
    expect(await screen.findByRole('heading', { name: 'Let Althar into northwind' }, { timeout: 4000 })).toBeTruthy()
    await userEvent.click(await screen.findByRole('button', { name: 'Install Althar on northwind' }))
    expect(open).toHaveBeenLastCalledWith('https://github.com/apps/althar/installations/new', '_blank')
    // Asked again, a little apart, until it is let in.
    expect(await screen.findByRole('heading', { name: 'Connected as you' }, { timeout: 6000 })).toBeTruthy()
    open.mockRestore()
  }, 15_000)

  it('says how a browser sign-in ended, starts it again once, and cancels one left for another way', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const { client } = fakeClient({
      listConnections: vi.fn(async () => ({
        ...connectionList,
        products: connectionList.products.map((product) => (product.product === 'github' ? { ...product, browserSignIn: true } : product)),
      })),
      getSignIn: vi.fn(async () => ({ state: 'ended' as const, reason: 'denied' as const, message: 'Sign-in was declined.' })),
    })
    withServices(<Connections />, client)
    await connect(0)
    await userEvent.click(await screen.findByRole('button', { name: /Continue with GitHub/ }))
    expect(await screen.findByText('Sign-in was declined.', {}, { timeout: 4000 })).toBeTruthy()
    vi.mocked(client.getSignIn).mockResolvedValue({ state: 'waiting' })
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('ABCD-1234')).toBeTruthy()
    expect(client.startSignIn).toHaveBeenCalledTimes(2)
    await userEvent.click(screen.getByRole('button', { name: 'Another way' }))
    expect(await screen.findByRole('group', { name: 'Ways to connect GitHub' })).toBeTruthy()
    expect(client.cancelSignIn).toHaveBeenCalledWith('flow1')
    open.mockRestore()
  }, 15_000)

  it('lists a connection on a company’s own server with its address, and one that needs signing in again', async () => {
    const { client } = fakeClient({
      listConnections: vi.fn(async () => ({
        ...connectionList,
        connections: [
          { ...githubConnection, id: 'conn3', webUrl: 'https://git.meridian.dev' },
          {
            ...githubConnection,
            id: 'conn4',
            product: 'linear' as const,
            name: 'Linear',
            webUrl: 'https://linear.app',
            state: 'reauth_required' as const,
          },
        ],
      })),
    })
    withServices(<Connections />, client)
    expect(await screen.findByText(/git\.meridian\.dev/)).toBeTruthy()
    expect(screen.getByText('Its sign-in stopped working')).toBeTruthy()
    // A connected service that runs on companies' own servers takes another, by its address.
    await userEvent.click(screen.getByRole('button', { name: 'Add a server' }))
    expect(await screen.findByLabelText('Server address')).toBeTruthy()
  })

  it('says when the list can’t be read', async () => {
    const { client } = fakeClient({
      listConnections: vi.fn(async () => Promise.reject(new ApiError({ reason: 'X', message: 'No list.' }))),
    })
    withServices(<Connections />, client)
    expect(await screen.findByText('No list.')).toBeTruthy()
  })
})

describe('the thread, reaching outside', () => {
  it('unfurls pasted links, shows what arrived, and the pull request a task opened', async () => {
    const { client } = fakeClient({
      getThread: vi.fn(async (): Promise<ThreadSnapshot> =>
        snapshot({
          items: [
            items.you('Do MER-231, like #1206', null, [
              {
                kind: 'issue',
                product: 'linear',
                key: 'MER-231',
                title: 'Rate-limit refunds',
                url: 'https://linear.app/m/issue/MER-231/x',
                status: { name: 'In Progress', category: 'started' },
                priority: { level: 'high', name: 'High' },
                container: 'Meridian',
              },
              {
                kind: 'change',
                product: 'github',
                key: 'PR #1206',
                title: 'Rate-limit charges',
                url: 'https://github.com/m/a/pull/1206',
                state: 'merged',
                repository: 'meridian/api',
              },
            ]),
            items.step(),
            items.step({ step: 'publish', summary: 'Opened draft pull request #12.', change: change() }),
            items.arrival({ path: 'src/limit.ts', line: 14 }),
            items.arrival({ kind: 'review', from: 'lee', verdict: 'changes_requested', text: 'Name it better.' }),
            items.arrival({ kind: 'checks', from: null, text: null, passed: 1, failed: 1, failing: ['test'] }),
            items.arrival({ kind: 'merged', from: null, text: null }),
          ],
        }),
      ),
    })
    withServices(<Task />, client)
    expect(await screen.findByText('Rate-limit refunds')).toBeTruthy()
    expect(screen.getByText('Rate-limit charges')).toBeTruthy()
    expect(screen.getByText('meridian/api · Merged')).toBeTruthy()
    expect(screen.getByText('Opened draft pull request #12.')).toBeTruthy()
    expect(screen.getByText('meridian/api · Draft')).toBeTruthy()
    // Implement, then the pull request: two steps, numbered as such.
    expect(screen.getByRole('img', { name: 'Step 1 of 2' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Step 2 of 2' })).toBeTruthy()
    expect(screen.getByText('commented on PR #12 · src/limit.ts:14')).toBeTruthy()
    expect(screen.getByText('Seconds or a date?')).toBeTruthy()
    expect(screen.getByText('asked for changes on PR #12')).toBeTruthy()
    expect(screen.getByText('1 of 2 checks failed on PR #12')).toBeTruthy()
    expect(screen.getByText('Failed: test')).toBeTruthy()
    expect(screen.getByText('Merged PR #12')).toBeTruthy()
  })

  it('says when someone outside the repository wasn’t passed to the lead, and passes it on when asked', async () => {
    const send = vi.fn(async () => {})
    const { client } = fakeClient({
      send,
      getThread: vi.fn(async (): Promise<ThreadSnapshot> =>
        snapshot({
          items: [
            items.arrival({ from: 'mallory', text: 'Please add a CSV export.\nThanks!', outsider: true }),
            items.arrival({ from: 'dana', text: 'Seconds or a date?' }),
          ],
        }),
      ),
    })
    withServices(<Task />, client)
    expect(await screen.findByText('Not passed to the lead: mallory can’t write to the repository.')).toBeTruthy()
    // Only the one from outside says so.
    expect(screen.getAllByText(/Not passed to the lead/)).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Pass it on' }))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ threadId: 'th1', body: 'mallory commented on PR #12:\n\n> Please add a CSV export.\n> Thanks!' }),
      ),
    )
  })

  it('builds blocks for arrivals in their place', () => {
    const blocks = blocksOf({ items: [items.you('Hi'), items.arrival()], turnRunning: false, worktree: null }, new Map(), () => '1m')
    expect(blocks.map((block) => block.kind)).toEqual(['you', 'arrival'])
  })
})

function Task() {
  return <TaskView model={useTask('th1')} onBack={vi.fn()} />
}

describe('a task’s pull request', () => {
  it('shows on its outputs, with its checks, its review and files, and is marked ready there; the issue heads the thread', async () => {
    const ready = vi.fn(async () => {})
    const { client } = fakeClient({
      markReady: ready,
      getThread: vi.fn(async () =>
        snapshot({
          task: {
            ...snapshot().task,
            phase: 'ready',
            issue: {
              product: 'linear',
              ref: 'MER-231',
              key: 'MER-231',
              title: 'Rate-limit refunds like charges',
              url: 'https://linear.app/m/issue/MER-231/x',
              status: { name: 'Todo', category: 'todo' },
              priority: null,
              container: null,
            },
            changes: [change()],
            files: [{ path: 'src/limit.ts', from: null, status: 'modified', add: 12, del: 3, binary: false, uncommitted: false }],
            commits: 2,
          },
          items: [items.step({ step: 'review', verdict: 'pass', agentId: 'codex', summary: 'Holds.' })],
        }),
      ),
    })
    withServices(<Task />, client)
    // Ready, it opens on what it made.
    const outputs = within(await screen.findByRole('article', { name: 'Add a retry' }))
    // Opening a task with a pull request asks its host for news.
    await waitFor(() => expect(client.refreshTask).toHaveBeenCalledWith('t1'))
    expect(outputs.getByText('limit.ts')).toBeTruthy()
    expect(outputs.getByText('test')).toBeTruthy()
    // Its review says how it went, not what the reviewer wrote: that is in the conversation.
    expect(outputs.getByText('Review')).toBeTruthy()
    expect(outputs.queryByText('Holds.')).toBeNull()
    expect(outputs.getByText('Its checks run on it; mark it ready when you are')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open on GitHub' }).getAttribute('href')).toBe('https://github.com/meridian/api/pull/12')
    await userEvent.click(screen.getByRole('button', { name: 'Mark ready for review' }))
    expect(ready).toHaveBeenCalledWith('t1', 'https://github.com/meridian/api/pull/12')
    // The conversation is a switch away, and the issue heads it.
    await userEvent.click(screen.getByRole('radio', { name: /Conversation/ }))
    expect(await screen.findByText('Rate-limit refunds like charges')).toBeTruthy()
    expect(screen.queryByRole('article', { name: 'Add a retry' })).toBeNull()
  })

  it('pushes what the lead committed since, from its outputs, up to what it showed', async () => {
    const push = vi.fn(async () => {})
    const { client } = fakeClient({
      push,
      getThread: vi.fn(async () =>
        snapshot({
          task: { ...snapshot().task, phase: 'ready', changes: [change({ unpushed: 2, localHead: 'def456' })], commits: 4 },
        }),
      ),
    })
    withServices(<Task />, client)
    expect(await screen.findByText('2 commits aren’t on the pull request yet.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Push 2 commits' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('t1', 'def456', 'https://github.com/meridian/api/pull/12'))
  })

  it('shows what it changed, file by file, from its header, its outputs, or ⌘D', async () => {
    const file = (path: string, more: Partial<ThreadSnapshot['task']['files'][number]> = {}) => ({
      path,
      from: null,
      status: 'modified' as const,
      add: 1,
      del: 1,
      binary: false,
      uncommitted: false,
      ...more,
    })
    const getFileDiff = vi.fn(async (_taskId: string, path: string) => {
      if (path === 'notes.md') throw new ApiError({ reason: 'NotFound', message: 'It went away' })
      return {
        file: file(path),
        lines: [
          { kind: 'hunk' as const, text: '@@ -1 +1 @@' },
          { kind: 'removed' as const, old: 1, text: 'const tries = 3', changed: ['3'] },
          { kind: 'added' as const, new: 1, text: 'const tries = 5', changed: ['5'] },
        ],
        truncated: false,
      }
    })
    const { client } = fakeClient({
      getFileDiff,
      getThread: vi.fn(async () =>
        snapshot({
          task: {
            ...snapshot().task,
            branch: 'althar/retry',
            baseRef: 'origin/main',
            changes: [change()],
            files: [file('src/limit.ts'), file('notes.md', { status: 'added', del: 0, uncommitted: true })],
          },
        }),
      ),
    })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: /^2 files/ }))
    const view = await screen.findByRole('dialog', { name: 'Changes' })
    expect(within(view).getByText('althar/retry into main')).toBeTruthy()
    // The first file, read from the runtime when you get to it.
    const line = (words: string) => (_: string, element: Element | null) =>
      element?.tagName === 'SPAN' && element.textContent === words && element.querySelector('mark') !== null
    expect(await within(view).findByText(line('const tries = 5'))).toBeTruthy()
    expect(getFileDiff).toHaveBeenLastCalledWith('t1', 'src/limit.ts')
    // An editor here opens the task's folder at the file and its first change; the others are a menu away.
    await userEvent.click(await within(view).findByRole('button', { name: 'Open in Zed' }))
    expect(client.openInEditor).toHaveBeenLastCalledWith({ taskId: 't1', editor: 'zed', path: 'src/limit.ts', line: 1 })
    await userEvent.click(within(view).getByRole('button', { name: 'Open in another editor' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Show in Finder' }))
    expect(client.openInEditor).toHaveBeenLastCalledWith({ taskId: 't1', editor: 'finder', path: 'src/limit.ts', line: 1 })
    // Finder, used last, comes first next time.
    expect(within(view).getByRole('button', { name: 'Show in Finder' })).toBeTruthy()
    window.localStorage.removeItem('althar.editor')
    // One that can't be read says why, and tries again.
    await userEvent.click(within(view).getByRole('button', { name: /notes\.md/ }))
    expect(await within(view).findByText('It went away')).toBeTruthy()
    expect(within(view).getByText(/Not committed yet/)).toBeTruthy()
    await userEvent.click(within(view).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(getFileDiff).toHaveBeenCalledTimes(3))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Changes' })).toBeNull())
    // From its outputs, on a file; and with ⌘D, not a bare D, which speech or typing could set off.
    await userEvent.keyboard('o')
    await userEvent.click(await screen.findByRole('button', { name: 'Open the diff of src/limit.ts' }))
    expect(await screen.findByRole('dialog', { name: 'Changes' })).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Changes' })).toBeNull())
    await userEvent.keyboard('d')
    expect(screen.queryByRole('dialog', { name: 'Changes' })).toBeNull()
    await userEvent.keyboard('{Meta>}d{/Meta}')
    expect(await screen.findByRole('dialog', { name: 'Changes' })).toBeTruthy()
  })

  it('says on its outputs that it is ready to accept, merged, or closed', async () => {
    for (const [shown, words] of [
      [change({ draft: false }), 'Nothing merges until you accept it'],
      [change({ state: 'merged', draft: false, checks: null }), 'Merged'],
      [
        change({ state: 'closed', draft: false, noun: 'merge request', short: 'MR', prefix: '!', product: 'gitlab' }),
        'MR !12 was closed on GitLab.',
      ],
    ] as const) {
      const { client } = fakeClient({ getThread: vi.fn(async () => snapshot({ task: { ...snapshot().task, changes: [shown] } })) })
      const view = withServices(<Task />, client)
      await userEvent.click(await screen.findByRole('radio', { name: /Outputs/ }))
      expect((await screen.findAllByText(words)).length).toBeGreaterThan(0)
      view.unmount()
    }
  })

  it('needs the person when it can’t be opened: tried again, or gone on without', async () => {
    const answer = vi.fn(async () => {})
    const call = (why: 'not_connected' | 'failed_to_start') => ({
      id: `a-${why}`,
      kind: 'stuck' as const,
      title: '',
      reason: '',
      command: null,
      stuck: {
        step: 'publish' as const,
        why,
        detail: why === 'failed_to_start' ? 'The host said no.' : null,
        agentId: null,
        round: 0,
        open: 0,
      },
      createdAt: '2026-10-01T10:00:00.000Z',
    })
    const { client } = fakeClient({
      answerStuck: answer,
      getThread: vi.fn(async () => snapshot({ attention: [call('not_connected')] })),
    })
    withServices(<Task />, client)
    expect(await screen.findByText(/isn't connected to this repository's host/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(answer).toHaveBeenCalledWith({ attentionId: 'a-not_connected', answer: { kind: 'retry', agentId: 'althar' } })
    expect(stuckWords.publishing(call('failed_to_start').stuck)).toBe("Althar couldn't open the pull request. The host said no.")
    expect(stuckWords.publishing({ ...call('failed_to_start').stuck, why: 'restarted', detail: null })).toBe(
      'Althar restarted while it was opening the pull request.',
    )
    expect(stuckWords.publishing({ ...call('failed_to_start').stuck, detail: null })).toBe("Althar couldn't open the pull request.")
  })
})

function Project() {
  return (
    <ProjectView
      model={useProject('p1')}
      board={useBoard('p1')}
      connections={useConnections()}
      menu={{ model: useProjectMenu('p1', vi.fn()), onRepositories: vi.fn(), onRules: vi.fn() }}
      onTask={vi.fn()}
    />
  )
}

describe('a project, reaching outside', () => {
  it('says nothing of an unconnected host up front, and connects it from the project’s menu in the bar, on any view', async () => {
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () =>
        coordinatorSnapshot({ host: { product: 'github', name: 'GitHub', webUrl: 'https://github.com', connected: false } }),
      ),
    })
    withServices(<Project />, client)
    await screen.findByRole('textbox', { name: 'Tell the coordinator something' })
    // Pushing needs no connection, so nothing stands in the way of the conversation.
    expect(screen.queryByText(/isn't connected to GitHub/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'More for this project' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Connect GitHub' }))
    const dialog = await screen.findByRole('dialog', { name: 'Code hosts and trackers' })
    expect(within(dialog).getByText('GitHub')).toBeTruthy()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // On the board too, where nothing of the conversation shows.
    await userEvent.click(screen.getByRole('radio', { name: 'Board' }))
    await userEvent.click(screen.getByRole('button', { name: 'More for this project' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Connect GitHub' }))
    expect(await screen.findByRole('dialog', { name: 'Code hosts and trackers' })).toBeTruthy()
  })

  it('shows each of a task’s pull requests by its repository, and acts on the one open', async () => {
    const ready = vi.fn(async () => {})
    const web = change({ number: 4, repository: 'meridian/web', url: 'https://github.com/meridian/web/pull/4' })
    const { client } = fakeClient({
      markReady: ready,
      getThread: vi.fn(async () => snapshot({ task: { ...snapshot().task, phase: 'ready', changes: [change(), web] } })),
    })
    withServices(<Task />, client)
    expect(await screen.findByRole('link', { name: 'Open on GitHub · api' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Mark web ready for review' }))
    expect(ready).toHaveBeenCalledWith('t1', 'https://github.com/meridian/web/pull/4')
  })

  it('accepts its pull requests in turn, each at the head it showed, and stops at the first refused', async () => {
    const api = change({ draft: false })
    const web = change({
      number: 4,
      repository: 'meridian/web',
      url: 'https://github.com/meridian/web/pull/4',
      draft: false,
      head: 'def456',
    })
    const ready = { ...snapshot().task, phase: 'ready' as const, changes: [api, web], commits: 2 }
    // The first waits until the test says: the second isn't asked for meanwhile, and Accept stays busy.
    let finish: () => void = () => undefined
    const merge = vi.fn(
      (_taskId: string, head: string) =>
        new Promise<void>((resolve) => {
          if (head === 'abc123') finish = resolve
          else resolve()
        }),
    )
    const { client } = fakeClient({ merge, getThread: vi.fn(async () => snapshot({ task: ready })) })
    const view = withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Accept and merge both' }))
    await waitFor(() => expect(merge).toHaveBeenCalledTimes(1))
    expect(merge).toHaveBeenLastCalledWith('t1', 'abc123', 'https://github.com/meridian/api/pull/12')
    expect(screen.getByRole('button', { name: 'Accept and merge both' }).getAttribute('aria-busy')).toBe('true')
    act(() => finish())
    await waitFor(() => expect(merge).toHaveBeenLastCalledWith('t1', 'def456', 'https://github.com/meridian/web/pull/4'))
    view.unmount()

    // Refused, the first stops it there: the second waits, and the refusal is said.
    const refused = vi.fn(async () => {
      throw new ApiError({ reason: 'ChangedSinceSeen', message: 'It moved on since you looked.' })
    })
    const second = fakeClient({ merge: refused, getThread: vi.fn(async () => snapshot({ task: ready })) })
    withServices(<Task />, second.client)
    await userEvent.click(await screen.findByRole('button', { name: 'Accept and merge both' }))
    expect(await screen.findByText(/It moved on since you looked/)).toBeTruthy()
    expect(refused).toHaveBeenCalledTimes(1)
  })

  it('shows each pull request’s files under its repository’s folder here, however the host names it', async () => {
    const file = (path: string) => ({ path, from: null, status: 'modified' as const, add: 1, del: 0, binary: false, uncommitted: false })
    const web = change({ number: 4, repository: 'meridian/Web', slug: 'web-app', url: 'https://github.com/meridian/Web/pull/4' })
    const { client } = fakeClient({
      getThread: vi.fn(async () =>
        snapshot({
          task: {
            ...snapshot().task,
            phase: 'ready',
            changes: [change({ slug: 'api' }), web],
            files: [file('api/src/limit.ts'), file('web-app/src/button.tsx')],
            commits: 2,
          },
        }),
      ),
    })
    withServices(<Task />, client)
    expect(await screen.findByText('button.tsx')).toBeTruthy()
    expect(screen.getByText('limit.ts')).toBeTruthy()
  })

  it('pushes what the lead committed since to the repository it was committed in', async () => {
    const push = vi.fn(async () => {})
    const web = change({
      number: 4,
      repository: 'meridian/web',
      url: 'https://github.com/meridian/web/pull/4',
      unpushed: 1,
      localHead: 'def456',
    })
    const { client } = fakeClient({
      push,
      getThread: vi.fn(async () =>
        snapshot({ task: { ...snapshot().task, changes: [change({ unpushed: 2, localHead: 'abc999' }), web] } }),
      ),
    })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('radio', { name: /Outputs/ }))
    expect(await screen.findByRole('button', { name: 'Push 2 commits to api' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Push 1 commit to web' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('t1', 'def456', 'https://github.com/meridian/web/pull/4'))
  })

  it('shows a task’s issue and pull request on its card, and its ending on its plan, which can change', async () => {
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () =>
        coordinatorSnapshot({
          items: [
            items.card(
              card({ plan: { ...card().plan!, end: 'draft' }, issue: { product: 'linear', key: 'MER-231', title: 't', url: 'u' } }),
              'c1',
            ),
            items.card(card({ taskId: 't2', slug: 'shipped', phase: 'ready', change: change(), plan: null }), 'c2'),
          ],
        }),
      ),
    })
    withServices(<Project />, client)
    expect((await screen.findAllByText('MER-231')).length).toBeGreaterThan(0)
    expect(screen.getByText('PR #12')).toBeTruthy()
    // No rule of the project's picked the draft pull request, so none is named.
    expect(screen.queryByText(/rule/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Open a draft PR/ }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: /Push the branch only/ }))
    await waitFor(() => expect(screen.getByText('this task only')).toBeTruthy())
    await waitFor(() => expect(client.changePlan).toHaveBeenLastCalledWith('pln1', expect.any(Array), 'none'))
  })
})

describe('what reaching outside says, in every case', () => {
  it('draws each product with its own name and mark, and an issue’s status and priority as the kit’s', () => {
    const all: ReadonlyArray<Product> = ['github', 'gitlab', 'bitbucket_cloud', 'bitbucket_dc', 'linear', 'jira_cloud', 'jira_dc', 'trello']
    expect(all.map(productName)).toEqual(['GitHub', 'GitLab', 'Bitbucket', 'Bitbucket', 'Linear', 'Jira', 'Jira', 'Trello'])
    expect(productBrand('jira_dc')).toBe(Brand.Jira)
    expect((['triage', 'backlog', 'todo', 'started', 'done', 'cancelled'] as const).map(issueStatus)).toEqual([
      IssueStatus.Backlog,
      IssueStatus.Backlog,
      IssueStatus.Todo,
      IssueStatus.InProgress,
      IssueStatus.Done,
      IssueStatus.Cancelled,
    ])
    expect(['urgent', 'high', 'medium', 'low', 'none', 'odd'].map(issuePriority)).toEqual([
      IssuePriority.Urgent,
      IssuePriority.High,
      IssuePriority.Medium,
      IssuePriority.Low,
      IssuePriority.None,
      IssuePriority.None,
    ])
  })

  it('lists each service once, Cloud and Data Center together, with where the projects’ code is or what it is for', () => {
    const list = {
      ...connectionList,
      products: [
        ...connectionList.products,
        {
          ...connectionList.products[1]!,
          product: 'jira_cloud' as const,
          service: 'jira' as const,
          name: 'Jira',
          hostedUrl: null,
          tokenNeeds: 'email' as const,
        },
        {
          ...connectionList.products[1]!,
          product: 'jira_dc' as const,
          service: 'jira' as const,
          name: 'Jira Data Center',
          hostedUrl: null,
          selfHosted: true,
        },
        {
          ...connectionList.products[0]!,
          product: 'bitbucket_dc' as const,
          service: 'bitbucket' as const,
          name: 'Bitbucket Data Center',
          tracker: false,
          hostedUrl: null,
        },
      ],
      places: [
        ...connectionList.places,
        {
          product: 'bitbucket_dc' as const,
          webUrl: 'https://git.tessera.studio',
          project: 'tessera',
          remote: null,
          repositories: ['TS/app'],
        },
      ],
      connections: [{ ...githubConnection, webUrl: 'https://git.meridian.dev' }],
    }
    expect(servicesOf(list).map((service) => [service.id, service.name, service.what, service.selfHosted])).toEqual([
      ['github', 'GitHub', 'meridian’s code is here', true],
      ['bitbucket', 'Bitbucket', 'tessera’s code is on git.tessera.studio', true],
      ['linear', 'Linear', 'Issues', undefined],
      ['jira', 'Jira', 'Issues', true],
    ])
    expect(servicesOf(list, { what: false }).map((service) => service.what)).toEqual([
      'meridian’s code is here',
      'tessera’s code is on git.tessera.studio',
      undefined,
      undefined,
    ])
    expect(connectionsOf(list)).toEqual([{ id: 'conn1', service: 'github', account: 'you', instance: 'https://git.meridian.dev' }])
  })

  it('says each thing that arrives in its own words', async () => {
    const { client } = fakeClient({
      getThread: vi.fn(async (): Promise<ThreadSnapshot> =>
        snapshot({
          items: [
            items.arrival({ kind: 'review', from: 'lee', verdict: 'approved', text: '' }),
            items.arrival({ kind: 'review', from: 'kim', verdict: null, text: 'Fine.' }),
            items.arrival({ kind: 'checks', from: null, text: null, passed: 3, failed: 0, failing: [] }),
            items.arrival({ kind: 'checks', from: null, text: null, passed: 0, failed: 2, failing: ['test', 'lint'] }),
            items.arrival({ kind: 'closed', from: null, text: null, source: 'gitlab', where: 'MR !4' }),
            items.arrival({ kind: 'ready', from: null, text: null }),
            items.step({ step: 'publish', summary: 'Pushed althar/x.', change: null }),
            items.step({ step: 'publish', summary: 'Opened pull request #12 for review.', change: change({ draft: false }) }),
            items.you('See', null, [
              {
                kind: 'issue',
                product: 'github',
                key: '#12',
                title: 'Refunds ignore the limit',
                url: 'https://github.com/m/a/issues/12',
                status: { name: 'Open', category: 'todo' },
                priority: null,
                container: null,
              },
            ]),
          ],
        }),
      ),
    })
    withServices(<Task />, client)
    expect(await screen.findByText('approved PR #12')).toBeTruthy()
    expect(screen.getByText('reviewed PR #12')).toBeTruthy()
    expect(screen.getByText('Checks passed on PR #12')).toBeTruthy()
    expect(screen.getByText('Checks failed on PR #12')).toBeTruthy()
    expect(screen.getByText('Failed: test, lint')).toBeTruthy()
    expect(screen.getByText('Closed MR !4')).toBeTruthy()
    expect(screen.getByText('Ready for review: PR #12')).toBeTruthy()
    expect(screen.getByText('Push')).toBeTruthy()
    expect(screen.getByText('meridian/api · Open')).toBeTruthy()
    expect(screen.getByText('Refunds ignore the limit')).toBeTruthy()
  })
})
