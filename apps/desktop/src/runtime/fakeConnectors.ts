import {
  type Access,
  type AccessLine,
  type AccessReport,
  ConnectorFailed,
  type Fetch,
  line,
  type Product,
  type ProductInfo,
  products,
} from '@althar/connectors'
import { type FakeCheck, makeFakeService } from '@althar/connectors/testing'
import { Connectors } from '@althar/runtime'
import { Effect, Layer } from 'effect'

/*
 * A code host for the end-to-end tests: GitHub, answered by the connectors'
 * fake service in the runtime's own process, on an instance at
 * https://github.test, which no network reaches. Its repositories are
 * meridian/api, with one issue, and meridian/web where
 * ALTHAR_FAKE_REMOTE_WEB is set, with the pull requests ALTHAR_FAKE_PULLS
 * lists for a test to review; what is pushed to one goes to the bare
 * repository ALTHAR_FAKE_REMOTE_API or _WEB names, else ALTHAR_FAKE_REMOTE, and its commits have the checks
 * ALTHAR_FAKE_CHECKS names, where it does. A pasted token connects it, and so
 * does gh's sign-in, which is signed in to it. Loaded only when
 * ALTHAR_FAKE_AGENTS is set, or, with real agents, ALTHAR_FAKE_CONNECTORS=github.
 */

export const HOST = 'https://github.test'

/** The checks every pull request's commits have, where a test names them (ALTHAR_FAKE_CHECKS, as JSON); else those a test sets. */
const namedChecks =
  process.env.ALTHAR_FAKE_CHECKS === undefined ? undefined : (JSON.parse(process.env.ALTHAR_FAKE_CHECKS) as ReadonlyArray<FakeCheck>)

// A repository's pushes go to ALTHAR_FAKE_REMOTE_<NAME> where that is set, as a test of several repositories gives each its own.
const github = makeFakeService({
  pushUrl: (path) => process.env[`ALTHAR_FAKE_REMOTE_${(path.at(-1) ?? '').toUpperCase()}`] ?? process.env.ALTHAR_FAKE_REMOTE ?? '',
  ...(namedChecks === undefined ? {} : { checksFor: () => namedChecks }),
})
github.addRepository(['meridian', 'api'])
// Only for a test that gives it somewhere to push: every other sees the one repository it always did.
if (process.env.ALTHAR_FAKE_REMOTE_WEB !== undefined) github.addRepository(['meridian', 'web'])
github.addIssue({ ref: 'meridian/api#12', title: 'Checkout gives up after one try', body: 'It should retry.' })
// Pull requests someone else opened on meridian/api, for a test that reviews them: each its title, author and head commit, which
// the test pushed to the remote as refs/pull/<n>/head, numbered from 1 in the order given.
for (const pull of JSON.parse(process.env.ALTHAR_FAKE_PULLS ?? '[]') as ReadonlyArray<{ title: string; author: string; headSha: string }>)
  github.addPullRequest({ path: ['meridian', 'api'], ...pull })

export const fakeConnectors = Layer.succeed(
  Connectors,
  Connectors.of({
    products: [
      {
        ...products.github,
        hosted: { webUrl: HOST, apiUrl: `${HOST}/api/v3` },
        make: () => ({ host: github, tracker: github }),
        access: github.access,
      },
    ],
    fetch: () => Promise.reject(new Error('The end-to-end tests reach no network')),
    clientIds: {},
    callbackPort: 0,
    // gh, signed in to the fake GitHub alone.
    cliToken: (tool, host) => Effect.succeed(tool === 'gh' && host === new URL(HOST).hostname ? 'gho_fake' : null),
  }),
)

/*
 * Every service, for seeing the walks in on a demo profile
 * (ALTHAR_FAKE_CONNECTORS=demo): each answered by a fake on its own hosted
 * address, which no network reaches, with the accounts of the people in
 * the design's world. gh is signed in to github.com and glab to
 * gitlab.com; a company's GitLab answers at git.halyard.dev, and Jira at
 * northwind.atlassian.net. A GitHub token with `readonly` in it can't open
 * pull requests the first time it is checked; an Atlassian token with
 * `old` in it ran out.
 */

const fake = (product: Product, login: string, repositories: ReadonlyArray<ReadonlyArray<string>> = []) => {
  const service = makeFakeService({ product, account: { id: login, login, name: null } })
  for (const path of repositories) service.addRepository(path)
  return service
}

