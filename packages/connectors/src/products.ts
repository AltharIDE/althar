import type { Access } from './access'
import { accessBitbucketCloud, makeBitbucketCloud } from './bitbucketCloud'
import { accessBitbucketDataCenter, makeBitbucketDataCenter } from './bitbucketDataCenter'
import type { AdapterOptions, Credential } from './credential'
import { accessGitHub, classicTokenPage, makeGitHub } from './github'
import { accessGitLab, makeGitLab } from './gitlab'
import { accessJira, makeJiraCloud, makeJiraDataCenter, siteOf } from './jira'
import { accessLinear, makeLinear } from './linear'
import type { KnownHosts } from './links'
import type { CodeHost, Product, Service, Tracker } from './model'
import { accessTrello, makeTrello } from './trello'

/*
 * Every product Althar connects to: its name, where its hosted service
 * is, whether it runs on people's own servers, how a person signs in to it
 * (docs/architecture/06, "Signing in"), and its adapter, once there is one.
 * A product without an adapter is listed so the model stays honest about
 * all six, but nothing offers it yet.
 */

export interface ProductInfo {
  readonly product: Product
  /** The service it is an edition of, as the person connects it: Bitbucket for Bitbucket Cloud and Data Center alike. */
  readonly service: Service
  readonly name: string
  /** It hosts code, and changes to it. */
  readonly host: boolean
  /** It tracks issues. */
  readonly tracker: boolean
  /** The hosted service; null for a product that only runs on people's own servers. */
  readonly hosted: { readonly webUrl: string; readonly apiUrl: string } | null
  /** An instance on a company's own server can be connected, by its address. */
  readonly selfHosted: boolean
  /** An instance's API root, from its address. */
  readonly apiFor: (webUrl: string) => string
  /** The address a connection keeps, from what the person typed, where the product says more than trimming it. */
  readonly address?: (typed: string) => string
  /**
   * The browser sign-in it gives a desktop app without a secret: a code the
   * person types on its page, or a page they approve that comes back here.
   * Each needs Althar's app registered with the service; until it is, the
   * product takes a pasted token.
   */
  readonly browser:
    | {
        readonly kind: 'device'
        readonly codeUrl: (webUrl: string) => string
        readonly tokenUrl: (webUrl: string) => string
        readonly scope?: string
      }
    | {
        readonly kind: 'pkce'
        readonly authorizeUrl: string
        readonly tokenUrl: string
        readonly scope: string
      }
    | null
  /**
   * A pasted token: how it is sent, what goes with it (the account's email,
   * or the API key it was made for), where the person makes one (filled in,
   * where the service's page takes it), where their tokens are listed to
   * change one, and what its tokens start with, to notice one on the
   * clipboard. With an API key, where a token is made for the key typed
   * (`{key}` in its place), and what the key is checked against before it is
   * sent: the first pattern it matches says what is wrong with it.
   */
  readonly token: {
    readonly kind: Credential['kind']
    readonly needs: 'email' | 'key' | null
    readonly page: (webUrl: string, made: TokenMade) => string
    readonly settings: (webUrl: string) => string
    readonly prefixes: ReadonlyArray<string>
    readonly helpForKey?: string
    readonly keyChecks?: ReadonlyArray<{ readonly pattern: string; readonly says: string }>
  }
  /** Its adapter, once built. */
  readonly make: ((options: AdapterOptions) => { readonly host?: CodeHost; readonly tracker?: Tracker }) | null
  /** What a connection to it can do, asked of the service; null where nothing is asked beyond who it signs in as. */
  readonly access: Access | null
}

/** What a token page is filled in with, where it takes it: the token's name, and the owner of the repositories it is for. */
export interface TokenMade {
  readonly name: string
  readonly owner?: string
}

/** What a token Althar asks for says it is for, on the pages that take a description. */
const PURPOSE = 'Althar pushes task branches, opens their pull requests and reads their checks.'

/**
 * GitHub's page for a fine-grained token, filled in: its name, what it is
 * for, the owner of the repositories, 90 days, and the permissions Althar
 * uses (docs.github.com, "Pre-filling fine-grained personal access token
 * details using URL parameters"). Which repositories can't be filled in;
 * the person picks them. Fine-grained tokens get no Checks permission.
 */
const fineGrained = (webUrl: string, made: TokenMade) => {
  const query = new URLSearchParams({
    name: made.name.slice(0, 40),
    description: PURPOSE,
    ...(made.owner === undefined ? {} : { target_name: made.owner }),
    expires_in: '90',
    contents: 'write',
    pull_requests: 'write',
    issues: 'write',
    statuses: 'read',
    actions: 'read',
    workflows: 'write',
  })
  return `${trimmed(webUrl)}/settings/personal-access-tokens/new?${query.toString()}`
}

