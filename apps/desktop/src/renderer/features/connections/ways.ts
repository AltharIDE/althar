import type { CliSignIn, ConnectGuide, ConnectionSummary, ConnectPlace, Product, ProductOption, Service } from '@althar/contracts'
import { Brand } from '@althar/ui'

/*
 * The ways in to a service, and the steps of each, from what the runtime
 * found: the service's own sign-in in the browser where Althar's app is set
 * up for it, gh's or glab's sign-in where the tool is signed in on this
 * device, a token made on a page opened filled in, and a company's own
 * server, by the address a project's remote names or one the person types.
 * Only ways that can work here are offered.
 */

export const SERVICES: ReadonlyArray<Service> = ['github', 'gitlab', 'bitbucket', 'linear', 'jira', 'trello']

const SERVICE: Readonly<Record<Service, { readonly name: string; readonly brand: Brand; readonly host: boolean }>> = {
  github: { name: 'GitHub', brand: Brand.GitHub, host: true },
  gitlab: { name: 'GitLab', brand: Brand.GitLab, host: true },
  bitbucket: { name: 'Bitbucket', brand: Brand.Bitbucket, host: true },
  linear: { name: 'Linear', brand: Brand.Linear, host: false },
  jira: { name: 'Jira', brand: Brand.Jira, host: false },
  trello: { name: 'Trello', brand: Brand.Trello, host: false },
}

export const serviceName = (service: Service): string => SERVICE[service].name
export const serviceBrand = (service: Service): Brand => SERVICE[service].brand
/** It hosts code, rather than tracking issues. */
export const hostsCode = (service: Service): boolean => SERVICE[service].host

/** The service a product is an edition of, as the list says. */
export const serviceOf = (products: ReadonlyArray<ProductOption>, product: Product): Service | undefined =>
  products.find((option) => option.product === product)?.service

/** The service a product is an edition of: Bitbucket for Bitbucket Cloud and Data Center alike. */
export const serviceOfProduct = (product: Product): Service => {
  switch (product) {
    case 'github':
      return 'github'
    case 'gitlab':
      return 'gitlab'
    case 'bitbucket_cloud':
    case 'bitbucket_dc':
      return 'bitbucket'
    case 'linear':
      return 'linear'
    case 'jira_cloud':
    case 'jira_dc':
      return 'jira'
    case 'trello':
      return 'trello'
  }
}

export type WayKind = 'browser' | 'cli' | 'token' | 'server' | 'site' | 'key'

/** A step of a way: what it asks, on a screen of its own. */
export type StepKind = 'code' | 'install' | 'approve' | 'cli' | 'server' | 'site' | 'key' | 'make' | 'allow' | 'paste' | 'check'

export interface Way {
  /** Unique among a service's ways. */
  readonly id: string
  readonly kind: WayKind
  /** The product it connects. A server's is the service's own-server product until the server answers as another. */
  readonly product: Product
  /** Where: the hosted service, a server a remote names, or null until the person types one. */
  readonly webUrl: string | null
  readonly steps: ReadonlyArray<StepKind>
  /** The project's remote that named its server. */
  readonly place?: ConnectPlace
  /** The tool signed in, for gh's or glab's way. */
  readonly cli?: CliSignIn
}

