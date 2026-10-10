import type { BoardTask, ConnectionList, CoordinatorSnapshot, Product, ProjectRepository, ProjectRulesView } from '@althar/contracts'
import { type MarkGlance, PermissionPolicy, permissionPolicyText, type ProjectPart } from '@althar/ui'

import { productBrand, productName } from '../../shared/products'
import { ago } from '../../shared/time'
import type { Lanes } from '../board/lanes'
import { text as rulesText } from '../rules/RulesView'

/*
 * What a project's front page says, worked out from what the window read:
 * what settled last, what the project is made of (each repository with its
 * host's mark, as its remote says, and the tracker its tasks name, where
 * they name one), and its rules in a line.
 */

export const text = {
  merged: (change: string, at: string) => `${change} merged ${at}`.trim(),
  closed: (change: string, at: string) => `${change} closed ${at}`.trim(),
  done: (title: string, at: string) => `${title}, done ${at}`.trim(),
  abandoned: (title: string, at: string) => `${title}, abandoned ${at}`.trim(),
  /** The tracker its tasks name, by the key their issues share. */
  issues: (key: string) => `${key} issues`,
  alwaysAsks: (what: string) => `Always asks you: ${what}.`,
  nothingAsks: 'Nothing always asks you.',
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

/** A remote's host name, as git writes remotes: `git@host:owner/repo.git`, or an address. Null for a local path. */
export const remoteHostOf = (remote: string | null): string | null => {
  if (remote === null) return null
  const text = remote.trim()
  if (!text.includes('://')) return /^(?:[^@\s]+@)?([^:/\s]+):.+$/.exec(text)?.[1]?.toLowerCase() ?? null
  try {
    return new URL(text).hostname.toLowerCase() || null
  } catch {
    return null
  }
}

const hostNameOf = (url: string | null): string | null => {
  if (url === null) return null
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** The code host a remote is on: the project's own, one connected, or a hosted one Althar knows; null for one it doesn't. */
export const productOfRemote = (remote: string | null, host: Host | null, list: ConnectionList | null): Product | null => {
  const name = remoteHostOf(remote)
  if (name === null) return null
  if (host !== null && hostNameOf(host.webUrl) === name) return host.product
  const hosts = new Set(list?.products.filter((product) => product.host).map((product) => product.product) ?? [])
  const connected = list?.connections.find((connection) => hosts.has(connection.product) && hostNameOf(connection.webUrl) === name)
  if (connected !== undefined) return connected.product
  return list?.products.find((product) => product.host && hostNameOf(product.hostedUrl) === name)?.product ?? null
}

/** The tracker a project's tasks name, by the key most of their issues share (MER of MER-231); none where they name none. */
export const trackerOf = (tasks: ReadonlyArray<BoardTask>, list: ConnectionList | null): { product: Product; key: string } | null => {
  const trackers = new Set(list?.products.filter((product) => product.tracker && !product.host).map((product) => product.product) ?? [])
  const counted = new Map<string, { product: Product; key: string; n: number }>()
  for (const task of tasks) {
    const issue = task.issue
    const key = issue === null ? undefined : /^([A-Z][A-Z0-9_]*)-\d+$/.exec(issue.key)?.[1]
    if (issue === null || key === undefined || !trackers.has(issue.product)) continue
    const id = `${issue.product}:${key}`
    const was = counted.get(id)
    counted.set(id, { product: issue.product, key, n: (was?.n ?? 0) + 1 })
  }
  const [most] = [...counted.values()].toSorted((a, b) => b.n - a.n)
  return most === undefined ? null : { product: most.product, key: most.key }
}

/** Every task on the board, in its lanes' order. */
export const tasksOf = (lanes: Lanes): ReadonlyArray<BoardTask> => [...lanes.next, ...lanes.running, ...lanes.ready, ...lanes.settled]

/** What the project is made of: its repositories, each with its host's mark, then the tracker its tasks name. */
export const partsOf = (input: {
  readonly repositories: ReadonlyArray<Pick<ProjectRepository, 'id' | 'name' | 'remote'>>
  readonly host: Host | null
  readonly list: ConnectionList | null
  readonly tracker: { readonly product: Product; readonly key: string } | null
}): ProjectPart[] => [
  ...input.repositories.map((repository) => {
    const product = productOfRemote(repository.remote, input.host, input.list)
    return { id: repository.id, name: repository.name, ...(product === null ? {} : { brand: productBrand(product) }) }
  }),
  ...(input.tracker === null
    ? []
    : [{ id: `tracker:${input.tracker.key}`, name: text.issues(input.tracker.key), brand: productBrand(input.tracker.product) }]),
]

/** The hosts a project's repositories are on, a mark each: faint where Althar isn't connected to it. */
export const hostMarksOf = (
  repositories: ReadonlyArray<Pick<ProjectRepository, 'remote'>>,
  host: Host | null,
  list: ConnectionList | null,
): MarkGlance[] => {
  const marks = new Map<string, MarkGlance>()
  for (const repository of repositories) {
    const product = productOfRemote(repository.remote, host, list)
    if (product === null) continue
    const brand = productBrand(product)
    const connected =
      list?.connections.some((connection) => connection.product === product && connection.state === 'ready') ??
      (host?.product === product && host.connected)
    // One mark a brand, as Cloud and a company's own server share one: faint only while neither is connected.
    const was = marks.get(brand)
    const faint = !connected && (was === undefined || was.faint === true)
    marks.set(brand, { id: brand, name: productName(product), brand, ...(faint ? { faint } : {}) })
  }
  return [...marks.values()]
}

const POLICY = {
  rules: PermissionPolicy.Rules,
  coordinator: PermissionPolicy.Coordinator,
  ask: PermissionPolicy.Ask,
  allow: PermissionPolicy.AllowAll,
} as const satisfies Record<ProjectRulesView['permissions'], PermissionPolicy>

/** The project's rules in a line: who answers what agents ask, and what always asks you whoever would. */
export const rulesLineOf = (rules: ProjectRulesView): { readonly policy: string; readonly asks: string } => {
  const asking = [
    ...rules.alwaysAsk.map((kind) => rulesText.kinds[kind]),
    ...rules.commands.filter((rule) => rule.decision === 'ask').map((rule) => `“${rule.pattern}”`),
  ]
  return {
    policy: permissionPolicyText[POLICY[rules.permissions]].title,
    asks:
      asking.length === 0
        ? text.nothingAsks
        : text.alwaysAsks(asking.map((what, i) => (i === 0 ? what : what.charAt(0).toLowerCase() + what.slice(1))).join(', ')),
  }
}
