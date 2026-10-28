import type {
  BoardTask,
  ConnectionList,
  CoordinatorSnapshot,
  Product,
  ProjectRepository,
  ProjectRulesView,
  ProjectTracker,
} from '@althar/contracts'
import { type MarkGlance, PermissionPolicy, permissionPolicyText, type ProjectPart, RuleKind } from '@althar/ui'
import { projectRulesText } from '@althar/ui/screens'

import { productBrand, productName } from '../../shared/products'
import { ago } from '../../shared/time'
import type { Lanes } from '../board/lanes'

/*
 * What a project's front page says, worked out from what the window read:
 * what settled last, what the project is made of (each repository with its
 * host's mark, as the runtime read its remote, and the tracker its tasks
 * name, where they name one), and its rules in a line.
 */

export const text = {
  merged: (change: string, at: string) => `${change} merged ${at}`.trim(),
  closed: (change: string, at: string) => `${change} closed ${at}`.trim(),
  done: (title: string, at: string) => `${title}, done ${at}`.trim(),
  abandoned: (title: string, at: string) => `${title}, abandoned ${at}`.trim(),
  /** The tracker its tasks name, by the key their issues share, else by its name: MER issues, Trello cards. */
  issues: (tracker: Pick<Tracker, 'product' | 'key'>) =>
    `${tracker.key ?? productName(tracker.product)} ${tracker.product === 'trello' ? 'cards' : 'issues'}`,
  /** What opening a repository or tracker part says it does: Open on GitHub, Open on Linear. */
  openOn: (where: string) => `Open on ${where}`,
  moreTrackers: (n: number) => `+${n} more`,
  alwaysAsks: (what: string) => `Always asks you: ${what}.`,
  nothingAsks: 'Nothing always asks you.',
  /** Everything allowed: what always asks is kept, but doesn't ask. */
  nothingWaits: 'Nothing waits for you.',
}

/** The code host or tracker a project is on, as its coordinator's thread says. */
export type Host = NonNullable<CoordinatorSnapshot['host']>

/** What settled last, in a line: its pull request merged or closed, or the task done or abandoned, and when. */
export const lastSettledOf = (lanes: Lanes, now: Date = new Date()): string | undefined => {
  const [last] = lanes.settled
  if (last === undefined) return undefined
  const at = last.settledAt === null ? '' : ago(last.settledAt, now)
  const change = last.change
  if (change !== null && change.state !== 'open') {
    const named = `${change.short} ${change.number}`
    return change.state === 'merged' ? text.merged(named, at) : text.closed(named, at)
  }
  return last.state === 'abandoned' ? text.abandoned(last.title, at) : text.done(last.title, at)
}