/** An address's host: git.halyard.dev. */
export const hostOf = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** The ways in to a service, in the order they are offered, and the way to a company's own server where one can be added. */
export const waysOf = (
  service: Service,
  products: ReadonlyArray<ProductOption>,
  guide: ConnectGuide | null,
  again: ConnectionSummary | null,
): { readonly ways: ReadonlyArray<Way>; readonly server: Way | null } => {
  const mine = products.filter((option) => option.service === service)
  const hosted = mine.find((option) => option.hostedUrl !== null)
  const own = mine.find((option) => option.selfHosted && option.hostedUrl === null) ?? mine.find((option) => option.selfHosted)
  const places = guide?.places ?? []
  const clis = guide?.clis ?? []
  const servers = places.filter((place) => hosted === undefined || place.webUrl !== hosted.hostedUrl)
  // A server's walk asks its address first, and makes a token there.
  const serverSteps = (product: Product): ReadonlyArray<StepKind> => ['server', ...tokenSteps(product, products)]

  if (again !== null) {
    // Signing a connection in again: only its own instance, by its own sign-in or a new token.
    const option = products.find((candidate) => candidate.product === again.product)
    const ways: Array<Way> = []
    if (option?.browserSignIn === true && again.auth !== 'token' && again.webUrl === option.hostedUrl)
      ways.push(browserWay(option, again.webUrl))
    for (const cli of clis) if (cli.product === again.product && cli.webUrl === again.webUrl) ways.push(cliWay(cli))
    ways.push({
      id: `token ${again.product} ${again.webUrl}`,
      kind: again.product === 'trello' ? 'key' : 'token',
      product: again.product,
      webUrl: again.webUrl,
      steps: tokenSteps(again.product, products),
    })
    return { ways, server: null }
  }

  const ways: Array<Way> = []
  // GitLab's own servers come first: the code a project names there is where it is.
  if (service === 'gitlab') for (const place of servers) ways.push(serverWay(place.product, place, serverSteps(place.product)))
  if (hosted?.browserSignIn === true && hosted.hostedUrl !== null) ways.push(browserWay(hosted, hosted.hostedUrl))
  for (const cli of clis) if (cli.webUrl === hosted?.hostedUrl) ways.push(cliWay(cli))
  if (hosted !== undefined && hosted.hostedUrl !== null) {
    switch (service) {
      case 'jira':
        break
      case 'trello':
        ways.push({ id: 'key', kind: 'key', product: hosted.product, webUrl: hosted.hostedUrl, steps: ['key', 'allow', 'paste', 'check'] })
        break
      default:
        ways.push({
          id: `token ${hosted.product}`,
          kind: 'token',
          product: hosted.product,
          webUrl: hosted.hostedUrl,
          steps: tokenSteps(hosted.product, products),
        })
    }
  }
  // gh or glab signed in to a server a remote names is a way to that server too.
  for (const cli of clis) if (cli.webUrl !== hosted?.hostedUrl) ways.push(cliWay(cli))
  if (service !== 'gitlab') for (const place of servers) ways.push(serverWay(place.product, place, serverSteps(place.product)))
  // Jira is reached by its site, Cloud or Data Center alike, which says which it is.
  if (service === 'jira' && mine.length > 0) {
    const cloud = mine.find((option) => option.product === 'jira_cloud') ?? mine[0]
    if (cloud !== undefined)
      ways.push({ id: 'site', kind: 'site', product: cloud.product, webUrl: null, steps: ['site', 'make', 'paste', 'check'] })
  }
  const server =
    own === undefined || service === 'jira'
      ? null
      : { id: `server ${own.product}`, kind: 'server' as const, product: own.product, webUrl: null, steps: serverSteps(own.product) }
  return { ways, server }
}

/** A token's steps: made on the service's page, pasted here, and checked. */
const tokenSteps = (product: Product, products: ReadonlyArray<ProductOption>): ReadonlyArray<StepKind> =>
  products.find((option) => option.product === product)?.tokenNeeds === 'key'
    ? ['key', 'allow', 'paste', 'check']
    : ['make', 'paste', 'check']

const browserWay = (option: ProductOption, webUrl: string): Way => ({
  id: `browser ${option.product}`,
  kind: 'browser',
  product: option.product,
  webUrl,
  // GitHub's sign-in is its app's, which is then let in to the projects' owner.
  steps:
    option.product === 'github' ? ['code', 'install', 'check'] : option.product === 'linear' ? ['approve', 'check'] : ['code', 'check'],
})

const cliWay = (cli: CliSignIn): Way => ({
  id: `cli ${cli.product} ${cli.webUrl}`,
  kind: 'cli',
  product: cli.product,
  webUrl: cli.webUrl,
  steps: ['cli', 'check'],
  cli,
})

const serverWay = (product: Product, place: ConnectPlace, steps: ReadonlyArray<StepKind>): Way => ({
  id: `server ${product} ${place.webUrl}`,
  kind: 'server',
  product,
  webUrl: place.webUrl,
  steps,
  place,
})

/** The places of a service's code on one instance. */
export const placesAt = (places: ReadonlyArray<ConnectPlace>, product: Product, webUrl: string): ReadonlyArray<ConnectPlace> =>
  places.filter((place) => place.product === product && place.webUrl === webUrl)

/** The one owner of these places' repositories: northwind; undefined where they have several, or none. */
export const ownerOf = (places: ReadonlyArray<ConnectPlace>): string | undefined => {
  const owners = [...new Set(places.flatMap((place) => place.repositories.map((path) => path.split('/')[0] ?? '')))]
  return owners.length === 1 && owners[0] !== '' ? owners[0] : undefined
}
