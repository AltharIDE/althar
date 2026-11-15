import { signInHost } from '@althar/contracts'
import { type SignInFlowHandle, type SignInWay, startSignInFlow } from '@althar/provider-adapters'
import { Clock, Context, Effect, Fiber, Layer, Schema, Scope } from 'effect'
import type { SqlError } from 'effect/sql'

import { Accounts } from './Accounts'
import { Agents, RuntimeConfig } from './Config'
import type { NotFound, UnknownAgent } from './errors'
import { SignIns } from './SignIns'
import { PlanUsage } from './PlanUsage'
import { Copilot } from './Copilot'

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
      readonly host?: string
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
  static readonly layer: Layer.Layer<AccountSignIns, never, Agents | Accounts | SignIns | PlanUsage | RuntimeConfig | Copilot> =
    Layer.effect(
      AccountSignIns,
      Effect.gen(function* () {
        const agents = yield* Agents
        const accounts = yield* Accounts
        const signIns = yield* SignIns
        const planUsage = yield* PlanUsage
        const config = yield* RuntimeConfig
        const copilot = yield* Copilot
        const scope = yield* Scope.Scope
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
          start: ({ accountId, way, host: inputHost }) =>
            Effect.gen(function* () {
              const account = yield* accounts.get(accountId)
              const entry = yield* agents.get(account.agentId)
              const host = inputHost === undefined ? undefined : signInHost(inputHost)
              if (host === null || (host !== undefined && entry.definition.native !== 'copilot'))
                return yield* new NoSignInHere({ agentId: account.agentId, way: 'Use a GitHub Enterprise hostname or HTTPS address.' })
              yield* accounts.prepare(account)
              // One at a time per agent: a new one stops the one before.
              for (const [id, flow] of flows) if (flow.agentId === account.agentId) stop(id)
              // The clock as the flow's events come, outside any effect: Effect's, so a test's clock is the one they read.
              const clock = yield* Clock.Clock
              const flowId = `signin_${clock.currentTimeMillisUnsafe().toString(36)}_${(made += 1)}`
              if (entry.definition.native === 'copilot') {
                if (way !== 'browser') return yield* new NoSignInHere({ agentId: account.agentId, way })
                let fiber: Fiber.Fiber<void> | undefined
                const flow: Flow = {
                  accountId,
                  agentId: account.agentId,
                  state: { state: 'starting' },
                  handle: {
                    paste: () => undefined,
                    cancel: () => {
                      if (fiber) Effect.runFork(Fiber.interrupt(fiber))
                    },
                  },
                }
                flows.set(flowId, flow)
                fiber = yield* Effect.forkIn(
                  copilot
                    .signIn(accountId, host, (challenge) => {
                      if (!flows.has(flowId)) return
                      flow.state = { state: 'device', ...challenge }
                      if (config.openUrl) Effect.runFork(config.openUrl(challenge.page))
                    })
                    .pipe(
                      Effect.andThen(signIns.account(account, true)),
                      Effect.andThen(planUsage.retell),
                      Effect.andThen(
                        Effect.sync(() => {
                          if (flows.has(flowId)) flow.state = { state: 'done', who: null, plan: 'Copilot subscription' }
                        }),
                      ),
                      Effect.catch((error) =>
                        Effect.sync(() => {
                          if (flows.has(flowId))
                            flow.state = {
                              state: 'failed',
                              message:
                                error._tag === 'CopilotFailed'
                                  ? error.message
                                  : error._tag === 'SecretsUnavailable' && error.keyring === true
                                    ? error.reason
                                    : 'Althar could not keep this sign-in securely. Try again.',
                            }
                        }),
                      ),
                      Effect.catchCause(() =>
                        Effect.sync(() => {
                          if (flows.has(flowId))
                            flow.state = { state: 'failed', message: 'Althar could not complete Copilot sign-in. Try again.' }
                        }),
                      ),
                    ),
                  scope,
                )
                return { flowId, state: flow.state }
              }
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
                        expiresAt: new Date(clock.currentTimeMillisUnsafe() + event.minutes * 60_000).toISOString(),
                      }
                      return
                    case 'failed':
                      flow.state = { state: 'failed', message: event.message }
                      return
                    case 'done':
                      // Signed in: checked again, so every screen shows it, before the window hears it; plan usage told again
                      // with it, so a warning that the old sign-in was ending goes from the bar at once (DEV-196).
                      Effect.runFork(
                        signIns.account(account, true).pipe(
                          Effect.flatMap(() =>
                            planUsage.retell.pipe(
                              Effect.ensuring(
                                Effect.sync(() => {
                                  flow.state = { state: 'done', who: event.who, plan: event.plan }
                                }),
                              ),
                            ),
                          ),
                        ),
                      )
                      return
                  }
                },
                {
                  way,
                  ...(host === undefined ? {} : { host }),
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
