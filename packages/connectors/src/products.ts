import type { AdapterOptions, Credential } from './credential'
import { makeGitHub } from './github'
import { makeJiraCloud, makeJiraDataCenter, siteOf } from './jira'
import { makeLinear } from './linear'
import type { KnownHosts } from './links'
import type { CodeHost, Product, Tracker } from './model'

/*
 * Every product Althar connects to: its name, where its hosted service
 * is, whether it runs on people's own servers, how a person signs in to it
 * (docs/architecture/06, "Signing in"), and its adapter, once there is one.
 * A product without an adapter is listed so the model stays honest about
 * all six, but nothing offers it yet.
 */

export interface ProductInfo {
  readonly product: Product
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
  /** A pasted token: how it is sent, whether it needs the account's email with it, and where the person makes one. */
  readonly token: { readonly kind: Credential['kind']; readonly user: boolean; readonly help: (webUrl: string) => string }
  /** Its adapter, once built. */
  readonly make: ((options: AdapterOptions) => { readonly host?: CodeHost; readonly tracker?: Tracker }) | null
}

const trimmed = (url: string) => url.replace(/\/+$/, '')

export const products: Readonly<Record<Product, ProductInfo>> = {
  github: {
    product: 'github',
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
    token: { kind: 'bearer', user: false, help: (webUrl) => `${trimmed(webUrl)}/settings/personal-access-tokens/new` },
    make: (options) => {
      const github = makeGitHub(options)
      return { host: github, tracker: github }
    },
  },
  gitlab: {
    product: 'gitlab',
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
    token: { kind: 'bearer', user: false, help: (webUrl) => `${trimmed(webUrl)}/-/user_settings/personal_access_tokens` },
    make: null,
  },
  bitbucket_cloud: {
    product: 'bitbucket_cloud',
    name: 'Bitbucket',
    host: true,
    tracker: false,
    hosted: { webUrl: 'https://bitbucket.org', apiUrl: 'https://api.bitbucket.org/2.0' },
    selfHosted: false,
    apiFor: () => 'https://api.bitbucket.org/2.0',
    browser: null,
    token: { kind: 'basic', user: true, help: () => 'https://id.atlassian.com/manage-profile/security/api-tokens' },
    make: null,
  },
  bitbucket_dc: {
    product: 'bitbucket_dc',
    name: 'Bitbucket Data Center',
    host: true,
    tracker: false,
    hosted: null,
    selfHosted: true,
    apiFor: (webUrl) => `${trimmed(webUrl)}/rest/api/latest`,
    browser: null,
    token: { kind: 'bearer', user: false, help: (webUrl) => `${trimmed(webUrl)}/plugins/servlet/access-tokens/manage` },
    make: null,
  },
  linear: {
    product: 'linear',
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
    token: { kind: 'key', user: false, help: () => 'https://linear.app/settings/account/security' },
    make: (options) => ({ tracker: makeLinear(options) }),
  },
  jira_cloud: {
    product: 'jira_cloud',
    name: 'Jira',
    host: false,
    tracker: true,
    hosted: null,
    selfHosted: false,
    apiFor: (webUrl) => `${siteOf(webUrl)}/rest/api/3`,
    // A site is its origin, whatever page of it was pasted.
    address: siteOf,
    browser: null,
    token: { kind: 'basic', user: true, help: () => 'https://id.atlassian.com/manage-profile/security/api-tokens' },
    make: (options) => ({ tracker: makeJiraCloud(options) }),
  },
  jira_dc: {
    product: 'jira_dc',
    name: 'Jira Data Center',
    host: false,
    tracker: true,
    hosted: null,
    selfHosted: true,
    apiFor: (webUrl) => `${trimmed(webUrl)}/rest/api/2`,
    browser: null,
    token: {
      kind: 'bearer',
      user: false,
      help: (webUrl) =>
        `${trimmed(webUrl)}/secure/ViewProfile.jspa?selectedTab=com.atlassian.pats.pats-plugin:jira-user-personal-access-tokens`,
    },
    make: (options) => ({ tracker: makeJiraDataCenter(options) }),
  },
  trello: {
    product: 'trello',
    name: 'Trello',
    host: false,
    tracker: true,
    hosted: { webUrl: 'https://trello.com', apiUrl: 'https://api.trello.com/1' },
    selfHosted: false,
    apiFor: () => 'https://api.trello.com/1',
    browser: null,
    token: { kind: 'key', user: false, help: () => 'https://trello.com/power-ups/admin' },
    make: null,
  },
}

/** The address a connection to a product keeps, from what the person typed: without a trailing slash, and as the product says. */
export const addressOf = (info: ProductInfo, typed: string): string => info.address?.(typed) ?? trimmed(typed)

/** The products Althar can connect to now: those with an adapter. */
export const available = (): ReadonlyArray<ProductInfo> => Object.values(products).filter((info) => info.make !== null)

/** The hosts of these products' hosted services, for reading their links and remotes. */
export const hostedOf = (infos: ReadonlyArray<ProductInfo>): KnownHosts =>
  new Map(infos.flatMap((info) => (info.hosted === null ? [] : [[new URL(info.hosted.webUrl).hostname, info.product] as const])))
