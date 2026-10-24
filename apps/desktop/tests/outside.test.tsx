import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type Product, type Service, type ThreadItem, type ThreadSnapshot } from '@althar/contracts'
import { Brand, IssuePriority, IssueStatus } from '@althar/ui'

import { useConnections } from '../src/renderer/features/connections/useConnections'
import { useBoard } from '../src/renderer/features/board/useBoard'
import { ConnectPanel } from '../src/renderer/features/connections/ConnectPanel'
import { connectionsOf, ConnectionsView, servicesOf } from '../src/renderer/features/connections/ConnectionsView'
import { ProjectView } from '../src/renderer/features/project/ProjectView'
import { useProject } from '../src/renderer/features/project/useProject'
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
  githubGuide,
  items,
  NOW,
  repositories,
  runnables,
  snapshot,
} from './fixtures'
import { useSettingsOf, withServices } from './render'

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
    expect(client.connectCli).toHaveBeenLastCalledWith('github', 'https://github.com', undefined)
    expect(await screen.findByRole('heading', { name: 'Connected as you' })).toBeTruthy()
    expect(screen.getByText('gh’s token; it runs out when gh’s does.')).toBeTruthy()
    // Another way goes back to the ways.
  })

  it('puts right what gh’s sign-in can’t do with a token for the same place, made or pasted', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const refused = {
      ...githubCheck,
      lines: githubCheck.lines.map((line) =>
        line.need === 'account' ? { ...line, state: 'no' as const, fact: null, reason: { kind: 'refused' as const } } : line,
      ),
    }
    const { client } = fakeClient({ checkConnection: vi.fn().mockResolvedValueOnce(refused).mockResolvedValue(githubCheck) })
    withServices(<ConnectPanel service="github" onClose={vi.fn()} />, client)
    const panel = await screen.findByRole('complementary', { name: 'Connect GitHub' })
    await userEvent.click(await within(panel).findByRole('button', { name: /Use gh’s sign-in/ }))
    await userEvent.click(within(panel).getByRole('button', { name: 'Use this sign-in' }))

    // GitHub no longer takes gh's token: another one pasted, on a token's own steps.
    expect(await within(panel).findByRole('heading', { name: 'GitHub didn’t take that token' })).toBeTruthy()
    await userEvent.click(within(panel).getByRole('button', { name: 'Paste another' }))
    expect(within(panel).getByLabelText('Paste it')).toBeTruthy()
    // Back from there is where that token is made; back from that, gh's way again.
    await userEvent.click(within(panel).getByRole('button', { name: 'Back' }))
    expect(within(panel).getByRole('heading', { name: 'Make a token on GitHub' })).toBeTruthy()
    await userEvent.click(within(panel).getByRole('button', { name: 'Paste it myself' }))
    await userEvent.type(within(panel).getByLabelText('Paste it'), 'github_pat_new{Enter}')
    expect(client.connectToken).toHaveBeenLastCalledWith({ product: 'github', token: 'github_pat_new', webUrl: 'https://github.com' })
    expect(await within(panel).findByRole('heading', { name: 'Connected as you' })).toBeTruthy()
    await userEvent.click(within(panel).getByRole('button', { name: 'Back' }))
    await userEvent.click(within(panel).getByRole('button', { name: 'Back' }))
    await userEvent.click(within(panel).getByRole('button', { name: 'Back' }))
    expect(within(panel).getByRole('heading', { name: 'Use gh’s sign-in' })).toBeTruthy()
    open.mockRestore()
  })

  it('makes a new token for what gh’s sign-in can’t do, on the page for the same place', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const refused = {
      ...githubCheck,
      lines: githubCheck.lines.map((line) =>
        line.need === 'account' ? { ...line, state: 'no' as const, fact: null, reason: { kind: 'refused' as const } } : line,
      ),
    }
    const { client } = fakeClient({ checkConnection: vi.fn().mockResolvedValueOnce(refused).mockResolvedValue(githubCheck) })
    withServices(<Connections />, client)
    await connect(0)
    await userEvent.click(await screen.findByRole('button', { name: /Use gh’s sign-in/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Use this sign-in' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Make a new one' }))
    expect(open).toHaveBeenCalledWith(GITHUB_TOKEN_PAGE, '_blank')
    await userEvent.type(screen.getByLabelText('Paste it'), 'github_pat_new{Enter}')
    expect(client.connectToken).toHaveBeenLastCalledWith({ product: 'github', token: 'github_pat_new', webUrl: 'https://github.com' })
    expect(await screen.findByRole('heading', { name: 'Connected as you' })).toBeTruthy()
    open.mockRestore()
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
    expect(client.startSignIn).toHaveBeenCalledWith('github', 'https://github.com', undefined)
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

  it('drops what answers late for a way, a token or a sign-in left behind, and goes on once a server answers', async () => {
    /** A call answered when the test says, in the order it was made. */
    const later = <A,>() => {
      const waiting: Array<(value: A) => void> = []
      const call = vi.fn(() => new Promise<A>((resolve) => void waiting.push(resolve)))
      return { call, answer: (index: number, value: A) => waiting[index]?.(value) }
    }
    const connected = later<typeof githubConnection>()
    const checked = later<typeof githubCheck>()
    const started = later<{ flowId: string; kind: 'device'; userCode: string; verificationUri: string; expiresAt: string }>()
    const servers = later<{ product: 'github' | null; webUrl: string; reason: null; tokenPage: string | null }>()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const { client } = fakeClient({
      listConnections: vi.fn(async () => ({
        ...connectionList,
        products: connectionList.products.map((product) => (product.product === 'github' ? { ...product, browserSignIn: true } : product)),
      })),
      connectToken: connected.call,
      checkConnection: checked.call,
      startSignIn: started.call,
      findServer: servers.call,
    })
    const closed = vi.fn()
    withServices(<ConnectPanel service="github" onClose={closed} />, client)
    const panel = await screen.findByRole('complementary', { name: 'Connect GitHub' })
    const back = () => userEvent.click(within(panel).getByRole('button', { name: 'Back' }))

    // A token sent, and the way left before GitHub answers: its answer doesn't move gh's way on.
    await userEvent.click(await within(panel).findByRole('button', { name: /Make a token/ }))
    await userEvent.click(within(panel).getByRole('button', { name: 'Paste it myself' }))
    await userEvent.type(within(panel).getByLabelText('Paste it'), 'github_pat_first{Enter}')
    await back()
    await back()
    await userEvent.click(await within(panel).findByRole('button', { name: /Use gh’s sign-in/ }))
    await act(async () => connected.answer(0, githubConnection))
    expect(within(panel).getByRole('heading', { name: 'Use gh’s sign-in' })).toBeTruthy()

    // A check left for another token: its late answer isn't the new token's.
    await back()
    await userEvent.click(await within(panel).findByRole('button', { name: /Make a token/ }))
    await userEvent.click(within(panel).getByRole('button', { name: 'Paste it myself' }))
    await userEvent.type(within(panel).getByLabelText('Paste it'), 'github_pat_second{Enter}')
    await act(async () => connected.answer(1, githubConnection))
    expect(await within(panel).findByRole('heading', { name: 'Checking what it can do' })).toBeTruthy()
    await back()
    await userEvent.type(within(panel).getByLabelText('Paste it'), 'github_pat_third{Enter}')
    await act(async () => connected.answer(2, githubConnection))
    const lacking = {
      ...githubCheck,
      lines: githubCheck.lines.map((line) => ({ ...line, state: 'no' as const, reason: { kind: 'refused' as const } })),
    }
    await act(async () => checked.answer(0, lacking))
    expect(within(panel).getByRole('heading', { name: 'Checking what it can do' })).toBeTruthy()
    await act(async () => checked.answer(1, githubCheck))
    expect(await within(panel).findByRole('heading', { name: 'Connected as you' })).toBeTruthy()

    // A browser sign-in left while it starts, and started again: the first is cancelled, the second shown.
    await back()
    await back()
    await back()
    await userEvent.click(await within(panel).findByRole('button', { name: /Continue with GitHub/ }))
    await back()
    await userEvent.click(await within(panel).findByRole('button', { name: /Continue with GitHub/ }))
    expect(client.startSignIn).toHaveBeenCalledTimes(2)
    const device = {
      kind: 'device' as const,
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
      expiresAt: '2026-10-11T10:00:00.000Z',
    }
    await act(async () => started.answer(0, { ...device, flowId: 'first' }))
    expect(client.cancelSignIn).toHaveBeenCalledWith('first')
    await act(async () => started.answer(1, { ...device, flowId: 'second', userCode: 'WXYZ-0000' }))
    expect(await within(panel).findByText('WXYZ-0000')).toBeTruthy()

    // A company's server, pressed on before it answers: on, once it answers.
    await back()
    await userEvent.click(within(panel).getByRole('button', { name: 'On a company’s own server' }))
    await userEvent.type(within(panel).getByLabelText('Server address'), 'git.meridian.dev')
    await userEvent.click(within(panel).getByRole('button', { name: 'Make a token' }))
    await waitFor(() => expect(servers.call.mock.calls.length).toBeGreaterThanOrEqual(1))
    const answer = {
      product: 'github' as const,
      webUrl: 'https://git.meridian.dev',
      reason: null,
      tokenPage: 'https://git.meridian.dev/settings/tokens/new',
    }
    await waitFor(() => expect(servers.call.mock.calls.length).toBe(2), { timeout: 2000 })
    await act(async () => {
      servers.answer(0, answer)
      servers.answer(1, answer)
    })
    expect(await within(panel).findByRole('heading', { name: 'Make a token on git.meridian.dev' })).toBeTruthy()
    expect(closed).not.toHaveBeenCalled()
    open.mockRestore()
  }, 20_000)

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

  it('lists two of Linear’s workspaces side by side, each by its name, and adds another the way the first was', async () => {
    const workspace = (id: string, key: string, name: string) => ({
      ...githubConnection,
      id,
      product: 'linear' as const,
      name: 'Linear',
      webUrl: 'https://linear.app',
      account: { login: 'mate.kokai99', name: 'Mate' },
      workspace: { key, name },
    })
    const { client } = fakeClient({
      listConnections: vi.fn(async () => ({
        ...connectionList,
        connections: [workspace('conn5', 'althar', 'althar'), workspace('conn6', 'fnt', 'FNT')],
      })),
    })
    withServices(<Connections />, client)
    expect(await screen.findByText('· FNT')).toBeTruthy()
    expect(screen.getByText('· althar')).toBeTruthy()
    expect(screen.getAllByText('Signed in as mate.kokai99', { exact: false })).toHaveLength(2)
    // Each disconnects on its own.
    const [, second] = screen.getAllByRole('button', { name: 'Disconnect' })
    if (second === undefined) throw new Error('no second Disconnect')
    await userEvent.click(second)
    await waitFor(() => expect(client.disconnect).toHaveBeenCalledWith('conn6'))
    // Another workspace is the first one's walk in again, not a server's.
    expect(screen.queryByRole('button', { name: 'Add a server' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Add a workspace' }))
    expect(await screen.findByRole('heading', { name: /Linear/ })).toBeTruthy()
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
    // Althar's words for the pull request it opened, and the pull request under them.
    expect(screen.getByText('Opened draft pull request #12.')).toBeTruthy()
    expect(screen.getByText('meridian/api · Draft')).toBeTruthy()
    expect(screen.getByText('commented on PR #12 · src/limit.ts:14')).toBeTruthy()
    expect(screen.getByText('Seconds or a date?')).toBeTruthy()
    expect(screen.getByText('asked for changes on PR #12')).toBeTruthy()
    expect(screen.getByText('1 of 2 checks failed on PR #12')).toBeTruthy()
    expect(screen.getByText('Failed: test')).toBeTruthy()
    expect(screen.getByText('Merged PR #12')).toBeTruthy()
  })

  it('reads a pasted link as its key, with its card in the message it came in', async () => {
    const { client } = fakeClient({
      getThread: vi.fn(async (): Promise<ThreadSnapshot> =>
        snapshot({
          items: [
            items.you('Do https://linear.app/m/issue/MER-231, like https://github.com/m/a/pull/1206. Not https://example.com/x.', null, [
              {
                kind: 'issue',
                product: 'linear',
                key: 'MER-231',
                title: 'Rate-limit refunds',
                url: 'https://linear.app/m/issue/MER-231/rate-limit-refunds',
                pasted: 'https://linear.app/m/issue/MER-231',
                status: { name: 'Todo', category: 'todo' },
                priority: null,
                container: null,
              },
              {
                kind: 'change',
                product: 'github',
                key: 'PR #1206',
                title: 'Rate-limit charges',
                url: 'https://github.com/m/a/pull/1206',
                pasted: 'https://github.com/m/a/pull/1206',
                state: 'merged',
                repository: 'meridian/api',
              },
            ]),
            items.you('Nothing linked here.'),
          ],
        }),
      ),
    })
    withServices(<Task />, client)
    const [linked, plain] = await screen.findAllByRole('article', { name: 'You' })
    const message = within(linked as HTMLElement)
    // The words say each link's key where it was pasted; an address that didn't unfurl stays as written.
    expect(message.getByText(/^Do /).textContent).toBe('Do MER-231, like #1206. Not https://example.com/x.')
    // Each card is in the message, under its words, and opens the link.
    expect(message.getByRole('link', { name: /Rate-limit refunds/ }).getAttribute('href')).toBe(
      'https://linear.app/m/issue/MER-231/rate-limit-refunds',
    )
    expect(message.getByRole('link', { name: /Rate-limit charges/ }).getAttribute('href')).toBe('https://github.com/m/a/pull/1206')
    expect(within(plain as HTMLElement).getByText('Nothing linked here.')).toBeTruthy()
    expect(within(plain as HTMLElement).queryByRole('link')).toBeNull()
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

describe('running what a task built, with no agent', () => {
  it('runs it from the task’s bar, shows it over the composer beside what its lead left running, and stops each its own way', async () => {
    const thread = snapshot()
    const serving = { id: 'bg-1', command: 'bun dev', url: 'http://localhost:5173/', startedAt: '2026-10-10T09:00:00.000Z', ended: null }
    const { client, emit } = fakeClient({
      getThread: vi.fn(async () => ({
        ...thread,
        task: { ...thread.task, runnables },
        session: thread.session === null ? null : { ...thread.session, background: [serving] },
      })),
    })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: /^Run$/ }))
    expect(client.runProject).toHaveBeenCalledWith('p1', 't1', 'th1', 'rnbl_dev')
    // The run comes back on the watch: one for another task, or another project, says nothing here.
    const launch = {
      id: 'proc_1',
      taskId: 't1',
      runnableId: 'rnbl_dev',
      where: 'Fix the login timeout',
      command: 'bun run dev',
      url: 'http://localhost:4173/',
      startedAt: '2026-10-10T09:05:00.000Z',
      ended: null,
    }
    act(() =>
      emit({ _tag: 'Launches', projectId: 'p1', launches: [launch, { ...launch, id: 'proc_2', taskId: 't9', command: 'make serve' }] }),
    )
    act(() => emit({ _tag: 'Launches', projectId: 'p9', launches: [{ ...launch, id: 'proc_3', command: 'cargo run' }] }))
    const pill = await screen.findByRole('button', { name: /^Running/ })
    await waitFor(() => expect(pill.textContent).toContain('2 processes'))
    await userEvent.click(pill)
    const list = within(await screen.findByRole('dialog', { name: 'Running' }))
    expect(list.queryByText('make serve')).toBeNull()
    expect(list.queryByText('cargo run')).toBeNull()
    // Each stops its own way: Althar's run, and what the lead left running.
    await userEvent.click(list.getByRole('button', { name: 'Stop bun run dev' }))
    expect(client.stopLaunch).toHaveBeenCalledWith('proc_1')
    await userEvent.click(list.getByRole('button', { name: 'Stop bun dev' }))
    expect(client.stopBackground).toHaveBeenCalledWith('th1', 'bg-1')
  })

  it('leaves a card in the thread that follows the run: open where it answers, stop it, run it again once it ended', async () => {
    const thread = snapshot()
    const card = items.run()
    let current = { ...thread, items: [...thread.items, card], task: { ...thread.task, runCommand: 'bun run dev' } }
    const { client, emit } = fakeClient({
      getThread: vi.fn(async () => current),
      getThreadItem: vi.fn(async () => current.items.at(-1) as ThreadItem),
    })
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null)
    withServices(<Task />, client)
    const shown = within(await screen.findByRole('article', { name: 'Run of Fix the login timeout' }))
    await userEvent.click(shown.getByRole('button', { name: 'Open localhost:4173' }))
    expect(opened).toHaveBeenCalledWith('http://localhost:4173/', '_blank')
    await userEvent.click(shown.getByRole('button', { name: 'Stop bun run dev' }))
    expect(client.stopLaunch).toHaveBeenCalledWith('proc_1')
    expect(shown.queryByRole('button', { name: 'Run bun run dev again' })).toBeNull()
    // It ended by itself: it says how, with its last line, and runs again here.
    const ended = {
      ...card,
      content: { ...card.content, ended: { at: NOW, code: 1, stopped: false, last: 'Error: Port 4173 is already in use' } },
    } as ThreadItem
    current = { ...current, items: [...thread.items, ended] }
    act(() => emit(changed('thread_item', card.id)))
    const again = await screen.findByRole('button', { name: 'Run bun run dev again' })
    expect(screen.getByText('Error: Port 4173 is already in use')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Stop bun run dev' })).toBeNull()
    await userEvent.click(again)
    expect(client.runProject).toHaveBeenCalledWith('p1', 't1', 'th1')
    opened.mockRestore()
  })

  it('shows Althar setting up the worktree before the lead starts: as it installs, once it has, and what it printed if it failed', async () => {
    const thread = snapshot()
    const setup = items.setup()
    let current = { ...thread, items: [...thread.items, setup] }
    const { client, emit } = fakeClient({
      getThread: vi.fn(async () => current),
      getThreadItem: vi.fn(async () => current.items.at(-1) as ThreadItem),
    })
    withServices(<Task />, client)
    expect(await screen.findByText('Installing dependencies in meridian…')).toBeTruthy()
    type Setup = Extract<ThreadItem, { kind: 'setup' }>['content']
    const ended = (over: Partial<NonNullable<Setup['ended']>>, more: Partial<Setup> = {}) =>
      ({
        ...setup,
        content: {
          ...(setup.content as Setup),
          ...more,
          ended: { at: NOW, code: 0, timedOut: false, stopped: false, last: null, ...over },
        },
      }) as ThreadItem
    // Installed, it is Althar's housekeeping: it goes with the lead's work, and the line across the thread goes.
    current = { ...thread, items: [...thread.items, ended({})] }
    act(() => emit(changed('thread_item', setup.id)))
    await waitFor(() => expect(screen.queryByText('Installing dependencies in meridian…')).toBeNull())
    expect(screen.queryByText('bun install --frozen-lockfile')).toBeNull()
    // Failed, the end of what it printed stands under it, with how it ended; the lead hears of it.
    current = { ...thread, items: [...thread.items, ended({ code: 1, last: 'resolving\nerror: lockfile had changes' })] }
    act(() => emit(changed('thread_item', setup.id)))
    expect(await screen.findByText('Couldn’t install dependencies in meridian. The lead is told.')).toBeTruthy()
    expect(screen.getByText('error: lockfile had changes')).toBeTruthy()
    expect(screen.getByText('exit 1')).toBeTruthy()
    // A setup kept for the repository, out of time: it says so.
    current = {
      ...thread,
      items: [...thread.items, ended({ code: null, timedOut: true, last: 'waiting' }, { kept: true, command: 'make deps' })],
    }
    act(() => emit(changed('thread_item', setup.id)))
    expect(await screen.findByText('Couldn’t set up meridian. The lead is told.')).toBeTruthy()
    expect(screen.getByText('It took too long, and was stopped.')).toBeTruthy()
    // Cut short as Althar quit, it says it runs again.
    current = { ...thread, items: [...thread.items, ended({ code: null, stopped: true })] }
    act(() => emit(changed('thread_item', setup.id)))
    expect(await screen.findByText('Setting up meridian stopped as Althar quit. It runs again before the lead starts.')).toBeTruthy()
  })

  it('offers no run where nothing says how it runs', async () => {
    const { client } = fakeClient()
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'More for this task' }))
    expect(screen.queryByRole('menuitem', { name: /^Run / })).toBeNull()
  })
})

