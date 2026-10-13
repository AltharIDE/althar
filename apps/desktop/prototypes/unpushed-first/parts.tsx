import { useState } from 'react'

import type { ThreadSnapshot } from '@althar/contracts'
import { Button, Icon, LinkButton, PushBlocked, PushRequest, PushState } from '@althar/ui'

import { commitsWord, pushOf } from './direction'
import p from './proto.module.css'

/*
 * The prototype's own arrangements of the kit's pieces: B's bar, pinned
 * while commits aren't on the pull request, and E's one line at the end of
 * the lead's message.
 */

/** B: the commits not on the pull request yet, with Push, until they're up; a moment's "all on it" after. */
export function PushBar({ snapshot, pushing, onPush }: { snapshot: ThreadSnapshot; pushing: boolean; onPush: () => void }) {
  const push = pushOf(snapshot)
  const n = push.unpushed
  if (push.asked === null || !(n > 0 || push.blocked || push.justPushed)) return null
  const where = push.asked.where
  return (
    <PushRequest
      className={p.bar}
      where={where}
      // Once up, a line: the thread keeps the record of what went.
      commits={push.justPushed ? [] : push.asked.commits}
      count={Math.max(n, push.asked.count)}
      state={push.justPushed ? PushState.Pushed : PushState.Open}
      {...(push.blocked ? { blocked: PushBlocked.Rewritten } : {})}
      {...(n > 0 ? { onPush } : {})}
      pushing={pushing}
      at={push.justPushed ? 'just now' : `${commitsWord(Math.max(n, push.asked.count))}`}
      text={{
        asked: 'Not on the pull request yet',
        pushed: 'All on the pull request',
        blocked: {
          [PushBlocked.Rewritten]: () =>
            'The branch was rewritten since it was pushed, so these can’t go up without a force push. Ask the lead to merge instead, on Outputs.',
          [PushBlocked.Behind]: () => '',
          [PushBlocked.Unknown]: () => '',
        },
      }}
    />
  )
}

/** E: one line closing the lead's message: what isn't up yet, and Push; the commits a press away. */
export function InlinePush({
  snapshot,
  pushing,
  onPush,
  onAskMerge,
}: {
  snapshot: ThreadSnapshot
  pushing: boolean
  onPush: () => void
  onAskMerge: () => void
}) {
  const [seen, setSeen] = useState(false)
  const push = pushOf(snapshot)
  const asked = push.asked
  if (asked === null) return null
  const n = push.unpushed
  if (push.blocked)
    return (
      <div className={p.inline}>
        <Icon name="hold" size={12} />
        <span>Can’t push: the branch was rewritten since it was pushed.</span>
        <Button size="small" onClick={onAskMerge}>
          Ask the lead to merge instead
        </Button>
      </div>
    )
  if (n === 0)
    return push.justPushed || asked.state === 'pushed' ? (
      <div className={p.inline}>
        <Icon name="check" size={12} />
        <span>
          Pushed {commitsWord(asked.count)} to {asked.where} · just now
        </span>
      </div>
    ) : null
  return (
    <div className={p.inlineBlock}>
      <div className={p.inline}>
        <Icon name="up" size={12} />
        <span>
          {commitsWord(n)} not on {asked.where} yet
        </span>
        <Button size="small" variant="signal" busy={pushing} onClick={onPush}>
          Push
        </Button>
        <LinkButton onClick={() => setSeen(!seen)}>{seen ? 'Hide them' : 'See them'}</LinkButton>
      </div>
      {seen && (
        <ol className={p.list}>
          {asked.commits.map((commit) => (
            <li key={commit.sha}>
              <code>{commit.sha}</code> {commit.subject}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
