// Scrappy: the models the cases name, as the kit's pickers draw them: who leads, who reviews, and who can take over.
import { Brand } from '../../src/foundations/brands/brands'
import type { ModelInfo } from '../../src/primitives/Model/Model'

export const OPUS: ModelInfo = {
  id: 'claude-opus-5.5',
  name: 'Claude Opus 5.5',
  short: 'Opus 5.5',
  mark: Brand.Anthropic,
  runtime: 'claude-code',
  efforts: ['low', 'medium', 'high', 'xhigh'],
  via: 'via Claude Code',
}
export const SONNET: ModelInfo = {
  id: 'claude-sonnet-5.5',
  name: 'Claude Sonnet 5.5',
  short: 'Sonnet 5.5',
  mark: Brand.Anthropic,
  runtime: 'claude-code',
  efforts: ['low', 'medium', 'high'],
  via: 'via Claude Code',
}
export const SOL: ModelInfo = {
  id: 'gpt-6.1-sol',
  name: 'GPT-6.1 Sol',
  short: 'Sol',
  mark: Brand.OpenAI,
  runtime: 'codex',
  efforts: ['low', 'medium', 'high'],
  via: 'via Codex',
}
export const TERRA: ModelInfo = {
  id: 'gpt-6.1-terra',
  name: 'GPT-6.1 Terra',
  short: 'Terra',
  mark: Brand.OpenAI,
  runtime: 'codex',
  efforts: ['low', 'medium', 'high'],
  via: 'via Codex',
}
export const FLASH: ModelInfo = {
  id: 'deepseek-v4.1-flash',
  name: 'DeepSeek V4.1 Flash',
  short: 'V4.1 Flash',
  mark: Brand.DeepSeek,
  runtime: 'opencode',
  efforts: [],
  via: 'via OpenCode Go',
}

/** Who can take a review or a lead's turn over, the project's backup first (the person's notes). */
export const TAKERS: ReadonlyArray<ModelInfo> = [FLASH, TERRA, OPUS, SONNET]
