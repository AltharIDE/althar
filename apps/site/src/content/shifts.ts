/*
 * Shifts: what changed under developers who code with agents, dated and
 * sourced. New models, new limits, new owners, new terms. The page links the
 * reporting; it doesn't host it. Each entry says what happened in a line, and
 * the page makes the argument once, at the top, not in every entry.
 *
 * Collected on 1 October 2026 from search results, covering 1 August to 30
 * September. Topped up on 8 October with 1 to 8 October, and one September
 * item that was missed. Before launch, open every source and check the date
 * and the line against it; replace secondary sources with the company's own
 * post where there is one.
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

/** A change that is announced but hasn't happened yet. `date` is the day it takes effect. */
export interface Upcoming extends Shift {
  /** The day it was announced, YYYY-MM-DD. */
  announced: string
}

export const SHIFTS: readonly Shift[] = [
  {
    id: 'gpt-5-4-cyber-removed',
    date: '2026-10-01',
    kind: ShiftKind.Access,
    who: 'OpenAI',
    title: 'gpt-5.4-cyber removed from the API',
    what: 'Removed on the date OpenAI gave in September. Its notice points users to the most capable cyber model available to them.',
    source: { name: 'OpenAI API deprecations', url: 'https://developers.openai.com/api/docs/deprecations' },
  },
  {
    id: 'gpt-5-3-codex-retiring',
    date: '2026-10-01',
    kind: ShiftKind.Access,
    who: 'OpenAI',
    title: 'gpt-5.3-codex and gpt-5.1 leave the API in April 2027',
    what: 'Also gpt-5.4-nano. Removal on 1 April 2027, with six months’ notice. The replacements are GPT-6 models.',
    source: { name: 'OpenAI API deprecations', url: 'https://developers.openai.com/api/docs/deprecations' },
  },
  {
    id: 'copilot-seats-paid-up-front',
    date: '2026-10-01',
    kind: ShiftKind.Pricing,
    who: 'GitHub',
    title: 'Copilot Business and Enterprise seats are paid up front',
    what: 'For card and PayPal customers, each assigned seat is charged at the start of the cycle and needs payment before access. Invoice billing is not covered.',
    source: {
      name: 'GitHub Changelog',
      url: 'https://github.blog/changelog/2026-08-28-upcoming-changes-to-github-copilot-policies-and-billing/',
    },
  },
  {
    id: 'sonnet-4-5-deprecated',
    date: '2026-09-30',
    kind: ShiftKind.Access,
    who: 'Anthropic',
    title: 'Claude Sonnet 4.5 is deprecated',
    what: 'It retires from the Claude API on 30 November 2026. Anthropic’s replacement is Sonnet 5.5.',
    source: { name: 'Claude Platform docs', url: 'https://platform.claude.com/docs/en/about-claude/model-deprecations' },
  },
  {
    id: 'managed-agents-dynamic-workflows',
    date: '2026-10-09',
    kind: ShiftKind.Tools,
    who: 'Anthropic',
    title: 'Dynamic workflows for Managed Agents, in beta',
    what: 'An agent can write a program that runs many agents in phases and combines their results, for work like reviewing hundreds of documents.',
    source: { name: 'Claude Platform release notes', url: 'https://platform.claude.com/docs/en/release-notes/overview' },
  },
  {
    id: 'usage-policy-november',
    date: '2026-10-09',
    kind: ShiftKind.Access,
    who: 'Anthropic',
    title: 'Revised usage policy takes effect 12 November',
    what: 'It bans sustained, needless abuse of Claude and tightens the rules on influence operations. Anthropic says the abuse rule targets only extreme cases.',
    source: {
      name: 'The Register',
      url: 'https://www.theregister.com/ai-and-ml/2026/10/09/anthropic-asks-users-to-stop-being-mean-to-claude/5302218',
    },
  },
  {
    id: 'gemini-universal-agent',
    date: '2026-10-08',
    kind: ShiftKind.Tools,
    who: 'Google',
    title: 'Gemini, a universal agent for the workplace',
    what: 'Works in Gmail, Docs, Drive and Sheets, generates and runs code, and can start sub-agents that work for days. Availability is not yet stated.',
    source: { name: 'CBS News', url: 'https://www.cbsnews.com/news/google-gemini-ai-workplace-agent/' },
  },
  {
    id: 'claude-haiku-5-5-api',
    date: '2026-10-07',
    kind: ShiftKind.Model,
    who: 'Anthropic',
    title: 'Claude Haiku 5.5 in the API',
    what: 'A 1M-token context window and 128k output. Code written for Haiku 4.5 can return 400 errors on it, so check before switching.',
    source: { name: 'Claude Platform release notes', url: 'https://platform.claude.com/docs/en/release-notes/overview' },
  },
  {
    id: 'reflection-beam',
    date: '2026-10-05',
    kind: ShiftKind.OpenModel,
    who: 'Reflection AI',
    title: 'Reflection announces Beam, an open-weight model',
    what: '501 billion parameters, 23 billion active, with a 1M-token window, for coding and agent work. Weights are due later this month; the claims are unverified.',
    source: { name: 'AI Business', url: 'https://aibusiness.com/foundation-models/reflection-s-beam-model-signals-deepening-split' },
  },
  {
    id: 'claude-haiku-5-5-copilot',
    date: '2026-10-07',
    kind: ShiftKind.Model,
    who: 'Anthropic',
    title: 'Claude Haiku 5.5 in GitHub Copilot',
    what: 'Anthropic’s lightweight model is generally available in Copilot on Pro and up, billed at list price under usage-based billing.',
    source: {
      name: 'GitHub Changelog',
      url: 'https://github.blog/changelog/2026-10-07-claude-haiku-5-5-in-github-copilot',
    },
  },
  {
    id: 'claude-spend-limit-pause',
    date: '2026-10-07',
    kind: ShiftKind.Outage,
    who: 'Anthropic',
    title: 'Some organisations wrongly paused at spend limit',
    what: 'Requests were refused across the API, Claude.ai, Claude Code and Cowork. The incident is marked resolved.',
    source: { name: 'Claude Status', url: 'https://status.claude.com/incidents/vmys9qn874h4' },
  },
  {
    id: 'copilot-local-sandbox',
    date: '2026-10-07',
    kind: ShiftKind.Tools,
    who: 'GitHub',
    title: 'Local sandboxing for Copilot is generally available',
    what: 'Commands that Copilot agents start get limited access to files, network and credentials, under policies admins can lock. No extra cost.',
    source: {
      name: 'GitHub Changelog',
      url: 'https://github.blog/changelog/2026-10-07-local-sandboxing-for-github-copilot-now-generally-available',
    },
  },
  {
    id: 'mistral-large-4',
    date: '2026-10-06',
    kind: ShiftKind.Model,
    who: 'Mistral',
    title: 'Mistral Large 4, a trillion-parameter model',
    what: 'A preview of Mistral’s largest model, reachable through a guardrail endpoint for now. Weights follow about three weeks later, after safety testing.',
    source: {
      name: 'TechCrunch',
      url: 'https://techcrunch.com/2026/10/06/mistrals-new-1t-model-aims-to-leapfrog-closed-and-open-rivals/',
    },
  },
  {
    id: 'copilot-four-models-deprecated',
    date: '2026-10-02',
    kind: ShiftKind.Access,
    who: 'GitHub',
    title: 'Four models deprecated across Copilot',
    what: 'Gemini 3.5 Flash, Gemini 3.6 Flash, Kimi K2.7 Code and Claude Opus 4.7. Replacements named are Gemini 3.8 Flash, Kimi K3 and Claude Opus 5.5.',
    source: {
      name: 'GitHub Changelog',
      url: 'https://github.blog/changelog/2026-10-02-selected-models-in-github-copilot-deprecated',
    },
  },
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
    title: 'Codex outage, then early limit errors',
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
    what: 'Claude Code now reads AGENTS.md in projects that have no CLAUDE.md.',
    source: {
      name: 'Enterprise DNA',
      url: 'https://enterprisedna.co/resources/ai-pulse/ai-pulse-2026-09-19-claude-code-adopts-agents-md-standard/',
    },
  },
  {
    id: 'gpt-5-5-retires',
    date: '2026-09-16',
    kind: ShiftKind.Access,
    who: 'OpenAI',
    title: 'GPT-5.5 leaves ChatGPT and Codex on 14 October',
    what: 'Retired from ChatGPT, ChatGPT Work and Codex on every plan. The API is not affected, but Codex settings that pin it need to move first.',
    source: {
      name: 'BusinessToday',
      url: 'https://www.businesstoday.in/technology/artificial-intelligence/story/openai-to-retire-gpt-5-5-from-chatgpt-work-and-codex-on-october-14-what-changes-to-expect-555782-2026-09-16',
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
    title: 'OpenAI ends Cursor’s direct model access',
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

/*
 * Upcoming: removals, retirements and new terms that are announced but not
 * yet in effect, soonest first as written. The page hides one once its day has
 * passed; move it into SHIFTS then, with what actually happened.
 */
export const UPCOMING: readonly Upcoming[] = [
  {
    id: 'gpt-5-5-leaves',
    date: '2026-10-14',
    announced: '2026-09-16',
    kind: ShiftKind.Access,
    who: 'OpenAI',
    title: 'GPT-5.5 leaves ChatGPT and Codex',
    what: 'Retired from ChatGPT, ChatGPT Work and Codex on every plan. The API is not affected, but Codex settings that pin it need to move first.',
    source: {
      name: 'BusinessToday',
      url: 'https://www.businesstoday.in/technology/artificial-intelligence/story/openai-to-retire-gpt-5-5-from-chatgpt-work-and-codex-on-october-14-what-changes-to-expect-555782-2026-09-16',
    },
  },
  {
    id: 'openai-legacy-models-leave',
    date: '2026-10-23',
    announced: '2026-04-22',
    kind: ShiftKind.Access,
    who: 'OpenAI',
    title: 'o1, o3-mini, GPT-4 and gpt-3.5-turbo leave the API',
    what: 'Also o4-mini and the fine-tuned versions of these models. OpenAI’s replacements are GPT-5.6 models.',
    source: { name: 'OpenAI API deprecations', url: 'https://developers.openai.com/api/docs/deprecations' },
  },
  {
    id: 'chatgpt-pro-allowance-ends',
    date: '2026-10-29',
    announced: '2026-09-29',
    kind: ShiftKind.Limits,
    who: 'OpenAI',
    title: 'ChatGPT Pro $200 subscribers lose the old allowance',
    what: 'People already on the plan keep their old allowance until this day, then get the reopened plan’s, which is roughly half.',
    source: { name: 'Kingy AI', url: 'https://kingy.ai/news/chatgpt-pro-200-usage-cut/' },
  },
  {
    id: 'usage-policy-takes-effect',
    date: '2026-11-12',
    announced: '2026-10-09',
    kind: ShiftKind.Access,
    who: 'Anthropic',
    title: 'Anthropic’s revised usage policy takes effect',
    what: 'It bans sustained, needless abuse of Claude and tightens the rules on influence operations.',
    source: {
      name: 'The Register',
      url: 'https://www.theregister.com/ai-and-ml/2026/10/09/anthropic-asks-users-to-stop-being-mean-to-claude/5302218',
    },
  },
  {
    id: 'cursor-openai-access-ends',
    date: '2026-11-12',
    announced: '2026-08-29',
    kind: ShiftKind.Access,
    who: 'OpenAI',
    title: 'Cursor loses direct access to OpenAI’s models',
    what: 'OpenAI’s upcoming models won’t go to Cursor either, now that SpaceX owns it.',
    source: { name: 'CNBC', url: 'https://www.cnbc.com/2026/08/29/openai-cursor-spacex-model-access.html' },
  },
  {
    id: 'sonnet-4-5-retires',
    date: '2026-11-30',
    announced: '2026-09-30',
    kind: ShiftKind.Access,
    who: 'Anthropic',
    title: 'Claude Sonnet 4.5 retires from the Claude API',
    what: 'Requests to it will fail after this day. Anthropic’s replacement is Sonnet 5.5.',
    source: { name: 'Claude Platform docs', url: 'https://platform.claude.com/docs/en/about-claude/model-deprecations' },
  },
  {
    id: 'openai-evals-prompts-agent-builder',
    date: '2026-11-30',
    announced: '2026-06-03',
    kind: ShiftKind.Tools,
    who: 'OpenAI',
    title: 'Evals, reusable prompts and Agent Builder shut down',
    what: 'Existing evals turn read-only on 31 October. OpenAI points to Promptfoo for evals and the Agents SDK for Agent Builder.',
    source: { name: 'OpenAI API deprecations', url: 'https://developers.openai.com/api/docs/deprecations' },
  },
  {
    id: 'gpt-5-o3-snapshots-leave',
    date: '2026-12-11',
    announced: '2026-06-11',
    kind: ShiftKind.Access,
    who: 'OpenAI',
    title: 'GPT-5 and o3 snapshots leave the API',
    what: 'Covers gpt-5, gpt-5-mini, gpt-5-nano, gpt-5-pro, o3 and o3-pro. OpenAI’s replacements are GPT-5.6 models.',
    source: { name: 'OpenAI API deprecations', url: 'https://developers.openai.com/api/docs/deprecations' },
  },
  {
    id: 'openai-fine-tuning-ends',
    date: '2027-01-06',
    announced: '2026-05-07',
    kind: ShiftKind.Access,
    who: 'OpenAI',
    title: 'OpenAI stops new fine-tuning jobs',
    what: 'Existing customers can no longer create fine-tuning jobs. Fine-tuned models keep running until their base model is deprecated.',
    source: { name: 'OpenAI API deprecations', url: 'https://developers.openai.com/api/docs/deprecations' },
  },
  {
    id: 'gpt-5-3-codex-leaves',
    date: '2027-04-01',
    announced: '2026-10-01',
    kind: ShiftKind.Access,
    who: 'OpenAI',
    title: 'gpt-5.3-codex, gpt-5.1 and gpt-5.4-nano leave the API',
    what: 'Six months’ notice. OpenAI’s replacements are GPT-6 models.',
    source: { name: 'OpenAI API deprecations', url: 'https://developers.openai.com/api/docs/deprecations' },
  },
]
