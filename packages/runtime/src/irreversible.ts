import type { Irreversible } from '@althar/contracts'
import type { PermissionRequest } from '@althar/provider-adapters'

import { mcpActOf } from './mcpActs'
import { commandOf, lastingKept, type RuleContext } from './rules'

/*
 * What the ask card says of a request that can't be undone (ADR-097): its
 * kind as Rules lists it, the action on its button, what can't be taken back
 * in one line, the words it would post, and where the call goes. Only for
 * what the rules read as that; a request kept for the person for another
 * reason (a command the project asks about, what the rules can't tell) keeps
 * the card it has.
 */

type Rule = NonNullable<ReturnType<typeof lastingKept>>['rule']

/** What a command of each kind is, as its card says it. */
const COMMANDS: Readonly<Record<Rule, (context: RuleContext) => Omit<Irreversible, 'through'>>> = {
  'force-push': () => ({
    kind: 'history',
    verb: 'Force push',
    done: 'Force pushed.',
    stays: 'What was on the remote branch is gone for everyone who shares it.',
  }),
  'default-branch': (context) => ({
    kind: 'history',
    verb: `Push to ${context.defaultBranch}`,
    done: `Pushed to ${context.defaultBranch}.`,
    stays: `It’s in ${context.defaultBranch}’s history at once; only a revert takes it out.`,
  }),
  'many-branches': () => ({
    kind: 'history',
    verb: 'Push them all',
    done: 'Pushed.',
    stays: 'Every branch and tag it names changes on the remote at once.',
  }),
  'delete-branch': () => ({
    kind: 'history',
    verb: 'Delete it',
    done: 'Deleted.',
    stays: 'Commits that are on no other branch go with it.',
  }),
  outside: () => ({
    kind: 'history',
    verb: 'Go ahead',
    done: 'Done.',
    stays: 'It may be the only copy, and it doesn’t go to the Bin.',
  }),
  deploy: () => ({
    kind: 'publish',
    verb: 'Publish',
    done: 'Published.',
    stays: 'It reaches everyone at once, and what went out stays out.',
  }),
  speak: () => ({
    kind: 'speak',
    verb: 'Post it',
    done: 'Posted.',
    stays: 'Everyone watching it is told at once; it can’t be called back.',
  }),
}

/** The card's words for a request the rules read as what can't be undone; undefined for any other. */
export const irreversibleOf = (request: PermissionRequest, context: RuleContext): Irreversible | undefined => {
  const lasting = lastingKept(request, context)
  if (lasting === undefined) return undefined
  if (request.mcp !== undefined) {
    const act = mcpActOf(request.mcp, request.rawInput)
    if (act.kind === undefined || act.stays === undefined) return undefined
    return {
      kind: act.kind,
      verb: act.verb,
      done: `${act.done}.`,
      stays: act.stays,
      ...(act.words === undefined ? {} : { words: act.words }),
      through: { server: act.server, tool: act.tool },
    }
  }
  return { ...COMMANDS[lasting.rule](context), through: { command: commandOf(request) } }
}
