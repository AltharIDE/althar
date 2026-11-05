// Scrappy: C, one answer. Each thing the person said gets one answer from the lead, as the thread's Round draws one: its
// reply or what it set out to do, then all the work it took, reviews and all, in one faint line that opens in place, then
// what came of it. The latest answer's words are what the task has built, and what needs the person closes it.
import { Fragment, useRef } from 'react'

import { Markdown, Round as KitRound, WorkLine } from '../../../src/index'
import { TaskThread as Thread, type TaskThreadProps } from '../../../../../apps/desktop/src/renderer/features/task/TaskThread'
import type { Round } from '../../../../../apps/desktop/src/renderer/shared/rounds'
import { Asks, HandoffWords, ReviewLine, tookAll, TurnLine } from '../calm'
import { useProto } from '../state'
import type { Cycle, LeadTurn } from '../story'
import { exchangesOf, useOpenAt, useStory, useWho } from './shared'

const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`)

/** What its reviews came to, after how long it worked: reviewed twice, 2 of 3 findings fixed, 1 for you. */
const reviewedSum = (cycles: ReadonlyArray<Cycle>) => {
  if (cycles.length === 0) return undefined
  const rows = cycles.flatMap((cycle) => cycle.rows)
  if (rows.length === 0) return `reviewed ${times(cycles.length)}, nothing to change`
  const fixed = rows.filter((row) => row.state === 'fixed').length
  const yours = rows.filter((row) => row.yours).length
  return `reviewed ${times(cycles.length)}, ${fixed} of ${rows.length} findings fixed${yours > 0 ? `, ${yours} for you` : ''}`
}

export function ThreadC(props: TaskThreadProps) {
  const { story } = useStory(props.rounds, props.threadId)
  const who = useWho(props.session)
  const asked = useProto().opening.review
  const latest = useRef<HTMLElement>(null)
  useOpenAt(latest)
  const exchanges = exchangesOf(story.beats)
  return (
    <>
      {exchanges.map((exchange, at) => {
        const last = at === exchanges.length - 1
        const turns = exchange.beats.filter((beat): beat is LeadTurn => beat.kind === 'lead')
        const cycles = exchange.beats.filter((beat): beat is Cycle => beat.kind === 'review')
        const others = exchange.beats.filter((beat) => beat.kind === 'block')
        // A reply to the person opens the answer in its own words; a step's turn, with what it set out to do.
        const reply = turns[0]?.step === null ? turns[0] : undefined
        const work = turns.filter((turn) => turn !== reply)
        const rounds: Round[] = [
          ...work.map((turn) => turn.round),
          ...cycles.flatMap((cycle) => [...cycle.work, ...(cycle.settle === null ? [] : [cycle.settle.round])]),
        ]
        const reported = [...work, ...cycles.flatMap((cycle) => (cycle.settle === null ? [] : [cycle.settle]))].filter(
          (turn) => turn.round.report !== null,
        )
        const said = reported.at(-1)?.round.report?.result.summary ?? null
        const lastAt = [...turns, ...cycles].at(-1)
        const summary = reviewedSum(cycles)
        return (
          <Fragment key={exchange.ask?.id ?? `start-${at}`}>
            {exchange.ask !== null && <Thread {...props} rounds={[exchange.ask.block]} />}
            {(turns.length > 0 || cycles.length > 0) && (
              <KitRound
                model={who.lead}
                at={lastAt === undefined ? '' : lastAt.kind === 'review' ? lastAt.at : lastAt.round.at}
                {...(last ? { ref: latest } : {})}
              >
                {reply !== undefined && reply.round.result !== null && <Markdown source={reply.round.result.text} />}
                {reply === undefined && work[0]?.round.ack != null && <Markdown source={work[0].round.ack.text} />}
                {rounds.length > 0 && (
                  <WorkLine took={tookAll(rounds)} {...(summary === undefined ? {} : { summary })}>
                    {exchange.beats.map((beat) =>
                      beat.kind === 'lead' ? (
                        beat === reply ? null : (
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
                      ) : null,
                    )}
                  </WorkLine>
                )}
                {last && story.handoff !== null ? (
                  <HandoffWords handoff={story.handoff} />
                ) : (
                  said !== null && reported.length > 0 && <Markdown source={said} />
                )}
                {last && <Asks calls={story.yours.calls} findings={story.yours.findings} onPassOn={props.onPassOn} bare />}
              </KitRound>
            )}
            {others.map((beat) => (beat.kind === 'block' ? <Thread key={beat.id} {...props} rounds={[beat.block]} /> : null))}
          </Fragment>
        )
      })}
    </>
  )
}