/** GitHub's page for a classic token, filled in, which its adapter keeps: a check links to it too. */
export { classicTokenPage }

const trimmed = (url: string) => url.replace(/\/+$/, '')

/** Where an Atlassian account's API tokens are made and listed, for Jira Cloud and Bitbucket Cloud alike. */
const ATLASSIAN_TOKENS = 'https://id.atlassian.com/manage-profile/security/api-tokens'

/** A Jira Data Center account's personal access tokens. */
const jiraTokens = (webUrl: string) =>
  `${trimmed(webUrl)}/secure/ViewProfile.jspa?selectedTab=com.atlassian.pats.pats-plugin:jira-user-personal-access-tokens`

export const products: Readonly<Record<Product, ProductInfo>> = {
  github: {
    product: 'github',
    service: 'github',
    name: 'GitHub',
    host: true,
    tracker: true,
    hosted: { webUrl: 'https://github.com', apiUrl: 'https://api.github.com' },
    selfHosted: true,
    apiFor: (webUrl) => (trimmed(webUrl) === 'https://github.com' ? 'https://api.github.com' : `${trimmed(webUrl)}/api/v3`),
    browser: {
      kind: 'device',
      codeUrl: (webUrl) => `${trimmed(webUrl)}/login/device/code`,
      tokenUrl: (webUrl) => `${trimmed(webUrl)}/login/oauth/access_token`,
    },
    token: {
      kind: 'bearer',
      needs: null,
      // A company's own server may predate fine-grained tokens: a classic one there.
      page: (webUrl, made) => (trimmed(webUrl) === 'https://github.com' ? fineGrained(webUrl, made) : classicTokenPage(webUrl)),
      settings: (webUrl) =>
        trimmed(webUrl) === 'https://github.com'
          ? `${trimmed(webUrl)}/settings/personal-access-tokens`
          : `${trimmed(webUrl)}/settings/tokens`,
      prefixes: ['github_pat_', 'ghp_'],
    },
    make: (options) => {
      const github = makeGitHub(options)
      return { host: github, tracker: github }
    },
    access: accessGitHub,
  },
  gitlab: {
    product: 'gitlab',
    service: 'gitlab',
    name: 'GitLab',
    host: true,
    tracker: true,
    hosted: { webUrl: 'https://gitlab.com', apiUrl: 'https://gitlab.com/api/v4' },
    selfHosted: true,
    apiFor: (webUrl) => `${trimmed(webUrl)}/api/v4`,
    browser: {
      kind: 'device',
      codeUrl: (webUrl) => `${trimmed(webUrl)}/oauth/authorize_device`,
      tokenUrl: (webUrl) => `${trimmed(webUrl)}/oauth/token`,
      scope: 'api',
    },
    token: {
      kind: 'bearer',
      needs: null,
      // GitLab's page takes a name, a description and scopes (docs.gitlab.com, "Prefill personal access token name and scopes"); `api` covers git over HTTPS too.
      page: (webUrl, made) =>
        `${trimmed(webUrl)}/-/user_settings/personal_access_tokens?${new URLSearchParams({ name: made.name, description: PURPOSE, scopes: 'api' }).toString()}`,
      settings: (webUrl) => `${trimmed(webUrl)}/-/user_settings/personal_access_tokens`,
      prefixes: ['glpat-'],
    },
    make: (options) => {
      const gitlab = makeGitLab(options)
      return { host: gitlab, tracker: gitlab }
    },
    access: accessGitLab,
  },
  bitbucket_cloud: {
    product: 'bitbucket_cloud',
    service: 'bitbucket',
    name: 'Bitbucket',
    host: true,
    tracker: false,
    hosted: { webUrl: 'https://bitbucket.org', apiUrl: 'https://api.bitbucket.org/2.0' },
    selfHosted: false,
    apiFor: () => 'https://api.bitbucket.org/2.0',
    browser: null,
    // Atlassian's page takes nothing filled in: the person names the token and ticks its scopes.
    token: { kind: 'basic', needs: 'email', page: () => ATLASSIAN_TOKENS, settings: () => ATLASSIAN_TOKENS, prefixes: ['ATATT'] },
    make: (options) => ({ host: makeBitbucketCloud(options) }),
    access: accessBitbucketCloud,
  },
  bitbucket_dc: {
    product: 'bitbucket_dc',
    service: 'bitbucket',
    name: 'Bitbucket Data Center',
    host: true,
    tracker: false,
    hosted: null,
    selfHosted: true,
    apiFor: (webUrl) => `${trimmed(webUrl)}/rest/api/latest`,
    browser: null,
    token: {
      kind: 'bearer',
      needs: null,
      page: (webUrl) => `${trimmed(webUrl)}/plugins/servlet/access-tokens/manage`,
      settings: (webUrl) => `${trimmed(webUrl)}/plugins/servlet/access-tokens/manage`,
      prefixes: [],
    },
    make: (options) => ({ host: makeBitbucketDataCenter(options) }),
    access: accessBitbucketDataCenter,
  },
  linear: {
    product: 'linear',
    service: 'linear',
    name: 'Linear',
    host: false,
    tracker: true,
    hosted: { webUrl: 'https://linear.app', apiUrl: 'https://api.linear.app' },
    selfHosted: false,
    apiFor: () => 'https://api.linear.app',
    browser: {
      kind: 'pkce',
      authorizeUrl: 'https://linear.app/oauth/authorize',
      tokenUrl: 'https://api.linear.app/oauth/token',
      scope: 'read,write',
    },
    token: {
      kind: 'key',
      needs: null,
      page: () => 'https://linear.app/settings/account/security',
      settings: () => 'https://linear.app/settings/account/security',
      prefixes: ['lin_api_'],
    },
    make: (options) => ({ tracker: makeLinear(options) }),
    access: accessLinear,
  },
  jira_cloud: {
    product: 'jira_cloud',
    service: 'jira',
    name: 'Jira',
    host: false,
    tracker: true,
    hosted: null,
    selfHosted: false,
    apiFor: (webUrl) => `${siteOf(webUrl)}/rest/api/3`,
    // A site is its origin, whatever page of it was pasted.
    address: siteOf,
    browser: null,
    token: { kind: 'basic', needs: 'email', page: () => ATLASSIAN_TOKENS, settings: () => ATLASSIAN_TOKENS, prefixes: ['ATATT'] },
    make: (options) => ({ tracker: makeJiraCloud(options) }),
    access: accessJira,
  },
  jira_dc: {
    product: 'jira_dc',
    service: 'jira',
    name: 'Jira Data Center',
    host: false,
    tracker: true,
    hosted: null,
    selfHosted: true,
    apiFor: (webUrl) => `${trimmed(webUrl)}/rest/api/2`,
    browser: null,
    token: {
      kind: 'bearer',
      needs: null,
      page: (webUrl) => jiraTokens(webUrl),
      settings: (webUrl) => jiraTokens(webUrl),
      prefixes: [],
    },
    make: (options) => ({ tracker: makeJiraDataCenter(options) }),
    access: accessJira,
  },
  trello: {
    product: 'trello',
    service: 'trello',
    name: 'Trello',
    host: false,
    tracker: true,
    hosted: { webUrl: 'https://trello.com', apiUrl: 'https://api.trello.com/1' },
    selfHosted: false,
    apiFor: () => 'https://api.trello.com/1',
    browser: null,
    // The person's own Power-Up key, with a token made for it, until Althar's Power-Up is registered.
    token: {
      kind: 'app',
      needs: 'key',
      page: () => 'https://trello.com/power-ups/admin',
      // A member's tokens, each with the app it was made for, where one is revoked.
      settings: () => 'https://trello.com/my/account',
      prefixes: ['ATTA'],
      // Trello shows the token it makes there, to copy.
      helpForKey: 'https://trello.com/1/authorize?expiration=never&name=Althar&scope=read,write&response_type=token&key={key}',
      keyChecks: [
        // A Power-Up's page shows its secret beside its key.
        { pattern: '^[0-9a-fA-F]{64}$', says: 'That’s the Power-Up’s secret; paste its API key' },
        { pattern: '^(?![0-9a-fA-F]{32}$)', says: 'An API key is 32 characters' },
      ],
    },
    make: (options) => ({ tracker: makeTrello(options) }),
    access: accessTrello,
  },
}

/** The address a connection to a product keeps, from what the person typed: without a trailing slash, and as the product says. */
export const addressOf = (info: ProductInfo, typed: string): string => info.address?.(typed) ?? trimmed(typed)

/** The products Althar can connect to now: those with an adapter. */
export const available = (): ReadonlyArray<ProductInfo> => Object.values(products).filter((info) => info.make !== null)

/** The hosts of these products' hosted services, for reading their links and remotes. */
export const hostedOf = (infos: ReadonlyArray<ProductInfo>): KnownHosts =>
  new Map(infos.flatMap((info) => (info.hosted === null ? [] : [[new URL(info.hosted.webUrl).hostname, info.product] as const])))
