// Scrappy: the kit as the board sees it, with a task that allows everything saying so at its card's foot.
import { BoardCard as KitBoardCard, type BoardCardProps, Fact } from '@althar/ui'

import { useNow, timedOf } from '../parts'
import { TASK } from '../data'
import { type State, useProto } from '../store'
import { words } from '../words'

export * from '@althar/ui'

/** The tasks at work: what a project that allows everything marks, every one of them. */
const AT_WORK = new Set([TASK.title, 'Refunds skip the rate limiter'])

/** What the card says, by path; none where nothing is allowed beyond the rules, or today. */
const markOf = (st: State, title: string, now: number): { readonly text: string; readonly icon?: 'clock' } | null => {
  const own = title === TASK.title && st.taskMode === 'allow'
  const project = st.rules.permissions === 'allow' && AT_WORK.has(title) && !(title === TASK.title && st.taskMode !== null)
  if (!own && !project) return null
  switch (st.path) {
    case 'A':
      return { text: words.A.badge }
    case 'B':
    case 'BC':
      return { text: own ? 'Allow everything · this task' : 'Allow everything · meridian' }
    case 'C':
      return { text: own ? words.C.badge : 'meridian allows everything' }
    case 'D': {
      const timed = title === TASK.title ? timedOf(st) : timedOf({ ...st, taskUntil: null })
      if (timed === null) return { text: 'Allowing everything' }
      const left = timed.endsAt === null ? null : Math.max(1, Math.ceil((timed.endsAt - now) / 60_000))
      return { text: words.D.badge(left, timed.until), icon: 'clock' }
    }
    default:
      return null
  }
}

export function BoardCard(props: BoardCardProps) {
  const st = useProto()
  const now = useNow()
  const mark = markOf(st, props.title, now)
  if (mark === null) return <KitBoardCard {...props} />
  const fact = (
    <Fact tone="warm" {...(mark.icon === undefined ? {} : { icon: mark.icon })}>
      {mark.text}
    </Fact>
  )
  return (
    <KitBoardCard
      {...props}
      foot={
        props.foot == null ? (
          fact
        ) : (
          <>
            {props.foot} · {fact}
          </>
        )
      }
    />
  )
}
