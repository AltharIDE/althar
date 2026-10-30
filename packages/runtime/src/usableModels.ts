import { isAgentDefault, knownModelName } from '@althar/contracts'
import { Effect, Option } from 'effect'

import { Agents } from './Config'
import { Installs, isInstalled } from './Installs'
import { Limits, NEARLY_OUT, type Room, roomWords } from './Limits'
import { type ModelFact, ModelFacts } from './ModelFacts'
import { Models } from './Models'
import { SignIns } from './SignIns'

/*
 * The models the coordinator can give work to (ADR-015): every model of
 * every agent that is signed in and not out of usage, but the ones the
 * person switched off, each once, however many agents offer it. An agent is
 * only a route to a model: a step names the model, and Althar takes it the
 * best way, on a plan with room before one nearly out, and a plan before a
 * key. Each way says how much room its plan has, as last read, so the
 * coordinator can pick with that in mind.
 */

/** One way to a model: the agent that runs it, its id for it there, whether a plan pays, and how hard it can think there. */
export interface Route {
  readonly agentId: string
  readonly agentName: string
  readonly model: string
  readonly plan: boolean
  /** Its efforts there, in the agent's ids and names; empty where it has no such choice, or it isn't known. */
  readonly efforts: ReadonlyArray<{ readonly id: string; readonly name: string }>
  /** The effort it starts at by itself, the person's default aside; null where it isn't known. */
  readonly effort: string | null
  /** The person's default effort for it there; null where they set none. */
  readonly defaultEffort: string | null
  /** How much room the plan it runs on has for it, its tightest window as last read; null where none is read, or it is a key. */
  readonly room: Room | null
}

export interface UsableModel {
  /** As people know it: Claude Sonnet 5.5, GPT-6 Astra. */
  readonly name: string
  /** Who makes it, where known: Anthropic, OpenAI. */
  readonly maker: string | null
  readonly fact: ModelFact | null
  /** The ways to it, the best first. */
  readonly routes: ReadonlyArray<Route>
}

/** Makers by the first part of the list's ids. */
const MAKERS: Readonly<Record<string, string>> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  'z-ai': 'Z.ai',
  deepseek: 'DeepSeek',
  'x-ai': 'xAI',
  moonshotai: 'Moonshot',
  qwen: 'Alibaba',
  mistralai: 'Mistral',
  minimax: 'MiniMax',
  'meta-llama': 'Meta',
}

/** An agent's own maker, for a model the list doesn't know. */
const AGENT_MAKERS: Readonly<Record<string, string>> = { 'claude-code': 'Anthropic', codex: 'OpenAI' }

const makerOf = (fact: ModelFact | null, agentId: string): string | null => {
  if (fact === null) return AGENT_MAKERS[agentId] ?? null
  const prefix = fact.slug.slice(0, fact.slug.indexOf('/'))
  return MAKERS[prefix] ?? (prefix === '' ? null : `${prefix.charAt(0).toUpperCase()}${prefix.slice(1)}`)
}

/** The models usable now, by maker, the highest scoring first in each. */
export const usableModels = (projectId?: string) =>
  Effect.gen(function* () {
    const agents = yield* Agents
    const models = yield* Models
    const facts = yield* ModelFacts
    const signIns = yield* SignIns
    const installs = yield* Installs
    const limits = yield* Limits
    const catalog = yield* models.catalog
    const byKey = new Map<string, { name: string; maker: string | null; fact: ModelFact | null; routes: Route[] }>()
    for (const entry of agents.list) {
      const agent = { id: entry.definition.id, name: entry.definition.name }
      if (!isInstalled(installs, entry.definition) || (yield* signIns.of(agent.id)) === 'signed_out') continue
      if (Option.isSome(yield* limits.out(agent.id, projectId).pipe(Effect.orElseSucceed(() => Option.none())))) continue
      const offered = catalog.find((one) => one.agentId === agent.id)
      if (offered === undefined) continue
      for (const model of offered.models) {
        if (isAgentDefault(model) || offered.blocked.includes(model.id)) continue
        const name = knownModelName(agent, model)
        // A model's own window (Opus's weekly) counts beside the plan's, by its id or its name.
        const named = `${model.id} ${name}`
        // The account work on it would start on, of those the project allows: none signed in, and the agent is no way to it there.
        const starts = yield* limits
          .pick({ agentId: agent.id, model: named, ...(projectId === undefined ? {} : { projectId }) })
          .pipe(Effect.option)
        if (Option.isNone(starts)) continue
        const account = yield* signIns.account(starts.value)
        if (account.status === 'signed_out') continue
        // A plan pays where that account is on one, not just any signed in.
        const plan = account.paidBy === 'plan'
        const room = plan ? Option.getOrNull(yield* limits.room(starts.value.id, named)) : null
        const fact = facts.of(agent, model)
        const key = fact?.slug ?? name.toLowerCase()
        const route: Route = {
          agentId: agent.id,
          agentName: agent.name,
          model: model.id,
          plan,
          efforts: model.efforts,
          effort: model.effort,
          defaultEffort: offered.defaults.find((chosen) => chosen.model === model.id)?.effort ?? null,
          room,
        }
        const found = byKey.get(key)
        if (found === undefined) byKey.set(key, { name, maker: makerOf(fact, agent.id), fact, routes: [route] })
        else found.routes.push(route)
      }
    }
    const usable: UsableModel[] = [...byKey.values()].map((model) => ({
      ...model,
      // A plan with room before one nearly out, a plan before a key; else in the agents' order.
      routes: model.routes.toSorted((a, b) => Number(b.plan) - Number(a.plan) || Number(nearlyOut(a)) - Number(nearlyOut(b))),
    }))
    return usable.toSorted(
      (a, b) =>
        (a.maker ?? '~').localeCompare(b.maker ?? '~') ||
        (b.fact?.intelligence ?? -1) - (a.fact?.intelligence ?? -1) ||
        a.name.localeCompare(b.name),
    )
  })

