import { useEffect, useRef, useState } from 'react'

import type { AccountSignInState, AccountStatus, AgentStatus, FoundAccount } from '@althar/contracts'
import { type AccountSignInStep, accountsText, SignInWay } from '@althar/ui'

import { messageOf } from '../../data/client'
import { useServices } from '../../data/services'
import { signInWordsOf } from '../../shared/agents'
import type { StartModel } from '../start/useStart'

/*
 * Signing an agent's account in, in its accounts list (ADR-012): a new one,
 * or one again. Where the agent lets it, Althar runs its own login itself:
 * the browser, which comes back by itself, with a code to paste where it
 * can't; or a one-time code to type on another device. The runtime says how
 * it stands, asked every second while it shows. Any agent can still sign in
 * with its own command in Terminal, which Althar checks when the person
 * comes back to the window or asks.
 *
 * A new account is made as the sign-in starts, under a name for now, and
 * named by the person once it is signed in; leaving before then removes it.
 * One a switcher already signed in is added as it is, and named the same way.
 */

/** A sign-in under way: whose, which account, and where it stands. */
export interface SigningIn {
  readonly agentId: string
  /** The account signing in again; null for a new one. */
  readonly again: string | null
  /** The new account, once it is made. */
  readonly made: string | null
  readonly step: AccountSignInStep
}

export interface AccountSignInModel {
  readonly signingIn: SigningIn | null
  /** Folders account switchers keep the agent's accounts in, as last looked for. */
  readonly found: ReadonlyArray<FoundAccount>
  /** Starts adding an account to the agent. */
  readonly add: (agentId: string) => void
  /** Signs one of its accounts in again: its ways in, or Terminal at once where Althar has none. */
  readonly again: (agentId: string, accountId: string) => void
  readonly way: (way: SignInWay) => void
  /** Opens the one-time code's page, or the sign-in in Terminal again. */
  readonly reopen: () => void
  /** Asks the agent again whether it is signed in, after Terminal. */
  readonly check: () => void
  /** A code the browser's page showed. */
  readonly paste: (code: string) => void
  /** Adds a folder a switcher made, by its grant. */
  readonly adopt: (grant: string) => void
  /** Adds a folder the person picks. */
  readonly chooseFolder: () => void
  /** Back to the ways in, leaving what the way began. */
  readonly back: () => void
  /** Keeps the new account under the name given. */
  readonly done: (name: string) => void
  readonly cancel: () => void
}

/** A new account's name until the person gives it one. */
export const newName = (n: number) => `Account ${n}`

/** How often a sign-in Althar runs is asked how it stands. */
const POLL = 1_000

interface Flow extends SigningIn {
  /** When the agents were read as Terminal opened: a later read that still finds the account signed out says so. */
  readonly since: number
  /** The runtime's sign-in under way, while Althar runs the agent's login. */
  readonly flowId: string | null
  /** The new account's name, as it was made. */
  readonly name?: string
}

/** Signed in, as far as the agent says. */
const signedIn = (account: AccountStatus) => account.signIn !== 'signed_out'

/** A signed-in account, to name: what pays for it, when the agent says. */
const naming = (account: AccountStatus): AccountSignInStep => ({
  kind: 'named',
  name: account.name,
  ...(account.paidBy === 'plan' ? { paid: accountsText.plan } : account.paidBy === 'key' ? { paid: accountsText.key } : {}),
})

/** Terminal opening for the agent's sign-in, until the runtime says it has. */
const opening: AccountSignInStep = { kind: 'terminal', line: '', opened: true }

/** A page as the person reads it: its host and path. */
const pageOf = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '')

/** How long a code still works, as the person reads it. */
const lastsOf = (expiresAt: string, now = Date.now()) => `${Math.max(1, Math.round((new Date(expiresAt).getTime() - now) / 60_000))} min`

