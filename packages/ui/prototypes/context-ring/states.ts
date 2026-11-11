import { Brand, type ModelInfo, type UsageLine } from '@althar/ui'

/* The states every direction is drawn in. Context in thousands of tokens, as the ring counts it. */

const model = (id: string, name: string, short: string, mark: Brand | undefined, runtime: string, context: number): ModelInfo => ({
  id,
  name,
  short,
  ...(mark === undefined ? {} : { mark }),
  runtime,
  context,
  efforts: runtime === 'claude-code' ? ['Low', 'Medium', 'High', 'Max'] : ['Low', 'Medium', 'High'],
})

export const OPUS = model('claude-opus-5-5', 'Claude Opus 5.5', 'Opus 5.5', Brand.Anthropic, 'claude-code', 1000)
export const GPT = model('gpt-5.5', 'GPT-5.5', 'GPT-5.5', Brand.OpenAI, 'codex', 400)
export const QWEN = model(
  'qwen3-coder-480b',
  'Qwen3 Coder 480B A35B Instruct Turbo',
  'Qwen3 Coder 480B A35B Instruct Turbo',
  Brand.Alibaba,
  'openrouter',
  256,
)

export interface Usage {
  /** Whose: the coordinator's day, or the task so far. */
  readonly heading: 'Today' | 'This task so far'
  readonly lines: ReadonlyArray<UsageLine>
}

export interface CardState {
  readonly key: string
  readonly label: string
  readonly used: number
  readonly total: number
  readonly model: ModelInfo
  readonly usage?: Usage
  readonly compacting?: boolean
}

const claudeToday = (took: number, tokens: number, estimated = true): UsageLine => ({
  id: 'cc',
  name: 'Claude Code',
  mark: Brand.ClaudeCode,
  took,
  estimated,
  models: ['Claude Opus 5.5'],
  tokens,
})

export const STATES: readonly CardState[] = [
  {
    key: 'low',
    label: 'Low, as today',
    used: 97.4,
    total: 1000,
    model: OPUS,
    usage: { heading: 'Today', lines: [claudeToday(0.04, 2_600_000)] },
  },
  {
    key: 'mid',
    label: 'Mid, a task',
    used: 548,
    total: 1000,
    model: OPUS,
    usage: {
      heading: 'This task so far',
      lines: [{ id: 'max', name: 'Claude Code Max', mark: Brand.ClaudeCode, took: 12, models: ['Claude Opus 5.5'], tokens: 13_400_000 }],
    },
  },
  {
    key: 'full',
    label: 'Nearly full',
    used: 372,
    total: 400,
    model: GPT,
    usage: {
      heading: 'Today',
      lines: [{ id: 'codex', name: 'Codex', mark: Brand.Codex, took: 31, models: ['GPT-5.5'], tokens: 41_000_000 }],
    },
  },
  { key: 'none', label: 'No usage', used: 310, total: 1000, model: OPUS },
  {
    key: 'several',
    label: 'Several accounts and models',
    used: 214,
    total: 1000,
    model: OPUS,
    usage: {
      heading: 'Today',
      lines: [
        {
          id: 'max',
          name: 'Claude Code Max',
          mark: Brand.ClaudeCode,
          took: 14,
          estimated: true,
          models: ['Claude Opus 5.5', 'Claude Sonnet 5.5'],
          tokens: 11_400_000,
          byModel: [
            { name: 'Claude Opus 5.5', tokens: 9_100_000 },
            { name: 'Claude Sonnet 5.5', tokens: 2_300_000 },
          ],
        },
        { id: 'codex', name: 'Codex Pro', mark: Brand.Codex, took: 6, models: ['GPT-5.5'], tokens: 4_200_000 },
        { id: 'zen', name: 'OpenCode', mark: Brand.OpenCode, spent: 1.24, models: ['Kimi K2.5'], tokens: 2_100_000 },
      ],
    },
  },
  {
    key: 'estimate',
    label: 'Estimates',
    used: 180,
    total: 1000,
    model: OPUS,
    usage: {
      heading: 'Today',
      lines: [
        claudeToday(8.2, 6_800_000),
        { id: 'or', name: 'OpenRouter', mark: Brand.OpenRouter, spent: 0.86, estimated: true, models: ['Kimi K2.5'], tokens: 1_300_000 },
      ],
    },
  },
  {
    key: 'long',
    label: 'Long model name',
    used: 141,
    total: 256,
    model: QWEN,
    usage: {
      heading: 'Today',
      lines: [
        {
          id: 'or',
          name: 'OpenRouter, shared team key',
          mark: Brand.OpenRouter,
          spent: 3.17,
          models: ['Qwen3 Coder 480B A35B Instruct Turbo'],
          tokens: 5_800_000,
        },
      ],
    },
  },
  {
    key: 'compacting',
    label: 'Compacting',
    used: 902,
    total: 1000,
    model: OPUS,
    compacting: true,
    usage: { heading: 'Today', lines: [claudeToday(4.1, 9_300_000)] },
  },
]
