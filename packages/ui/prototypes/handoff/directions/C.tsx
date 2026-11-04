// Scrappy: C, one ask, one answer. The reviews are part of the lead's work, not turns of the conversation: what the person asked
// gets one answer from its lead, whose work is a rail of what it went through (its work, each review with its settle, publishing),
// each stop opening in place, and whose words are what the task has built, as it stands. What waits on the person follows it.
import { type ReactNode, useRef, useState } from 'react'

import { Issue, Model, Round as KitRound } from '../../../src/index'
import { TaskThread as Built, type TaskThreadProps } from '../../../../../apps/desktop/src/renderer/features/task/TaskThread'
import { productBrand, productName } from '../../../../../apps/desktop/src/renderer/shared/products'
import { ChecksChip, CycleBody, HandoffBody, NeedsYou, Noise, Rail, StandingFacts, TurnLines, words } from '../parts'
import type { Beat, Cycle, LeadTurn, Stop } from '../story'
import s from './directions.module.css'
import { useOpenAt, useStory, useWho } from './shared'

/** The thread in exchanges: what the person asked (or the coordinator passed on), and everything until the next ask. */
const exchangesOf = (beats: ReadonlyArray<Beat>) => {
  const out: Array<{ ask: Beat | null; rest: Beat[] }> = [{ ask: null, rest: [] }]
  for (const beat of beats) {
    if (beat.kind === 'block' && (beat.block.kind === 'you' || beat.block.kind === 'relayed')) out.push({ ask: beat, rest: [] })
    else out.at(-1)?.rest.push(beat)
  }
  return out.filter((one) => one.ask !== null || one.rest.length > 0)
}

export function ThreadC(props: TaskThreadProps) {
  const { story, snapshot } = useStory(props.rounds, props.threadId)
  const who = useWho(props.session)
  const top = useRef<HTMLDivElement>(null)
  useOpenAt(top)
  const exchanges = exchangesOf(story.beats)
  return (
    <>
      {exchanges.map((exchange, at) => {
        const latest = at === exchanges.length - 1
        const turns = exchange.rest.filter((beat): beat is LeadTurn => beat.kind === 'lead')
        const cycles = exchange.rest.filter((beat): beat is Cycle => beat.kind === 'review')
        const others = exchange.rest.filter((beat) => beat.kind === 'block')
        const ids = new Set([...turns.map((one) => one.id), ...cycles.map((one) => one.id)])
        const stops = story.rail.filter((stop) => ids.has(stop.id) || (latest && stop.id === 'publish'))
        const ask =
          exchange.ask === null ? null : (
            <Built
              key={exchange.ask.id}
              {...props}
              rounds={[exchange.ask.kind === 'block' ? exchange.ask.block : (exchange.ask as never)]}
            />
          )
        return (
          <div key={exchange.ask?.id ?? `start-${at}`} className={s.exchange}>
            {ask}
            {(turns.length > 0 || cycles.length > 0) && (
              <div ref={latest ? top : undefined}>
                <Answer
                  props={props}
                  turns={turns}
                  cycles={cycles}
                  stops={stops}
                  lead={who.lead}
                  of={who.of}
                  words={
                    latest && story.handoff !== null ? (
                      <HandoffBody
                        handoff={story.handoff}
                        facts={<StandingFacts change={story.change} cycles={story.cycles} ledger={story.ledger} />}
                      />
                    ) : undefined
                  }
                  change={latest ? story.change : null}
                  publishing={latest && snapshot?.task.step === 'publish'}
                  needs={
                    latest ? (
                      <NeedsYou
                        calls={story.yours.calls}
                        findings={story.yours.findings}
                        {...(props.onPassOn === undefined ? {} : { onPassOn: props.onPassOn })}
                      />
                    ) : null
                  }
                />
              </div>
            )}
            {others.map((beat) => (beat.kind === 'block' ? <Built key={beat.id} {...props} rounds={[beat.block]} /> : null))}
          </div>
        )
      })}
    </>
  )
}

/** The lead's one answer to an ask: what it set out to do, the rail of what it went through, and what it has built. */
function Answer({
  props,
  turns,
  cycles,
  stops,
  lead,
  of,
  words: said,
  change,
  publishing,
  needs,
}: {
  props: TaskThreadProps
  turns: ReadonlyArray<LeadTurn>
  cycles: ReadonlyArray<Cycle>
  stops: ReadonlyArray<Stop>
  lead: ReturnType<typeof useWho>['lead']
  of: ReturnType<typeof useWho>['of']
  words: ReactNode | undefined
  change: ReturnType<typeof useStory>['story']['change']
  publishing: boolean
  needs: ReactNode
}) {
  const [open, setOpen] = useState<string | null>(null)
  const first = turns[0]
  const last = turns.at(-1)
  const turn = turns.find((one) => one.id === open)
  const cycle = cycles.find((one) => one.id === open)
  const report = last?.round.report ?? null
  return (
    <KitRound model={lead} at={first?.round.at ?? ''} data-item={first?.id}>
      {first?.intent != null && <p className={s.intent}>{first.intent}</p>}
      {stops.length > 1 && (
        <div className={s.railBox}>
          <Rail stops={stops} open={open} onOpen={setOpen} />
          {turn !== undefined && (
            <div className={s.stopOpen}>
              <TurnLines turn={{ ...turn, intent: turn === first ? null : turn.intent }} threadId={props.threadId} quiet />
            </div>
          )}
          {cycle !== undefined && (
            <div className={s.stopOpen}>
              <div className={s.stopHead}>
                <Model model={of(cycle.agentId)} />
                <span className={s.quiet}>{cycle.at}</span>
                <Noise noise={cycle.noise} />
              </div>
              <CycleBody cycle={cycle} lead={lead} threadId={props.threadId} />
            </div>
          )}
          {open === 'publish' && change !== null && (
            <div className={s.stopOpen}>
              {publishing && <p className={s.quiet}>{words.publishWaits}</p>}
              <Issue
                mark={productBrand(change.product)}
                source={productName(change.product)}
                id={`${change.short} ${change.prefix}${change.number}`}
                title={change.title}
                href={change.url}
                meta={[change.repository, change.draft ? words.draft : change.state].join(' · ')}
              />
            </div>
          )}
        </div>
      )}
      {needs}
      {said ?? (
        <>
          {last?.outcome != null && <p className={s.outcome}>{last.outcome}</p>}
          {report !== null && <ChecksChip id={report.id} evidence={report.result.evidence} unverified={report.result.unverified ?? []} />}
        </>
      )}
    </KitRound>
  )
}
