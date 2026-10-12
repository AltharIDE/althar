import { type SignInFlowHandle, type SignInWay, startSignInFlow } from '@althar/provider-adapters'
import { Context, Effect, Layer, Schema } from 'effect'
import type { SqlError } from 'effect/sql'

import { Accounts } from './Accounts'
import { Agents, RuntimeConfig } from './Config'
import type { NotFound, UnknownAgent } from './errors'
import { SignIns } from './SignIns'

/*
 * Signing an agent's account in inside Althar (ADR-012), rather than in a
 * terminal: the agent's own login, run in the account's home
 * (provider-adapters' signInFlow), with what it says kept for the window to
 * read. The window asks how one stands while it shows it; a code pasted in
 * the window goes to the agent; leaving it stops the agent's login. Once
 * done, the account's sign-in is checked again, so every screen shows it.
 *
 * Codex's login waits on one port for the browser, so an agent signs in one
 * account at a time: starting another stops the one before.
 */

/** How a sign-in stands, as the window shows it. */
export type AccountSignInState =
  | { readonly state: 'starting' }
  | { readonly state: 'browser'; readonly link: string | null; readonly paste: boolean; readonly refused: string | null }
  | { readonly state: 'device'; readonly code: string; readonly page: string; readonly expiresAt: string }
  | { readonly state: 'done'; readonly who: string | null; readonly plan: string | null }
  | { readonly state: 'failed'; readonly message: string }

/** The agent signs in no way Althar can run itself, or not this one. */
export class NoSignInHere extends Schema.TaggedError<NoSignInHere>()('NoSignInHere', {
  agentId: Schema.String,
  way: Schema.String,
}) {}

interface Flow {
  readonly accountId: string
  readonly agentId: string
  state: AccountSignInState
  readonly handle: SignInFlowHandle
}

export class AccountSignIns extends Context.Service<
  AccountSignIns,
  {
    /** Starts the account's sign-in, this way; its id, to ask how it stands. */
    start(input: {
      readonly accountId: string
      readonly way: SignInWay
    }): Effect.Effect<
      { readonly flowId: string; readonly state: AccountSignInState },
      NotFound | UnknownAgent | NoSignInHere | SqlError.SqlError
    >
    /** How it stands; a sign-in not known is one that was left. */
    get(flowId: string): Effect.Effect<AccountSignInState>
    /** A code the browser's page showed, for the agent. */
    paste(flowId: string, code: string): Effect.Effect<void>
    cancel(flowId: string): Effect.Effect<void>
  }
>()('@althar/runtime/AccountSignIns') {
  static readonly layer: Layer.Layer<AccountSignIns, never, Agents | Accounts | SignIns | RuntimeConfig> = Layer.effect(
    AccountSignIns,
    Effect.gen(function* () {
      const agents = yield* Agents
      const accounts = yield* Accounts
      const signIns = yield* SignIns
      const config = yield* RuntimeConfig
      const flows = new Map<string, Flow>()
      let made = 0
      // A sign-in still under way when the runtime stops stops with it, rather than living on behind it.
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          for (const flow of flows.values()) flow.handle.cancel()
          flows.clear()
        }),
      )

      const stop = (flowId: string) => {
        const flow = flows.get(flowId)
        if (flow === undefined) return
        flow.handle.cancel()
        flows.delete(flowId)
      }

      return AccountSignIns.of({
        start: ({ accountId, way }) =>
          Effect.gen(function* () {
            const account = yield* accounts.get(accountId)
            const entry = yield* agents.get(account.agentId)
            yield* accounts.prepare(account)
            // One at a time per agent: a new one stops the one before.
            for (const [id, flow] of flows) if (flow.agentId === account.agentId) stop(id)
            const flowId = `signin_${Date.now().toString(36)}_${(made += 1)}`
            const holder: { flow?: Flow } = {}
            const handle = startSignInFlow(
              entry.definition,
              (event) => {
                const flow = holder.flow
                if (flow === undefined || !flows.has(flowId)) return
                switch (event.kind) {
                  case 'browser':
                    flow.state = { state: 'browser', link: event.link, paste: event.paste, refused: null }
                    return
                  case 'refused':
                    if (flow.state.state === 'browser') flow.state = { ...flow.state, refused: event.message }
                    return
                  case 'device':
                    flow.state = {
                      state: 'device',
                      code: event.code,
                      page: event.page,
                      expiresAt: new Date(Date.now() + event.minutes * 60_000).toISOString(),
                    }
                    return
                  case 'failed':
                    flow.state = { state: 'failed', message: event.message }
                    return
                  case 'done':
                    // Signed in: checked again, so every screen shows it, before the window hears it.
                    Effect.runFork(
                      signIns
                        .account(account, true)
                        .pipe(Effect.ensuring(Effect.sync(() => (flow.state = { state: 'done', who: event.who, plan: event.plan })))),
                    )
                    return
                }
              },
              {
                way,
                home: accounts.env(account),
                ...(config.openUrl === undefined
                  ? {}
                  : { openUrl: (url: string) => void Effect.runFork(config.openUrl?.(url) ?? Effect.void) }),
              },
            )
            if (handle === null) return yield* new NoSignInHere({ agentId: account.agentId, way })
            holder.flow = { accountId, agentId: account.agentId, state: { state: 'starting' }, handle }
            flows.set(flowId, holder.flow)
            return { flowId, state: holder.flow.state }
          }),
        get: (flowId) => Effect.sync(() => flows.get(flowId)?.state ?? { state: 'failed', message: 'This sign-in was left.' }),
        paste: (flowId, code) =>
          Effect.sync(() => {
            const flow = flows.get(flowId)
            if (flow === undefined) return
            if (flow.state.state === 'browser') flow.state = { ...flow.state, refused: null }
            flow.handle.paste(code)
          }),
        cancel: (flowId) => Effect.sync(() => stop(flowId)),
      })
    }),
  )
}
