import { type ComponentProps, type ReactNode, useState } from 'react'

import { Button, Icon } from '@althar/ui'

import { Node, openTask } from '../graph/parts'
import { plan, type Step, word } from '../plan'
import { launch, option, scenario, store, useStore } from '../state'
import { type GraphView, listed, type NodeView } from '../view'
import {
  changedIn,
  Dropped,
  flash,
  flashSteps,
  LivePill,
  needsOf,
  ordered,
  PlannedPill,
  Progress,
  StepPopover,
  useGraph,
  usePlan,
} from './pieces'
import s from './dock.module.css'

/*
 * Chat C · Over the composer. The plan sits over the coordinator's
 * composer, through the whole talk: the conversation scrolls, the plan
 * doesn't. Folded, it's one line: the request, its version and size, and
 * Launch. Open, it's the plan a wave a row, in the order the steps can
 * start; pointing at a step lights what it waits for and what waits for
 * it, and pressing it opens what it does and why, to change. The answers
 * that change it say so in a line, which opens it on what changed.
 * Launched, the line follows the run: how far it is, and the one thing
 * that needs the person.
 */

/** The plan open over the composer. */
export const dockOpen = store(false)

/** A step in a wave, lit where the one pointed at waits for it (before) or it waits for that one (after). */
const relation = (step: { key: string; deps: ReadonlyArray<string> }, lit: { key: string; deps: ReadonlyArray<string> } | null) => {
  if (lit === null || lit.key === step.key) return null
  if (lit.deps.includes(step.key)) return 'before'
  if (step.deps.includes(lit.key)) return 'after'
  return 'far'
}

function Planned({ step, ...rest }: ComponentProps<typeof PlannedPill>) {
  return <PlannedPill step={step} {...rest} />
}

function Live({ node, ...rest }: { node: NodeView } & ComponentProps<'button'>) {
  return <LivePill node={node} {...rest} onClick={() => openTask(node)} />
}

/** The plan a wave a row: before launch each step its lead, after it where it stands. */
function Waves({ steps, graph }: { steps: ReadonlyArray<Step>; graph: GraphView | null }) {
  const [lit, setLit] = useState<string | null>(null)
  const flashing = useStore(flash)
  const { waves } = ordered(steps)
  const pointed = lit === null ? null : (steps.find((one) => one.key === lit) ?? null)
  return (
    <div className={s.waves} onPointerLeave={() => setLit(null)}>
      {waves.map((wave, i) => (
        <div key={wave.map((one) => one.key).join()} className={s.wave}>
          <span className={s.waveNumber}>{i + 1}</span>
          <div className={s.steps}>
            {wave.map((step) => {
              const node = graph?.byKey.get(step.key) ?? null
              const how = relation(node === null ? step : { key: step.key, deps: node.now.deps }, pointed)
              return (
                <div
                  key={step.key}
                  className={[s.place, how !== null && s[how], flashing.includes(step.key) && s.flash].filter(Boolean).join(' ')}
                  onPointerEnter={() => setLit(step.key)}
                >
                  {node === null || graph === null ? (
                    <StepPopover step={step} steps={steps} editable placement="above">
                      <Planned step={step} />
                    </StepPopover>
                  ) : (
                    <Node node={node} graph={graph} placement="above">
                      <Live node={node} />
                    </Node>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function Planned_({ open }: { open: boolean }) {
  const { last } = usePlan()
  const count = last.steps.filter((one) => !one.dropped).length
  return (
    <>
      {open && (
        <div className={s.sheet}>
          <Waves steps={last.steps} graph={null} />
          {last.steps.some((one) => one.dropped) && <Dropped steps={last.steps} className={s.dropped} />}
        </div>
      )}
      <div className={s.line}>
        <button type="button" className={s.fold} aria-expanded={open} onClick={() => dockOpen.set((was) => !was)}>
          <span className={s.name}>{scenario().name}</span>
          <span className={s.meta}>
            v{last.n} · {count} tasks
          </span>
          <Icon name={open ? 'chevronD' : 'chevronU'} size={12} className={s.chevron} />
        </button>
        <Button size="small" variant="signal" onClick={launch}>
          Launch
        </Button>
      </div>
    </>
  )
}

function Running({ open }: { open: boolean }) {
  const { last } = usePlan()
  const graph = useGraph()
  const need = needsOf(graph)[0]
  return (
    <>
      {open && (
        <div className={s.sheet}>
          <Waves steps={last.steps.filter((one) => !one.dropped)} graph={graph} />
        </div>
      )}
      <div className={s.line}>
        <button type="button" className={s.fold} aria-expanded={open} onClick={() => dockOpen.set((was) => !was)}>
          <span className={s.name}>{scenario().name}</span>
          <Progress graph={graph} />
          <span className={s.meta}>
            {graph.merged} of {graph.nodes.length}
          </span>
          <Icon name={open ? 'chevronD' : 'chevronU'} size={12} className={s.chevron} />
        </button>
        {need !== undefined && (
          <Button size="small" variant={need.signal ? 'signal' : 'default'} onClick={need.run} className={s.need}>
            {need.words}
          </Button>
        )}
      </div>
    </>
  )
}

function DockPlan() {
  const { launched } = usePlan()
  const open = useStore(dockOpen)
  return (
    <section className={s.dock} aria-label={scenario().name}>
      {launched ? <Running open={open} /> : <Planned_ open={open} />}
    </section>
  )
}

/** The coordinator's composer, with the plan docked over it where the chat option is C. */
export function LabDock({ children }: { children: ReactNode }) {
  const picked = useStore(option.chat)
  if (picked !== 'c') return <>{children}</>
  return (
    <div className={s.docked}>
      <DockPlan />
      {children}
    </div>
  )
}

/** A version, as a line under the answer that made it: pressed, the plan opens over the composer on what it changed. */
export function DockLine({ version }: { version: number }) {
  const now = useStore(plan)
  const made = now.versions.find((one) => one.n === version)
  if (made === undefined) return null
  const changed = changedIn(made)
  const count = made.steps.filter((one) => !one.dropped).length
  return (
    <button
      type="button"
      className={s.versionLine}
      onClick={() => {
        dockOpen.set(true)
        flashSteps(changed.map((one) => one.key))
      }}
    >
      <span className={s.versionName}>
        {word()} v{version}
      </span>
      <span className={s.versionWhat}>{version === 1 ? `${count} tasks` : listed(changed.map((one) => one.short))}</span>
      <span className={s.versionShow}>Open</span>
    </button>
  )
}