describe('what keeps the places a task waits for', () => {
  it('names the task whose server keeps a place, over the composer of the task that waits, and stops it from there', async () => {
    const server = { id: 'bg-1', command: 'bun dev', url: 'http://localhost:5173/', startedAt: '2026-10-10T09:00:00.000Z', ended: null }
    const thread = snapshot()
    const holders = [
      { taskId: 't2', title: 'Prototype the board', threadId: 'th2', kept: true, running: [server] },
      { taskId: 't3', title: 'Fix the login', threadId: 'th3', kept: false, running: [] },
    ]
    const { client } = fakeClient({
      getThread: vi.fn(async () => ({ ...thread, task: { ...thread.task, queued: { busy: 2, atOnce: 2, holders } } })),
    })
    withServices(<Task />, client)
    const pill = await screen.findByRole('button', { name: /^Keeping a place/ })
    expect(pill.textContent).toContain('bun dev')
    await userEvent.click(pill)
    const list = within(await screen.findByRole('dialog', { name: 'Keeping a place' }))
    // Which task it is from; a task at work in its turn is not a server to stop.
    expect(list.getByText(/Prototype the board/)).toBeTruthy()
    expect(list.queryByText(/Fix the login/)).toBeNull()
    // Every task that holds a place is named beside the wait, the server's by what it left running.
    expect(screen.getByText('Held by Prototype the board (a server it left running), Fix the login')).toBeTruthy()
    await userEvent.click(list.getByRole('button', { name: 'Stop bun dev' }))
    expect(client.stopBackground).toHaveBeenCalledWith('th2', 'bg-1')
  })
})

