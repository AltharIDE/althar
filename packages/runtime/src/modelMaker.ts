import type { ModelFact } from './ModelFacts'

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

export const makerOf = (fact: ModelFact | null, agentId: string, model?: { readonly id: string; readonly name: string }): string | null => {
  if (fact === null) {
    const own = AGENT_MAKERS[agentId]
    if (own !== undefined) return own
    // Maker identity still matters when the score cache has no entry for a
    // newly offered model. Provider prefixes (opencode-go) aren't makers.
    const name = `${model?.id.split('/').at(-1) ?? ''} ${model?.name ?? ''}`.toLowerCase()
    if (/\bclaude[- ]/.test(name)) return 'Anthropic'
    if (/\b(gpt[- ]|codex\b|o[1-9]\b)/.test(name)) return 'OpenAI'
    if (/\bgemini[- ]/.test(name)) return 'Google'
    if (/\bdeepseek[- ]/.test(name)) return 'DeepSeek'
    if (/\bglm[- ]/.test(name)) return 'Z.ai'
    if (/\bkimi[- ]/.test(name)) return 'Moonshot'
    return null
  }
  const prefix = fact.slug.slice(0, fact.slug.indexOf('/'))
  return MAKERS[prefix] ?? (prefix === '' ? null : `${prefix.charAt(0).toUpperCase()}${prefix.slice(1)}`)
}