/** An address's host name, lower case; null for one that isn't an address. */
export const hostNameOf = (url: string | null): string | null => {
  if (url === null) return null
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** A tracker a project's tasks name, where it is, and one key their issues share (MER of MER-231). */
export interface Tracker {
  readonly product: Product
  /** The host its issues are on: linear.app, a company's own Jira. */
  readonly at: string | null
  /** Null where its issues share none: a Trello card's key is its own. */
  readonly key: string | null
  /** Its space on the web (the Linear team, the Jira project), worked out from an issue's link; null where that isn't one to build on. */
  readonly url: string | null
  /** The connections its issues are read and moved through, the one most of them use first: Althar's standing there is theirs. */
  readonly connections: ReadonlyArray<string>
  /** Whether it is the one the project is bound to: where its drafts go. */
  readonly bound?: true
}

/** A key's space on the web, from the link of one of its issues: linear.app/acme/team/MER, acme.atlassian.net/browse/MER. */
export const trackerUrlOf = (product: Product, key: string | null, issueUrl: string): string | null => {
  try {
    const url = new URL(issueUrl)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (key === null) return url.origin
    if (product === 'linear') {
      const [workspace] = url.pathname.split('/').filter(Boolean)
      return workspace === undefined ? null : `${url.origin}/${workspace}/team/${key}`
    }
    if (product === 'jira_cloud' || product === 'jira_dc') return `${url.origin}/browse/${key}`
    return url.origin
  } catch {
    return null
  }
}

/**
 * The trackers a project's tasks name, the one most of them name first: one
 * a key their issues share, else one a tracker whose issues share none, as
 * Trello's cards; each with the connections its issues are read through.
 */
export const trackersOf = (tasks: ReadonlyArray<BoardTask>, list: ConnectionList | null): Tracker[] => {
  const trackers = new Set(list?.products.filter((product) => product.tracker && !product.host).map((product) => product.product) ?? [])
  const counted = new Map<string, Omit<Tracker, 'connections'> & { n: number; through: Map<string, number> }>()
  for (const task of tasks) {
    const issue = task.issue
    if (issue === null || !trackers.has(issue.product)) continue
    const key = /^([A-Z][A-Z0-9_]*)-\d+$/.exec(issue.key)?.[1] ?? null
    const at = hostNameOf(issue.url)
    const id = `${issue.product}:${at ?? ''}:${key ?? ''}`
    const was = counted.get(id)
    const through = was?.through ?? new Map<string, number>()
    if (issue.connectionId !== undefined) through.set(issue.connectionId, (through.get(issue.connectionId) ?? 0) + 1)
    counted.set(id, {
      product: issue.product,
      at,
      key,
      url: was?.url ?? trackerUrlOf(issue.product, key, issue.url),
      n: (was?.n ?? 0) + 1,
      through,
    })
  }
  return [...counted.values()]
    .toSorted((a, b) => b.n - a.n)
    .map(({ product, at, key, url, through }) => ({
      product,
      at,
      key,
      url,
      connections: [...through].toSorted((a, b) => b[1] - a[1]).map(([connection]) => connection),
    }))
}

/** The account Althar is connected as on a product there, if it is: a connection to another server of the same product doesn't count. */
export const connectedAs = (list: ConnectionList | null, product: Product, at: string | null): string | null =>
  list?.connections.find(
    (connection) => connection.product === product && connection.state === 'ready' && (at === null || hostNameOf(connection.webUrl) === at),
  )?.account.login ?? null

/** Every task on the board, in its lanes' order. */
export const tasksOf = (lanes: Lanes): ReadonlyArray<BoardTask> => [...lanes.next, ...lanes.running, ...lanes.ready, ...lanes.settled]

/** How many trackers show by name; the rest are counted. */
export const TRACKERS_SHOWN = 3

/** What the project is made of: its repositories, each with its host's mark, then the trackers its tasks name. */
export const partsOf = (input: {
  /** Its repositories as read, each with where its work goes; null until they are. */
  readonly repositories: ReadonlyArray<Pick<ProjectRepository, 'id' | 'name' | 'host'>> | null
  /** Its repositories by name, as the projects are listed: until they are read, each is on the project's host. */
  readonly names: ReadonlyArray<string>
  readonly host: Host | null
  readonly trackers: ReadonlyArray<Tracker>
  /** Opens an address in the person's browser. */
  readonly open: (url: string) => void
}): ProjectPart[] => {
  const opening = (product: Product | null, url: string | null) =>
    product === null || url === null || !/^https?:\/\//i.test(url)
      ? {}
      : { openLabel: text.openOn(productName(product)), onOpen: () => input.open(url) }
  const shown = input.trackers.slice(0, TRACKERS_SHOWN)
  const more = input.trackers.length - shown.length
  return [
    ...(input.repositories === null
      ? input.names.map((name) => ({ id: name, name, ...(input.host === null ? {} : { brand: productBrand(input.host.product) }) }))
      : input.repositories.map((repository) => {
          const product = repository.host?.product ?? null
          return {
            id: repository.id,
            name: repository.name,
            ...(product === null ? {} : { brand: productBrand(product) }),
            // From its remote, so a host Althar isn't connected to opens too.
            ...opening(product, repository.host?.url ?? null),
          }
        })),
    ...shown.map((tracker) => ({
      id: `tracker:${tracker.product}:${tracker.at ?? ''}:${tracker.key ?? ''}`,
      name: text.issues(tracker),
      brand: productBrand(tracker.product),
      ...opening(tracker.product, tracker.url),
    })),
    ...(more > 0 ? [{ id: 'tracker:more', name: text.moreTrackers(more) }] : []),
  ]
}

/** The hosts a project's repositories are on, a mark each: faint where Althar isn't connected to it. */
export const hostMarksOf = (repositories: ReadonlyArray<Pick<ProjectRepository, 'host'>>): MarkGlance[] => {
  const marks = new Map<string, MarkGlance>()
  for (const repository of repositories) {
    const product = repository.host?.product ?? null
    if (product === null) continue
    const brand = productBrand(product)
    const connected = repository.host?.account?.state === 'ready'
    // One mark a brand, as Cloud and a company's own server share one: faint only while neither is connected.
    const was = marks.get(brand)
    const faint = !connected && (was === undefined || was.faint === true)
    marks.set(brand, { id: brand, name: productName(product), brand, ...(faint ? { faint } : {}) })
  }
  return [...marks.values()]
}

/** The kinds of request, in the order the rules list them. */
const KINDS: readonly RuleKind[] = [
  RuleKind.DefaultBranch,
  RuleKind.ForcePush,
  RuleKind.ManyBranches,
  RuleKind.DeleteBranch,
  RuleKind.Deploy,
  RuleKind.Outside,
]

const POLICY = {
  rules: PermissionPolicy.Rules,
  coordinator: PermissionPolicy.Coordinator,
  ask: PermissionPolicy.Ask,
} as const satisfies Record<ProjectRulesView['permissions'], PermissionPolicy>

/** The project's rules in a line: who answers what agents ask, and what always asks you whoever would. */
export const rulesLineOf = (rules: ProjectRulesView): { readonly policy: string; readonly asks: string } => {
  // Each kind where a request meets it first: one Never also lists doesn't ask.
  const asking = [
    ...KINDS.filter((kind) => rules.alwaysAsk.includes(kind) && !rules.never.includes(kind)).map(
      (kind) => projectRulesText.kinds[kind].name,
    ),
    ...rules.commands.filter((rule) => rule.decision === 'ask').map((rule) => `“${rule.pattern}”`),
  ]
  return {
    policy: permissionPolicyText[rules.allowEverything ? PermissionPolicy.AllowAll : POLICY[rules.permissions]].title,
    // With everything allowed, what always asks is kept for later, but asks nothing now.
    asks: rules.allowEverything
      ? text.nothingWaits
      : asking.length === 0
        ? text.nothingAsks
        : text.alwaysAsks(asking.map((what, i) => (i === 0 ? what : what.charAt(0).toLowerCase() + what.slice(1))).join(', ')),
  }
}

/**
 * The trackers a project is on, as the person sees them: the one it is bound
 * to first, by hand or learned, then those its tasks' issues are on that
 * differ. The binding is the learned tracker on its connection, when its
 * issues are on one; otherwise a tracker of its own, from its connection (or,
 * disconnected since, the one it was bound to, which Althar can't reach).
 */
/** A tracker's page on the web: its server's, or the workspace's on it where the connection reaches one. */
const spaceOf = (webUrl: string | null, workspace: string | undefined): string | null => {
  if (webUrl === null) return null
  const origin = trackerUrlOf('trello', null, webUrl)
  return origin === null || workspace === undefined ? origin : `${origin}/${workspace}`
}

export const trackersWithBinding = (
  learned: ReadonlyArray<Tracker>,
  binding: Pick<ProjectTracker, 'connectionId' | 'gone'> | null,
  list: ConnectionList | null,
): Tracker[] => {
  if (binding === null) return [...learned]
  const connection = list?.connections.find((each) => each.id === binding.connectionId)
  const product = connection?.product ?? (binding.gone?.product as Product | undefined)
  const webUrl = connection?.webUrl ?? binding.gone?.webUrl ?? null
  if (product === undefined) return [...learned]
  const at = hostNameOf(webUrl)
  const same = (tracker: Tracker) =>
    tracker.connections.length > 0 ? tracker.connections.includes(binding.connectionId) : tracker.product === product && tracker.at === at
  const matched = learned.find(same)
  const first: Tracker =
    matched !== undefined
      ? { ...matched, bound: true }
      : {
          product,
          at,
          key: null,
          url: spaceOf(webUrl, connection?.workspace?.key),
          connections: [binding.connectionId],
          bound: true,
        }
  return [first, ...learned.filter((tracker) => tracker !== matched)]
}