const nearlyOut = (route: Route) => route.room !== null && route.room.leftPercent < NEARLY_OUT

const score = (value: number | null) => (value === null ? 'unknown' : String(value))

/**
 * A model's efforts the way it goes, as the coordinator reads them: the ids
 * a step's effort takes, the one it starts at by itself, and the person's
 * default where they set one it offers.
 */
const effortWords = (route: Route | undefined): string => {
  if (route === undefined || route.efforts.length === 0) return 'no effort to set'
  const preferred = route.efforts.some((level) => level.id === route.defaultEffort) ? route.defaultEffort : null
  const starts = [
    ...(route.effort === null ? [] : [`its own: ${route.effort}`]),
    ...(preferred === null ? [] : [`the person's default: ${preferred}`]),
  ]
  return `effort ${route.efforts.map((level) => level.id).join(', ')}${starts.length === 0 ? '' : ` (${starts.join('; ')})`}`
}

/**
 * The models as the coordinator reads them: by maker, each with its scores,
 * how it is paid for, and its efforts. `use` says what names one, for a
 * task's lead making its task a change.
 */
export const describeModels = (
  usable: ReadonlyArray<UsableModel>,
  /** The time they are read at, which says whether a reset is today. */
  now: number,
  use = "propose_plan's lead and review and start_task's lead",
): string => {
  if (usable.length === 0)
    return 'No model can be used now: no agent is signed in, every one is out of usage, or the person switched them all off.'
  const lines: string[] = [
    `The models you can give work to now, by who makes them. Name one as it is written here, for ${use}, and, where you set one, an effort it lists. Without an effort, a step starts at the person's default for its model, or else at the model's own. The scores are Artificial Analysis's indices, higher is better: intelligence, coding, agentic.`,
    `Where a plan's usage is read, each says how much of its tightest limit is left and until when. A step on a plan with under ${NEARLY_OUT}% left goes elsewhere or waits, as the project's rule for usage limits says, so give work to one with room where you can.`,
  ]
  let maker: string | null | undefined
  for (const model of usable) {
    if (model.maker !== maker) {
      maker = model.maker
      lines.push('', model.maker ?? 'Others')
    }
    const fact = model.fact
    const scores =
      fact === null
        ? 'no scores known'
        : `intelligence ${score(fact.intelligence)}, coding ${score(fact.coding)}, agentic ${score(fact.agentic)}`
    const best = model.routes[0]
    const paid =
      best?.plan === true
        ? best.room === null
          ? 'on a plan'
          : `on a plan, ${nearlyOut(best) ? 'nearly out, ' : ''}${roomWords(best.room, now)}`
        : fact?.price == null
          ? 'per use'
          : `per use, $${fact.price.input.toFixed(2)} in and $${fact.price.output.toFixed(2)} out per million tokens`
    lines.push(`- ${model.name}: ${scores}; ${paid}; ${effortWords(best)}`)
  }
  return lines.join('\n')
}

/**
 * The way to the model a plan names: as list_models writes it, or by an
 * agent's own id for it; on the agent named, where it is one of the ways.
 * Null where no usable model goes by that name.
 */
export const routeTo = (usable: ReadonlyArray<UsableModel>, asked: string, agentId?: string): Route | null => {
  const wanted = asked.trim().toLowerCase()
  const model = usable.find(
    (one) =>
      one.name.toLowerCase() === wanted ||
      one.fact?.slug.toLowerCase() === wanted ||
      one.routes.some((route) => route.model.toLowerCase() === wanted && (agentId === undefined || route.agentId === agentId)),
  )
  if (model === undefined) return null
  return model.routes.find((route) => route.agentId === agentId) ?? model.routes[0] ?? null
}
