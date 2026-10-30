import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type AccessLine,
  type AccessReason,
  ApiError,
  type ConnectGuide,
  type ConnectionCheck,
  type ConnectionSummary,
  type Product,
  type ProductOption,
  type Service,
} from '@althar/contracts'

import type { Client } from '../src/renderer/data/client'
import type { Host } from '../src/renderer/data/services'
import { ConnectPanel } from '../src/renderer/features/connections/ConnectPanel'
import { connectionList, fakeClient, fakeHost, githubCheck, githubGuide } from './fixtures'
import { withServices } from './render'

/*
 * The walk in to each service, in the panel that hosts it beside a
 * project's work: the ways each offers from what the runtime found, each
 * step of a way, what the service says the connection can do and how to put
 * right what it can't, the clipboard, a company's own server, and a
 * connection signed in again. The runtime answers as each test says.
 */

const option = (product: Product, service: Service, name: string, more: Partial<ProductOption> = {}): ProductOption => ({
  product,
  service,
  name,
  host: true,
  tracker: true,
  hostedUrl: null,
  selfHosted: false,
  browserSignIn: false,
  tokenNeeds: null,
  tokenPrefixes: [],
  tokenHelpForKey: null,
  keyChecks: [],
  ...more,
})

const ATLASSIAN = 'https://id.atlassian.com/manage-profile/security/api-tokens'

/** Every product the runtime offers, as it lists them. */
const PRODUCTS: ReadonlyArray<ProductOption> = [
  option('github', 'github', 'GitHub', { hostedUrl: 'https://github.com', selfHosted: true, tokenPrefixes: ['github_pat_', 'ghp_'] }),
  option('gitlab', 'gitlab', 'GitLab', { hostedUrl: 'https://gitlab.com', selfHosted: true, tokenPrefixes: ['glpat-'] }),
  option('bitbucket_cloud', 'bitbucket', 'Bitbucket', {
    tracker: false,
    hostedUrl: 'https://bitbucket.org',
    tokenNeeds: 'email',
    tokenPrefixes: ['ATATT'],
  }),
  option('bitbucket_dc', 'bitbucket', 'Bitbucket Data Center', { tracker: false, selfHosted: true }),
  option('linear', 'linear', 'Linear', { host: false, hostedUrl: 'https://linear.app', tokenPrefixes: ['lin_api_'] }),
  option('jira_cloud', 'jira', 'Jira', { host: false, tokenNeeds: 'email', tokenPrefixes: ['ATATT'] }),
  option('jira_dc', 'jira', 'Jira Data Center', { host: false, selfHosted: true }),
  option('trello', 'trello', 'Trello', {
    host: false,
    hostedUrl: 'https://trello.com',
    tokenNeeds: 'key',
    tokenPrefixes: ['ATTA'],
    tokenHelpForKey: 'https://trello.com/1/authorize?response_type=token&key={key}',
    keyChecks: [
      { pattern: '^[0-9a-f]{64}$', says: 'That’s the Power-Up’s secret; paste its API key' },
      { pattern: '^(?![0-9a-f]{32}$)', says: 'An API key is 32 characters' },
    ],
  }),
]

const guideOf = (service: Service, more: Partial<ConnectGuide> = {}): ConnectGuide => ({
  service,
  places: [],
  clis: [],
  email: null,
  tokenPages: [],
  ...more,
})

type Line = readonly [
  need: AccessLine['need'],
  state: AccessLine['state'],
  fact?: string | null,
  reason?: AccessReason | null,
  count?: number,
]

/** What a service says a connection can do, line by line. */
const checked = (lines: ReadonlyArray<Line>, more: Partial<ConnectionCheck> = {}): ConnectionCheck => ({
  connectionId: 'conn1',
  lines: lines.map(([need, state, fact = null, reason = null, count]) => ({ need, state, fact, count: count ?? null, reason })),
  expiresAt: null,
  renews: false,
  settings: 'https://example.test/settings',
  ...more,
})

const connection = (product: Product, webUrl: string, more: Partial<ConnectionSummary> = {}): ConnectionSummary => ({
  id: 'conn1',
  product,
  name: product,
  webUrl,
  account: { login: 'you', name: 'You' },
  auth: 'token',
  state: 'ready',
  ...more,
})

let open: ReturnType<typeof vi.spyOn>
beforeEach(() => void (open = vi.spyOn(window, 'open').mockReturnValue(null)))
afterEach(() => open.mockRestore())

/** The walk in to a service, in its panel, with the runtime answering as the test says. */
const walk = async (
  service: Service,
  overrides: Partial<Client> = {},
  more: { readonly host?: Host; readonly again?: string; readonly connections?: ReadonlyArray<ConnectionSummary> } = {},
) => {
  const closed = vi.fn()
  const { client } = fakeClient({
    listConnections: vi.fn(async () => ({
      ...connectionList,
      products: [...PRODUCTS],
      connections: [...(more.connections ?? [])],
      places: [],
    })),
    getConnectGuide: vi.fn(async () => guideOf(service)),
    ...overrides,
  })
  withServices(
    <ConnectPanel service={service} onClose={closed} {...(more.again === undefined ? {} : { again: more.again })} />,
    client,
    more.host ?? fakeHost(),
  )
  const name = PRODUCTS.find((candidate) => candidate.service === service)?.name ?? service
  const panel = await screen.findByRole('complementary', {
    name: more.again === undefined ? `Connect ${name}` : `Sign in to ${name} again`,
  })
  const press = (name: string | RegExp) => userEvent.click(within(panel).getByRole('button', { name }))
  const heading = (name: string) => within(panel).findByRole('heading', { name }, { timeout: 4000 })
  return { client, panel, closed, press, heading }
}

/** The window coming back to the front, as after making a token in the browser. */
const comeBack = () => act(async () => void fireEvent.focus(window))

