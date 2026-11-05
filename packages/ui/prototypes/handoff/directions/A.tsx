// Scrappy: A, calmer. The thread as it is, in order, each part quieter: the lead's turns say what came of them in a line or
// two, each review is one faint line, Althar's restarts sit on its hover. The lead's latest turn says what the task has
// built, whole; what needs the person ends the thread, and the thread opens on that turn.
import { Fragment, type RefObject, useRef } from 'react'

import { TaskThread as Thread, type TaskThreadProps } from '../../../../../apps/desktop/src/renderer/features/task/TaskThread'
import { Asks, ReviewLine, Turn } from '../calm'
import { useProto } from '../state'
import type { Story } from '../story'
import { useOpenAt, useStory, useWho } from './shared'

/** The thread, quieter, from a beat on: shared with E, whose history it is, where the handoff stands above it instead. */
export function Quieter({
  props,
  story,
  who,
  from = 0,
  handoffHere = true,
  holderRef,
}: {
  props: TaskThreadProps
  story: Story
  who: ReturnType<typeof useWho>
  from?: number
  handoffHere?: boolean
  holderRef?: RefObject<HTMLElement | null>
}) {
  const asked = useProto().opening.review
  const holder = story.handoff?.from?.id
  const turn = (one: Parameters<typeof Turn>[0]['turn']) => (
    <Turn
      key={one.id}
      turn={one}
      lead={who.lead}
      threadId={props.threadId}
      handoff={handoffHere && one.id === holder ? story.handoff : null}
      {...(one.id === holder && holderRef !== undefined ? { ref: holderRef } : {})}
    />
  )
  return (
    <>
      {story.beats.slice(from).map((beat) =>
        beat.kind === 'lead' ? (
          turn(beat)
        ) : beat.kind === 'review' ? (
          <Fragment key={beat.id}>
            <ReviewLine
              cycle={beat}
              reviewer={who.of(beat.agentId)}
              lead={who.lead}
              threadId={props.threadId}
              withSettle={false}
              defaultOpen={asked === beat.round}
            />
            {beat.settle !== null && turn(beat.settle)}
          </Fragment>
        ) : (
          <Thread key={beat.id} {...props} rounds={[beat.block]} />
        ),
      )}
    </>
  )
}

export function ThreadA(props: TaskThreadProps) {
  const { story } = useStory(props.rounds, props.threadId)
  const who = useWho(props.session)
  const holder = useRef<HTMLElement>(null)
  useOpenAt(holder)
  return (
    <>
      <Quieter props={props} story={story} who={who} holderRef={holder} />
      <Asks calls={story.yours.calls} findings={story.yours.findings} onPassOn={props.onPassOn} />
    </>
  )
}
