import { MergeRules } from '@althar/connectors'
import { type ChangeSummary, ChecksSummary } from '@althar/contracts'
import { Option, Schema } from 'effect'

import { mergeNeedsOf } from './mergeNeeds'

/** Reading what the store keeps as JSON (snapshots, payloads): what it holds, or nothing where it isn't there or isn't JSON. */
export const parse = (json: string | null): unknown => {
  if (json === null) return null
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

export const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null && key in value ? (value as Record<string, unknown>)[key] : undefined

export const text = (value: unknown, key: string): string => {
  const found = field(value, key)
  return typeof found === 'string' ? found : ''
}

export const number = (value: unknown, key: string): number | null => {
  const found = field(value, key)
  return typeof found === 'number' ? found : null
}

const decodeChecks = Schema.decodeUnknownOption(ChecksSummary.fields.list)
const decodeRules = Schema.decodeUnknownOption(MergeRules)

export const PRODUCTS = [
  'github',
  'gitlab',
  'bitbucket_cloud',
  'bitbucket_dc',
  'linear',
  'jira_cloud',
  'jira_dc',
  'trello',
  'clickup',
] as const

/** A pull request as Althar last saw it (its external link's snapshot), in the contract's shape. */
export const changeOf = (value: unknown, product: string, listening: boolean): ChangeSummary | null => {
  const state = text(value, 'state')
  const words = field(value, 'words')
  const repository = field(value, 'repository')
  const checks = field(value, 'checks')
  const productIs = PRODUCTS.find((candidate) => candidate === product)
  const n = number(value, 'number')
  if (n === null || productIs === undefined || (state !== 'open' && state !== 'merged' && state !== 'closed')) return null
  const outcome = text(checks, 'outcome')
  const failing = field(checks, 'failing')
  // Where the host said whether it conflicts, and which branch it merges into: absent from a snapshot kept before them.
  const conflicts = field(value, 'conflicts')
  const target = text(value, 'target')
  const seen: ChangeSummary = {
    product: productIs,
    number: n,
    title: text(value, 'title'),
    url: text(value, 'url'),
    state,
    draft: field(value, 'draft') === true,
    noun: text(words, 'noun') || 'pull request',
    short: text(words, 'short') || 'PR',
    prefix: text(words, 'prefix') || '#',
    repository: Array.isArray(repository) ? repository.filter((part) => typeof part === 'string').join('/') : '',
    slug: null,
    additions: number(value, 'additions'),
    deletions: number(value, 'deletions'),
    changedFiles: number(value, 'changedFiles'),
    checks:
      checks === null || checks === undefined
        ? null
        : {
            outcome: outcome === 'running' || outcome === 'passed' || outcome === 'failed' ? outcome : 'none',
            passed: number(checks, 'passed') ?? 0,
            failed: number(checks, 'failed') ?? 0,
            running: number(checks, 'running') ?? 0,
            total: number(checks, 'total') ?? 0,
            failing: Array.isArray(failing) ? failing.filter((name) => typeof name === 'string') : [],
            list: Option.getOrElse(decodeChecks(field(checks, 'list') ?? []), () => []),
          },
    ...(target === '' ? {} : { target }),
    ...(typeof conflicts === 'boolean' ? { conflicts } : {}),
    ...(field(value, 'queued') === true ? { queued: true } : {}),
    head: text(value, 'headSha') || null,
    listening,
    localHead: null,
    ...(field(value, 'maintainerEdit') === true ? { maintainerEdit: true } : {}),
    unpushed: 0,
    diverged: null,
  }
  // What merging it needs, as its host last said, with what Althar knows of it (DEV-204); what is left to push is counted later.
  const rules = Option.getOrNull(decodeRules(field(value, 'rules')))
  const needs = mergeNeedsOf(seen, rules)
  return {
    ...seen,
    ...(needs === undefined ? {} : { needs }),
    ...(state === 'open' && rules?.canBypassQueue !== undefined ? { canBypassQueue: rules.canBypassQueue } : {}),
  }
}
