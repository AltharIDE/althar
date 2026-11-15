import { type ComponentProps, useRef, useState } from 'react'

import { Button, Icon } from '@althar/ui'

import { useWidth } from '../graph/parts'
import { leadOf, type Step } from '../plan'
import { launch, scenario } from '../state'
import {
  Dropped,
  flash,
  Kicker,
  LeadMark,
  leadWords,
  NeedsYou,
  ordered,
  planEdges,
  Progress,
  StepPopover,
  useGraph,
  useLaid,
  usePlan,
  Wires,
} from './pieces'
import { useStore } from '../state'
import s from './beside.module.css'

/*
 * Chat D · Beside the talk. While the plan is talked over, it takes the
 * board's half of the window: the conversation keeps its narrow column for
 * the talk, and the plan gets the room to show every step whole, what it
 * does as well as its name, laid out top to bottom by what waits for what.
 * Pressing a step opens why, its lead, its notes and what it waits for, to
 * change. Launched, the board comes back, and the conversation holds a
 * small card that follows the run.
 */

const H = 112
const GAP = 40
const PITCH = 16

/** A step whole: its number, lead and name, what it does, and who leads it. */
function Big({ step, number, ...rest }: { step: Step; number: number } & ComponentProps<'button'>) {
  const lit = useStore(flash)
  return (
    <button
      type="button"
      {...rest}
      className={[s.step, step.changed.length > 0 && s.changed, lit.includes(step.key) && s.flash].filter(Boolean).join(' ')}
    >
      <span className={s.stepHead}>
        <span className={s.number}>{number}</span>
        <span className={s.stepName}>{step.short}</span>
        {(step.notes ?? []).length > 0 && <Icon name="comment" size={12} className={s.noted} />}
        {step.changed.length > 0 && <span className={s.dot} title="Changed in this version" />}
      </span>
      <span className={s.stepWhat}>{step.what}</span>
      <span className={s.stepLead}>
        <LeadMark model={step.model} size={11} />
        {leadWords(step)}
      </span>
    </button>
  )
}

export function PlanBeside() {
  const { last } = usePlan()
  const canvas = useRef<HTMLDivElement>(null)
  const room = useWidth(canvas)
  const steps = last.steps.filter((one) => !one.dropped)
  const { number } = ordered(last.steps)
  const laid = useLaid(
    steps,
    (_columns, widest) => ({ w: Math.floor(Math.max(176, Math.min(236, ((room || 760) - (widest - 1) * PITCH) / widest))), h: H }),
    GAP,
    PITCH,
    true,
    room,
  )
  const [lit, setLit] = useState<string | null>(null)
  const leads = [...new Set(steps.map((one) => leadOf(one.model).short))]
  return (
    <section className={s.beside} aria-label={scenario().name}>
      <header className={s.head}>
        <div className={s.heading}>
          <Kicker last={last} launched={false} />
          <h2 className={s.title}>{scenario().name}</h2>
          <p className={s.facts}>
            {steps.length} tasks · {leads.join(', ')}
          </p>
        </div>
        <Button variant="signal" onClick={launch}>
          Launch {steps.length} tasks
        </Button>
      </header>
      <div className={s.canvas} ref={canvas}>
        <div className={s.world} style={{ width: laid.w, height: laid.h }} onPointerLeave={() => setLit(null)}>
          <Wires laid={laid} edges={planEdges(steps)} gap={GAP} down lit={lit} />
          {steps.map((step) => {
            const box = laid.boxes.get(step.key)
            if (box === undefined) return null
            return (
              <div
                key={step.key}
                className={s.place}
                data-node={step.key}
                style={{ transform: `translate(${box.x}px, ${box.y}px)`, width: box.w, height: box.h }}
                onPointerEnter={() => setLit(step.key)}
              >
                <StepPopover step={step} steps={last.steps} editable placement="right">
                  <Big step={step} number={number(step.key)} />
                </StepPopover>
              </div>
            )
          })}
        </div>
        {last.steps.some((one) => one.dropped) && <Dropped steps={last.steps} className={s.dropped} />}
      </div>
    </section>
  )
}

/** Once launched, the plan in the conversation, small: how far it is, and what needs the person. */
export function LaunchedCard() {
  const { last } = usePlan()
  const graph = useGraph()
  return (
    <article className={s.launched} aria-label={scenario().name}>
      <div className={s.launchedTop}>
        <Kicker last={last} launched graph={graph} />
        <span className={s.launchedAt}>
          {graph.merged} of {graph.nodes.length} merged
        </span>
      </div>
      <h3 className={s.launchedTitle}>{scenario().name}</h3>
      <Progress graph={graph} className={s.launchedProgress} />
      <NeedsYou graph={graph} className={s.launchedSteps} />
    </article>
  )
}