describe('connecting GitLab', () => {
  it('offers its own server first, from a remote, with glab’s sign-in there; puts right a missing scope with a new token from the clipboard', async () => {
    const halyard = 'https://git.halyard.dev'
    const tokenPage = `${halyard}/-/user_settings/personal_access_tokens?name=Althar`
    let clipboard: string | null = null
    const { client, panel, closed, press, heading } = await walk(
      'gitlab',
      {
        getConnectGuide: vi.fn(async () =>
          guideOf('gitlab', {
            places: [{ product: 'gitlab', webUrl: halyard, project: 'halyard', remote: 'origin', repositories: ['team/gateway'] }],
            clis: [{ product: 'gitlab', webUrl: halyard, tool: 'glab', account: 'balazs.k', scopes: ['api'] }],
            tokenPages: [{ product: 'gitlab', webUrl: halyard, url: tokenPage }],
          }),
        ),
        connectCli: vi.fn(async () => connection('gitlab', halyard, { account: { login: 'balazs.k', name: null } })),
        connectToken: vi.fn(async () => connection('gitlab', halyard, { account: { login: 'balazs.k', name: null } })),
        checkConnection: vi
          .fn()
          .mockResolvedValueOnce(
            checked([
              ['server', 'ok', 'git.halyard.dev'],
              ['account', 'ok', 'balazs.k'],
              ['reach', 'ok', 'Developer'],
              ['push', 'ok'],
              ['changes', 'no', null, { kind: 'scope', scope: 'api', url: null }],
              ['checks', 'ok'],
              ['issues', 'ok'],
            ]),
          )
          .mockResolvedValue(
            checked(
              [
                ['server', 'ok', 'git.halyard.dev'],
                ['account', 'ok', 'balazs.k'],
                ['reach', 'ok', 'Developer'],
                ['push', 'ok'],
                ['changes', 'ok'],
                ['checks', 'ok'],
                ['issues', 'ok'],
              ],
              { expiresAt: '2026-12-31T00:00:00.000Z' },
            ),
          ),
      },
      { host: fakeHost({ clipboardToken: vi.fn(async () => clipboard) }) },
    )
    const ways = await within(panel).findByRole('group', { name: 'Ways to connect GitLab' })
    expect(within(panel).getByText('For halyard: team/gateway on git.halyard.dev')).toBeTruthy()
    expect(within(panel).getByText(/Agents never get it; they reach GitLab through Althar/)).toBeTruthy()
    const offered = within(ways)
      .getAllByRole('button')
      .map((button) => button.textContent)
    expect(offered).toEqual([
      'git.halyard.devhalyard’s server, from its remote',
      'Make a tokenOn gitlab.com’s token page, opened filled in',
      'Use glab’s sign-inSigned in to git.halyard.dev as balazs.k',
    ])

    // glab's sign-in: who, what it may do, and where.
    await userEvent.click(within(ways).getByRole('button', { name: /Use glab’s sign-in/ }))
    expect(await heading('Use glab’s sign-in')).toBeTruthy()
    expect(within(panel).getByText('balazs.k on git.halyard.dev')).toBeTruthy()
    expect(within(panel).getByText('api')).toBeTruthy()
    expect(within(panel).getByText('Every project balazs.k can, team’s included')).toBeTruthy()
    expect(within(panel).getByText('Althar keeps its own copy of the token, encrypted. glab keeps working as it does.')).toBeTruthy()
    await press('Use this sign-in')
    expect(client.connectCli).toHaveBeenCalledWith('gitlab', halyard, undefined)

    // It can't open merge requests: GitLab keeps a token's scopes, so a new one is made there.
    expect(await heading('This token can’t open merge requests')).toBeTruthy()
    expect(within(panel).getByText('Open, update and merge merge requests')).toBeTruthy()
    expect(within(panel).getByText('Read pipelines and job logs')).toBeTruthy()
    expect(within(panel).getByText('The token wasn’t given the api scope.')).toBeTruthy()
    expect(within(panel).getByText('A GitLab token keeps the scopes it was made with: make one with api.')).toBeTruthy()
    await press('Make a new one')
    expect(open).toHaveBeenCalledWith(tokenPage, '_blank')
    expect(await heading('Paste the token')).toBeTruthy()

    // The token, noticed on the clipboard as the window comes back; one that isn't GitLab's is let be.
    clipboard = 'ghp_not_gitlabs'
    await comeBack()
    expect(within(panel).queryByText('A GitLab token is on your clipboard')).toBeNull()
    clipboard = 'glpat-new1234567890xyz'
    await comeBack()
    expect(await within(panel).findByText('A GitLab token is on your clipboard')).toBeTruthy()
    expect(within(panel).getByText('glpat-new1234567····xyz')).toBeTruthy()
    expect(within(panel).getByLabelText('Or paste it')).toBeTruthy()
    await press('Use it')
    expect(client.connectToken).toHaveBeenCalledWith({ product: 'gitlab', token: 'glpat-new1234567890xyz', webUrl: halyard })
    expect(await heading('Connected as balazs.k')).toBeTruthy()
    expect(within(panel).getByText('The token runs out on 31 December 2026.')).toBeTruthy()
    // The same token isn't offered again.
    await comeBack()
    expect(within(panel).queryByText('A GitLab token is on your clipboard')).toBeNull()
    await press('Done')
    expect(closed).toHaveBeenCalled()
  })

  it('walks to the server a remote names, or signs in on gitlab.com by a code typed in the browser', async () => {
    const halyard = 'https://git.halyard.dev'
    const { client, panel, press, heading } = await walk('gitlab', {
      listConnections: vi.fn(async () => ({
        ...connectionList,
        products: PRODUCTS.map((product) => (product.product === 'gitlab' ? { ...product, browserSignIn: true } : product)),
        places: [],
      })),
      getConnectGuide: vi.fn(async () =>
        guideOf('gitlab', {
          places: [{ product: 'gitlab', webUrl: halyard, project: 'halyard', remote: 'origin', repositories: ['team/gateway'] }],
        }),
      ),
      findServer: vi.fn(async () => ({ product: 'gitlab' as const, webUrl: halyard, reason: null, tokenPage: `${halyard}/-/tokens` })),
      startSignIn: vi.fn(async () => ({
        flowId: 'flow3',
        kind: 'device' as const,
        userCode: 'WXYZ-0000',
        verificationUri: 'https://gitlab.com/oauth/device?user_code=WXYZ-0000',
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      })),
      getSignIn: vi.fn(async () => ({ state: 'ended' as const, reason: 'expired' as const, message: 'The code expired.' })),
    })
    await press(/git.halyard.dev\s*halyard’s server, from its remote/)
    expect(await heading('halyard’s GitLab')).toBeTruthy()
    expect(
      await within(panel).findByText('GitLab answers at git.halyard.dev · from halyard’s remote, origin', {}, { timeout: 3000 }),
    ).toBeTruthy()
    expect(client.findServer).toHaveBeenCalledWith('gitlab', halyard)
    await press('Make a token')
    expect(await heading('Make a token on git.halyard.dev')).toBeTruthy()
    await press('Back')
    await press('Back')

    await press(/Continue with GitLab\s*gitlab.com, in your browser/)
    expect(await heading('Type this code on GitLab')).toBeTruthy()
    expect(await within(panel).findByText('WXYZ-0000')).toBeTruthy()
    expect(
      within(panel).getByText('gitlab.com/oauth/device is open in your browser. Type the code there, then Authorize Althar.'),
    ).toBeTruthy()
    expect(within(panel).getByText(/Waiting for you to approve · the code lasts (9|10) min/)).toBeTruthy()
    await press('Open the page again')
    expect(open).toHaveBeenLastCalledWith('https://gitlab.com/oauth/device?user_code=WXYZ-0000', '_blank')
    expect(await within(panel).findByText('The code expired.', {}, { timeout: 4000 })).toBeTruthy()
    expect(client.startSignIn).toHaveBeenCalledWith('gitlab', 'https://gitlab.com', undefined)
  })

  it('says each thing it asks GitLab while GitLab is asked, with who the token is', async () => {
    const { panel, press, heading } = await walk('gitlab', {
      getConnectGuide: vi.fn(async () =>
        guideOf('gitlab', {
          places: [{ product: 'gitlab', webUrl: 'https://gitlab.com', project: 'halyard', remote: 'origin', repositories: ['team/api'] }],
        }),
      ),
      connectToken: vi.fn(async () => connection('gitlab', 'https://gitlab.com', { account: { login: 'balazs.k', name: null } })),
      checkConnection: vi.fn(() => new Promise<ConnectionCheck>(() => undefined)),
    })
    expect(await heading('Make a token on gitlab.com')).toBeTruthy()
    await press('Paste it myself')
    expect(within(panel).getByLabelText('Paste it').getAttribute('placeholder')).toBe('glpat-…')
    await userEvent.type(within(panel).getByLabelText('Paste it'), 'glpat-x{Enter}')
    expect(await heading('Checking what it can do')).toBeTruthy()
    expect(within(panel).getByText('Asking GitLab what this sign-in can do in team.')).toBeTruthy()
    expect(within(panel).getByText('Your GitLab account')).toBeTruthy()
    expect(within(panel).getByText('balazs.k')).toBeTruthy()
    expect(within(panel).getByText('Reaches team/api')).toBeTruthy()
    expect(within(panel).queryByText('The server')).toBeNull()
  })

  it('asks a company’s own server for its address, says what doesn’t answer, and steps back by Escape', async () => {
    const { client, panel, closed, press, heading } = await walk('gitlab', {
      getConnectGuide: vi.fn(async () =>
        guideOf('gitlab', {
          tokenPages: [
            { product: 'gitlab', webUrl: 'https://gitlab.com', url: 'https://gitlab.com/-/user_settings/personal_access_tokens' },
          ],
        }),
      ),
      findServer: vi
        .fn()
        .mockResolvedValueOnce({ product: null, webUrl: 'https://gitlab.nowhere.test', reason: 'unreachable', tokenPage: null })
        .mockRejectedValueOnce(new Error('lost'))
        .mockResolvedValue({ product: null, webUrl: 'https://wiki.northwind.test', reason: 'other', tokenPage: null }),
    })
    // One way in, gitlab.com's token: its first step at once, with a company's server a press away.
    expect(await heading('Make a token on gitlab.com')).toBeTruthy()
    expect(within(panel).getByText('On gitlab.com’s token page, opened filled in')).toBeTruthy()
    expect(within(panel).getByText('It opens with the name Althar and the api scope ticked.')).toBeTruthy()
    await press('Open gitlab.com’s token page')
    expect(open).toHaveBeenCalledWith('https://gitlab.com/-/user_settings/personal_access_tokens', '_blank')
    await press('On a company’s own server')
    expect(await heading('Your company’s GitLab')).toBeTruthy()
    expect(within(panel).getByText('On this server Althar connects with a token you make there.')).toBeTruthy()

    // Nothing typed isn't an address; what doesn't answer, or isn't GitLab, is said under the field.
    await press('Make a token')
    expect(within(panel).getByText('That isn’t a server’s address')).toBeTruthy()
    expect(client.findServer).not.toHaveBeenCalled()
    const field = within(panel).getByLabelText('Server address')
    await userEvent.type(field, 'gitlab.nowhere.test{Enter}')
    expect(await within(panel).findByText('Nothing answers at gitlab.nowhere.test')).toBeTruthy()
    await userEvent.clear(field)
    await userEvent.type(field, 'lost.test{Enter}')
    expect(await within(panel).findByText('Nothing answers at lost.test')).toBeTruthy()
    await userEvent.clear(field)
    await userEvent.type(field, 'wiki.northwind.test{Enter}')
    expect(await within(panel).findByText('wiki.northwind.test isn’t a GitLab server')).toBeTruthy()

    // gitlab.com instead; Escape steps back to the server, then, at the start of the walk, closes it.
    await press('gitlab.com instead')
    expect(await heading('Make a token on gitlab.com')).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    expect(closed).toHaveBeenCalled()
  })
})

