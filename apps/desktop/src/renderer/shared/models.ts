import { useSyncExternalStore } from 'react'

import type { AgentModels, AgentStatus } from '@charrette/contracts'
import { Brand, Lab, labBrand, type ModelInfo, type RuntimeInfo } from '@charrette/ui'

import type { Client, Start } from '../data/client'

/*
 * The models every agent offers, as the kit's pickers take them: one list,
 * whichever agent runs each. A model is known by its agent and its own id
 * together, since two agents may name theirs alike. It carries its maker's
 * mark, found from its name, or the agent's maker where the name says
 * nothing. An agent whose models aren't known yet is one entry: its own
 * default. The person's pins and default efforts stay in this window's
 * storage; until they pin one, each agent's current model is pinned.
 */

/** Who runs a conversation: an agent, its model, how hard it thinks. Null is the agent's own. */
export interface Choice {
  readonly agentId: string
  readonly model: string | null
  readonly effort: string | null
}

/** A model's id in the kit's lists: its agent's id, then its own; an agent's own default has none. */
export const keyOf = (agentId: string, model: string | null): string => `${agentId}:${model ?? ''}`

/** The agent and model a key names. Agent ids have no colon; a model's may. */
export const choiceOf = (key: string): { readonly agentId: string; readonly model: string | null } => {
  const at = key.indexOf(':')
  const model = key.slice(at + 1)
  return { agentId: key.slice(0, at), model: model === '' ? null : model }
}

/** Who made a model, from the words in its id and name. */
const MAKERS: ReadonlyArray<readonly [RegExp, Lab]> = [
  [/claude|opus|sonnet|haiku|anthropic/, Lab.Anthropic],
  [/gpt|openai|codex|\bo[1-9]\b/, Lab.OpenAI],
  [/gemini|gemma|google/, Lab.Google],
  [/grok|\bx-?ai\b/, Lab.XAI],
  [/qwen|alibaba/, Lab.Alibaba],
  [/llama|\bmeta\b/, Lab.Meta],
  [/mistral|devstral|codestral|magistral/, Lab.Mistral],
  [/deepseek/, Lab.DeepSeek],
  [/kimi|moonshot/, Lab.Moonshot],
  [/glm|\bz-?ai\b|zhipu/, Lab.Zai],
  [/minimax/, Lab.MiniMax],
]

/** The maker of an agent's own models, where it has one. */
const AGENT_MAKERS: Readonly<Record<string, Lab>> = { 'claude-code': Lab.Anthropic, codex: Lab.OpenAI }

/** An agent's own mark, for the list of agents. */
const AGENT_BRANDS: Readonly<Record<string, Brand>> = { 'claude-code': Brand.ClaudeCode, codex: Brand.Codex }

export const makerOf = (agentId: string, words: string): Brand | undefined => {
  const said = words.toLowerCase()
  const lab = MAKERS.find(([pattern]) => pattern.test(said))?.[1] ?? AGENT_MAKERS[agentId]
  return lab === undefined ? undefined : labBrand(lab)
}

export const text = {
  /** An agent's own default, as it names it ("Default (recommended)"), or an agent whose models aren't known. */
  agentDefault: (agent: string) => `${agent} default`,
  /** A name two agents share, told apart. */
  via: (model: string, agent: string) => `${model} · ${agent}`,
  how: { signed_in: 'signed in', unknown: 'this Mac', signed_out: 'signed out' } satisfies Record<AgentStatus['signIn'], string>,
}

export interface Catalog {
  /** Every model of every agent, in the agents' order, keyed by `keyOf`. */
  readonly models: ReadonlyArray<ModelInfo>
  readonly runtimes: ReadonlyArray<RuntimeInfo>
  /** What each agent offers, and what it is on, by agent id. */
  readonly agents: ReadonlyMap<string, AgentModels>
}

