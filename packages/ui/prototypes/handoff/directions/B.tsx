// Scrappy: B, the last word. Everything that is work is the thread's faint line: each of the lead's steps, each review with
// the lead's answer to it inside. What the person said, and the lead's replies to them, stay words. The lead's handoff is
// the thread's last message, said again as it now stands, and what needs the person are its closing lines.
import { useRef } from 'react'

import { Round as KitRound } from '../../../src/index'
import { TaskThread as Thread, type TaskThreadProps } from '../../../../../apps/desktop/src/renderer/features/task/TaskThread'
import { Asks, HandoffWords, ReviewLine, Turn, TurnLine } from '../calm'
import { useProto } from '../state'
import { useOpenAt, useStory, useWho } from './shared'

export function ThreadB(props: TaskThreadProps) {
  const { story } = useStory(props.rounds, props.threadId)
  const who = useWho(props.session)
  const asked = useProto().opening.review
  const last = useRef<HTMLElement>(null)
  useOpenAt(last)
  const handoff = story.handoff
  return (
    <>
      {story.beats.map((beat) =>
        beat.kind === 'lead' ? (
          // A reply to the person is said to them; a step's work is a line.
          beat.step === null ? (
            <Turn key={beat.id} turn={beat} lead={who.lead} threadId={props.threadId} />
          ) : (
            <TurnLine key={beat.id} turn={beat} lead={who.lead} threadId={props.threadId} />
          )
        ) : beat.kind === 'review' ? (
          <ReviewLine
            key={beat.id}
            cycle={beat}
            reviewer={who.of(beat.agentId)}
            lead={who.lead}
            threadId={props.threadId}
            defaultOpen={asked === beat.round}
          />
        ) : (
          <Thread key={beat.id} {...props} rounds={[beat.block]} />
        ),
      )}
      {handoff !== null && (
        <KitRound model={who.lead} at={handoff.from?.round.at ?? ''} data-item="handoff" ref={last}>
          <HandoffWords handoff={handoff} />
          <Asks calls={story.yours.calls} findings={story.yours.findings} onPassOn={props.onPassOn} bare />
        </KitRound>
      )}
    </>
  )
}
