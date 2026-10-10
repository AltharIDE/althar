import type { AccountStatus, AgentStatus } from '@althar/contracts'
import { type AccountEntry, Accounts, AccountSignIn } from '@althar/ui'

import { signInWordsOf } from '../../shared/agents'
import { shortFolder } from '../../shared/folders'
import { clock } from '../../shared/time'
import type { StartModel } from '../start/useStart'
import type { AccountSignInModel } from './useAccountSignIn'

/*
 * An agent's accounts, drawn by the kit: one quiet line each, in the order
 * work tries them, each to sign in again, rename, move and remove. Adding one
 * or signing one in happens in the list, in the line it is for, by the ways
 * the agent offers: the browser and a one-time code where Althar runs its
 * login, Terminal for any, or a folder another tool signed in.
 */

/** An account, as a line of the kit's list of an agent's accounts. */
export const accountEntry = (account: AccountStatus, now: Date = new Date()): AccountEntry => ({
  id: account.id,
  name: account.name,
  place:
    account.home === null
      ? { kind: 'usual' }
      : account.adoptedFrom === null
        ? { kind: 'own' }
        : { kind: 'adopted', folder: shortFolder(account.home), from: account.adoptedFrom },
  state:
    account.outUntil !== null
      ? { kind: 'out', back: clock(account.outUntil, now) }
      : account.signIn === 'signed_out'
        ? { kind: 'signedOut' }
        : { kind: 'ready', ...(account.paidBy === 'unknown' ? {} : { paid: account.paidBy }) },
})

export function AgentAccounts({ agent, start, signIn }: { agent: AgentStatus; start: StartModel; signIn: AccountSignInModel }) {
  const flow = signIn.signingIn?.agentId === agent.id ? signIn.signingIn : null
  // The account made for a sign-in under way is that sign-in's line until it is named.
  const accounts = agent.accounts.filter((account) => account.id !== flow?.made)
  const again = flow?.again == null ? undefined : accounts.find((account) => account.id === flow.again)
  const node = flow && (
    <AccountSignIn
      agent={agent.name}
      position={again === undefined ? accounts.length + 1 : accounts.indexOf(again) + 1}
      {...(again === undefined ? {} : { account: { name: again.name } })}
      step={flow.step}
      ways={{
        ...(agent.ways.includes('browser') ? { browser: signInWordsOf(agent.id).plan } : {}),
        ...(agent.ways.includes('device') ? { code: true } : {}),
        terminal: true,
        found: signIn.found.map((place) => ({ id: place.grant, name: place.name, folder: shortFolder(place.path), from: place.tool })),
        choose: true,
      }}
      onWay={signIn.way}
      onOpen={signIn.reopen}
      onCheck={signIn.check}
      onPaste={signIn.paste}
      onAdopt={signIn.adopt}
      onChooseFolder={signIn.chooseFolder}
      onBack={signIn.back}
      onDone={signIn.done}
      onCancel={signIn.cancel}
    />
  )
  return (
    <Accounts
      agent={agent.name}
      accounts={accounts.map((account) => accountEntry(account))}
      onAdd={() => signIn.add(agent.id)}
      onSignIn={(accountId) => signIn.again(agent.id, accountId)}
      onRename={(accountId, name) => void start.renameAccount(accountId, name)}
      onMove={(accountId, to) => void start.moveAccount(agent.id, accountId, to)}
      onRemove={(accountId) => void start.removeAccount(accountId)}
      {...(flow === null || node === null ? {} : { signIn: { account: flow.again, at: accounts.length, node } })}
    />
  )
}
