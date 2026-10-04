/*
 * Shifts: what changed under developers who code with agents, dated and
 * sourced. New models, new limits, new owners, new terms. The page links the
 * reporting; it doesn't host it. Each entry says what happened in a line, and
 * the page makes the argument once, at the top, not in every entry.
 *
 * Collected on 1 October 2026 from search results, covering 1 August to 30
 * September. Before launch, open every source and check the date and the line
 * against it; replace secondary sources with the company's own post where
 * there is one.
 */

export enum ShiftKind {
  Model = 'model',
  OpenModel = 'open-model',
  Limits = 'limits',
  Pricing = 'pricing',
  Access = 'access',
  Tools = 'tools',
  Outage = 'outage',
}

export const KIND_WORD: Record<ShiftKind, string> = {
  [ShiftKind.Model]: 'New model',
  [ShiftKind.OpenModel]: 'Open model',
  [ShiftKind.Limits]: 'Limits',
  [ShiftKind.Pricing]: 'Pricing',
  [ShiftKind.Access]: 'Access',
  [ShiftKind.Tools]: 'Tools',
  [ShiftKind.Outage]: 'Outage',
}

export interface Shift {
  /** Stable, for links to one entry: /shifts#id. */
  id: string
  /** The day it happened or took effect, YYYY-MM-DD. */
  date: string
  kind: ShiftKind
  /** Whose change it was, as the page names them. */
  who: string
  title: string
  /** What happened, in a sentence or two. Facts, not commentary. */
  what: string
  source: { name: string; url: string }
}