describe('a task waiting in its project’s line', () => {
  it('can go to the front of the line from its own view, when it is 2nd or later', async () => {
    const thread = snapshot()
    const holders = [{ taskId: 't3', title: 'Fix the login', threadId: 'th3', kept: false, running: [] }]
    let place = 2
    const { client, emit } = fakeClient({
      getThread: vi.fn(async () => ({ ...thread, task: { ...thread.task, place, queued: { busy: 1, atOnce: 1, holders } } })),
    })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Move to the front of the line' }))
    expect(client.moveInLine).toHaveBeenCalledWith(thread.task.id, 0)
    // First in line, it has nowhere further to go.
    place = 1
    act(() => emit(changed('task', 't1')))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Move to the front of the line' })).toBeNull())
    expect(screen.getByText('Held by Fix the login')).toBeTruthy()
  })
})

describe('a waiting task’s open view', () => {
  it('reads who holds the places again when its task changes: a server that went idle leaves the list, a task that took its place joins it', async () => {
    const server = { id: 'bg-1', command: 'bun dev', url: null, startedAt: '2026-10-10T09:00:00.000Z', ended: null }
    const thread = snapshot()
    let holders = [{ taskId: 't2', title: 'Prototype the board', threadId: 'th2', kept: true, running: [server] }]
    const { client, emit } = fakeClient({
      getThread: vi.fn(async () => ({ ...thread, task: { ...thread.task, queued: { busy: 1, atOnce: 1, holders } } })),
    })
    withServices(<Task />, client)
    expect(await screen.findByText('Held by Prototype the board (a server it left running)')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Keeping a place/ })).toBeTruthy()
    holders = [{ taskId: 't3', title: 'Fix the login', threadId: 'th3', kept: false, running: [] }]
    act(() => emit(changed('task', 't1')))
    expect(await screen.findByText('Held by Fix the login')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Keeping a place/ })).toBeNull()
  })
})

