import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type { Fetch } from '@althar/connectors'
import { knownModelName } from '@althar/contracts'
import { Context, Effect, Layer } from 'effect'

import { RuntimeConfig } from './Config'

/*
 * What is known about models beyond what their agents say (ADR-015): how
 * each scores (Artificial Analysis's intelligence, coding and agentic
 * indices), what it costs per use, and how much it holds, from OpenRouter's
 * public list of models. The coordinator weighs them when it picks a model
 * for a step.
 *
 * Read from the profile's copy as the runtime starts, and fetched again in
 * the background: nothing waits for it, and a fetch that fails is logged and
 * otherwise ignored. A model the list doesn't have goes without.
 */

/** What is known of one model. */
export interface ModelFact {
  /** Its id in the list: anthropic/claude-sonnet-5.5. */
  readonly slug: string
  readonly intelligence: number | null
  readonly coding: number | null
  readonly agentic: number | null
  /** Dollars per million tokens, in and out, where it is sold per use. */
  readonly price: { readonly input: number; readonly output: number } | null
  /** How many tokens it holds. */
  readonly context: number | null
}

export interface ModelFactsOptions {
  /** Where the list is: OpenRouter's models. */
  readonly url: string
  /** The profile's copy of the list, read as the runtime starts and written after each fetch. */
  readonly cache?: string
  readonly fetch?: Fetch
}

const number = (value: unknown): number | null => {
  const read = typeof value === 'string' ? Number(value) : value
  return typeof read === 'number' && Number.isFinite(read) ? read : null
}

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined

/** The list's models by the last part of their id (claude-sonnet-5.5), the plain ones only: no `:batch` or `:free` variants. */
export const factsIn = (body: unknown): ReadonlyMap<string, ModelFact> => {
  const facts = new Map<string, ModelFact>()
  const data = field(body, 'data')
  for (const model of Array.isArray(data) ? data : []) {
    const slug = field(model, 'id')
    if (typeof slug !== 'string' || slug.includes(':')) continue
    const tail = slug.slice(slug.lastIndexOf('/') + 1).toLowerCase()
    const scores = field(field(model, 'benchmarks'), 'artificial_analysis')
    const pricing = field(model, 'pricing')
    const input = number(field(pricing, 'prompt'))
    const output = number(field(pricing, 'completion'))
    const fact: ModelFact = {
      slug,
      intelligence: number(field(scores, 'intelligence_index')),
      coding: number(field(scores, 'coding_index')),
      agentic: number(field(scores, 'agentic_index')),
      price: input === null || output === null || (input === 0 && output === 0) ? null : { input: input * 1e6, output: output * 1e6 },
      context: number(field(model, 'context_length')),
    }
    // The maker's own listing wins over a reseller's of the same model, by having scores.
    const had = facts.get(tail)
    if (had === undefined || (had.intelligence === null && fact.intelligence !== null)) facts.set(tail, fact)
  }
  return facts
}

/** A name as the list writes ids: lowercase, words joined by dashes, without what is in brackets ("(New)"). */
const slugOf = (name: string) =>
  name
    .replace(/\([^)]*\)/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')

/**
 * One of an agent's models in the list: by its id's last part (gpt-6-astra,
 * opencode-go/glm-5.3), or by its name as people know it (Claude Sonnet 5.5,
 * claude-sonnet-5.5), a free copy as the model itself; none where the list
 * has neither.
 */
export const factFor = (
  facts: ReadonlyMap<string, ModelFact>,
  agent: { readonly id: string; readonly name: string },
  model: { readonly id: string; readonly name: string },
): ModelFact | null => {
  const tail = model.id.slice(model.id.lastIndexOf('/') + 1).toLowerCase()
  const named = slugOf(knownModelName(agent, model))
  // A free copy of a model ("MiMo-V2.6-Flash Free") scores as the model does.
  for (const candidate of [tail, named, tail.replace(/-free$/, ''), named.replace(/-free$/, '')]) {
    const found = facts.get(candidate)
    if (found !== undefined) return found
  }
  return null
}

export class ModelFacts extends Context.Service<
  ModelFacts,
  {
    /** What is known of one of an agent's models; null where the list hasn't it, or there is no list. */
    of(agent: { readonly id: string; readonly name: string }, model: { readonly id: string; readonly name: string }): ModelFact | null
  }
>()('@althar/runtime/ModelFacts') {
  static readonly layer: Layer.Layer<ModelFacts, never, RuntimeConfig> = Layer.effect(
    ModelFacts,
    Effect.gen(function* () {
      const options = (yield* RuntimeConfig).modelFacts
      const scope = yield* Effect.scope
      let facts: ReadonlyMap<string, ModelFact> = new Map()
      if (options === undefined) return ModelFacts.of({ of: (agent, model) => factFor(facts, agent, model) })
      const { cache } = options
      // The copy from last time, until the list comes.
      if (cache !== undefined) {
        try {
          facts = factsIn(JSON.parse(readFileSync(cache, 'utf8')))
        } catch {
          // None yet, or unreadable: the fetch makes one.
        }
      }
      const fetch = options.fetch ?? globalThis.fetch
      yield* Effect.forkIn(
        Effect.tryPromise(async () => {
          const response = await fetch(options.url, { signal: AbortSignal.timeout(20_000) })
          if (!response.ok) throw new Error(`The list of models answered ${response.status}.`)
          const body: unknown = await response.json()
          const fresh = factsIn(body)
          if (fresh.size === 0) throw new Error('The list of models had none.')
          facts = fresh
          if (cache !== undefined) {
            mkdirSync(dirname(cache), { recursive: true })
            writeFileSync(cache, JSON.stringify(body))
          }
        }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not read the list of models; going on without it', cause))),
        scope,
      )
      return ModelFacts.of({ of: (agent, model) => factFor(facts, agent, model) })
    }),
  )
}