export const SHIFTS: readonly Shift[] = [
  {
    id: 'gemini-4-argon',
    date: '2026-09-30',
    kind: ShiftKind.Model,
    who: 'Google',
    title: 'Gemini 4 Argon is announced',
    what: 'Google’s first Gemini 4 frontier model, built for long-horizon coding. Cyber defenders get it first; paid API access comes later.',
    source: {
      name: 'Yahoo Finance',
      url: 'https://finance.yahoo.com/technology/article/google-debuts-gemini-4-argon-its-latest-frontier-model-204002322.html',
    },
  },
  {
    id: 'chatgpt-pro-reopens',
    date: '2026-09-29',
    kind: ShiftKind.Pricing,
    who: 'OpenAI',
    title: 'ChatGPT Pro reopens with less usage',
    what: 'The $200 plan comes back with roughly half its old allowance, beside a new $500 tier. Existing subscribers keep the old allowance until 29 October.',
    source: { name: 'Kingy AI', url: 'https://kingy.ai/news/chatgpt-pro-200-usage-cut/' },
  },
  {
    id: 'gpt-6-1-sol',
    date: '2026-09-29',
    kind: ShiftKind.Model,
    who: 'OpenAI',
    title: 'GPT-6.1 Sol, a week after GPT-6 Sol',
    what: 'Near GPT-6 Astra on agentic coding at a fifth of its price, in Codex and the API from DevDay.',
    source: { name: 'Unite.AI', url: 'https://www.unite.ai/openai-unveils-gpt-6-1-sol-at-devday-with-new-codex-and-chatgpt-tools/' },
  },
  {
    id: 'codex-outage',
    date: '2026-09-25',
    kind: ShiftKind.Outage,
    who: 'OpenAI',
    title: 'Codex goes down, then says “Limit reached”',
    what: 'Errors on ChatGPT and Codex ran into the next day, and Pro users hit usage walls without notice. Paid limits were reset early afterwards.',
    source: {
      name: 'OpenAI Developer Community',
      url: 'https://community.openai.com/t/200-chatgpt-pro-20x-hard-usage-limits-appeared-without-advance-notice/1400674',
    },
  },
  {
    id: 'claude-opus-5-5',
    date: '2026-09-22',
    kind: ShiftKind.Model,
    who: 'Anthropic',
    title: 'Claude Opus 5.5',
    what: 'A cheaper model for long agent work. Anthropic says it matches Fable 5.1 on most tasks and costs 40% less to run than Opus 5.',
    source: { name: 'BetaNews', url: 'https://betanews.com/article/claude-opus-5-5-launch-price-cut/' },
  },
  {
    id: 'gpt-6-sol-luna',
    date: '2026-09-22',
    kind: ShiftKind.Model,
    who: 'OpenAI',
    title: 'GPT-6 Sol and Luna, the same afternoon',
    what: 'Faster, cheaper models under GPT-6 Astra, in Codex and the API, released hours after Claude Opus 5.5.',
    source: {
      name: 'Crowdfund Insider',
      url: 'https://www.crowdfundinsider.com/2026/09/312279-openai-expands-gpt-6-lineup-with-more-economical-sol-and-luna-models/',
    },
  },
  {
    id: 'claude-code-agents-md',
    date: '2026-09-18',
    kind: ShiftKind.Tools,
    who: 'Anthropic',
    title: 'Claude Code reads AGENTS.md',
    what: 'About a year after it was asked for, and only in projects with no CLAUDE.md.',
    source: {
      name: 'Enterprise DNA',
      url: 'https://enterprisedna.co/resources/ai-pulse/ai-pulse-2026-09-19-claude-code-adopts-agents-md-standard/',
    },
  },
  {
    id: 'claude-code-weekly-limits',
    date: '2026-09-14',
    kind: ShiftKind.Limits,
    who: 'Anthropic',
    title: 'Claude Code’s weekly limits drop about 17%',
    what: 'A 50% summer boost ended, replaced by a permanent 25% raise over the old baseline. Announced on 30 August.',
    source: { name: 'Android Headlines', url: 'https://www.androidheadlines.com/2026/08/anthropic-claude-code-weekly-limits-update.html' },
  },
  {
    id: 'chatgpt-pro-paused',
    date: '2026-09-10',
    kind: ShiftKind.Access,
    who: 'OpenAI',
    title: 'New ChatGPT Pro sign-ups are paused',
    what: 'Demand for GPT-6 Astra outran capacity. People already on Pro kept it; nobody new could join.',
    source: { name: 'TechCrunch', url: 'https://techcrunch.com/2026/09/10/openai-puts-pro-subscriptions-on-hold-due-to-astra-demand/' },
  },
  {
    id: 'gpt-6-astra',
    date: '2026-09-03',
    kind: ShiftKind.Model,
    who: 'OpenAI',
    title: 'GPT-6 Astra',
    what: 'OpenAI’s new flagship for long coding and computer-use work: a preview on 3 September, generally available the next day.',
    source: { name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/GPT-6_Astra' },
  },
  {
    id: 'copilot-credits',
    date: '2026-09-01',
    kind: ShiftKind.Pricing,
    who: 'GitHub',
    title: 'Copilot Business and Enterprise lose their extra credits',
    what: 'The promotional credits that came with June’s move to usage-based billing ended; included usage went back to standard amounts.',
    source: {
      name: 'The GitHub Blog',
      url: 'https://github.blog/news-insights/company-news/github-copilot-is-moving-to-usage-based-billing/',
    },
  },
  {
    id: 'deepseek-v4-vision',
    date: '2026-08-31',
    kind: ShiftKind.OpenModel,
    who: 'DeepSeek',
    title: 'DeepSeek V4 Flash Vision weights, under MIT',
    what: 'A multimodal model in the V4 family, free to download and run.',
    source: { name: 'Digital Applied', url: 'https://www.digitalapplied.com/blog/deepseek-v4-flash-vision-weights-mit' },
  },
  {
    id: 'openai-cursor',
    date: '2026-08-29',
    kind: ShiftKind.Access,
    who: 'OpenAI',
    title: 'OpenAI is cutting Cursor off',
    what: 'After SpaceX bought Cursor, OpenAI said Cursor’s direct access to its models ends on 12 November, and its upcoming models won’t go there.',
    source: { name: 'CNBC', url: 'https://www.cnbc.com/2026/08/29/openai-cursor-spacex-model-access.html' },
  },
  {
    id: 'glm-5-3',
    date: '2026-08-14',
    kind: ShiftKind.OpenModel,
    who: 'Z.ai',
    title: 'GLM-5.3, an open coding model',
    what: 'Z.ai’s coding model for long engineering work, with open weights following two weeks later.',
    source: {
      name: 'MarkTechPost',
      url: 'https://www.marktechpost.com/2026/08/14/z-ai-ships-glm-5-3-without-retraining-the-base-model-better-at-complex-coding-and-long-horizon-tasks/',
    },
  },
  {
    id: 'spacex-cursor',
    date: '2026-08-14',
    kind: ShiftKind.Access,
    who: 'Cursor',
    title: 'SpaceX completes its $60 billion purchase of Cursor',
    what: 'One of the most used AI editors now belongs to a company with its own models.',
    source: { name: 'Techzine', url: 'https://www.techzine.eu/news/devops/143619/spacex-completes-acquisition-of-cursor/' },
  },
  {
    id: 'qwen-3-8-27b',
    date: '2026-08-14',
    kind: ShiftKind.OpenModel,
    who: 'Alibaba',
    title: 'Qwen3.8-27B, small enough to run yourself',
    what: 'Open weights under Apache 2.0, eleven days after the much larger Qwen3.8-Max.',
    source: { name: 'Emergent', url: 'https://emergent.sh/news/qwen38-27b-officially-launched' },
  },
  {
    id: 'qwen-3-8-max',
    date: '2026-08-03',
    kind: ShiftKind.OpenModel,
    who: 'Alibaba',
    title: 'Qwen3.8-Max',
    what: 'Alibaba’s new flagship: a 2.4-trillion-parameter model with a million-token window.',
    source: { name: 'DataNorth', url: 'https://datanorth.ai/news/alibaba-releases-qwen3-8-max' },
  },
]