describe('connecting Bitbucket', () => {
  it('makes an Atlassian token with the email the projects commit with, and says what it can do', async () => {
    const { client, panel, closed, press, heading } = await walk('bitbucket', {
      getConnectGuide: vi.fn(async () =>
        guideOf('bitbucket', {
          places: [
            {
              product: 'bitbucket_cloud',
              webUrl: 'https://bitbucket.org',
              project: 'tessera',
              remote: 'origin',
              repositories: ['northwind/tessera-web', 'northwind/tessera-api', 'northwind/tessera-ops'],
            },
          ],
          email: { address: 'you@northwind.io', project: 'tessera' },
          tokenPages: [{ product: 'bitbucket_cloud', webUrl: 'https://bitbucket.org', url: ATLASSIAN }],
        }),
      ),
      connectToken: vi.fn(async () => connection('bitbucket_cloud', 'https://bitbucket.org')),
      checkConnection: vi.fn(async () =>
        checked([
          ['account', 'ok', 'me@northwind.io'],
          ['reach', 'ok', 'write'],
          ['push', 'ok'],
          ['changes', 'ok'],
          ['checks', 'ok'],
        ]),
      ),
    })
    expect(await heading('Make an Atlassian API token')).toBeTruthy()
    expect(within(panel).getByText('Made on your Atlassian account, with your account’s email')).toBeTruthy()
    expect(within(panel).getByText('Choose Bitbucket as the app, then tick the scopes below.')).toBeTruthy()
    expect(within(panel).getByText('write:pullrequest:bitbucket')).toBeTruthy()
    await press('Open Atlassian’s API tokens')
    expect(open).toHaveBeenCalledWith(ATLASSIAN, '_blank')
    await press('Paste it myself')

    // The email comes from the projects' git config, and is needed with the token.
    expect(await heading('Paste the token')).toBeTruthy()
    const email = within(panel).getByLabelText('Your Atlassian account’s email')
    expect((email as HTMLInputElement).value).toBe('you@northwind.io')
    expect(within(panel).getByText('From tessera’s git config')).toBeTruthy()
    await userEvent.clear(email)
    const token = within(panel).getByLabelText('Paste it')
    expect(token.getAttribute('placeholder')).toBe('ATATT…')
    await userEvent.type(token, 'ATATTtoken{Enter}')
    expect(within(panel).getByText('Type the email your Atlassian account signs in with')).toBeTruthy()
    expect(client.connectToken).not.toHaveBeenCalled()
    await userEvent.type(email, 'me@northwind.io')
    await press('Check')
    expect(client.connectToken).toHaveBeenCalledWith({
      product: 'bitbucket_cloud',
      token: 'ATATTtoken',
      webUrl: 'https://bitbucket.org',
      user: 'me@northwind.io',
    })
    expect(await heading('Connected as me@northwind.io')).toBeTruthy()
    expect(within(panel).getByText('Your Atlassian account')).toBeTruthy()
    expect(within(panel).getByText('Reaches northwind/tessera-web, northwind/tessera-api and northwind/tessera-ops')).toBeTruthy()
    expect(within(panel).getByText('Write')).toBeTruthy()
    expect(within(panel).getByText('Read build statuses and pipeline logs')).toBeTruthy()

    // Back through the token's steps; back from its start, there being no other way, closes the walk.
    await press('Back')
    await press('Back')
    expect(await heading('Make an Atlassian API token')).toBeTruthy()
    await press('Back')
    expect(closed).toHaveBeenCalled()
  })

  it('connects Bitbucket Data Center by its address, with a token made there, and says what the account’s role keeps it from', async () => {
    const tessera = 'https://git.tessera.dev'
    const { client, panel, closed, press, heading } = await walk('bitbucket', {
      findServer: vi.fn(async () => ({
        product: 'bitbucket_dc' as const,
        webUrl: tessera,
        reason: null,
        tokenPage: `${tessera}/plugins/servlet/access-tokens/manage`,
      })),
      connectToken: vi.fn(async () => connection('bitbucket_dc', tessera)),
      checkConnection: vi.fn(async () =>
        checked([
          ['server', 'ok', 'git.tessera.dev'],
          ['account', 'ok', 'admin'],
          ['push', 'no', null, { kind: 'role', role: 'Reader' }],
          ['changes', 'ok'],
        ]),
      ),
    })
    await press('On a company’s own server')
    expect(await heading('Your company’s Bitbucket')).toBeTruthy()
    await userEvent.type(within(panel).getByLabelText('Server address'), 'git.tessera.dev')
    expect(await within(panel).findByText('Bitbucket Data Center answers at git.tessera.dev', {}, { timeout: 3000 })).toBeTruthy()
    expect(within(panel).getByRole('button', { name: 'bitbucket.org instead' })).toBeTruthy()
    await press('Make a token')
    expect(await heading('Make a token on git.tessera.dev')).toBeTruthy()
    await press('Open git.tessera.dev’s access tokens')
    expect(open).toHaveBeenCalledWith(`${tessera}/plugins/servlet/access-tokens/manage`, '_blank')
    expect(within(panel).getByText('Give it Project read and Repository write.')).toBeTruthy()
    // A server's tokens have no mark of their own: nothing waits on the clipboard.
    expect(within(panel).queryByText('Waiting for a token on the clipboard')).toBeNull()
    await press('Paste it')
    await userEvent.type(within(panel).getByLabelText('Paste it'), 'BBDC-token{Enter}')
    expect(client.connectToken).toHaveBeenCalledWith({ product: 'bitbucket_dc', token: 'BBDC-token', webUrl: tessera })
    expect(await heading('Your account can’t push there')).toBeTruthy()
    expect(within(panel).getByText('Your account there')).toBeTruthy()
    expect(within(panel).getByText('As Reader, your account can’t do this there.')).toBeTruthy()
    expect(within(panel).getByText('That is your account’s role there, not the token’s: its owners can change it.')).toBeTruthy()
    await press('Connect as it is')
    expect(closed).toHaveBeenCalled()
  })
})

