// Scrappy: the project, its agents and accounts, their plan usage, and what Althar's steering did, for the scenario the bar picks.
import type { AgentModels, AgentStatus, PlanUsage, ProjectSummary, UsageWarning } from '@althar/contracts'

import { project } from '../../tests/fixtures'
import { minutesAgo, nextMonday, today } from './clock'
import type { Level, Rule, State } from './store'
import { limitWords, whenWords } from './usage'

export const ROOT = '/Users/balazs/Charrette/althar'

export const althar: ProjectSummary = {
  ...project,
  id: 'p1',
  name: 'althar',
  slug: 'althar',
  ink: 'slate',
  repository: `${ROOT}/althar`,
  repositories: ['althar'],
  worktrees: ROOT,
  tasks: 5,
  running: 3,
  coordinatorThreadId: 'thc',
}

export const COORDINATOR = 'thc'

/** The project's tasks: the two steering touches, two more under way or done, and one planned. */
export const T = {
  scroll: { taskId: 't_scroll', threadId: 'th_scroll', title: 'Let a long dictation scroll in the composer', slug: 'dictation-scroll' },
  keep: { taskId: 't_keep', threadId: 'th_keep', title: 'Keep composer text when moving between screens', slug: 'keep-composer-text' },
  flicker: { taskId: 't_flicker', threadId: 'th_flicker', title: 'Find why the dock flickers on wake', slug: 'dock-flicker' },
  branch: { taskId: 't_branch', threadId: 'th_branch', title: 'Name the branch after its issue', slug: 'branch-after-issue' },
  checks: { taskId: 't_checks', threadId: 'th_checks', title: 'Show the checks’ names on the task card', slug: 'checks-on-card' },
} as const

export type TaskKey = keyof typeof T

/* ——— Agents and accounts ——— */

const account = (id: string, name: string, extra: Partial<AgentStatus['accounts'][number]> = {}): AgentStatus['accounts'][number] => ({
  id,
  name,
  home: null,
  signIn: 'signed_in',
  paidBy: 'plan',
  outUntil: null,
  adoptedFrom: null,
  ...extra,
})

const agent = (
  id: string,
  name: string,
  accounts: ReadonlyArray<AgentStatus['accounts'][number]>,
  extra: Partial<AgentStatus> = {},
): AgentStatus => ({
  id,
  name,
  signIn: 'signed_in',
  login: `${id} login`,
  version: '1.0.0',
  ways: ['browser'],
  accounts,
  addsAccounts: true,
  guide: null,
  installed: true,
  kept: false,
  download: null,
  problem: null,
  ...extra,
})

const homeOf = (id: string) => `/Users/balazs/Library/Application Support/Althar/accounts/${id}`

/** The agents on this Mac, as the scenario has them. */
export const agentsOf = (s: State): ReadonlyArray<AgentStatus> => [
  agent('claude-code', 'Claude Code', [
    account('acc_cc_work', 'Work', s.level === 'out' ? { outUntil: nextMonday(9) } : {}),
    ...(s.several ? [account('acc_cc_personal', 'Personal', { home: homeOf('acc_cc_personal') })] : []),
  ]),
  agent('codex', 'Codex', [
    account('acc_cx_work', 'Work'),
    ...(s.several ? [account('acc_cx_side', 'Side', { home: homeOf('acc_cx_side') })] : []),
  ]),
  ...(s.silent
    ? [
        agent('copilot', 'GitHub Copilot', [account('acc_copilot', 'main')]),
        agent('junie', 'Junie', [account('acc_junie', 'main')]),
        agent('mistral-vibe', 'Mistral Vibe', [account('acc_vibe', 'main')]),
      ]
    : []),
]

export const agentName = (id: string | null): string =>
  ({
    'claude-code': 'Claude Code',
    codex: 'Codex',
    copilot: 'GitHub Copilot',
    junie: 'Junie',
    'mistral-vibe': 'Mistral Vibe',
  })[id ?? ''] ??
  id ??
  ''

const efforts = (...names: ReadonlyArray<string>) => names.map((name) => ({ id: name.toLowerCase().replace(' ', ''), name }))

const offered = (
  agentId: string,
  models: ReadonlyArray<readonly [string, string]>,
  levels = efforts('Low', 'Medium', 'High'),
): AgentModels => ({
  agentId,
  models: models.map(([id, name]) => ({ id, name, description: null, efforts: levels, effort: 'medium' })),
  model: models[0]![0],
  effort: 'medium',
  defaults: [],
  blocked: [],
  probing: false,
  images: true,
})

export const modelsOf = (s: State): ReadonlyArray<AgentModels> => [
  offered('claude-code', [
    ['opus', 'Opus 5.5'],
    ['sonnet', 'Sonnet 5.5'],
    ['haiku', 'Haiku 5.5'],
  ]),
  offered(
    'codex',
    [
      ['gpt-5.5', 'GPT-5.5'],
      ['gpt-5.5-codex', 'GPT-5.5-Codex'],
    ],
    efforts('Low', 'Medium', 'High', 'Extra high'),
  ),
  ...(s.silent
    ? [
        offered('copilot', [['claude-sonnet-5.5', 'Claude Sonnet 5.5']], []),
        offered('junie', [['gemini-3-pro', 'Gemini 3 Pro']], []),
        offered('mistral-vibe', [['devstral-2', 'Devstral 2']], []),
      ]
    : []),
]

