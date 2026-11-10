import type { AccountUse } from '@althar/contracts'
import type { UsageLine } from '@althar/ui'
import { useSyncExternalStore } from 'react'

import { brandOf } from './agents'
import type { NameModel, NameProvider } from './modelNames'

/*
 * What a task, or the coordinator's day, used of each account its agents ran
 * on (ADR-084), as the kit's lines: an account named as the plan gauge's
 * peek names it, with its plan, and its own name where the agent has several.
 * An agent that reaches several providers (OpenCode) has a line for each its
 * turns ran on, named as the agent names the provider: OpenCode Zen.
 *
 * Whether Outputs' Usage is open is the person's, kept by this window across
 * launches for every task alike, as the board keeps its folded lanes: closed
 * until they open it, then open on every task until they close it.
 */

const planWord = (plan: string) => plan.charAt(0).toUpperCase() + plan.slice(1)

/** An account as its line names it: Claude Code Max, or Codex · Work where the agent has several. */
export const accountWords = (use: Pick<AccountUse, 'agentName' | 'accountName' | 'several' | 'plan'>) => {
  const agent = use.plan === null ? use.agentName : `${use.agentName} ${planWord(use.plan)}`
  return use.several ? `${agent} · ${use.accountName}` : agent
}

/** Providers as they are named, where none of the agent's models listed says: a model dropped from its list still reads as a name. */
const PROVIDERS: Readonly<Record<string, string>> = {
  opencode: 'OpenCode Zen',
  'opencode-go': 'OpenCode Go',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  'github-copilot': 'GitHub Copilot',
  openrouter: 'OpenRouter',
  xai: 'xAI',
  deepseek: 'DeepSeek',
  moonshotai: 'Moonshot AI',
  mistral: 'Mistral',
  zai: 'Z.ai',
}

/**
 * A provider's line as it is named: OpenCode Zen, a provider of the agent's own; OpenCode · OpenAI, another's; with the
 * account's own name where the agent has several.
 */
export const providerWords = (
  use: Pick<AccountUse, 'agentId' | 'agentName' | 'accountName' | 'several' | 'models'>,
  provider: string,
  nameProvider?: NameProvider,
) => {
  const named = nameProvider?.(use.agentId, use.models[0] ?? null, provider)
  const name = named === undefined || named === provider ? (PROVIDERS[provider] ?? provider) : named
  const line = name.toLowerCase().startsWith(use.agentName.toLowerCase()) ? name : `${use.agentName} · ${name}`
  return use.several ? `${line} · ${use.accountName}` : line
}

/** The kit's lines, from what a snapshot says each account was used, and each provider of an agent that reaches several. */
export const usageLines = (
  usage: ReadonlyArray<AccountUse> | undefined,
  named: NameModel,
  nameProvider?: NameProvider,
): ReadonlyArray<UsageLine> =>
  (usage ?? []).map((use) => {
    const mark = brandOf(use.agentId)
    return {
      id: use.provider === undefined ? use.accountId : `${use.accountId}:${use.provider}`,
      name: use.provider === undefined ? accountWords(use) : providerWords(use, use.provider, nameProvider),
      ...(mark === undefined ? {} : { mark }),
      ...(use.paidBy === 'plan' ? { took: use.took } : { spent: use.spent }),
      estimated: use.estimated,
      models: use.models.map((model) => named(use.agentId, model).name),
      tokens: use.tokens,
      // Several models on one account, its helpers' among them: each one's tokens.
      ...(use.byModel === undefined
        ? {}
        : { byModel: use.byModel.map((one) => ({ name: named(use.agentId, one.model).name, tokens: one.tokens })) }),
      ...(use.why === undefined ? {} : { why: use.why }),
    }
  })

const STORED = 'althar.usage'
const listeners = new Set<() => void>()
let last = false

/** What storage holds. Storage that can't be read keeps what this window last chose. */
const read = (): boolean => {
  try {
    return window.localStorage.getItem(STORED) === 'open'
  } catch {
    return last
  }
}

const write = (open: boolean) => {
  last = open
  try {
    if (open) window.localStorage.setItem(STORED, 'open')
    else window.localStorage.removeItem(STORED)
  } catch {
    // Kept for this window only, until storage can be written.
  }
  listeners.forEach((listener) => listener())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/** Whether Outputs' Usage is open, and how to keep what the person chooses next. */
export const useUsageOpen = (): readonly [boolean, (open: boolean) => void] => [useSyncExternalStore(subscribe, read), write]

/** Forgets the choice this window kept, as each test starts. */
export const forgetUsageOpen = () => {
  last = false
}