describe('connecting Linear', () => {
  it('signs in in the browser, starting it again once it couldn’t, and connects to the workspace', async () => {
    let state: 'waiting' | 'done' = 'waiting'
    const { client, panel, press, heading } = await walk('linear', {
      listConnections: vi.fn(async () => ({
        ...connectionList,
        products: PRODUCTS.map((product) => (product.product === 'linear' ? { ...product, browserSignIn: true } : product)),
        places: [],
      })),
      startSignIn: vi
        .fn()
        .mockRejectedValueOnce(new ApiError({ reason: 'SignInUnavailable', message: 'Port 41000 is busy.' }))
        .mockResolvedValue({ flowId: 'flow2', kind: 'browser', url: 'https://linear.app/oauth/authorize?client_id=althar' }),
      getSignIn: vi.fn(async () => (state === 'waiting' ? { state } : { state, connectionId: 'conn2' })),
      checkConnection: vi.fn(async () =>
        checked(
          [
            ['account', 'ok', 'you · Northwind'],
            ['read', 'ok', null, null, 3],
            ['comment', 'ok'],
            ['move', 'ok'],
          ],
          { renews: true },
        ),
      ),
    })
    const ways = await within(panel).findByRole('group', { name: 'Ways to connect Linear' })
    expect(within(panel).getByText('Issues become tasks, and tasks move their issues')).toBeTruthy()
    expect(within(panel).getByText(/Agents never get it; they read issues through Althar/)).toBeTruthy()
    expect(within(ways).getByRole('button', { name: /A personal API key\s*Made in Linear’s settings/ })).toBeTruthy()
    await userEvent.click(within(ways).getByRole('button', { name: /Continue with Linear\s*Approve in your browser/ }))
    expect(await heading('Approve Althar on Linear')).toBeTruthy()
    expect(await within(panel).findByText('Port 41000 is busy.')).toBeTruthy()
    await press('Try again')
    expect(await within(panel).findByText('linear.app is open in your browser. Pick your workspace, then Approve.')).toBeTruthy()
    expect(open).toHaveBeenCalledWith('https://linear.app/oauth/authorize?client_id=althar', '_blank')
    expect(within(panel).getByRole('button', { name: 'Copy the link for another browser' })).toBeTruthy()
    state = 'done'
    expect(await heading('Connected to Northwind')).toBeTruthy()
    expect(client.startSignIn).toHaveBeenLastCalledWith('linear', 'https://linear.app', undefined)
    expect(within(panel).getByText('3 teams')).toBeTruthy()
    expect(within(panel).getByText('Reads your workspace’s issues')).toBeTruthy()
    expect(within(panel).getByText('Moves an issue’s status')).toBeTruthy()
    expect(within(panel).getByText('Through Althar’s Linear app, which renews its own sign-in.')).toBeTruthy()
  })

  it('takes a personal key, and says when Linear doesn’t take it, with a new one made or another pasted', async () => {
    const { client, panel, press, heading } = await walk('linear', {
      getConnectGuide: vi.fn(async () =>
        guideOf('linear', {
          tokenPages: [{ product: 'linear', webUrl: 'https://linear.app', url: 'https://linear.app/settings/account/security' }],
        }),
      ),
      connectToken: vi
        .fn()
        .mockRejectedValueOnce(new ApiError({ reason: 'ConnectorFailed', message: 'Linear no longer takes it.', why: 'unauthorized' }))
        .mockResolvedValue(connection('linear', 'https://linear.app')),
      checkConnection: vi.fn(async () =>
        checked([
          ['account', 'ok', 'you'],
          ['read', 'ok', null, null, 1],
          ['comment', 'ok'],
          ['move', 'ok'],
        ]),
      ),
    })
    expect(await heading('Make a key in Linear')).toBeTruthy()
    expect(within(panel).getByText('Under Personal API keys, New key: name it Althar.')).toBeTruthy()
    await press('Open Linear’s settings')
    await press('Paste it myself')
    expect(await heading('Paste the key')).toBeTruthy()
    const field = within(panel).getByLabelText('Paste it')
    expect(field.getAttribute('placeholder')).toBe('lin_api_…')
    await userEvent.type(field, 'lin_api_old{Enter}')
    expect(await heading('Linear didn’t take that token')).toBeTruthy()
    expect(within(panel).getByText('Linear didn’t take this token: it may be mistyped, revoked or run out.')).toBeTruthy()
    await press('Make a new one')
    expect(open).toHaveBeenLastCalledWith('https://linear.app/settings/account/security', '_blank')
    await userEvent.type(within(panel).getByLabelText('Paste it'), 'lin_api_new{Enter}')
    expect(client.connectToken).toHaveBeenLastCalledWith({ product: 'linear', token: 'lin_api_new', webUrl: 'https://linear.app' })
    expect(await heading('Connected as you')).toBeTruthy()
    expect(within(panel).getByText('1 team')).toBeTruthy()
  })
})