/** What the pickers list: the two models each agent's steps use, and the one each agent with no reading offers. */
export const PINS = [
  'claude-code:opus',
  'claude-code:sonnet',
  'codex:gpt-5.5',
  'codex:gpt-5.5-codex',
  'copilot:claude-sonnet-5.5',
  'junie:gemini-3-pro',
  'mistral-vibe:devstral-2',
]

/** A model's name as the thread says it. */
export const modelWords: Readonly<Record<string, string>> = {
  opus: 'Opus 5.5',
  sonnet: 'Sonnet 5.5',
  haiku: 'Haiku 5.5',
  'gpt-5.5': 'GPT-5.5',
  'gpt-5.5-codex': 'GPT-5.5-Codex',
}

/* ——— Plan usage ——— */

type Win = PlanUsage['accounts'][number]['windows'][number]
const win = (kind: Win['kind'], used: number, resetsAt: string, label: string | null = null): Win => ({
  kind,
  label,
  usedPercent: used,
  resetsAt,
})

/** Why there is no reading, as usageSources.ts says it. */
const WHY: Readonly<Record<string, string>> = {
  copilot: 'Copilot shows its premium requests in its own window and in your GitHub settings, not to other apps.',
  junie: 'Junie shows its JetBrains AI credits only in its own /stats, not to other apps.',
  'mistral-vibe': 'Mistral shows Vibe’s usage only in its own console, not to other apps.',
}

/** Every account's windows: plenty left everywhere, but for the window the level runs down. */
export const usageOf = (s: State): PlanUsage => {
  const accounts: Array<PlanUsage['accounts'][number]> = [
    {
      agentId: 'claude-code',
      agentName: 'Claude Code',
      accountId: 'acc_cc_work',
      accountName: 'Work',
      paidBy: 'plan',
      source: 'acp_extension',
      observedAt: minutesAgo(4),
      plan: 'max',
      windows: [
        win('five_hour', 31, today(15, 40)),
        win('weekly', s.level === 'out' ? 100 : 44, nextMonday(9)),
        // Opus's own week runs lower than the rest, so a model's own window shows where it counts.
        win('weekly', 81, nextMonday(9), 'Opus'),
      ],
      fault: null,
      noReading: null,
    },
    ...(s.several
      ? [
          {
            agentId: 'claude-code',
            agentName: 'Claude Code',
            accountId: 'acc_cc_personal',
            accountName: 'Personal',
            paidBy: 'plan' as const,
            source: 'agent' as const,
            observedAt: minutesAgo(26),
            plan: 'pro',
            windows: [win('five_hour', 12, today(13, 10)), win('weekly', 35, today(9, 0, 2))],
            fault: null,
            noReading: null,
          },
        ]
      : []),
    {
      agentId: 'codex',
      agentName: 'Codex',
      accountId: 'acc_cx_work',
      accountName: 'Work',
      paidBy: 'plan',
      source: 'agent',
      observedAt: minutesAgo(1),
      plan: 'pro',
      windows: [win('five_hour', s.level === 'nearly' ? 97 : 42, today(14, 0)), win('weekly', 27, today(18, 0, 4))],
      fault: null,
      noReading: null,
    },
    ...(s.several
      ? [
          {
            agentId: 'codex',
            agentName: 'Codex',
            accountId: 'acc_cx_side',
            accountName: 'Side',
            paidBy: 'plan' as const,
            source: 'agent' as const,
            observedAt: minutesAgo(12),
            plan: 'plus',
            windows: [win('five_hour', 6, today(16, 30)), win('weekly', 21, today(20, 0, 5))],
            fault: null,
            noReading: null,
          },
        ]
      : []),
    ...(s.silent
      ? (
          [
            ['copilot', 'GitHub Copilot', 'acc_copilot'],
            ['junie', 'Junie', 'acc_junie'],
            ['mistral-vibe', 'Mistral Vibe', 'acc_vibe'],
          ] as const
        ).map(([agentId, name, accountId]) => ({
          agentId,
          agentName: name,
          accountId,
          accountName: 'main',
          paidBy: 'plan' as const,
          source: null,
          observedAt: null,
          plan: null,
          windows: [],
          // As the runtime says it now: no fault, a calm reason (usageSources.ts).
          fault: null,
          noReading: WHY[agentId] ?? null,
        }))
      : []),
  ]
  // Ninemate's warnings: the lowest threshold crossed, per account and window, not yet seen.
  const warning = (over: Partial<UsageWarning>): UsageWarning => ({
    accountId: 'acc_cx_work',
    accountName: 'Work',
    agentId: 'codex',
    agentName: 'Codex',
    windowKey: 'five_hour',
    kind: 'five_hour',
    label: null,
    remainingPercent: 5,
    resetsAt: today(14, 0),
    raisedAt: minutesAgo(9),
    ...over,
  })
  const warnings =
    s.level === 'nearly'
      ? [warning({})]
      : s.level === 'out'
        ? [
            warning({
              accountId: 'acc_cc_work',
              agentId: 'claude-code',
              agentName: 'Claude Code',
              windowKey: 'weekly',
              kind: 'weekly',
              resetsAt: nextMonday(9),
              raisedAt: minutesAgo(3),
            }),
          ]
        : []
  return { accounts, warnings }
}

