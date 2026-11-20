import { Brand, type ModelInfo } from '@althar/ui'

import { AGENTS, type AgentId, DAY, HOUR, type Ink, MIN, MODELS, type ModelId, NOW } from './facts.ts'

/* How the usage lab says its numbers: money, tokens, time, dates; and a model as the kit draws one. */

export const money = (n: number) =>
  n >= 10_000
    ? `$${(n / 1000).toFixed(1)}k`
    : n >= 1000
      ? `$${Math.round(n).toLocaleString('en-GB')}`
      : n >= 100
        ? `$${Math.round(n)}`
        : n > 0 && n < 0.01
          ? '< $0.01'
          : `$${n.toFixed(2)}`

/** Whole dollars, for a figure that heads a section. */
export const moneyWhole = (n: number) => `$${Math.round(n).toLocaleString('en-GB')}`

export const tokens = (n: number) =>
  n >= 1e9
    ? `${(n / 1e9).toFixed(n >= 1e10 ? 1 : 2)}B`
    : n >= 1e6
      ? `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M`
      : n >= 1000
        ? `${Math.round(n / 1000)}k`
        : String(Math.round(n))

export const percent = (share: number | null, digits = 0) => (share === null ? '—' : `${(share * 100).toFixed(digits)}%`)
export const points = (n: number) => (n >= 10 ? `${Math.round(n)}%` : n >= 0.1 ? `${n.toFixed(1)}%` : '< 0.1%')

export const duration = (ms: number | null) => {
  if (ms === null) return '—'
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MIN))}m`
  if (ms < DAY) {
    const h = Math.floor(ms / HOUR)
    const m = Math.round((ms - h * HOUR) / MIN)
    return m === 0 ? `${h}h` : `${h}h ${m}m`
  }
  const d = Math.floor(ms / DAY)
  const h = Math.round((ms - d * DAY) / HOUR)
  return h === 0 ? `${d}d` : `${d}d ${h}h`
}

const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' })
const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })

export const date = (at: number) => day.format(at)
export const span = (from: number, to: number) => `${date(from)} – ${date(to - 1)}`
export const dayName = (at: number) => weekday.format(at)
export const timeOf = (at: number) => clock.format(at)
/** Tue 14:00, or 14:00 today. */
export const when = (at: number) =>
  Math.abs(at - NOW) < DAY && new Date(at).getUTCDate() === new Date(NOW).getUTCDate() ? timeOf(at) : `${dayName(at)} ${timeOf(at)}`

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`

/** A model as the kit's Model draws it. */
export const modelInfo = (id: ModelId): ModelInfo => {
  const m = MODELS[id]
  return { id, name: m.name, short: m.short, mark: m.lab === 'openai' ? Brand.OpenAI : Brand.Anthropic, runtime: m.agent, efforts: [] }
}

export const agentBrand = (agent: AgentId) => (agent === 'codex' ? Brand.Codex : Brand.ClaudeCode)
export const agentName = (agent: AgentId) => AGENTS[agent].name

/** A series' colour, by its ink: the project inks, in the charts' fixed order. */
export const inkVar = (ink: Ink) => (ink === 'neutral' ? 'var(--t-4)' : `var(--project-${ink})`)
export const agentInk = (agent: AgentId): Ink => (agent === 'codex' ? 'indigo' : 'clay')