describe('connecting Linear by a key on the clipboard', () => {
  it('notices it as the window comes back, shown without its middle, and connects with it', async () => {
    const { client, panel, press, heading } = await walk(
      'linear',
      {
        connectToken: vi.fn(async () => connection('linear', 'https://linear.app')),
        checkConnection: vi.fn(async () =>
          checked([
            ['account', 'ok'],
            ['read', 'ok', null, null, 2],
            ['comment', 'ok'],
            ['move', 'ok'],
          ]),
        ),
      },
      { host: fakeHost({ clipboardToken: vi.fn(async () => 'lin_api_short') }) },
    )
    expect(await heading('Make a key in Linear')).toBeTruthy()
    await comeBack()
    expect(await within(panel).findByText('A Linear key is on your clipboard')).toBeTruthy()
    expect(within(panel).getByText('lin_····')).toBeTruthy()
    await press('Use it')
    expect(client.connectToken).toHaveBeenCalledWith({ product: 'linear', token: 'lin_api_short', webUrl: 'https://linear.app' })
    // Linear didn't say who: the connection's account is.
    expect(await heading('Connected as you')).toBeTruthy()
  })
})

describe('what a tracker can’t do', () => {
  it.each([
    { line: ['comment', 'no', null, { kind: 'role', role: 'Guest' }] as Line, title: 'Your account can’t change issues there' },
    { line: ['move', 'no', null, { kind: 'scope', scope: 'write', url: null }] as Line, title: 'This token can’t change issues' },
    { line: ['account', 'no', null, { kind: 'refused' }] as Line, title: 'Linear didn’t take that token' },
  ])('says $title', async ({ line, title }) => {
    const lines: ReadonlyArray<Line> = [
      ['account', 'ok', 'you'],
      ['read', 'ok', null, null, 2],
      ['comment', 'ok'],
      ['move', 'ok'],
    ]
    const { panel, heading } = await walk('linear', {
      connectToken: vi.fn(async () => connection('linear', 'https://linear.app')),
      checkConnection: vi.fn(async () => checked(lines.map((was) => (was[0] === line[0] ? line : was)))),
    })
    expect(await heading('Make a key in Linear')).toBeTruthy()
    await userEvent.click(within(panel).getByRole('button', { name: 'Paste it myself' }))
    await userEvent.type(within(panel).getByLabelText('Paste it'), 'lin_api_x{Enter}')
    expect(await heading(title)).toBeTruthy()
  })

  it('says a company’s server didn’t answer the check', async () => {
    const tessera = 'https://git.tessera.dev'
    const { panel, press, heading } = await walk('bitbucket', {
      findServer: vi.fn(async () => ({ product: 'bitbucket_dc' as const, webUrl: tessera, reason: null, tokenPage: null })),
      connectToken: vi.fn(async () => connection('bitbucket_dc', tessera)),
      checkConnection: vi.fn(async () => checked([['server', 'no', null, { kind: 'failed', message: 'git.tessera.dev went away.' }]])),
    })
    await press('On a company’s own server')
    await userEvent.type(within(panel).getByLabelText('Server address'), 'git.tessera.dev{Enter}')
    expect(await heading('Make a token on git.tessera.dev')).toBeTruthy()
    // No page to open there: the token is made by hand.
    expect(within(panel).queryByRole('button', { name: /access tokens/ })).toBeNull()
    await press('Paste it')
    await userEvent.type(within(panel).getByLabelText('Paste it'), 'BBDC-x{Enter}')
    expect(await heading('Bitbucket didn’t answer')).toBeTruthy()
    expect(within(panel).getAllByText('git.tessera.dev went away.').length).toBeGreaterThan(0)
  })
})

describe('connecting Jira', () => {
  it('asks its site, says what isn’t one, and connects Data Center with a token made there', async () => {
    const site = 'https://jira.northwind.test'
    const { client, panel, press, heading } = await walk('jira', {
      findServer: vi.fn(async (_service, typed: string) =>
        typed.includes('northwind')
          ? { product: 'jira_dc' as const, webUrl: site, reason: null, tokenPage: `${site}/secure/ViewProfile.jspa` }
          : typed.includes('wiki')
            ? { product: null, webUrl: `https://${typed}`, reason: 'other' as const, tokenPage: null }
            : { product: null, webUrl: `https://${typed}`, reason: 'unreachable' as const, tokenPage: null },
      ),
      connectToken: vi.fn(async () => connection('jira_dc', site)),
      checkConnection: vi.fn(async () =>
        checked([
          ['site', 'ok', 'jira.northwind.test'],
          ['account', 'ok', 'you'],
          ['read', 'ok', null, null, 1],
          ['comment', 'ok'],
          ['move', 'unknown', null, { kind: 'unreadable' }],
        ]),
      ),
    })
    // One way in, by its site, Cloud or Data Center alike.
    expect(await heading('Your Jira site')).toBeTruthy()
    expect(within(panel).getByText('Jira Cloud or Data Center, by its address')).toBeTruthy()
    const field = within(panel).getByLabelText('Site address')
    expect(field.getAttribute('placeholder')).toBe('https://your-site.atlassian.net')
    await userEvent.type(field, 'wiki.example.dev{Enter}')
    expect(await within(panel).findByText('wiki.example.dev isn’t a Jira site')).toBeTruthy()
    await userEvent.clear(field)
    await userEvent.type(field, 'jira.gone.test{Enter}')
    expect(await within(panel).findByText('Nothing answers at jira.gone.test')).toBeTruthy()
    await userEvent.clear(field)
    await userEvent.type(field, 'jira.northwind.test')
    expect(await within(panel).findByText('Jira Data Center answers at jira.northwind.test', {}, { timeout: 3000 })).toBeTruthy()
    await press('Continue')
    expect(await heading('Make a token on jira.northwind.test')).toBeTruthy()
    expect(within(panel).getByText('Create token, named Althar.')).toBeTruthy()
    await press('Open jira.northwind.test’s token page')
    await press('Paste it')
    expect(within(panel).queryByLabelText('Your Atlassian account’s email')).toBeNull()
    await userEvent.type(within(panel).getByLabelText('Paste it'), 'jira-pat{Enter}')
    expect(client.connectToken).toHaveBeenCalledWith({ product: 'jira_dc', token: 'jira-pat', webUrl: site })
    expect(await heading('Connected as you')).toBeTruthy()
    expect(within(panel).getByText('1 project')).toBeTruthy()
    expect(within(panel).getByText('Moves them through their workflow')).toBeTruthy()
    expect(within(panel).getByText('Jira doesn’t say what this token may change.')).toBeTruthy()
  })

  it('connects Jira Cloud with an Atlassian token from the clipboard and its email; and checks again when Jira fails to answer', async () => {
    const site = 'https://northwind.atlassian.net'
    const { client, panel, press, heading } = await walk(
      'jira',
      {
        getConnectGuide: vi.fn(async () => guideOf('jira', { email: { address: 'me@home.test', project: null } })),
        findServer: vi.fn(async () => ({ product: 'jira_cloud' as const, webUrl: site, reason: null, tokenPage: ATLASSIAN })),
        connectToken: vi.fn(async () => connection('jira_cloud', site, { account: { login: 'you@northwind.io', name: null } })),
        checkConnection: vi
          .fn()
          .mockRejectedValueOnce(new ApiError({ reason: 'ConnectorFailed', message: 'Althar couldn’t reach Jira.', why: 'unreachable' }))
          .mockResolvedValueOnce(
            checked([
              ['site', 'ok', 'northwind.atlassian.net'],
              ['account', 'ok', 'you@northwind.io'],
              ['read', 'no', null, { kind: 'failed', message: 'Jira said: the search is down.' }],
              ['comment', 'ok'],
              ['move', 'ok'],
            ]),
          )
          .mockResolvedValue(
            checked([
              ['site', 'ok', 'northwind.atlassian.net'],
              ['account', 'ok', 'you@northwind.io'],
              ['read', 'ok', null, null, 4],
              ['comment', 'ok'],
              ['move', 'ok'],
            ]),
          ),
      },
      { host: fakeHost({ clipboardToken: vi.fn(async () => 'ATATT3xFfGF0token') }) },
    )
    expect(await heading('Your Jira site')).toBeTruthy()
    await userEvent.type(within(panel).getByLabelText('Site address'), 'northwind.atlassian.net{Enter}')
    expect(await heading('Make an Atlassian API token')).toBeTruthy()
    expect(within(panel).getByText('Name it Althar, and set when it runs out: a year at most.')).toBeTruthy()
    expect(within(panel).getByText('Waiting for a token on the clipboard')).toBeTruthy()
    await comeBack()
    expect(await heading('Paste the token')).toBeTruthy()
    expect(within(panel).getByText('An Atlassian token is on your clipboard')).toBeTruthy()
    // The email git signs commits with here, which the person changes.
    const email = within(panel).getByLabelText('Your Atlassian account’s email')
    expect((email as HTMLInputElement).value).toBe('me@home.test')
    expect(within(panel).getByText('From your git config')).toBeTruthy()
    await userEvent.clear(email)
    await press('Use it')
    expect(within(panel).getByText('Type the email your Atlassian account signs in with')).toBeTruthy()
    await userEvent.type(email, 'you@northwind.io')
    await press('Use it')
    expect(client.connectToken).toHaveBeenCalledWith({
      product: 'jira_cloud',
      token: 'ATATT3xFfGF0token',
      webUrl: site,
      user: 'you@northwind.io',
    })

    // Jira didn't answer the check: asked again; then it can't read issues, as Jira said.
    expect(await heading('Jira didn’t answer')).toBeTruthy()
    expect(within(panel).getByText('Althar couldn’t reach Jira.')).toBeTruthy()
    await press('Check again')
    expect(await heading('This token can’t read issues')).toBeTruthy()
    expect(within(panel).getAllByText('Jira said: the search is down.').length).toBeGreaterThan(0)
    await press('Check again')
    expect(await heading('Connected as you@northwind.io')).toBeTruthy()
    expect(within(panel).getByText('4 projects')).toBeTruthy()
  })
})

