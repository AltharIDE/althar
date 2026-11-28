import type { ApiHandlers } from '@althar/contracts'
import { Effect } from 'effect'

import { Accounts } from '../Accounts'
import { AccountSignIns } from '../AccountSignIns'
import { RuntimeConfig } from '../Config'
import { Folders } from '../Folders'
import { PlanUsage } from '../PlanUsage'
import { Policies } from '../Policies'
import { Models } from '../Models'
import { SignIns } from '../SignIns'
import type { ApiKit } from './kit'

/**
 * An agent's accounts: adding, naming, ordering, signing in and out, removing.
 * Plan usage, usage limits, which accounts a project uses, and the warning that a sign-in ends.
 */
export const accountsHandlers = ({ actorId, api, accountStatus }: ApiKit) =>
  Effect.gen(function* () {
    const planUsage = yield* PlanUsage
    const folders = yield* Folders
    const signIns = yield* SignIns
    const accounts = yield* Accounts
    const models = yield* Models
    const accountSignIns = yield* AccountSignIns
    const policies = yield* Policies
    const config = yield* RuntimeConfig
    return {
      AddAccount: ({ agentId, name, grant }) =>
        api(
          Effect.gen(function* () {
            const folder = grant === undefined ? undefined : yield* folders.path(grant)
            const account = yield* accounts.add({ agentId, name, ...(folder === undefined ? {} : { folder }) })
            return yield* accountStatus(account, true)
          }),
        ),
      RenameAccount: ({ accountId, name }) => api(accounts.rename(accountId, name)),
      RemoveAccount: ({ accountId, anyway }) =>
        // Removed, it offers its agent's models no more.
        api(accounts.remove(accountId, { anyway: anyway === true }).pipe(Effect.tap(() => models.forgetAccount(accountId)))),
      SignOutAccount: ({ accountId }) =>
        api(
          Effect.gen(function* () {
            yield* accounts.signOut(accountId)
            // Signed out, it offers its agent's models no more, and every screen says so: checked again, its plan with it.
            yield* models.forgetAccount(accountId)
            yield* signIns.account(yield* accounts.get(accountId), true)
            yield* planUsage.retell
          }),
        ),
      OrderAccounts: ({ agentId, accountIds }) => api(accounts.order(agentId, accountIds)),
      FindAccounts: ({ agentId }) =>
        api(
          Effect.gen(function* () {
            const found = yield* accounts.found(agentId)
            return {
              found: yield* Effect.forEach(found, (place) =>
                Effect.map(folders.allow(place.path), (grant) => ({ grant, name: place.name, path: place.path, tool: place.tool })),
              ),
            }
          }),
        ),
      SignInAccount: ({ accountId, host }) =>
        api(
          Effect.gen(function* () {
            const line = yield* accounts.login(accountId, host)
            if (host !== undefined) yield* models.forget('copilot')
            // Signed in again in Terminal, it may be someone else's sign-in, offered other models: asked afresh, and again as
            // its sign-in is checked for a while, as Althar can't see the sign-in end there.
            else yield* models.signingIn(accountId)
            // Opened where the app can, in Terminal; elsewhere the person runs it.
            return { line, opened: config.openTerminal === undefined ? false : yield* config.openTerminal(line) }
          }),
        ),
      StartAccountSignIn: ({ accountId, way, host }) =>
        api(accountSignIns.start({ accountId, way, ...(host === undefined ? {} : { host }) })),
      GetAccountSignIn: ({ flowId }) => accountSignIns.get(flowId),
      PasteAccountSignInCode: ({ flowId, code }) => api(accountSignIns.paste(flowId, code)),
      CancelAccountSignIn: ({ flowId }) => api(accountSignIns.cancel(flowId)),
      SetProjectAccounts: ({ projectId, rotate, only }) =>
        api(policies.setAccounts(projectId, only === null ? { rotate } : { rotate, only }, actorId)),
      SetUsageLimit: ({ projectId, policy }) => api(policies.setUsageLimit(projectId, policy, actorId)),
      GetPlanUsage: ({ refresh }) => api(planUsage.now(refresh === true)),
      DismissSignInEnding: ({ accountId, endsAt, stage }) => api(planUsage.dismiss(accountId, endsAt, stage)),
    } satisfies Partial<ApiHandlers>
  })