describe('what a task’s lead left running', () => {
  it('shows over the composer, opens where it answers, stops it, follows it as it changes, and clears one that exited', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const serving = { id: 'bg-1', command: 'bun dev', url: 'http://localhost:5173/', startedAt: '2026-10-10T09:00:00.000Z', ended: null }
    const thread = snapshot()
    const { client, emit } = fakeClient({
      getThread: vi.fn(async () => ({ ...thread, session: thread.session === null ? null : { ...thread.session, background: [serving] } })),
    })
    withServices(<Task />, client)
    const pill = await screen.findByRole('button', { name: /^Running/ })
    expect(pill.textContent).toContain('bun dev')
    expect(pill.textContent).toContain('localhost:5173')
    // Where it answers opens in the person's browser; Stop stops it.
    await userEvent.click(pill)
    const list = within(await screen.findByRole('dialog', { name: 'Running' }))
    await userEvent.click(list.getByRole('button', { name: 'Open localhost:5173' }))
    expect(open).toHaveBeenCalledWith('http://localhost:5173/', '_blank')
    await userEvent.click(list.getByRole('button', { name: 'Stop bun dev' }))
    expect(client.stopBackground).toHaveBeenCalledWith('th1', 'bg-1')
    await userEvent.keyboard('{Escape}')
    // It follows what the runtime says: one that exited by itself says how, and can be cleared.
    act(() =>
      emit({
        _tag: 'Background',
        threadId: 'th1',
        background: [{ ...serving, id: 'bg-2', command: 'bun run seed', url: null, ended: { at: '2026-10-10T09:10:00.000Z', code: 1 } }],
      }),
    )
    const ran = await screen.findByRole('button', { name: /^Ran/ })
    expect(ran.textContent).toContain('exited 1')
    await userEvent.click(ran)
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Ran' })).getByRole('button', { name: 'Clear bun run seed' }))
    expect(client.clearBackground).toHaveBeenCalledWith('th1', 'bg-2')
    act(() => emit({ _tag: 'Background', threadId: 'th1', background: [] }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /^(Running|Ran)/ })).toBeNull())
    // Another thread's says nothing here.
    act(() => emit({ _tag: 'Background', threadId: 'th9', background: [serving] }))
    expect(screen.queryByRole('button', { name: /^Running/ })).toBeNull()
  })
})