/* ——— What steering did ——— */

/** Someone who could take the step, as the runtime lists them. */
interface To {
  readonly agentId: string
  readonly accountId: string
  readonly model: string
}

export interface Steer {
  readonly task: TaskKey
  readonly step: 'implement' | 'review'
  /** The account nearly or wholly out, the step's planned one. */
  readonly from: { readonly agentId: string; readonly accountId: string; readonly model: string; readonly who: string }
  /** Its tightest window. */
  readonly left: number
  readonly limit: string
  readonly resetsAt: string
  /** What Althar did: took the step elsewhere, to another account of the same agent, held it, or asked. */
  readonly action: 'moved' | 'account' | 'waits' | 'asks'
  readonly to: (To & { readonly who: string }) | null
  /** Who could take it over, for a hold or an ask. */
  readonly choices: ReadonlyArray<To>
  /** What the thread says. */
  readonly words: string
}

const ACTION: Readonly<Record<Rule, Steer['action']>> = { move: 'moved', wait: 'waits', ask: 'asks' }

/** The step Althar steered before it started, in this scenario; none where every account has room. */
export const steerOf = (s: State): Steer | null => {
  if (s.level === 'plenty') return null
  const nearly = s.level === 'nearly'
  const step = nearly ? ('review' as const) : ('implement' as const)
  const from = nearly
    ? { agentId: 'codex', accountId: 'acc_cx_work', model: 'gpt-5.5', who: s.several ? 'Codex Work' : 'Codex' }
    : { agentId: 'claude-code', accountId: 'acc_cc_work', model: 'opus', who: s.several ? 'Claude Code Work' : 'Claude Code' }
  const resetsAt = nearly ? today(14, 0) : nextMonday(9)
  const left = nearly ? 3 : 0
  const limit = nearly ? limitWords({ kind: 'five_hour', label: null }) : limitWords({ kind: 'weekly', label: null })
  // With several accounts, another of the same agent's has room: the step goes there, whatever the rule.
  const sibling: (To & { who: string }) | null = !s.several
    ? null
    : nearly
      ? { agentId: 'codex', accountId: 'acc_cx_side', model: 'gpt-5.5', who: 'Codex Side' }
      : { agentId: 'claude-code', accountId: 'acc_cc_personal', model: 'opus', who: 'Claude Code Personal' }
  const elsewhere: To & { who: string } = nearly
    ? { agentId: 'claude-code', accountId: 'acc_cc_work', model: 'sonnet', who: 'Claude Code' }
    : { agentId: 'codex', accountId: 'acc_cx_work', model: 'gpt-5.5', who: 'Codex' }
  const action = sibling !== null ? 'account' : ACTION[s.rule]
  const to = action === 'account' ? sibling : action === 'moved' ? elsewhere : null
  const work = step === 'review' ? 'the review' : 'the work'
  const until = whenWords(resetsAt)
  const low = nearly
    ? `${from.who} has ${left}% of its ${limit} left, until ${until}`
    : `${from.who} has none of its ${limit} left, until ${until}`
  const words =
    action === 'moved'
      ? `${low}, so ${work} goes to ${to!.who}, on ${modelWords[to!.model]}.`
      : action === 'account'
        ? `${low}, so ${work} goes to ${to!.who}.`
        : action === 'waits'
          ? `${low}, so ${work} waits until ${nearly ? until : 'then'}. To carry on now, pick another model on the task.`
          : `${low}, so ${work} waits for you: carry on now on another model, or wait until then.`
  const choices: ReadonlyArray<To> = nearly
    ? [
        { agentId: 'claude-code', accountId: 'acc_cc_work', model: 'sonnet' },
        { agentId: 'claude-code', accountId: 'acc_cc_work', model: 'opus' },
        { agentId: 'codex', accountId: 'acc_cx_work', model: 'gpt-5.5' },
      ]
    : [
        { agentId: 'codex', accountId: 'acc_cx_work', model: 'gpt-5.5' },
        { agentId: 'codex', accountId: 'acc_cx_work', model: 'gpt-5.5-codex' },
      ]
  return { task: nearly ? 'scroll' : 'keep', step, from, left, limit, resetsAt, action, to, choices, words }
}

/** The task the Task screen opens on: the one steering touched, or the first under way. */
export const shownTask = (s: State): TaskKey => steerOf(s)?.task ?? 'scroll'
