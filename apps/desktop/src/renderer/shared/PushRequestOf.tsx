import { PushBlocked, PushRequest, PushState } from '@althar/ui'

import type { PushRequestContent } from './thread'

/*
 * A push the lead asked the person for, in the task's thread: what would go
 * up, and Push, which pushes up to the head it shows and nothing newer, as
 * pushing from the task's outputs does. Where the branch changed since, the
 * runtime shows what is on it now, and Push pushes that; or why that can't
 * go up, with no Push. Its pull request opens on its host.
 */

const states: Readonly<Record<PushRequestContent['state'], PushState>> = {
  open: PushState.Open,
  pushed: PushState.Pushed,
  replaced: PushState.Replaced,
  closed: PushState.Closed,
}

const blocks: Readonly<Record<NonNullable<PushRequestContent['blocked']>, PushBlocked>> = {
  rewritten: PushBlocked.Rewritten,
  behind: PushBlocked.Behind,
  unknown: PushBlocked.Unknown,
}

export function PushRequestOf({
  request,
  at,
  by,
  pushing,
  onPush,
}: {
  request: PushRequestContent
  /** When it was asked, or settled. */
  at: string
  /** The lead's name. */
  by?: string
  pushing: boolean
  onPush: (head: string, url: string) => void
}) {
  return (
    <PushRequest
      where={request.where}
      {...(by === undefined ? {} : { by })}
      commits={request.commits}
      count={request.count}
      state={states[request.state]}
      moved={request.moved}
      {...(request.blocked === null ? {} : { blocked: blocks[request.blocked] })}
      at={at}
      pushing={pushing}
      onPush={() => onPush(request.head, request.url)}
      onOpen={() => void window.open(request.url, '_blank')}
    />
  )
}
