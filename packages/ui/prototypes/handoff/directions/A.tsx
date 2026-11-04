// Scrappy: A, the thread tidied. In order, as it happened: the lead's turns in two lines, each review one card with the settle
// that answers it, only the latest open. Then where it stands now, pinned last and open, with what waits on the person under it;
// the thread opens with it at the top.
import { useRef } from 'react'

import { TaskThread as Built, type TaskThreadProps } from '../../../../../apps/desktop/src/renderer/features/task/TaskThread'
import { CycleCard, HandoffCard, NeedsYou, ShortTurn, StandingFacts } from '../parts'
import s from './directions.module.css'
import { useProto } from '../state'
import { useOpenAt, useStory, useWho } from './shared'

/** The history, in order: shared with B's conversation, which has no handoff pinned. */
export function History({ pinned = false, ...props }: TaskThreadProps & { pinned?: boolean }) {
  const { story } = useStory(props.rounds, props.threadId)
  const who = useWho(props.session)
  // The latest review open: the one that left the person something, else the last, unless it found nothing.
  const open =
    story.cycles.findLast((cycle) => cycle.rows.some((row) => row.yours)) ?? story.cycles.findLast((cycle) => cycle.rows.length > 0)
  return (
    <>
      {story.beats.map((beat) =>
        beat.kind === 'lead' ? (
          // The turn the pinned handoff comes from leaves its words to it, so nothing is said twice.
          <ShortTurn
            key={beat.id}
            turn={pinned && story.handoff?.from?.id === beat.id ? { ...beat, outcome: null, said: false } : beat}
            model={who.lead}
            threadId={props.threadId}
          />
        ) : beat.kind === 'review' ? (
          <CycleCard
            key={beat.id}
            cycle={beat}
            reviewer={who.of(beat.agentId)}
            lead={who.lead}
            threadId={props.threadId}
            defaultOpen={beat === open}
          />
        ) : (
          <Built key={beat.id} {...props} rounds={[beat.block]} />
        ),
      )}
    </>
  )
}

export function ThreadA(props: TaskThreadProps) {
  const { story, snapshot } = useStory(props.rounds, props.threadId)
  const who = useWho(props.session)
  const pinned = useRef<HTMLDivElement>(null)
  useOpenAt(pinned)
  return (
    <>
      <History {...props} pinned />
      {story.handoff !== null && (
        <div ref={pinned} className={s.pinned}>
          <NeedsYou
            calls={story.yours.calls}
            findings={story.yours.findings}
            project={snapshot?.project.name ?? ''}
            {...(props.onPassOn === undefined ? {} : { onPassOn: props.onPassOn })}
          />
          <HandoffCard
            handoff={story.handoff}
            lead={who.lead}
            facts={<StandingFacts change={story.change} cycles={story.cycles} ledger={story.ledger} />}
          />
        </div>
      )}
    </>
  )
}