describe('a server a task’s lead left running, as it named it', () => {
  it('leads with its name and address, quietly says the command at a glance, and shows what it prints', async () => {
    const server = {
      id: 'bg-1',
      name: 'Site dev server',
      command: 'cd /w/site && node_modules/.bin/vp dev --config ../../a/vite.config.ts 2>&1 | tail -20',
      label: 'vp dev',
      url: 'http://localhost:5173/',
      startedAt: '2026-10-10T09:00:00.000Z',
      ended: null,
    }
    const thread = snapshot()
    const readBackgroundOutput = vi.fn(async () => ({ text: 'VITE ready in 312 ms\n  ➜  Local:   http://localhost:5173/\n', dropped: 0 }))
    const { client } = fakeClient({
      getThread: vi.fn(async () => ({ ...thread, session: thread.session === null ? null : { ...thread.session, background: [server] } })),
      readBackgroundOutput,
    })
    withServices(<Task />, client)
    const pill = await screen.findByRole('button', { name: /^Running/ })
    expect(pill.textContent).toBe('RunningSite dev server· localhost:5173')
    await userEvent.click(pill)
    const list = within(await screen.findByRole('dialog', { name: 'Running' }))
    expect(list.getByText('Site dev server')).toBeTruthy()
    expect(list.getByText('vp dev').getAttribute('title')).toBe(server.command)
    await userEvent.click(list.getByRole('button', { name: 'Show the output of Site dev server' }))
    const output = within(await screen.findByRole('dialog', { name: 'Output of Site dev server' }))
    expect(await output.findByText(/VITE ready in 312 ms/)).toBeTruthy()
    expect(readBackgroundOutput).toHaveBeenCalledWith('th1', 'bg-1')
    await userEvent.click(output.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Output of Site dev server' })).toBeNull())
  })
})

describe('a task’s pull request', () => {
  it('says over the composer that it listens to it, says for a moment what it hears, and stops when asked', async () => {
    let thread = snapshot({ task: { ...snapshot().task, changes: [change()] }, items: [items.arrival()] })
    const checks = items.arrival({ kind: 'checks', from: null, text: null, passed: 2, failed: 0 })
    const { client, emit } = fakeClient({ getThread: vi.fn(async () => thread), getThreadItem: vi.fn(async () => checks) })
    withServices(<Task />, client)
    const pill = await screen.findByRole('button', { name: /^Listening to/ })
    expect(pill.textContent).toContain('PR #12')
    // What it heard before the task opened isn't said again.
    expect(within(pill).queryByText(/dana/)).toBeNull()
    // Something arrives while it is open: the pill says it, and so does a screen reader.
    act(() => emit(changed('thread_item', checks.id)))
    expect(await within(pill).findByText('Checks passed on PR #12')).toBeTruthy()
    // Its list says what it listens for and when it last heard, and stops it.
    await userEvent.click(pill)
    const list = within(await screen.findByRole('dialog', { name: 'Listening to' }))
    expect(list.getByText('meridian/api')).toBeTruthy()
    expect(list.getByText(/^review comments and checks · ./)).toBeTruthy()
    await userEvent.click(list.getByRole('button', { name: 'Stop listening to PR #12' }))
    expect(client.stopListening).toHaveBeenCalledWith('t1', 'https://github.com/meridian/api/pull/12')
    // Once it no longer listens, the pill goes.
    thread = { ...thread, task: { ...thread.task, changes: [change({ listening: false })] } }
    act(() => emit(changed('external_link', 'l1')))
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Listening to/ })).toBeNull())
  })

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
    // Its checks in a line, what failed by name, opening to the list.
    await userEvent.click(outputs.getByRole('button', { name: 'Its checks: test failed' }))
    expect(outputs.getByText('lint')).toBeTruthy()
    // Its review says how it went, not what the reviewer wrote: that is in the conversation.
    expect(outputs.getByText(/^Reviewed by/)).toBeTruthy()
    expect(outputs.queryByText('Holds.')).toBeNull()
    expect(outputs.getByText('Draft')).toBeTruthy()
    // Its number is the one link to its host.
    expect(outputs.getByRole('link', { name: 'Open meridian/api #12 on GitHub' }).getAttribute('href')).toBe(
      'https://github.com/meridian/api/pull/12',
    )
    expect(outputs.getAllByRole('link')).toHaveLength(1)
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
    await userEvent.click(await screen.findByRole('button', { name: 'Push 2 commits' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('t1', 'def456', 'https://github.com/meridian/api/pull/12'))
  })

  it('says plainly a branch rewritten since it was pushed, replaces its commits only once confirmed, or asks the lead to merge', async () => {
    const url = 'https://github.com/meridian/api/pull/12'
    const { client } = fakeClient({
      mergeNote: vi.fn(async () => 'Your branch was rewritten after it was pushed. Merge, never rebase.'),
      getThread: vi.fn(async () =>
        snapshot({
          task: {
            ...snapshot().task,
            phase: 'ready',
            changes: [change({ localHead: 'def456', diverged: { kind: 'rewritten', local: 5, onPullRequest: 4 } })],
            commits: 5,
          },
        }),
      ),
    })
    withServices(<Task />, client)
    expect(
      await screen.findByText('This branch was rewritten since it was pushed: 5 new commits replace 4 on the pull request.'),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Push/ })).toBeNull()
    // Replacing names what goes, and pushes only on the second press, from the head it saw.
    await userEvent.click(screen.getByRole('button', { name: 'Replace the pull request’s commits' }))
    expect(client.replacePullRequest).not.toHaveBeenCalled()
    expect(screen.getByText(/^Replace the 4 commits on PR #12 with the 5 commits here\?/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Replace them' }))
    await waitFor(() => expect(client.replacePullRequest).toHaveBeenCalledWith('t1', 'def456', 'abc123', url))
    // Or the lead merges instead: Althar fetches what was pushed, and the note goes to it.
    await userEvent.click(screen.getByRole('button', { name: 'Ask the lead to merge instead' }))
    await waitFor(() => expect(client.mergeNote).toHaveBeenCalledWith('t1', url))
    await waitFor(() =>
      expect(client.send).toHaveBeenCalledWith(
        expect.objectContaining({ body: 'Your branch was rewritten after it was pushed. Merge, never rebase.' }),
      ),
    )
  })

  it('says a push refused for commits pushed from elsewhere in a sentence, and offers to bring them in', async () => {
    const url = 'https://github.com/meridian/api/pull/12'
    const { client } = fakeClient({
      getThread: vi.fn(async () =>
        snapshot({ task: { ...snapshot().task, phase: 'ready', changes: [change({ unpushed: 1, localHead: 'def456' })], commits: 4 } }),
      ),
    })
    vi.mocked(client.push).mockRejectedValueOnce(
      new ApiError({
        reason: 'PushRefused',
        message: 'PR #12 has commits that aren’t here yet, so it didn’t take the push. Bring them in, then push again.',
        why: 'behind',
      }),
    )
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Push 1 commit' }))
    expect(
      await screen.findByText(
        'The pull request has commits pushed from elsewhere that aren’t on this branch, so it won’t take a plain push.',
      ),
    ).toBeTruthy()
    expect(screen.queryByText(/fast-forwards/)).toBeNull()
    expect(screen.queryByText(/didn’t take the push/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Replace/ })).toBeNull()
    // What fails after is said on the card, not hidden behind the refusal.
    vi.mocked(client.mergeNote).mockRejectedValueOnce(new ApiError({ reason: 'ConnectorFailed', message: 'GitHub no longer takes it.' }))
    await userEvent.click(screen.getByRole('button', { name: 'Bring in the pull request’s commits' }))
    expect(await within(screen.getByRole('article', { name: 'Add a retry' })).findByText('GitHub no longer takes it.')).toBeTruthy()
    expect(client.send).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Bring in the pull request’s commits' }))
    await waitFor(() => expect(client.mergeNote).toHaveBeenCalledWith('t1', url))
    await waitFor(() => expect(client.send).toHaveBeenCalledWith(expect.objectContaining({ body: 'Merge them.' })))
    expect(await screen.findByRole('button', { name: 'Push 1 commit' })).toBeTruthy()
  })

  it('asks, in the thread, for a push the lead asked for: what would go up, pushed up to the head it shows', async () => {
    const thread = snapshot()
    const asked = items.push()
    let current = { ...thread, items: [...thread.items, asked] }
    const push = vi.fn(async () => {})
    const { client, emit } = fakeClient({
      push,
      getThread: vi.fn(async () => current),
      getThreadItem: vi.fn(async () => current.items.at(-1) as ThreadItem),
    })
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null)
    withServices(<Task />, client)
    const card = within(await screen.findByRole('article', { name: 'Push to PR #12' }))
    expect(card.getByText('Read Retry-After as seconds')).toBeTruthy()
    expect(card.getByText('Name the retry option')).toBeTruthy()
    await userEvent.click(card.getByRole('button', { name: 'Open PR #12' }))
    expect(opened).toHaveBeenCalledWith('https://github.com/meridian/api/pull/12', '_blank')
    await userEvent.click(card.getByRole('button', { name: 'Push 2 commits to PR #12' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('t1', 'def4567890', 'https://github.com/meridian/api/pull/12'))
    // The branch changed since: the runtime shows what is on it now, and Push pushes that.
    const moved = {
      ...asked,
      content: { ...asked.content, moved: true, head: 'fed7654321', commits: [{ sha: 'fed7654', subject: 'Name it again' }], count: 1 },
    } as ThreadItem
    current = { ...current, items: [...thread.items, moved] }
    act(() => emit(changed('thread_item', asked.id)))
    expect(await screen.findByText('The branch changed since this was asked. This is what is on it now.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Push 1 commit to PR #12' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('t1', 'fed7654321', 'https://github.com/meridian/api/pull/12'))
    // Changed so that it can't go up: why, and what would let it, with nothing to press.
    current = {
      ...current,
      items: [...thread.items, { ...moved, content: { ...moved.content, commits: [], count: 0, blocked: 'rewritten' } } as ThreadItem],
    }
    act(() => emit(changed('thread_item', asked.id)))
    expect(await screen.findByText(/no longer has what PR #12 already has/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Push \d/ })).toBeNull()
    // Pushed, it stays as a record, with nothing to press.
    current = {
      ...current,
      items: [...thread.items, { ...moved, content: { ...asked.content, state: 'pushed', settledAt: NOW } } as ThreadItem],
    }
    act(() => emit(changed('thread_item', asked.id)))
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push to PR #12' }).textContent).toContain('Pushed'))
    expect(screen.queryByRole('button', { name: /^Push \d/ })).toBeNull()
    opened.mockRestore()
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
      [change({ draft: false }), 'Accept and merge'],
      [change({ state: 'merged', draft: false, checks: null }), 'Merged'],
      [
        change({ state: 'closed', draft: false, noun: 'merge request', short: 'MR', prefix: '!', product: 'gitlab' }),
        'MR !12 was closed on GitLab.',
      ],
    ] as const) {
      const { client } = fakeClient({
        getThread: vi.fn(async () => snapshot({ task: { ...snapshot().task, phase: 'ready', changes: [shown] } })),
      })
      const view = withServices(<Task />, client)
      await screen.findByRole('radio', { name: /Outputs/ })
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
    expect(stuckWords.publishing(call('failed_to_start').stuck)).toBe(
      "Althar couldn't open the pull request. The host said no. Try again, or go on without it.",
    )
    expect(stuckWords.publishing({ ...call('failed_to_start').stuck, why: 'restarted', detail: null })).toBe(
      'Althar restarted twice while opening the pull request, so it paused in case that caused it. If you restarted Althar yourself, try again.',
    )
    expect(stuckWords.publishing({ ...call('failed_to_start').stuck, detail: null })).toBe(
      "Althar couldn't open the pull request. Try again, or go on without it.",
    )
  })
})

function Project() {
  return (
    <ProjectView
      model={useProject('p1')}
      board={useBoard('p1')}
      connections={useConnections()}
      settings={useSettingsOf('p1')}
      onTask={vi.fn()}
    />
  )
}

describe('a project, reaching outside', () => {
  it('says nothing of an unconnected host up front, and walks in to it from where its work goes, in the project’s settings', async () => {
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () =>
        coordinatorSnapshot({ host: { product: 'github', name: 'GitHub', webUrl: 'https://github.com', connected: false } }),
      ),
      // Its repositories' work goes to GitHub, which Althar isn't connected to.
      getRepositories: vi.fn(async () =>
        repositories.map((one) => (one.host?.product === 'github' ? { ...one, host: { ...one.host, account: null } } : one)),
      ),
      connectToken: vi.fn(async () => githubConnection),
    })
    withServices(<Project />, client)
    await screen.findByRole('textbox', { name: 'Tell the coordinator something' })
    // Pushing needs no connection, so nothing stands in the way of the conversation.
    expect(screen.queryByText(/isn't connected to GitHub/)).toBeNull()
    /** GitHub, where its repositories' work goes in the project's settings, which says it isn't connected. */
    const connectFromSettings = async () => {
      await userEvent.click(screen.getByRole('radio', { name: /^Settings/ }))
      await userEvent.click(
        within(screen.getByRole('navigation', { name: 'Project settings' })).getByRole('button', { name: 'Code and issues' }),
      )
      const github = within(await screen.findByRole('region', { name: 'GitHub' }))
      expect(github.getByText('Not connected')).toBeTruthy()
      await userEvent.click(github.getByRole('button', { name: 'Connect GitHub' }))
    }
    await connectFromSettings()
    // GitHub's own walk in, at a sign-in card's width, over the project.
    const shown = await screen.findByRole('dialog', { name: 'GitHub' })
    const dialog = within(shown)
    expect(await dialog.findByRole('group', { name: 'Ways to connect GitHub' })).toBeTruthy()
    expect(shown.style.width).toMatch(/^min\(480px,/)
    // Nothing to press Done on yet, and nothing to step back to.
    expect(dialog.queryByRole('button', { name: 'Done' })).toBeNull()
    expect(dialog.queryByRole('button', { name: 'Back' })).toBeNull()
    // A step in, its way back steps it back, and so does Escape.
    await userEvent.click(dialog.getByRole('button', { name: /Make a token/ }))
    expect(dialog.getByRole('heading', { name: 'Make a token on GitHub' })).toBeTruthy()
    await userEvent.click(dialog.getByRole('button', { name: 'Back' }))
    expect(await dialog.findByRole('group', { name: 'Ways to connect GitHub' })).toBeTruthy()
    await userEvent.click(dialog.getByRole('button', { name: /Make a token/ }))
    await userEvent.click(dialog.getByRole('button', { name: 'Paste it myself' }))
    await userEvent.keyboard('{Escape}')
    expect(dialog.getByRole('heading', { name: 'Make a token on GitHub' })).toBeTruthy()
    await userEvent.click(dialog.getByRole('button', { name: 'Paste it myself' }))
    await userEvent.type(dialog.getByLabelText('Paste it'), 'github_pat_e2e{Enter}')
    expect(await dialog.findByRole('heading', { name: 'Connected as you' })).toBeTruthy()
    // One Done, the walk's own: it closes the walk.
    expect(dialog.getAllByRole('button', { name: 'Done' })).toHaveLength(1)
    await userEvent.click(dialog.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // From the board too: the settings are a view of their own, whichever the project was on.
    await userEvent.click(screen.getByRole('radio', { name: 'Board' }))
    await connectFromSettings()
    expect(await screen.findByRole('dialog', { name: 'GitHub' })).toBeTruthy()
  })

  it('opens all the code hosts and trackers to connect a tracker, walks in to one in their place, and comes back to them', async () => {
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () =>
        coordinatorSnapshot({ host: { product: 'github', name: 'GitHub', webUrl: 'https://github.com', connected: true } }),
      ),
      listConnections: vi.fn(async () => ({ ...connectionList, connections: [githubConnection] })),
      // Linear's walk starts from nothing of GitHub's.
      getConnectGuide: vi.fn(async (service: Service) =>
        service === 'github' ? githubGuide : { service, places: [], clis: [], email: null, tokenPages: [] },
      ),
    })
    withServices(<Project />, client)
    await userEvent.click(await screen.findByRole('radio', { name: /^Settings/ }))
    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'Project settings' })).getByRole('button', { name: 'Code and issues' }),
    )
    await userEvent.click(
      within(await screen.findByRole('region', { name: 'Trackers' })).getByRole('button', { name: 'Connect a tracker' }),
    )
    const shown = await screen.findByRole('dialog', { name: 'Code hosts and trackers' })
    const dialog = within(shown)
    expect(await dialog.findByText('Signed in as you')).toBeTruthy()
    expect(shown.style.width).toMatch(/^min\(720px,/)
    // Linear's walk, in their place, straight to its one way's first step: the dialog's Done gives way to the walk's own, and its way back is to the list.
    await userEvent.click(dialog.getByRole('button', { name: 'Connect' }))
    expect(await screen.findByRole('dialog', { name: 'Linear' })).toBe(shown)
    expect(shown.style.width).toMatch(/^min\(480px,/)
    expect(await dialog.findByRole('heading', { name: 'Make a key in Linear', level: 3 })).toBeTruthy()
    expect(dialog.queryByRole('button', { name: 'Done' })).toBeNull()
    await userEvent.click(dialog.getByRole('button', { name: 'Back' }))
    expect(await dialog.findByText('Signed in as you')).toBeTruthy()
    expect(dialog.getAllByRole('button', { name: 'Done' })).toHaveLength(1)
    // Escape steps out of a walk to the list, and only then closes it.
    await userEvent.click(dialog.getByRole('button', { name: 'Connect' }))
    await screen.findByRole('dialog', { name: 'Linear' })
    await userEvent.keyboard('{Escape}')
    expect(await screen.findByRole('dialog', { name: 'Code hosts and trackers' })).toBe(shown)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('shows each of a task’s pull requests by its repository, and acts on the one open', async () => {
    const ready = vi.fn(async () => {})
    const web = change({ number: 4, repository: 'meridian/web', url: 'https://github.com/meridian/web/pull/4' })
    const { client } = fakeClient({
      markReady: ready,
      getThread: vi.fn(async () => snapshot({ task: { ...snapshot().task, phase: 'ready', changes: [change(), web] } })),
    })
    withServices(<Task />, client)
    expect((await screen.findByRole('link', { name: 'Open meridian/api #12 on GitHub' })).textContent).toBe('api #12')
    expect(screen.getByRole('link', { name: 'Open meridian/web #4 on GitHub' }).textContent).toBe('web #4')
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

  it('shows only the button pressed as working, the others waiting beside it', async () => {
    let done = () => {}
    const push = vi.fn(() => new Promise<void>((resolve) => (done = resolve)))
    const { client } = fakeClient({
      push,
      getThread: vi.fn(async () =>
        snapshot({ task: { ...snapshot().task, changes: [change({ draft: true, unpushed: 1, localHead: 'def456' })] } }),
      ),
    })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('radio', { name: /Outputs/ }))
    const ready = await screen.findByRole('button', { name: 'Mark ready for review' })
    expect(ready.getAttribute('aria-busy')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Push 1 commit' }))
    await waitFor(() => expect(push).toHaveBeenCalled())
    // The push is working; marking ready waits for it, as the runtime serialises them, but doesn't look like it is working.
    expect(screen.getByRole('button', { name: 'Push 1 commit' }).getAttribute('aria-busy')).toBe('true')
    expect(screen.getByRole('button', { name: 'Mark ready for review' }).getAttribute('aria-busy')).toBeNull()
    expect((screen.getByRole('button', { name: 'Mark ready for review' }) as HTMLButtonElement).disabled).toBe(true)
    done()
    await waitFor(() => expect((screen.getByRole('button', { name: 'Mark ready for review' }) as HTMLButtonElement).disabled).toBe(false))
    expect(screen.getByRole('button', { name: 'Push 1 commit' }).getAttribute('aria-busy')).toBeNull()
  })

  it('offers Accept once what the lead committed since is pushed, and holds the rest while a push is on its way', async () => {
    let done = () => {}
    const push = vi.fn(() => new Promise<void>((resolve) => (done = resolve)))
    const { client } = fakeClient({
      push,
      getThread: vi.fn(async () =>
        snapshot({
          task: { ...snapshot().task, phase: 'ready', changes: [change({ draft: false, unpushed: 1, localHead: 'def456' })], commits: 4 },
        }),
      ),
    })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('radio', { name: /Outputs/ }))
    // Accepting merges what the pull request has: what was committed since goes up first.
    await userEvent.click(await screen.findByRole('button', { name: 'Push 1 commit' }))
    await waitFor(() => expect(push).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Accept and merge' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Push 1 commit' }).getAttribute('aria-busy')).toBe('true')
    done()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Push 1 commit' }).getAttribute('aria-busy')).toBeNull())
  })

  it('holds the push of what merged here while a pull request’s push is on its way', async () => {
    let done = () => {}
    const push = vi.fn(() => new Promise<void>((resolve) => (done = resolve)))
    const merged = [{ repository: 'web', name: 'web', branch: 'main', remote: 'origin/main', ahead: 2 }]
    const { client } = fakeClient({
      push,
      getThread: vi.fn(async () =>
        snapshot({
          task: { ...snapshot().task, phase: 'ready', changes: [change({ unpushed: 1, localHead: 'def456' })], merged, commits: 4 },
        }),
      ),
    })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('radio', { name: /Outputs/ }))
    await userEvent.click(await screen.findByRole('button', { name: /^Push 1 commit/ }))
    await waitFor(() => expect(push).toHaveBeenCalled())
    const here = screen.getByRole('button', { name: 'Push main to origin' }) as HTMLButtonElement
    expect(here.disabled).toBe(true)
    expect(here.getAttribute('aria-busy')).toBeNull()
    done()
    await waitFor(() => expect((screen.getByRole('button', { name: 'Push main to origin' }) as HTMLButtonElement).disabled).toBe(false))
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
            items.arrival({
              kind: 'checks',
              from: null,
              text: null,
              passed: 0,
              failed: 2,
              failing: ['test', 'lint'],
              logs: [
                {
                  name: 'test',
                  url: null,
                  log: [
                    '2026-10-18T19:42:01.1234567Z Run bun test',
                    '2026-10-18T19:42:09.0000000Z FAIL limit.test.ts',
                    '2026-10-18T19:42:09.0000000Z ##[error]Process completed with exit code 1.',
                    '2026-10-18T19:42:10.0000000Z Post job cleanup.',
                  ].join('\n'),
                  missing: null,
                },
                {
                  name: 'lint',
                  url: 'https://github.com/m/a/actions/runs/1/job/2',
                  log: null,
                  missing: 'GitHub refused (401): Bad credentials',
                },
              ],
            }),
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
    // Each failed check shows the end of its log, without its times, or why it couldn't be read, with its page.
    expect(screen.getByText('FAIL limit.test.ts')).toBeTruthy()
    expect(screen.queryByText(/2026-10-18T19:42/)).toBeNull()
    // It ends where Actions marked it failed, not in the job's cleanup after.
    expect(screen.getByText('##[error]Process completed with exit code 1.')).toBeTruthy()
    expect(screen.queryByText('Post job cleanup.')).toBeNull()
    expect(screen.getByText('Couldn’t read its log: GitHub refused (401): Bad credentials.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open its page' }).getAttribute('href')).toBe('https://github.com/m/a/actions/runs/1/job/2')
    expect(screen.getByText('Closed MR !4')).toBeTruthy()
    expect(screen.getByText('Ready for review: PR #12')).toBeTruthy()
    expect(screen.getByText('Pushed althar/x.')).toBeTruthy()
    expect(screen.getByText('meridian/api · Open')).toBeTruthy()
    expect(screen.getByText('Refunds ignore the limit')).toBeTruthy()
  })
})
