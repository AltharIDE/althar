import { Effect } from 'effect'

import { type MergeInCopy, mergeInCopy } from './branchCopy'
import { ConnectorFailed } from './errors'
import type { BranchUpdate, ChangeRequest, ChangeWords, Product, PushTarget, Repository } from './model'
import { notOpen } from './model'

/*
 * `updateBranch` on the hosts that have no call for it (GitLab, Bitbucket
 * Cloud and Data Center): read the change, stop where it can't or shouldn't
 * be updated, then merge the target into the branch in a copy and push it
 * plainly (branchCopy.ts). What differs between those hosts is how they read
 * a change and sign git in; the rest is here, so they end alike.
 */

export interface UpdateInCopy {
  readonly product: Product
  readonly words: ChangeWords
  readonly repository: Repository
  readonly change: ChangeRequest
  readonly expectedHead: string
  /** The change as the host has it now. */
  readonly read: Effect.Effect<ChangeRequest, ConnectorFailed>
  /** A repository the change's branch is on, where it isn't the one it goes into: null where the host won't show it. */
  readonly fork: (path: ReadonlyArray<string>) => Effect.Effect<Repository | null>
  readonly pushTarget: (repository: Repository) => Effect.Effect<PushTarget, ConnectorFailed>
  readonly merge?: MergeInCopy
}

/** Why a fork's branch can't be updated, said for the person to pass on. */
const GONE = 'The fork the branch is on is gone or Althar’s account can’t see it, so there is no branch to push to.'

export const updateInCopy = (input: UpdateInCopy): Effect.Effect<BranchUpdate, ConnectorFailed> =>
  Effect.gen(function* () {
    const now = yield* input.read
    if (now.state !== 'open') return yield* notOpen(input.product, input.words, now.number, now.state)
    // Another push since the caller read it: never merged unseen, and never overwritten.
    if (now.headSha !== input.expectedHead) return { outcome: 'moved', head: now.headSha } satisfies BranchUpdate
    const own = now.headRepository === null || now.headRepository === undefined
    const where = own ? input.repository : now.headRepository.length === 0 ? null : yield* input.fork(now.headRepository)
    if (where === null) return { outcome: 'no_access', reason: GONE } satisfies BranchUpdate
    const [into, from] = yield* Effect.all([input.pushTarget(where), input.pushTarget(input.repository)])
    const merged = yield* (input.merge ?? mergeInCopy)({
      into: { target: into, branch: now.source, head: input.expectedHead },
      from: { target: from, branch: now.target },
      push: true,
    })
    switch (merged.outcome) {
      case 'updated':
        return { outcome: 'updated', head: merged.head } satisfies BranchUpdate
      case 'refused':
        // A fork the account may not push to is the usual reason; the host's own words say which.
        return own
          ? yield* Effect.fail(refusal(input.product, merged.message))
          : ({ outcome: 'no_access', reason: merged.message } satisfies BranchUpdate)
      default:
        return merged satisfies BranchUpdate
    }
  })

const refusal = (product: Product, message: string) => new ConnectorFailed({ product, reason: 'rejected', message })
