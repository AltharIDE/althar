/*
 * Demo models and the runtimes that offer them, with the little logic a
 * consumer would own around them: pins, each model's default effort, and how
 * a context window is written. In the product this comes from the connected
 * runtimes and the user's settings. Not part of the package's API.
 */
import { useState } from 'react'

import type { RuntimeInfo } from '../composer/ModelBrowser/ModelBrowser'
import type { ModelInfo } from '../foundations/Model/Model'
import { Brand } from '../foundations/brands/brands'
import { labBrand } from '../foundations/brands/resolve'
import { Lab } from '../foundations/vocabulary'

/* Effort levels are the runtime's, in its own words. Ollama has none. */
const EFFORTS: Readonly<Record<string, readonly string[]>> = {
  'claude-code': ['Low', 'Medium', 'High', 'Max'],
  codex: ['Low', 'Medium', 'High', 'Extra high'],
  'gemini-cli': ['Low', 'High'],
}

const m = (id: string, name: string, short: string, lab: Lab, runtime: string, context: number, note?: string): ModelInfo => ({
  id,
  name,
  short,
  mark: labBrand(lab),
  runtime,
  context,
  efforts: EFFORTS[runtime] ?? [],
  note,
})

export const MODEL_LIST: readonly ModelInfo[] = [
  m('claude-opus-5', 'Claude Opus 5', 'Opus 5', Lab.Anthropic, 'claude-code', 1000, 'Largest Claude'),
  m('claude-sonnet-5', 'Claude Sonnet 5', 'Sonnet 5', Lab.Anthropic, 'claude-code', 1000),
  m('claude-haiku-4-5', 'Claude Haiku 4.5', 'Haiku 4.5', Lab.Anthropic, 'claude-code', 200),
  m('gpt-5.2', 'GPT-5.2', 'GPT-5.2', Lab.OpenAI, 'codex', 400),
  m('gpt-5.2-codex', 'GPT-5.2 Codex', 'Codex', Lab.OpenAI, 'codex', 400, 'Tuned for agentic coding'),
  m('gpt-5-mini', 'GPT-5 mini', 'GPT-5 mini', Lab.OpenAI, 'codex', 400),
  m('gemini-3-pro', 'Gemini 3 Pro', 'Gemini 3 Pro', Lab.Google, 'gemini-cli', 1000),
  m('gemini-3-flash', 'Gemini 3 Flash', 'Gemini 3 Flash', Lab.Google, 'gemini-cli', 1000),
  m('qwen3-coder', 'Qwen3 Coder 30B', 'Qwen3 Coder', Lab.Alibaba, 'ollama', 256),
  m('devstral-small', 'Devstral Small', 'Devstral', Lab.Mistral, 'ollama', 128),
  m('deepseek-v3.2', 'DeepSeek V3.2', 'DeepSeek V3.2', Lab.DeepSeek, 'openrouter', 128),
  m('kimi-k2', 'Kimi K2', 'Kimi K2', Lab.Moonshot, 'openrouter', 256),
  m('glm-4.6', 'GLM 4.6', 'GLM 4.6', Lab.Zai, 'openrouter', 200),
  m('grok-4', 'Grok 4', 'Grok 4', Lab.XAI, 'openrouter', 256),
  m('llama-4-maverick', 'Llama 4 Maverick', 'Llama 4', Lab.Meta, 'openrouter', 1000),
]

/** A model the runtimes do not describe: no mark, no efforts, its id for a name. */
export const UNKNOWN_MODEL: ModelInfo = {
  id: 'some-new-model',
  name: 'some-new-model',
  short: 'some-new-model',
  runtime: 'ollama',
  context: 200,
  efforts: [],
}

/** A demo model by id. Throws for an id the demo does not have, so a typo in a story fails loudly. */
export function model(id: string): ModelInfo {
  const found = MODEL_LIST.find((x) => x.id === id)
  if (!found) throw new Error(`No demo model ${id}`)
  return found
}

export const OPUS = model('claude-opus-5')
export const SONNET = model('claude-sonnet-5')
export const CODEX = model('gpt-5.2-codex')
export const GPT_MINI = model('gpt-5-mini')
export const GEMINI_PRO = model('gemini-3-pro')
export const QWEN = model('qwen3-coder')

export const RUNTIMES: readonly RuntimeInfo[] = [
  { id: 'claude-code', name: 'Claude Code', how: 'signed in', brand: Brand.ClaudeCode },
  { id: 'codex', name: 'Codex', how: 'signed in', brand: Brand.Codex },
  { id: 'gemini-cli', name: 'Gemini CLI', how: 'API key', brand: Brand.GeminiCli },
  { id: 'ollama', name: 'Ollama', how: 'this Mac', brand: Brand.Ollama },
  { id: 'openrouter', name: 'OpenRouter', how: 'API key', brand: Brand.OpenRouter },
]

export const DEFAULT_PINS: readonly string[] = ['claude-opus-5', 'gpt-5.2-codex', 'claude-sonnet-5']

/** A model's default effort: yours if you set one, else High where the runtime has it, else its top level. */
export function effortFor(x: ModelInfo, mine: Readonly<Record<string, string>> = {}): string | null {
  const set = mine[x.id]
  if (set !== undefined && x.efforts.includes(set)) return set
  if (x.efforts.includes('High')) return 'High'
  return x.efforts[x.efforts.length - 1] ?? null
}

/** A context window, in thousands of tokens, as people write it: 400k, 1M. */
export const contextLabel = (k: number): string => (k >= 1000 ? `${k / 1000}M` : `${k}k`)

/** What a consumer keeps about models: your pins and your default efforts. In memory, for stories. */
export function useModelPrefs(initialPins: readonly string[] = DEFAULT_PINS) {
  const [pins, setPins] = useState<readonly string[]>(initialPins)
  const [efforts, setEfforts] = useState<Readonly<Record<string, string>>>({})
  return {
    pins,
    efforts,
    pinned: pins.map(model),
    togglePin: (id: string) => setPins((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id])),
    setDefaultEffort: (id: string, level: string) => setEfforts((now) => ({ ...now, [id]: level })),
    defaultEffort: (x: ModelInfo) => effortFor(x, efforts),
  }
}