/** The agents' models as one list, for the agents a picker offers. */
export const catalogOf = (known: ReadonlyArray<AgentModels>, agents: ReadonlyArray<AgentStatus>): Catalog => {
  const byId = new Map(known.map((offered) => [offered.agentId, offered]))
  const entries = agents.flatMap((agent) => {
    const offered = byId.get(agent.id)
    const efforts = (offered?.efforts ?? []).map((effort) => effort.name)
    const models = offered?.models ?? []
    if (models.length === 0) {
      const mark = makerOf(agent.id, '')
      const name = text.agentDefault(agent.name)
      return [{ agent, info: { id: keyOf(agent.id, null), name, short: name, runtime: agent.id, efforts, ...(mark ? { mark } : {}) } }]
    }
    return models.map((model) => {
      const mark = makerOf(agent.id, `${model.id} ${model.name}`)
      // An agent's own default says which agent's it is; a provider's prefix is noise in a short name.
      const name = /^default\b/i.test(model.name) ? text.agentDefault(agent.name) : model.name
      const info: ModelInfo = {
        id: keyOf(agent.id, model.id),
        name,
        short: name.replace(/^[^/\s]+\//, ''),
        runtime: agent.id,
        efforts,
        ...(mark ? { mark } : {}),
        ...(model.description === null ? {} : { note: model.description }),
      }
      return { agent, info }
    })
  })
  // A name two agents share says which agent's each is.
  const shared = (name: string) => new Set(entries.filter((entry) => entry.info.name === name).map((entry) => entry.agent.id)).size > 1
  return {
    models: entries.map(({ agent, info }) =>
      shared(info.name) ? { ...info, name: text.via(info.name, agent.name), short: text.via(info.short, agent.name) } : info,
    ),
    runtimes: agents.map((agent) => {
      const brand = AGENT_BRANDS[agent.id]
      return { id: agent.id, name: agent.name, how: text.how[agent.signIn], ...(brand ? { brand } : {}) }
    }),
    agents: byId,
  }
}

/** What a choice shows as: its model, or what the agent is on where it names none, or the agent itself. */
export const infoOf = (catalog: Catalog, choice: { readonly agentId: string; readonly model: string | null }): ModelInfo => {
  const model = choice.model ?? catalog.agents.get(choice.agentId)?.model ?? null
  const found =
    catalog.models.find((info) => info.id === keyOf(choice.agentId, model)) ??
    catalog.models.find((info) => info.id === keyOf(choice.agentId, null))
  if (found !== undefined) return found
  // A model the agent no longer lists, or an agent this picker doesn't offer: its id, as it was set.
  const name = model ?? choice.agentId
  const mark = makerOf(choice.agentId, name)
  return { id: keyOf(choice.agentId, model), name, short: name, runtime: choice.agentId, efforts: [], ...(mark ? { mark } : {}) }
}

/** A model's name as its agent gives it, for a line that already names the agent; null for the agent's own default. */
export const modelName = (catalog: Catalog, agentId: string, model: string | null): string | null => {
  if (model === null) return null
  const name = catalog.agents.get(agentId)?.models.find((offered) => offered.id === model)?.name ?? model
  return /^default\b/i.test(name) ? null : name
}

/** An effort's name, as the agent says it, from its id. */
export const effortName = (catalog: Catalog, agentId: string, effort: string | null): string | null =>
  catalog.agents.get(agentId)?.efforts.find((offered) => offered.id === effort)?.name ?? null

/** An effort's id, from the name the kit shows. */
export const effortId = (catalog: Catalog, agentId: string, name: string): string =>
  catalog.agents.get(agentId)?.efforts.find((offered) => offered.name === name)?.id ?? name

/** Until the person pins a model: each agent's current one. */
export const defaultPins = (catalog: Catalog): ReadonlyArray<string> =>
  catalog.runtimes.map((runtime) => infoOf(catalog, { agentId: runtime.id, model: null }).id)

/** The person's pins, by key (null until they pin one), and their default effort for a model, by key. */
export interface ModelPrefs {
  readonly pins: ReadonlyArray<string> | null
  readonly efforts: Readonly<Record<string, string>>
}

const STORED = 'charrette.models'
const NONE: ModelPrefs = { pins: null, efforts: {} }
const listeners = new Set<() => void>()
let last: { readonly raw: string | null; readonly prefs: ModelPrefs } = { raw: null, prefs: NONE }

const isStrings = (value: unknown): value is ReadonlyArray<string> =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

/** What storage holds, read again only when it changed. Storage that can't be read keeps nothing. */
const readPrefs = (): ModelPrefs => {
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(STORED)
  } catch {
    return last.prefs
  }
  if (raw === last.raw) return last.prefs
  let prefs = NONE
  try {
    const parsed: unknown = raw === null ? null : JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null) {
      const { pins, efforts } = parsed as { pins?: unknown; efforts?: unknown }
      const kept =
        typeof efforts === 'object' && efforts !== null
          ? Object.fromEntries(Object.entries(efforts).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
          : {}
      prefs = { pins: isStrings(pins) ? pins : null, efforts: kept }
    }
  } catch {
    prefs = NONE
  }
  last = { raw, prefs }
  return prefs
}

const writePrefs = (prefs: ModelPrefs) => {
  const raw = JSON.stringify(prefs)
  last = { raw, prefs }
  try {
    window.localStorage.setItem(STORED, raw)
  } catch {
    // Kept for this window only.
  }
  listeners.forEach((listener) => listener())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

export const useModelPrefs = (): ModelPrefs => useSyncExternalStore(subscribe, readPrefs)

/** Pins a model, or unpins it; the first pin starts from the pins shown until then. */
export const togglePin = (key: string, shown: ReadonlyArray<string>) => {
  const prefs = readPrefs()
  const pins = prefs.pins ?? shown
  writePrefs({ ...prefs, pins: pins.includes(key) ? pins.filter((pin) => pin !== key) : [...pins, key] })
}

export const setDefaultEffort = (key: string, effort: string) => {
  const prefs = readPrefs()
  writePrefs({ ...prefs, efforts: { ...prefs.efforts, [key]: effort } })
}

/** What starts an agent on a thread as chosen; without a model or effort, the agent's own. */
export const startOf = (threadId: string, choice: Choice): Start => ({
  threadId,
  agentId: choice.agentId,
  ...(choice.model === null ? {} : { model: choice.model }),
  ...(choice.effort === null ? {} : { effort: choice.effort }),
})

/** The choice a running thread is on. */
export const runningOn = (session: {
  readonly agentId: string
  readonly model: string | null
  readonly effort: string | null
}): Choice => ({
  agentId: session.agentId,
  model: session.model,
  effort: session.effort,
})

/** Puts a running thread on what the person chose: its model and effort, or another agent taking over with them. */
export const moveTo = async (client: Client, threadId: string, current: Choice, next: Choice): Promise<void> => {
  if (next.agentId !== current.agentId) {
    await client.switchAgent(startOf(threadId, next))
    return
  }
  if (next.model !== null && next.model !== current.model) await client.setModel({ threadId, model: next.model })
  if (next.effort !== null && next.effort !== current.effort) await client.setEffort({ threadId, effort: next.effort })
}
