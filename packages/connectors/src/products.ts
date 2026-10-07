import type { AdapterOptions, Credential } from './credential'
import { makeGitHub } from './github'
import { makeGitLab } from './gitlab'
import { makeLinear } from './linear'
import type { KnownHosts } from './links'
import type { CodeHost, Product, Tracker } from './model'
import { makeTrello } from './trello'

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
   * or the API key it was made for), and where the person makes one. With an
   * API key, where a token is made for the key typed (`{key}` in its place),
   * and what the key is checked against before it is sent: the first pattern
   * it matches says what is wrong with it.
   */
  readonly token: {
    readonly kind: Credential['kind']
    readonly needs: 'email' | 'key' | null
    readonly help: (webUrl: string) => string
    readonly helpForKey?: string
    readonly keyChecks?: ReadonlyArray<{ readonly pattern: string; readonly says: string }>
  }
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
    token: { kind: 'bearer', needs: null, help: (webUrl) => `${trimmed(webUrl)}/settings/personal-access-tokens/new` },
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
    token: { kind: 'bearer', needs: null, help: (webUrl) => `${trimmed(webUrl)}/-/user_settings/personal_access_tokens` },
    make: (options) => {
      const gitlab = makeGitLab(options)
      return { host: gitlab, tracker: gitlab }
    },
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
    token: { kind: 'basic', needs: 'email', help: () => 'https://id.atlassian.com/manage-profile/security/api-tokens' },
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
    token: { kind: 'bearer', needs: null, help: (webUrl) => `${trimmed(webUrl)}/plugins/servlet/access-tokens/manage` },
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
    token: { kind: 'key', needs: null, help: () => 'https://linear.app/settings/account/security' },
    make: (options) => ({ tracker: makeLinear(options) }),
  },
  jira_cloud: {
    product: 'jira_cloud',
    name: 'Jira',
    host: false,
    tracker: true,
    hosted: null,
    selfHosted: false,
    apiFor: (webUrl) => `${trimmed(webUrl)}/rest/api/3`,
    browser: null,
    token: { kind: 'basic', needs: 'email', help: () => 'https://id.atlassian.com/manage-profile/security/api-tokens' },
    make: null,
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
      needs: null,
      help: (webUrl) =>
        `${trimmed(webUrl)}/secure/ViewProfile.jspa?selectedTab=com.atlassian.pats.pats-plugin:jira-user-personal-access-tokens`,
    },
    make: null,
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
    // The person's own Power-Up key, with a token made for it, until Althar's Power-Up is registered.
    token: {
      kind: 'app',
      needs: 'key',
      help: () => 'https://trello.com/power-ups/admin',
      // Trello shows the token it makes there, to copy.
      helpForKey: 'https://trello.com/1/authorize?expiration=never&name=Althar&scope=read,write&response_type=token&key={key}',
      keyChecks: [
        // A Power-Up's page shows its secret beside its key.
        { pattern: '^[0-9a-fA-F]{64}$', says: 'That’s the Power-Up’s secret; paste its API key' },
        { pattern: '^(?![0-9a-fA-F]{32}$)', says: 'An API key is 32 characters' },
      ],
    },
    make: (options) => ({ tracker: makeTrello(options) }),
  },
}

/** The products Althar can connect to now: those with an adapter. */
export const available = (): ReadonlyArray<ProductInfo> => Object.values(products).filter((info) => info.make !== null)

/** The hosts of these products' hosted services, for reading their links and remotes. */
export const hostedOf = (infos: ReadonlyArray<ProductInfo>): KnownHosts =>
  new Map(infos.flatMap((info) => (info.hosted === null ? [] : [[new URL(info.hosted.webUrl).hostname, info.product] as const])))
