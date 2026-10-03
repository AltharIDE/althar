import { products } from '@charrette/connectors'
import { Cause, Option } from 'effect'

import type { AccountRefused } from './Accounts'
import type { NoChangeToOpen } from './errors'

/*
 * What went wrong, in words a person reads in the window. The runtime's
 * errors carry what happened for the log; these say it the way the interface
 * does (docs/glossary.md: tasks, leads and agents, never sessions, runs or
 * failures). Anything not listed here says only that the runtime couldn't do
 * it; the log has the rest.
 */

const tagOf = (error: unknown): string =>
  typeof error === 'object' && error !== null && '_tag' in error && typeof error._tag === 'string' ? error._tag : 'Unknown'

const fieldOf = (error: unknown, key: string): unknown =>
  typeof error === 'object' && error !== null && key in error ? (error as Record<string, unknown>)[key] : undefined

const text = (error: unknown, key: string): string => {
  const value = fieldOf(error, key)
  return typeof value === 'string' ? value : ''
}

/** The last line of an agent's error output, which usually says why. */
const lastLine = (output: string): string =>
  output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .at(-1) ?? ''

/** A sentence, with its full stop. */
const sentence = (words: string): string => (/[.!?]$/.test(words) ? words : `${words}.`)

/** What an agent's own error says, when the runtime can put it in words. */
export const agentSaid = (error: unknown): string | undefined => {
  switch (tagOf(error)) {
    case 'AgentStartFailed': {
      const command = text(error, 'command')
      return /ENOENT/.test(text(error, 'reason'))
        ? `${command} isn't installed, or isn't on this Mac's PATH.`
        : sentence(`${command} wouldn't start: ${text(error, 'reason')}`)
    }
    case 'AgentExited': {
      const said = lastLine(text(error, 'stderr'))
      return said === '' ? 'The agent stopped.' : sentence(`The agent stopped: ${said}`)
    }
    case 'AgentRequestFailed':
      switch (fieldOf(error, 'failure')) {
        case 'auth_required':
          return "The agent isn't signed in. Sign in with its own tool, then try again."
        case 'usage_limit': {
          const until = text(error, 'resetsAt')
          return until === '' ? "The agent's usage limit is reached." : `The agent's usage limit is reached until ${until}.`
        }
        case 'context_full':
          return "The agent's context is full."
        default:
          return sentence(text(error, 'message'))
      }
    case 'OptionUnavailable':
      return `The agent doesn't offer ${text(error, 'value')}.`
    case 'TurnInProgress':
      return 'The lead is still on its last turn.'
    default:
      return undefined
  }
}

/** A cause, summed up for a person: what the agent said, or the first line of what went wrong. */
export const summarize = (cause: Cause.Cause<unknown>): string => {
  const error = Cause.findErrorOption(cause)
  const said = Option.isSome(error) ? agentSaid(error.value) : undefined
  if (said !== undefined) return said
  const first = lastLine(Cause.pretty(cause).split('\n')[0] ?? '').replace(/^\w*Error: /, '')
  return first === '' ? '' : sentence(first)
}

const kinds: Readonly<Record<string, string>> = {
  project: 'project',
  task: 'task',
  'task thread': 'task',
  thread: 'task',
  'task thread with a ready worktree': 'task’s worktree',
  'thread item': 'message',
  plan: 'plan',
  attention_request: 'call',
  provider_session: 'agent',
  folder: 'folder',
  account: 'account',
}