const demo = {
  github: fake('github', 'balazs', [
    ['northwind', 'meridian-api'],
    ['northwind', 'meridian-web'],
  ]),
  gitlab: fake('gitlab', 'balazs.k', [['halyard', 'gateway']]),
  bitbucket_cloud: fake('bitbucket_cloud', 'balazs@tessera.studio', [['tessera-studio', 'tessera-app']]),
  bitbucket_dc: fake('bitbucket_dc', 'balazs'),
  linear: fake('linear', 'Balázs · Northwind'),
  jira_cloud: fake('jira_cloud', 'balazs@northwind.io'),
  jira_dc: fake('jira_dc', 'balazs'),
  trello: fake('trello', 'balazsk'),
} satisfies Record<Product, ReturnType<typeof makeFakeService>>

/* Tokens checked once, so a token changed on its page reads as changed when checked again. */
const checked = new Set<string>()

/** A product's check, as its service would answer on the demo's world. */
const demoAccess =
  (product: Product): Access =>
  (input) =>
    Effect.map(demo[product].access(input), (report): AccessReport => {
      const token = input.credential.token
      const first = !checked.has(token)
      checked.add(token)
      const host = new URL(input.webUrl).host
      const lines: Array<AccessLine> = []
      if (!input.hosted && (product === 'gitlab' || product === 'bitbucket_dc')) lines.push(line('server', 'ok', { fact: host }))
      if (product === 'jira_cloud' || product === 'jira_dc') lines.push(line('site', 'ok', { fact: host }))
      if (product === 'trello' && input.credential.kind === 'app')
        lines.push(line('key', 'ok', { fact: `····${input.credential.key.slice(-4)}` }))
      for (const said of report.lines) {
        if (said.need === 'reach' && said.state === 'ok')
          lines.push({ ...said, fact: product === 'gitlab' ? 'Developer' : product === 'bitbucket_cloud' ? 'write' : said.fact })
        else if (said.need === 'read') lines.push({ ...said, count: product === 'trello' ? 4 : product === 'linear' ? 3 : 6 })
        else if (said.need === 'changes' && product === 'github' && token.includes('readonly') && first)
          lines.push(
            line('changes', 'no', {
              reason: { kind: 'permission', permission: 'Pull requests', url: 'https://github.com/settings/personal-access-tokens' },
            }),
          )
        else lines.push(said)
      }
      const expiresAt =
        product === 'github' && input.auth === 'token' && token.startsWith('github_pat_')
          ? '2027-01-08T00:00:00.000Z'
          : product === 'gitlab'
            ? '2026-12-31T00:00:00.000Z'
            : null
      // gh's sign-in is an OAuth token, which says its scopes.
      const scopes = token === 'gho_demo' ? ['repo', 'workflow', 'read:org', 'gist'] : report.scopes
      return { ...report, lines, expiresAt, scopes }
    })

/** A fake's adapter, refusing an Atlassian token that ran out. */
const demoMake =
  (product: Product): NonNullable<ProductInfo['make']> =>
  (options) => {
    const service = demo[product]
    const account = Effect.flatMap(options.credential, (credential) =>
      credential.token.includes('old')
        ? Effect.fail(new ConnectorFailed({ product, reason: 'unauthorized', status: 401, message: 'Unauthorized' }))
        : service.account,
    )
    const adapter = { ...service, account }
    return products[product].host ? { host: adapter, ...(products[product].tracker ? { tracker: adapter } : {}) } : { tracker: adapter }
  }

/** What the demo's servers answer, asked without signing in. */
const demoFetch: Fetch = async (url) => {
  if (url === 'https://git.halyard.dev/api/v4/version')
    return new Response(JSON.stringify({ message: '401 Unauthorized' }), { status: 401, headers: { 'x-gitlab-meta': '{}' } })
  if (url === 'https://northwind.atlassian.net/rest/api/2/serverInfo')
    return new Response(
      JSON.stringify({
        deploymentType: 'Cloud',
        baseUrl: 'https://northwind.atlassian.net',
        version: '1001.0.0',
        versionNumbers: [1001, 0, 0],
      }),
      { status: 200 },
    )
  throw new Error('The demo reaches no network')
}

export const demoConnectors = Layer.succeed(
  Connectors,
  Connectors.of({
    products: Object.values(products).map((info) => ({ ...info, make: demoMake(info.product), access: demoAccess(info.product) })),
    fetch: demoFetch,
    clientIds: {},
    callbackPort: 0,
    cliToken: (tool, host) =>
      Effect.succeed(tool === 'gh' && host === 'github.com' ? 'gho_demo' : tool === 'glab' && host === 'gitlab.com' ? 'glpat-demo' : null),
  }),
)