describe('signing Jira in again', () => {
  it('says a new token didn’t work, keeping its site and email for another', async () => {
    const stopped = connection('jira_cloud', 'https://northwind.atlassian.net', { id: 'conn9', state: 'reauth_required' })
    const { client, panel, press, heading } = await walk(
      'jira',
      {
        getConnectGuide: vi.fn(async () =>
          guideOf('jira', { tokenPages: [{ product: 'jira_cloud', webUrl: 'https://northwind.atlassian.net', url: ATLASSIAN }] }),
        ),
        connectToken: vi
          .fn()
          .mockRejectedValue(new ApiError({ reason: 'ConnectorFailed', message: 'Jira no longer takes it.', why: 'unauthorized' })),
      },
      { again: 'conn9', connections: [stopped] },
    )
    expect(await heading('Make a new API token')).toBeTruthy()
    await press('Paste it myself')
    await userEvent.type(within(panel).getByLabelText('Paste it'), 'ATATTold{Enter}')
    expect(client.connectToken).toHaveBeenCalledWith({ product: 'jira_cloud', token: 'ATATTold', connectionId: 'conn9' })
    expect(await heading('That token didn’t work')).toBeTruthy()
    await press('Paste another')
    expect(await heading('Paste the new token')).toBeTruthy()
    expect(within(panel).queryByLabelText('Your Atlassian account’s email')).toBeNull()
  })
})

describe('connecting Trello', () => {
  it('asks for the Power-Up key first, then takes the token Trello shows from the clipboard, which doesn’t run out', async () => {
    const key = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
    const { client, panel, press, heading } = await walk(
      'trello',
      {
        getConnectGuide: vi.fn(async () =>
          guideOf('trello', {
            tokenPages: [{ product: 'trello', webUrl: 'https://trello.com', url: 'https://trello.com/power-ups/admin' }],
          }),
        ),
        connectToken: vi.fn(async () => connection('trello', 'https://trello.com')),
        checkConnection: vi.fn(async () =>
          checked([
            ['key', 'ok', '····8f90'],
            ['account', 'ok', 'you'],
            ['read', 'ok', null, null, 2],
            ['comment', 'ok'],
            ['move', 'ok'],
          ]),
        ),
      },
      { host: fakeHost({ clipboardToken: vi.fn(async () => 'ATTAtokenfromtrello') }) },
    )
    expect(await heading('Make a Power-Up key on Trello')).toBeTruthy()
    await press('Open Trello’s Power-Up admin')
    expect(open).toHaveBeenCalledWith('https://trello.com/power-ups/admin', '_blank')
    const field = within(panel).getByLabelText('Power-Up API key')
    await press('Continue')
    expect(within(panel).getByText('Paste the Power-Up’s API key first')).toBeTruthy()
    await userEvent.type(field, 'short{Enter}')
    expect(within(panel).getByText('An API key is 32 characters')).toBeTruthy()
    await userEvent.clear(field)
    await userEvent.type(field, `${key}{Enter}`)
    expect(await heading('Allow Althar on Trello')).toBeTruthy()
    await comeBack()
    expect(await heading('Paste the token Trello showed')).toBeTruthy()
    expect(within(panel).getByText('A Trello token is on your clipboard')).toBeTruthy()
    await press('Use it')
    expect(client.connectToken).toHaveBeenCalledWith({ product: 'trello', token: 'ATTAtokenfromtrello', webUrl: 'https://trello.com', key })
    expect(await heading('Connected as you')).toBeTruthy()
    expect(within(panel).getByText('2 boards')).toBeTruthy()
    expect(within(panel).getByText('Reads your boards')).toBeTruthy()
    expect(within(panel).getByText('Comments on cards')).toBeTruthy()
    expect(within(panel).getByText('Moves cards between lists')).toBeTruthy()
    expect(within(panel).getByText('The token doesn’t run out; revoke it on Trello to stop it.')).toBeTruthy()
  })
})

