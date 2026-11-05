// Scrappy: D, replies. The lead's report is one message that stays current: what the task has built, as it now stands, with
// its reviews hanging under it as replies, one faint line that opens them in order. The person's own exchanges with the
// lead stay in the thread as they were. What needs the person waits over the composer, in view however far they scroll.
import { useRef } from 'react'

import { WorkLine } from '../../../src/index'
import { TaskThread as Thread, type TaskThreadProps } from '../../../../../apps/desktop/src/renderer/features/task/TaskThread'
import { Asks, cameTo, ReviewSheet, Turn, TurnLine, words } from '../calm'
import { useProto } from '../state'
import type { Cycle } from '../story'
import s from './takes.module.css'
import { useOpenAt, useStory, useWho } from './shared'

export function ThreadD(props: TaskThreadProps) {
  const { story } = useStory(props.rounds, props.threadId)
  const who = useWho(props.session)
  const asked = useProto().opening.review
  const report = useRef<HTMLElement>(null)
  useOpenAt(report)
  // The message the reviews answer: the lead's first report.
  const anchor = story.turns.find((turn) => turn.round.report !== null && turn.step !== 'settle') ?? story.handoff?.from ?? null
  const cycles = story.cycles
  const handoff = story.handoff
  const updated = handoff?.from != null && handoff.from.id !== anchor?.id ? `updated ${handoff.from.round.at}` : undefined
  const replies = (all: ReadonlyArray<Cycle>) =>
    all.length === 0 ? null : (
      <WorkLine
        who={who.of(all[0]!.agentId)}
        took=""
        text={{ workedBy: () => words.reviewedTimes(all.length) }}
        summary={cameTo(story.ledger, all.at(-1)!.passed)}
        defaultOpen={asked !== null}
      >
        {all.map((cycle) => (
          <div key={cycle.id} className={s.reply} title={cycle.noise.length === 0 ? undefined : cycle.noise.join(' ')}>
            <p className={s.replyHead}>
              <span>{`Review ${cycle.round + 1}`}</span>
              <span className={s.replyAt}>{cycle.at}</span>
            </p>
            <ReviewSheet cycle={cycle} lead={who.lead} threadId={props.threadId} />
          </div>
        ))}
      </WorkLine>
    )
  return (
    <>
      {story.beats.map((beat) =>
        beat.kind === 'lead' ? (
          beat.id === anchor?.id ? (
            <Turn
              key={beat.id}
              turn={beat}
              lead={who.lead}
              threadId={props.threadId}
              handoff={handoff}
              ref={report}
              {...(updated === undefined ? {} : { at: updated })}
            >
              {replies(cycles)}
            </Turn>
          ) : beat.step === null ? (
            <Turn key={beat.id} turn={beat} lead={who.lead} threadId={props.threadId} />
          ) : (
            <TurnLine key={beat.id} turn={beat} lead={who.lead} threadId={props.threadId} />
          )
        ) : beat.kind === 'review' ? null : (
          <Thread key={beat.id} {...props} rounds={[beat.block]} />
        ),
      )}
      <Asks calls={story.yours.calls} findings={story.yours.findings} onPassOn={props.onPassOn} docked />
    </>
  )
}