/** What went wrong, for the window: the error's tag as its reason, and words for the person. */
export const words = (error: unknown, agentName: (agentId: string) => string): { readonly reason: string; readonly message: string } => {
  const reason = tagOf(error)
  const message = ((): string => {
    switch (reason) {
      case 'NotARepository':
        return `${text(error, 'path')} isn't in a git repository. Choose a folder inside one.`
      case 'NotFound':
        return `That ${kinds[text(error, 'kind')] ?? 'thing'} isn't there any more.`
      case 'UnknownAgent':
        return `Charrette has no agent called ${text(error, 'agentId')}.`
      case 'SessionRunning':
        return 'An agent is already working on this task.'
      case 'NoSession':
        return 'No agent is working on this task.'
      case 'SessionFailed': {
        const summary = text(error, 'summary')
        return `${agentName(text(error, 'agentId'))} couldn't start.${summary === '' ? '' : ` ${summary}`}`
      }
      case 'EffortUnchanged': {
        const summary = text(error, 'summary')
        return `${agentName(text(error, 'agentId'))} still thinks as hard as it did.${summary === '' ? '' : ` ${summary}`}`
      }
      case 'ModelUnchanged': {
        const summary = text(error, 'summary')
        return `${agentName(text(error, 'agentId'))} is still on its old model.${summary === '' ? '' : ` ${summary}`}`
      }
      case 'CoordinatorUnavailable':
        return `${text(error, 'agentName')} isn't signed in, so the coordinator can't start on it. Pick another agent for the coordinator, or sign in with its own tool.`
      case 'AttentionClosed':
        return 'That call was already answered, or the agent took it back.'
      case 'GitFailed': {
        const args = fieldOf(error, 'args')
        const said = lastLine(text(error, 'stderr'))
        return sentence(`git ${Array.isArray(args) ? String(args[0] ?? '') : ''} didn't work${said === '' ? '' : `: ${said}`}`)
      }
      case 'CommandIdReused':
        return 'That request was already used for something else. Try again.'
      case 'DatabaseInUse':
        return 'Another copy of Charrette is using this profile.'
      case 'NoChangeToOpen':
        return noChangeToOpen[text(error, 'why') as NoChangeToOpen['why']] ?? noChangeToOpen.working
      case 'AccountRefused':
        return accountRefused[text(error, 'reason') as AccountRefused['reason']] ?? "Charrette can't add that account."
      case 'ChangedSinceSeen':
        return 'The pull request changed since you looked at it. Have another look before you accept it.'
      case 'NotConnected':
        return `Charrette isn't connected to ${productOf(text(error, 'product'))}. Connect it, then try again.`
      case 'OutwardUncertain':
        return "Charrette can't tell whether that went through: its answer was lost. Look on the host before trying again."
      case 'ConnectorFailed':
        return hostSaid(productOf(text(error, 'product')), text(error, 'reason'), text(error, 'message'))
      default:
        return agentSaid(error) ?? "Charrette's runtime couldn't do that. Its log has the details."
    }
  })()
  return { reason, message }
}

/** A product's name, by its id: GitHub, Linear. */
const productOf = (product: string) => Object.values(products).find((info) => info.product === product)?.name ?? 'The service'

/** What a code host or tracker said no to, or why it couldn't be asked, in the person's words. */
const hostSaid = (host: string, reason: string, said: string) => {
  const what = said === '' ? '' : `: ${lastLine(said)}`
  switch (reason) {
    case 'unauthorized':
      return `${host} no longer takes Charrette's sign-in. Sign in to it again.`
    case 'forbidden':
      return sentence(`${host} won't let this account do that${what}`)
    case 'not_found':
      return `${host} can't find it any more.`
    case 'rate_limited':
      return `${host} is asking Charrette to slow down. Try again in a little while.`
    case 'unreachable':
      return `Charrette couldn't reach ${host}. Try again in a moment.`
    case 'invalid_response':
      return `${host} answered in a way Charrette didn't understand.`
    default:
      return sentence(`${host} said no${what}`)
  }
}

/** Why a task has no pull request to open, by reason. */
const noChangeToOpen = {
  working: "The task's work isn't done yet. Its pull request opens when it is.",
  stopped: 'The task’s work stopped before it was done, so it has no pull request to open.',
  settled: 'The task is settled, so its branch stays as it is.',
  opened: 'The task already has its pull request.',
} as const satisfies Record<NoChangeToOpen['why'], string>

/** Errors the person caused or can put right; anything else is worth the log. */
export const expected = new Set([
  'ChangedSinceSeen',
  'NoChangeToOpen',
  'NotConnected',
  'NotARepository',
  'NotFound',
  'UnknownAgent',
  'SessionRunning',
  'NoSession',
  'AttentionClosed',
  'CommandIdReused',
])

/** Why an account can't be added, renamed or removed, by reason. */
const accountRefused = {
  no_room: "Charrette has nowhere to keep a new account's folder here. Choose a folder the agent signed in with instead.",
  not_a_folder: "That isn't a folder. Choose the folder the agent keeps the account's sign-in in.",
  usual: "That's the agent's usual sign-in, its first account: it stays.",
  taken: 'That folder is an account already.',
  no_name: 'Give the account a name.',
} as const satisfies Record<AccountRefused['reason'], string>