describe('connecting GitHub', () => {
  /** GitHub's walk by a token, to its check, which says what the test gives. */
  const toCheck = async (check: ConnectionCheck) => {
    const walked = await walk('github', { getConnectGuide: vi.fn(async () => githubGuide), checkConnection: vi.fn(async () => check) })
    await userEvent.click(await within(walked.panel).findByRole('button', { name: /Make a token/ }))
    await walked.press('Paste it myself')
    await userEvent.type(within(walked.panel).getByLabelText('Paste it'), 'github_pat_x{Enter}')
    return walked
  }
  const lacking = (need: AccessLine['need'], reason: AccessReason | null, state: AccessLine['state'] = 'no') => ({
    ...githubCheck,
    lines: githubCheck.lines.map((line) => (line.need === need ? { ...line, state, fact: null, reason } : line)),
  })

  it.each([
    {
      check: lacking('reach', {
        kind: 'unseen',
        names: ['northwind/meridian-api'],
        url: 'https://github.com/settings/personal-access-tokens/7',
      }),
      title: 'It doesn’t reach every repository',
      says: ['It doesn’t see northwind/meridian-api.', 'Add northwind/meridian-api under Repository access, then Update.'],
      press: 'Change it on GitHub',
      opens: 'https://github.com/settings/personal-access-tokens/7',
    },
    {
      check: lacking('reach', { kind: 'unseen', names: ['northwind/meridian-api', 'northwind/web'], url: null }),
      title: 'It doesn’t reach every repository',
      says: ['It doesn’t see northwind/meridian-api and northwind/web.'],
      press: 'Check again',
    },
    {
      check: lacking('reach', { kind: 'sso', owner: 'northwind', url: 'https://github.com/orgs/northwind/sso' }),
      title: 'northwind wants this token authorized',
      says: [
        'northwind signs in with SAML: the token needs authorizing for it.',
        'Authorize the token for northwind on GitHub, then check again.',
      ],
      press: 'Authorize it for northwind',
      opens: 'https://github.com/orgs/northwind/sso',
    },
    {
      check: lacking('reach', { kind: 'not_installed', owner: 'northwind', url: null }),
      title: 'It doesn’t reach every repository',
      says: ['Althar isn’t installed on northwind yet.'],
      press: 'Check again',
    },
    {
      check: lacking('push', { kind: 'role', role: null }),
      title: 'Your account can’t push there',
      says: ['Your account can’t do this there.'],
      press: 'Check again',
    },
    {
      check: lacking('push', { kind: 'permission', permission: 'Contents', url: null }),
      title: 'This token can’t push',
      says: [
        'Contents isn’t allowed on this token.',
        'Set Contents to Read and write, then Update. It stays the same token, so there’s nothing to paste again.',
      ],
      press: 'Change it on GitHub',
      opens: 'https://github.com/settings/personal-access-tokens',
    },
    {
      check: lacking('checks', { kind: 'permission', permission: 'Commit statuses', url: null }),
      title: 'This token can’t read checks',
      says: ['Set Commit statuses to Read, then Update. It stays the same token, so there’s nothing to paste again.'],
      press: 'Check again',
    },
    {
      check: lacking('issues', { kind: 'scope', scope: 'repo', url: null }),
      title: 'This token can’t read issues',
      says: [
        'The token wasn’t given the repo scope.',
        'Tick repo, then Update token. It stays the same token, so there’s nothing to paste again.',
      ],
      press: 'Change it on GitHub',
      opens: 'https://github.com/settings/personal-access-tokens',
    },
    {
      check: lacking('issues', null),
      title: 'This token can’t read issues',
      says: [],
      press: 'Check again',
    },
    {
      check: lacking('changes', { kind: 'unreadable' }),
      title: 'This token can’t open pull requests',
      says: ['GitHub doesn’t say what this token may change.'],
      press: 'Connect as it is',
    },
  ])('says $title, and how to put it right', async ({ check, title, says, press, opens }) => {
    const { panel, heading, press: pressIt } = await toCheck(check)
    expect(await heading(title)).toBeTruthy()
    for (const words of says) expect(within(panel).getByText(words)).toBeTruthy()
    await pressIt(press)
    if (opens !== undefined) expect(open).toHaveBeenLastCalledWith(opens, '_blank')
  })

  it('makes a classic token where a fine-grained one can’t read check runs', async () => {
    const { panel, heading, press } = await toCheck(
      lacking('checks', { kind: 'no_check_runs', url: 'https://github.com/settings/tokens/new?scopes=repo,workflow' }),
    )
    expect(await heading('This token can’t read check runs')).toBeTruthy()
    expect(within(panel).getByText('GitHub gives fine-grained tokens no check runs, so a task sees commit statuses only.')).toBeTruthy()
    await press('Make a classic token')
    expect(open).toHaveBeenLastCalledWith('https://github.com/settings/tokens/new?scopes=repo,workflow', '_blank')
    expect(await heading('Paste the token')).toBeTruthy()
  })

  it('offers a token where an organisation keeps gh’s sign-in out', async () => {
    const restricted = lacking('reach', { kind: 'restricted', owner: 'northwind' })
    const { client, panel, press, heading } = await walk('github', {
      getConnectGuide: vi.fn(async () => githubGuide),
      checkConnection: vi.fn(async () => restricted),
    })
    await userEvent.click(await within(panel).findByRole('button', { name: /Use gh’s sign-in/ }))
    await press('Use this sign-in')
    expect(await heading('northwind keeps gh’s sign-in out')).toBeTruthy()
    expect(
      within(panel).getByText('northwind keeps out apps that sign in with OAuth, gh among them, until its owners approve one.'),
    ).toBeTruthy()
    expect(within(panel).getByText('Its owners can approve GitHub CLI for northwind, or you can make a token instead.')).toBeTruthy()
    await press('Make a token instead')
    expect(await heading('Make a token on GitHub')).toBeTruthy()
    expect(client.connectCli).toHaveBeenCalledTimes(1)
  })

  it('says how many repositories it is for, and notices a GitHub token on the clipboard as the window comes back', async () => {
    const { client, panel, press, heading } = await walk(
      'github',
      {
        getConnectGuide: vi.fn(async () => ({
          ...githubGuide,
          places: [
            {
              product: 'github' as const,
              webUrl: 'https://github.com',
              project: 'meridian',
              remote: 'origin',
              repositories: ['northwind/api', 'northwind/web', 'northwind/ops'],
            },
          ],
        })),
      },
      { host: fakeHost({ clipboardToken: vi.fn(async () => 'github_pat_11ABCDEFG0123456789xyz') }) },
    )
    expect(await within(panel).findByText('For meridian: 3 repositories')).toBeTruthy()
    await press(/Make a token/)
    expect(within(panel).getByText('Under Repository access, choose Only select repositories: api, web and ops.')).toBeTruthy()
    expect(within(panel).getByText('It opens with the name, northwind as the owner, 90 days and the permissions set.')).toBeTruthy()
    await comeBack()
    expect(await heading('Paste the token')).toBeTruthy()
    expect(within(panel).getByText('A GitHub token is on your clipboard')).toBeTruthy()
    expect(within(panel).getByText('github_pat_11ABC····xyz')).toBeTruthy()
    await press('Use it')
    expect(client.connectToken).toHaveBeenCalledWith({
      product: 'github',
      token: 'github_pat_11ABCDEFG0123456789xyz',
      webUrl: 'https://github.com',
    })
  })

  it('offers what works without what the runtime found, and shows the permissions a token is made with on a press', async () => {
    const { panel, press, heading } = await walk('github', { getConnectGuide: vi.fn(async () => Promise.reject(new Error('down'))) })
    expect(await heading('Make a token on GitHub')).toBeTruthy()
    expect(within(panel).getByText('It opens with the name, 90 days and the permissions set.')).toBeTruthy()
    expect(within(panel).getByText('Under Repository access, choose the repositories Althar works in.')).toBeTruthy()
    // No page to open: nothing was found to fill it in from.
    expect(within(panel).queryByRole('button', { name: /token page/ })).toBeNull()
    await press('See the 6 permissions it sets')
    expect(within(panel).getByText('Filled in on the page')).toBe(document.activeElement)
    expect(within(panel).getByText('Workflows')).toBeTruthy()
  })

  it('signs a connection on a company’s server in again, by gh’s sign-in there or a new classic token', async () => {
    const meridian = 'https://git.meridian.dev'
    const stopped = connection('github', meridian, { id: 'conn5', state: 'reauth_required' })
    const again = {
      getConnectGuide: vi.fn(async () =>
        guideOf('github', {
          clis: [{ product: 'github' as const, webUrl: meridian, tool: 'gh' as const, account: 'you', scopes: null }],
          tokenPages: [{ product: 'github' as const, webUrl: meridian, url: `${meridian}/settings/tokens/new` }],
        }),
      ),
      connectCli: vi.fn(async () => ({ ...stopped, state: 'ready' as const })),
      connectToken: vi.fn(async () => ({ ...stopped, state: 'ready' as const })),
    }
    const { client, panel, press, heading } = await walk('github', again, { again: 'conn5', connections: [stopped] })
    const ways = await within(panel).findByRole('group', { name: 'Ways to connect GitHub' })
    expect(within(ways).getByRole('button', { name: /Use gh’s sign-in\s*Signed in to git.meridian.dev as you/ })).toBeTruthy()
    await userEvent.click(within(ways).getByRole('button', { name: /A new token\s*Made on git.meridian.dev/ }))
    expect(await heading('Make a token on git.meridian.dev')).toBeTruthy()
    expect(within(panel).getByText('Its token stopped working. Tasks can’t reach it until it’s back.')).toBeTruthy()
    expect(within(panel).getByText('It opens with the note Althar and the repo and workflow scopes ticked.')).toBeTruthy()
    await press(`Open git.meridian.dev’s token page`)
    expect(open).toHaveBeenCalledWith(`${meridian}/settings/tokens/new`, '_blank')
    await press('Paste it myself')
    expect(await heading('Paste the new token')).toBeTruthy()
    await userEvent.type(within(panel).getByLabelText('Paste it'), 'ghp_new{Enter}')
    expect(client.connectToken).toHaveBeenCalledWith({ product: 'github', token: 'ghp_new', connectionId: 'conn5' })
    expect(await heading('Connected as you')).toBeTruthy()

    // Back to the ways, and gh's sign-in instead: no scopes said, every repository it can.
    await press('Back')
    await press('Back')
    await press('Back')
    await press(/Use gh’s sign-in/)
    expect(await heading('Use gh’s sign-in')).toBeTruthy()
    expect(within(panel).queryByText('Scopes')).toBeNull()
    expect(within(panel).getByText('Every repository you can')).toBeTruthy()
    await press('Use this sign-in')
    expect(client.connectCli).toHaveBeenCalledWith('github', meridian, 'conn5')
    expect(await heading('Connected as you')).toBeTruthy()
    expect(within(panel).getByText('gh’s token; it runs out when gh’s does.')).toBeTruthy()
  })

  it('signs a GitHub connection in again by its own browser sign-in, gh’s there, or a new token', async () => {
    const stopped = connection('github', 'https://github.com', { id: 'conn6', auth: 'device_flow', state: 'reauth_required' })
    const { client, panel, press } = await walk(
      'github',
      {
        listConnections: vi.fn(async () => ({
          ...connectionList,
          products: PRODUCTS.map((product) => (product.product === 'github' ? { ...product, browserSignIn: true } : product)),
          connections: [stopped],
          places: [],
        })),
        getConnectGuide: vi.fn(async () =>
          guideOf('github', {
            clis: [
              { product: 'github', webUrl: 'https://github.com', tool: 'gh', account: 'you', scopes: ['repo'] },
              { product: 'github', webUrl: 'https://git.meridian.dev', tool: 'gh', account: 'you', scopes: ['repo'] },
            ],
          }),
        ),
        getSignIn: vi.fn(async () => Promise.reject(new ApiError({ reason: 'NotFound', message: 'That sign-in isn’t there any more.' }))),
      },
      { again: 'conn6' },
    )
    const ways = await within(panel).findByRole('group', { name: 'Ways to connect GitHub' })
    // Its own instance only: gh's sign-in to another server isn't a way to this one.
    expect(
      within(ways)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual([
      'Continue with GitHubApprove in your browser',
      'Use gh’s sign-inSigned in as you on this Mac',
      'A new tokenMade on github.com',
    ])
    await press(/Continue with GitHub/)
    expect(client.startSignIn).toHaveBeenCalledWith('github', 'https://github.com', 'conn6')
    // How it stands couldn't be read: said, with the sign-in started again on a press.
    expect(await within(panel).findByText('That sign-in isn’t there any more.', {}, { timeout: 4000 })).toBeTruthy()
    await press('Try again')
    expect(client.startSignIn).toHaveBeenCalledTimes(2)
  })

  it('says GitHub didn’t answer a check, and connects as it is', async () => {
    const { panel, closed, press, heading } = await walk('github', {
      getConnectGuide: vi.fn(async () => githubGuide),
      checkConnection: vi.fn(async () => Promise.reject(new ApiError({ reason: 'ConnectorFailed', message: 'GitHub is slow.' }))),
    })
    await userEvent.click(await within(panel).findByRole('button', { name: /Use gh’s sign-in/ }))
    await press('Use this sign-in')
    expect(await heading('GitHub didn’t answer')).toBeTruthy()
    expect(within(panel).getByText('GitHub is slow.')).toBeTruthy()
    await press('Connect as it is')
    expect(closed).toHaveBeenCalled()
  })
})

describe('the walk’s way back', () => {
  it('steps back by Escape, from a step to the ways, then closes', async () => {
    const { panel, closed, heading } = await walk('github', { getConnectGuide: vi.fn(async () => githubGuide) })
    await userEvent.click(await within(panel).findByRole('button', { name: /Make a token/ }))
    expect(await heading('Make a token on GitHub')).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    expect(await within(panel).findByRole('group', { name: 'Ways to connect GitHub' })).toBeTruthy()
    expect(closed).not.toHaveBeenCalled()
    within(panel)
      .getByRole('button', { name: /Make a token/ })
      .focus()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(closed).toHaveBeenCalled())
  })
})