export const useAccountSignIn = (start: StartModel): AccountSignInModel => {
  const { client, host } = useServices()
  const [flow, setFlow] = useState<Flow | null>(null)
  const [found, setFound] = useState<ReadonlyArray<FoundAccount>>([])
  // Each sign-in started; an answer for one already left is dropped.
  const token = useRef(0)

  const agentOf = (agentId: string): AgentStatus | undefined => start.status?.agents.find((agent) => agent.id === agentId)
  const accountsOf = (agentId: string) => agentOf(agentId)?.accounts ?? []
  const fresh = (agentId: string) => newName(accountsOf(agentId).length + 1)

  // The agents read again: an account that signed in in Terminal moves on, and one still signed out says so.
  const [seen, setSeen] = useState(start.checkedAt)
  if (start.checkedAt !== seen) {
    setSeen(start.checkedAt)
    const step = flow?.step
    if (flow !== null && flow.flowId === null && step?.kind === 'terminal' && start.checkedAt > flow.since) {
      const id = flow.again ?? flow.made
      const account = accountsOf(flow.agentId).find((one) => one.id === id)
      if (account !== undefined && signedIn(account)) setFlow(flow.again === null ? { ...flow, step: naming(account) } : null)
      else if (account !== undefined && step.notYet !== true) setFlow({ ...flow, step: { ...step, notYet: true } })
    }
  }

  const moveTo = (next: AccountSignInStep, mine: number) => {
    if (mine === token.current) setFlow((now) => (now === null ? now : { ...now, step: next }))
  }

  /** Removes an account made for a sign-in that was left; one that can't be signed out is removed anyway. */
  const forget = (accountId: string) =>
    client
      .removeAccount(accountId)
      .catch(() => client.removeAccount(accountId, true))
      .catch(() => undefined)
      .then(() => start.recheck())

  /** Stops what the sign-in under way began: the agent's login, and the account made for it. */
  const leave = () => {
    token.current += 1
    if (flow?.flowId != null) void client.cancelAccountSignIn(flow.flowId).catch(() => undefined)
    if (flow?.made != null) void forget(flow.made)
    setFlow(null)
    return token.current
  }

  // Closing the screen leaves the sign-in under way, as Cancel does: one still starting is stopped once it has.
  const left = useRef(leave)
  useEffect(() => {
    left.current = leave
  })
  useEffect(() => () => void left.current(), [])

  // While Althar runs the agent's login, it is asked how it stands.
  const flowId = flow?.flowId ?? null
  const agentId = flow?.agentId ?? null
  const { recheck } = start
  useEffect(() => {
    if (flowId === null || agentId === null) return
    const mine = token.current
    const words = signInWordsOf(agentId)
    const shown = (state: AccountSignInState) => {
      if (mine !== token.current) return
      setFlow((now) => {
        if (now === null || now.flowId !== flowId) return now
        switch (state.state) {
          case 'starting':
            return now
          case 'browser':
            return {
              ...now,
              step: {
                kind: 'browser',
                host: words.host,
                ...(state.link === null ? {} : { link: state.link }),
                paste: state.paste,
                ...(state.refused === null ? {} : { pasteError: state.refused }),
              },
            }
          case 'device':
            return {
              ...now,
              step: {
                kind: 'code',
                code: state.code,
                page: pageOf(state.page),
                lasts: lastsOf(state.expiresAt),
                ...(now.step.kind === 'code' && now.step.opened === true ? { opened: true } : {}),
              },
            }
          case 'failed':
            return { ...now, flowId: null, step: { kind: 'failed', said: state.message } }
          case 'done':
            void recheck()
            // Signed in again: back to its line. A new one: named, as who it signed in as.
            if (now.again !== null) return null
            return {
              ...now,
              flowId: null,
              step: {
                kind: 'named',
                name: now.step.kind === 'named' ? now.step.name : (now.name ?? ''),
                ...(state.who === null ? {} : { who: state.who }),
                ...(state.plan === null ? {} : { paid: state.plan }),
              },
            }
        }
      })
    }
    const ask = () => void client.getAccountSignIn(flowId).then(shown, () => undefined)
    ask()
    const timer = setInterval(ask, POLL)
    return () => clearInterval(timer)
  }, [client, flowId, agentId, recheck])

  /** Opens the account's sign-in in Terminal, or says the line to run where it can't. */
  const terminal = async (accountId: string, mine: number) => {
    const since = start.checkedAt
    const { line, opened } = await client.signInAccount(accountId)
    if (mine === token.current) setFlow((now) => (now === null ? now : { ...now, step: { kind: 'terminal', line, opened }, since }))
  }

  /** The account a way signs in: the one signing in again, or a new one, made now; null where it is signed in already, and named. */
  const accountFor = async (agentId: string, name: string, grant: string | null, mine: number): Promise<string | null> => {
    if (flow?.again != null) return flow.again
    if (flow?.made != null) return flow.made
    const account = await client.addAccount({ agentId, name, ...(grant === null ? {} : { grant }) })
    if (mine !== token.current) {
      void forget(account.id)
      return null
    }
    setFlow((now) => (now === null ? now : { ...now, made: account.id, name: account.name }))
    if (!signedIn(account)) return account.id
    moveTo(naming(account), mine)
    return null
  }

  /** Signs in by a way: the account made where it is new, then the agent's login, inside Althar or in Terminal. */
  const signInBy = async (agentId: string, how: 'browser' | 'device' | 'terminal', grant: string | null, name: string, mine: number) => {
    try {
      const accountId = await accountFor(agentId, name, grant, mine)
      if (accountId === null) return
      if (how === 'terminal') return await terminal(accountId, mine)
      const started = await client.startAccountSignIn(accountId, how)
      // Left while it started: what it started is stopped, so a sign-in the person left can't finish behind them.
      if (mine !== token.current) return void client.cancelAccountSignIn(started.flowId).catch(() => undefined)
      setFlow((now) => (now === null ? now : { ...now, flowId: started.flowId }))
    } catch (failure) {
      moveTo({ kind: 'failed', said: messageOf(failure) }, mine)
    }
  }

  const add = (agentId: string) => {
    const mine = leave()
    setFlow({ agentId, again: null, made: null, step: { kind: 'choose' }, since: 0, flowId: null })
    setFound([])
    client.findAccounts(agentId).then(
      (places) => mine === token.current && setFound(places),
      () => undefined,
    )
  }

  const again = (agentId: string, accountId: string) => {
    const mine = leave()
    // Where Althar runs the agent's login, its ways; elsewhere, Terminal at once.
    if ((agentOf(agentId)?.ways.length ?? 0) > 0)
      return setFlow({ agentId, again: accountId, made: null, step: { kind: 'choose' }, since: 0, flowId: null })
    setFlow({ agentId, again: accountId, made: null, step: opening, since: start.checkedAt, flowId: null })
    terminal(accountId, mine).catch((failure: unknown) => moveTo({ kind: 'failed', said: messageOf(failure) }, mine))
  }

  /** Back to the ways in, leaving what the way began. */
  const back = () => {
    if (flow === null) return
    token.current += 1
    if (flow.flowId !== null) void client.cancelAccountSignIn(flow.flowId).catch(() => undefined)
    if (flow.made !== null) void forget(flow.made)
    setFlow({ ...flow, made: null, flowId: null, step: { kind: 'choose' }, since: 0 })
  }

  return {
    signingIn: flow,
    found,
    add,
    again,
    way: (way) => {
      if (flow === null) return
      const mine = token.current
      const name = fresh(flow.agentId)
      switch (way) {
        case SignInWay.Browser:
          setFlow({ ...flow, step: { kind: 'browser', host: signInWordsOf(flow.agentId).host } })
          return void signInBy(flow.agentId, 'browser', null, name, mine)
        case SignInWay.Code:
          setFlow({ ...flow, step: { kind: 'checking' } })
          return void signInBy(flow.agentId, 'device', null, name, mine)
        case SignInWay.Terminal:
          setFlow({ ...flow, step: opening, since: start.checkedAt })
          return void signInBy(flow.agentId, 'terminal', null, name, mine)
        case SignInWay.Folder:
          return setFlow({ ...flow, step: { kind: 'folders' } })
        // Keys and the provider's console aren't offered here yet.
        case SignInWay.Key:
        case SignInWay.Console:
          return
      }
    },
    reopen: () => {
      if (flow === null) return
      if (flow.step.kind === 'code') {
        // The window opens web pages in the person's browser.
        window.open(`https://${flow.step.page}`, '_blank')
        setFlow({ ...flow, step: { ...flow.step, opened: true } })
        return
      }
      const id = flow.again ?? flow.made
      if (id === null) return
      const mine = token.current
      terminal(id, mine).catch((failure: unknown) => moveTo({ kind: 'failed', said: messageOf(failure) }, mine))
    },
    check: () => void start.recheck(),
    paste: (code) => {
      if (flow?.flowId != null) void client.pasteAccountSignInCode(flow.flowId, code).catch(() => undefined)
    },
    adopt: (grant) => {
      const place = found.find((one) => one.grant === grant)
      if (flow === null || place === undefined) return
      setFlow({ ...flow, step: { kind: 'checking' } })
      void signInBy(flow.agentId, 'terminal', grant, place.name, token.current)
    },
    chooseFolder: () => {
      if (flow === null) return
      const mine = token.current
      void host.pickFolder('account').then((grant) => {
        if (grant === null || mine !== token.current) return
        moveTo({ kind: 'checking' }, mine)
        return signInBy(flow.agentId, 'terminal', grant, fresh(flow.agentId), mine)
      })
    },
    back,
    done: (name) => {
      if (flow?.made == null || flow.step.kind !== 'named') return
      const { made, step: named } = flow
      const mine = token.current
      setFlow({ ...flow, step: { ...named, saving: true } })
      void (name === named.name ? Promise.resolve() : client.renameAccount(made, name))
        .then(() => start.recheck())
        .then(
          () => mine === token.current && setFlow(null),
          (failure: unknown) => moveTo({ kind: 'failed', said: messageOf(failure) }, mine),
        )
    },
    cancel: () => void leave(),
  }
}
