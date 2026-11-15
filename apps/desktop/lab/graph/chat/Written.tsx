import { useRef, useState } from 'react'

import { Icon } from '@althar/ui'

import { Mark, openTask, useWidth } from '../graph/parts'
import { plan, setDropped, type Step, word } from '../plan'
import { scenario, useStore } from '../state'
import { type GraphView, listed } from '../view'
import {
  changedIn,
  Dropped,
  flash,
  flashSteps,
  Kicker,
  LaunchStrip,
  LeadMark,
  LeadMenu,
  NeedsYou,
  Notes,
  ordered,
  planEdges,
  useGraph,
  useLaid,
  usePlan,
  Wires,
} from './pieces'
import s from './written.module.css'

/*
 * Chat B · Written out. The coordinator writes the plan out as it would a
 * short brief: its steps numbered in the order they can start, a wave at a
 * time, each with what it does and why, who leads it and what it waits for,
 * and the person's notes on it. It's one document, edited in place: the
 * person changes a step's lead from its row, adds a note or drops it on
 * pointing at it, and each answer of the coordinator's that changes the
 * plan is a line saying what changed, which shows it in the plan. The graph
 * is there for whoever wants it. Launched, the same rows tick off.
 */

/** The plan drawn small, names only, for whoever wants the shape. */
function Shape({ steps }: { steps: ReadonlyArray<Step> }) {
  const well = useRef<HTMLDivElement>(null)
  const room = useWidth(well)
  const kept = steps.filter((one) => !one.dropped)
  const laid = useLaid(
    kept,
    (_columns, widest) => ({ w: Math.floor(Math.max(84, Math.min(132, ((room || 440) - (widest - 1) * 10) / widest))), h: 26 }),
    18,
    10,
    true,
    room,
  )
  return (
    <div className={s.shape} ref={well}>
      <div className={s.canvas} style={{ width: laid.w, height: laid.h }}>
        <Wires laid={laid} edges={planEdges(kept)} gap={18} down heads={false} />
        {kept.map((step) => {
          const box = laid.boxes.get(step.key)
          if (box === undefined) return null
          return (
            <span key={step.key} className={s.chip} style={{ transform: `translate(${box.x}px, ${box.y}px)`, width: box.w, height: box.h }}>
              <LeadMark model={step.model} size={11} />
              <span className={s.chipName}>{step.short}</span>
            </span>
          )
        })}
      </div>
    </div>
  )
}

function Row({ step, number, steps, graph }: { step: Step; number: number; steps: ReadonlyArray<Step>; graph: GraphView | null }) {
  const lit = useStore(flash)
  const [adding, setAdding] = useState(false)
  const node = graph?.byKey.get(step.key) ?? null
  const short = (key: string) => steps.find((one) => one.key === key)?.short ?? key
  const after = step.deps.filter((dep) => steps.some((one) => one.key === dep && !one.dropped))
  const classes = [s.row, lit.includes(step.key) && s.flash, node !== null && s[node.stand]].filter(Boolean).join(' ')
  if (node !== null)
    return (
      <li className={classes} id={`plan-row-${step.key}`}>
        <span className={s.number}>
          <Mark stand={node.stand} />
        </span>
        <button type="button" className={s.liveMain} onClick={() => openTask(node)}>
          <span className={s.rowTitle}>{step.title}</span>
          <span className={[s.state, s[node.tone]].join(' ')}>{node.stand === 'done' ? `Merged ${node.pr ?? ''}` : node.word}</span>
        </button>
      </li>
    )
  return (
    <li className={classes} id={`plan-row-${step.key}`}>
      <span className={s.number}>{number}</span>
      <div className={s.main}>
        <p className={s.rowTitle}>{step.title}</p>
        <p className={s.what}>{step.what}</p>
        <p className={s.why}>{step.why}</p>
        <Notes step={step} editable adding={adding} onAddingChange={setAdding} />
      </div>
      <div className={s.side}>
        <LeadMenu step={step} />
        {after.length > 0 && <span className={s.after}>After {listed(after.map(short))}</span>}
        <span className={s.rowActs}>
          <button type="button" className={s.act} onClick={() => setAdding(true)}>
            Note
          </button>
          <button type="button" className={[s.act, s.drop].join(' ')} onClick={() => setDropped(step.key, true)}>
            Drop
          </button>
        </span>
      </div>
    </li>
  )
}

function Plan({ graph }: { graph: GraphView | null }) {
  const { last } = usePlan()
  const [shape, setShape] = useState(false)
  const { waves, number } = ordered(last.steps)
  const count = last.steps.filter((one) => !one.dropped).length
  return (
    <article className={s.doc} aria-label={scenario().name}>
      <div className={s.head}>
        <Kicker last={last} launched={graph !== null} {...(graph === null ? {} : { graph })} />
        <span className={s.count}>{graph === null ? `${count} tasks` : `${graph.merged} of ${graph.nodes.length} merged`}</span>
        <button type="button" className={s.toggle} aria-expanded={shape} onClick={() => setShape((was) => !was)}>
          <Icon name="branch" size={12} />
          Graph
        </button>
      </div>
      <h3 className={s.title}>{scenario().name}</h3>
      {shape && <Shape steps={last.steps} />}
      <div className={s.waves}>
        {waves.map((wave, i) => (
          <ol key={wave.map((one) => one.key).join()} className={s.wave} aria-label={i === 0 ? 'Starts at once' : `Wave ${i + 1}`}>
            {wave.map((step) => (
              <Row key={step.key} step={step} number={number(step.key)} steps={last.steps} graph={graph} />
            ))}
          </ol>
        ))}
      </div>
      {graph === null && last.steps.some((one) => one.dropped) && <Dropped steps={last.steps} className={s.dropped} />}
      {graph === null ? <LaunchStrip steps={last.steps} className={s.strip} /> : <NeedsYou graph={graph} className={s.strip} />}
    </article>
  )
}

function LivePlan() {
  const graph = useGraph()
  return <Plan graph={graph} />
}

export function Written() {
  const { launched } = usePlan()
  return launched ? <LivePlan /> : <Plan graph={null} />
}

/** What a version changed, as a line under the coordinator's answer: pressed, the plan shows those steps. */
export function VersionLine({ version }: { version: number }) {
  const now = useStore(plan)
  const made = now.versions.find((one) => one.n === version)
  if (made === undefined) return null
  const changed = changedIn(made)
  return (
    <button
      type="button"
      className={s.versionLine}
      onClick={() => {
        const first = changed[0]
        if (first !== undefined) document.getElementById(`plan-row-${first.key}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        flashSteps(changed.map((one) => one.key))
      }}
    >
      <Icon name="branch" size={12} className={s.versionMark} />
      <span className={s.versionName}>
        {word()} v{version}
      </span>
      <span className={s.versionWhat}>{changed.length === 0 ? 'No step changed' : listed(changed.map((one) => one.short))}</span>
      <span className={s.versionShow}>Show</span>
    </button>
  )
}
