import { type ComponentProps, type ReactNode, useMemo, useState } from 'react'

import { BrandMark, Button, Icon, KeyValues, Menu, MenuRadioGroup, MenuRadioItem, NextStep, NextSteps, NoteForm, Popover } from '@althar/ui'

import { Mark, modelOf } from '../graph/parts'
import {
  addNote,
  EFFORTS,
  latest,
  LEADS,
  leadOf,
  plan,
  type Plan,
  removeNote,
  setDropped,
  setEffort,
  setLead,
  type Step,
  unlinkStep,
  type Version,
  noun,
  word,
} from '../plan'
import { launch, move, scenario, stage, store, useStore, useWorld } from '../state'
import { columnsOf, type EdgeView, graphOf, type GraphView, type Laid, lay, listed, type NodeView } from '../view'
import s from './pieces.module.css'

export { Wires } from '../graph/parts'

/*
 * What every chat option draws the plan with: a step as it's planned (its
 * lead and name) and as it runs (its name and where it stands), a step's
 * detail where it can be changed (its lead, a note, what it waits for,
 * dropped), the graph's canvas, and the strips that launch the plan and
 * say what the run needs from the person.
 */

/** The plan as it stands, drawn again as it changes. */
export const usePlan = (): { plan: Plan; last: Version; launched: boolean } => {
  const now = useStore(plan)
  const at = useStore(stage)
  useStore(noun)
  return { plan: now, last: latest(now), launched: at === 'run' }
}

/** The run as it stands, drawn again as the clock moves. */
export const useGraph = (): GraphView => {
  const world = useWorld()
  const sc = scenario()
  return useMemo(() => graphOf(sc, world), [sc, world])
}

/** A model's brand mark, as the app draws it, for a step's lead. */
export function LeadMark({ model, size = 12 }: { model: string; size?: number }) {
  const mark = modelOf({ spec: { model } } as NodeView).mark
  return mark === undefined ? null : <BrandMark brand={mark} size={size} />
}

/** Who leads a step, in a few words: Opus 5.5, or Opus 5.5 · extra high. */
export const leadWords = (step: Step): string =>
  step.effort === undefined || step.effort === 'high' ? leadOf(step.model).short : `${leadOf(step.model).short} · ${EFFORTS[step.effort]}`

/* ——— a step's lead, changed from a menu ——— */

export function LeadMenu({ step, disabled = false }: { step: Step; disabled?: boolean }) {
  const trigger = (
    <button type="button" className={s.lead} disabled={disabled}>
      <LeadMark model={step.model} />
      <span>{leadWords(step)}</span>
      {!disabled && <Icon name="chevronD" size={11} className={s.chevron} />}
    </button>
  )
  if (disabled) return trigger
  return (
    <Menu trigger={trigger} label={`Who leads ${step.short}`} width={240}>
      <MenuRadioGroup label="Lead" value={step.model} onChange={(model) => setLead(step.key, model)}>
        {LEADS.map((one) => (
          <MenuRadioItem key={one.model} value={one.model} lead={<LeadMark model={one.model} size={14} />}>
            {one.name}
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
      <MenuRadioGroup
        label="Effort"
        value={step.effort ?? 'high'}
        onChange={(effort) => setEffort(step.key, effort as NonNullable<Step['effort']>)}
      >
        {(['medium', 'high', 'xhigh'] as const).map((one) => (
          <MenuRadioItem key={one} value={one}>
            {EFFORTS[one].charAt(0).toUpperCase() + EFFORTS[one].slice(1)}
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
    </Menu>
  )
}

/* ——— a step's notes: the person's words for its lead ——— */

export function Notes({
  step,
  editable,
  adding: held,
  onAddingChange,
}: {
  step: Step
  editable: boolean
  /** Whether the note form is open, where the caller has its own button for it; without, the notes have theirs. */
  adding?: boolean
  onAddingChange?: (adding: boolean) => void
}) {
  const [own, setOwn] = useState(false)
  const adding = held ?? own
  const setAdding = onAddingChange ?? setOwn
  const notes = step.notes ?? []
  return (
    <div className={s.notes}>
      {notes.map((note, i) => (
        <p key={note} className={s.note}>
          <Icon name="comment" size={12} className={s.noteMark} />
          <span>{note}</span>
          {editable && (
            <button type="button" className={s.unnote} aria-label="Take the note off" onClick={() => removeNote(step.key, i)}>
              <Icon name="close" size={11} />
            </button>
          )}
        </p>
      ))}
      {editable && adding && (
        <NoteForm
          className={s.noteForm}
          text={{ placeholder: `A note for its lead`, submit: 'Add' }}
          onSubmit={(note) => {
            addNote(step.key, note)
            setAdding(false)
          }}
          onCancel={() => setAdding(false)}
        />
      )}
      {editable && !adding && held === undefined && (
        <button type="button" className={s.addNote} onClick={() => setAdding(true)}>
          <Icon name="plus" size={12} />
          Add a note
        </button>
      )}
    </div>
  )
}

/* ——— a step's detail ——— */

/** A step as the plan has it: what it does and why, who leads it, what it waits for and what waits for it, the person's notes. */
export function StepDetail({ step, steps, editable }: { step: Step; steps: ReadonlyArray<Step>; editable: boolean }) {
  const short = (key: string) => steps.find((one) => one.key === key)?.short ?? key
  const kept = steps.filter((one) => !one.dropped)
  const after = step.deps.filter((dep) => kept.some((one) => one.key === dep))
  const then = kept.filter((one) => one.deps.includes(step.key)).map((one) => one.short)
  const facts: Array<[string, ReactNode]> = [
    ['Why', <span key="why">{step.why}</span>],
    ['Lead', <LeadMenu key="lead" step={step} disabled={!editable} />],
  ]
  if (after.length > 0)
    facts.push([
      'After',
      <span key="after" className={s.afters}>
        {after.map((dep) => (
          <span key={dep} className={s.after}>
            {short(dep)}
            {editable && (
              <button
                type="button"
                className={s.unlink}
                aria-label={`Don’t wait for ${short(dep)}`}
                title={`Don’t wait for ${short(dep)}`}
                onClick={() => unlinkStep(step.key, dep)}
              >
                <Icon name="close" size={10} />
              </button>
            )}
          </span>
        ))}
      </span>,
    ])
  if (then.length > 0) facts.push(['Then', listed(then)])
  return (
    <div className={s.detail}>
      <div>
        <p className={s.detailTitle}>{step.title}</p>
        <p className={s.what}>{step.what}</p>
      </div>
      <KeyValues keyWidth={52} items={facts} />
      <Notes step={step} editable={editable} />
      {editable && (
        <div className={s.detailActs}>
          <Button size="small" variant="quiet" onClick={() => setDropped(step.key, true)}>
            Drop this step
          </Button>
        </div>
      )}
    </div>
  )
}

/** A step that opens its detail on a press, in a popover beside it. */
export function StepPopover({
  step,
  steps,
  editable,
  placement = 'right',
  children,
}: {
  step: Step
  steps: ReadonlyArray<Step>
  editable: boolean
  placement?: 'below' | 'above' | 'right' | 'left'
  children: ComponentProps<typeof Popover>['trigger']
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover
      trigger={children}
      label={step.title}
      placement={placement}
      align="start"
      width={320}
      open={open}
      onOpenChange={setOpen}
      initialFocus="panel"
    >
      <StepDetail step={step} steps={steps} editable={editable} />
    </Popover>
  )
}

/* ——— a step drawn small: planned, or running ——— */

/** A step as it's planned: who leads it and its name, a mark where the person left a note, a dot where the latest version changed it. */
export function PlannedPill({ step, className, ...rest }: { step: Step } & ComponentProps<'button'>) {
  return (
    <button type="button" {...rest} className={[s.pill, s.planned, className].filter(Boolean).join(' ')}>
      <span className={s.name}>
        <span className={s.markBox}>
          <LeadMark model={step.model} />
        </span>
        <span className={s.short}>{step.short}</span>
      </span>
      <span className={s.word}>
        <span className={s.short}>{leadOf(step.model).short}</span>
        {(step.notes ?? []).length > 0 && <Icon name="comment" size={11} className={s.hasNote} />}
        {step.changed.length > 0 && <span className={s.changedDot} title="Changed in this version" />}
      </span>
    </button>
  )
}

/** A task as it runs: its mark and name, its pull request, and where it stands. */
export function LivePill({ node, className, ...rest }: { node: NodeView } & ComponentProps<'button'>) {
  return (
    <button type="button" {...rest} className={[s.pill, s[node.stand], className].filter(Boolean).join(' ')}>
      <span className={s.name}>
        <span className={s.markBox}>
          <Mark stand={node.stand} />
        </span>
        <span className={s.short}>{node.spec.short}</span>
        {node.pr !== null && node.stand !== 'done' && <span className={s.pr}>{node.pr}</span>}
      </span>
      <span className={[s.word, s[node.tone]].join(' ')}>{node.stand === 'done' ? `Merged ${node.pr ?? ''}` : node.word}</span>
    </button>
  )
}

/* ——— the graph's canvas ——— */

/** Lines between planned steps: all alike, solid and quiet. */
export const planEdges = (steps: ReadonlyArray<Step>): ReadonlyArray<EdgeView> => {
  const keys = new Set(steps.map((one) => one.key))
  return steps.flatMap((one) => one.deps.filter((dep) => keys.has(dep)).map((dep): EdgeView => ({ from: dep, to: one.key, look: 'met' })))
}

/** Where each step goes: laid out again only where what waits for what changes, or the room. */
export const useLaid = (
  items: ReadonlyArray<{ key: string; deps: ReadonlyArray<string> }>,
  size: (columns: number, widest: number) => { w: number; h: number },
  gap: number,
  pitch: number,
  down: boolean,
  room: number,
): Laid => {
  const shape = items.map((one) => `${one.key}:${one.deps.join(',')}`).join(' ')
  return useMemo(
    () => {
      const columns = lay(items, { w: 1, h: 1 }, gap, pitch, down).columns
      const widest = Math.max(1, ...columns.map((one) => one.length))
      return lay(items, size(columns.length, widest), gap, pitch, down)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shape, room],
  )
}

/* ——— the strips at a card's foot ——— */

/** Launching the plan, with what's dropped and can come back. */
export function LaunchStrip({ steps, className }: { steps: ReadonlyArray<Step>; className?: string }) {
  const kept = steps.filter((one) => !one.dropped)
  return (
    <NextSteps className={className}>
      <NextStep signal onPress={launch}>
        Launch {kept.length} tasks
      </NextStep>
    </NextSteps>
  )
}

/** Steps dropped from the plan, each to put back. */
export function Dropped({ steps, className }: { steps: ReadonlyArray<Step>; className?: string }) {
  const dropped = steps.filter((one) => one.dropped)
  if (dropped.length === 0) return null
  return (
    <p className={[s.dropped, className].filter(Boolean).join(' ')}>
      <span className={s.droppedLabel}>Dropped</span>
      {dropped.map((one) => (
        <span key={one.key} className={s.droppedOne}>
          <s className={s.struck}>{one.short}</s>
          <button type="button" className={s.putBack} onClick={() => setDropped(one.key, false)}>
            Put back
          </button>
        </span>
      ))}
    </p>
  )
}

/** What the run needs from the person now, the most pressing first, two at most. */
export function NeedsYou({ graph, className, max = 2 }: { graph: GraphView; className?: string; max?: number }) {
  const shown = needsOf(graph).slice(0, max)
  if (shown.length === 0) return null
  return (
    <NextSteps className={className}>
      {shown.map((one) => (
        <NextStep key={one.key} signal={one.signal} onPress={one.run}>
          {one.words}
        </NextStep>
      ))}
    </NextSteps>
  )
}

/** What the run needs from the person, the most pressing first: a failure, an ask, a merge. */
export const needsOf = (graph: GraphView) => {
  const short = (key: string) => graph.byKey.get(key)?.spec.short ?? key
  return graph.nodes
    .flatMap((node) => {
      switch (node.now.phase) {
        case 'failed':
          return [
            {
              key: node.key,
              rank: 0,
              words: `Try ${node.spec.short} again`,
              signal: false,
              run: () => move({ kind: 'retry', key: node.key }),
            },
          ]
        case 'asks':
          return [
            {
              key: node.key,
              rank: 1,
              words: `Allow ${node.spec.short}: ${node.spec.asks?.command ?? ''}`,
              signal: true,
              run: () => move({ kind: 'answer', key: node.key }),
            },
          ]
        case 'ready':
          return [
            {
              key: node.key,
              rank: 2,
              words:
                node.starts.length > 0 ? `Merge #${node.spec.pr} to start ${listed(node.starts.map(short))}` : `Merge #${node.spec.pr}`,
              signal: true,
              run: () => move({ kind: 'merge', key: node.key }),
            },
          ]
        default:
          return []
      }
    })
    .toSorted((a, b) => a.rank - b.rank)
}

/** Where the whole run stands, as a mark: the loudest of its tasks. */
export const standOf = (graph: GraphView): NodeView['stand'] =>
  graph.stand.tone === 'signal'
    ? 'yours'
    : graph.stand.tone === 'live'
      ? 'running'
      : graph.stand.tone === 'danger'
        ? 'failed'
        : graph.merged === graph.nodes.length
          ? 'done'
          : 'waits'

/** The plan's head: what it is and which version, and how big. */
export function Kicker({ last, launched, graph }: { last: Version; launched: boolean; graph?: GraphView }) {
  if (launched && graph !== undefined)
    return (
      <span className={[s.kicker, s[graph.stand.tone]].join(' ')}>
        <Mark stand={standOf(graph)} />
        {graph.stand.word}
      </span>
    )
  return (
    <span className={s.kicker}>
      {word()} · v{last.n}
    </span>
  )
}

/* ——— pointing back at steps from elsewhere in the conversation ——— */

/** Steps lit for a moment, where a line in the conversation was pressed to show them. */
export const flash = store<ReadonlyArray<string>>([])
let flashing: ReturnType<typeof setTimeout> | undefined
export const flashSteps = (keys: ReadonlyArray<string>) => {
  flash.set(keys)
  clearTimeout(flashing)
  flashing = setTimeout(() => flash.set([]), 1800)
}

/** The steps a version changed, by key. */
export const changedIn = (version: Version): ReadonlyArray<Step> => version.steps.filter((one) => one.changed.length > 0)

/** The steps in the order they can start: wave by wave, each wave in the graph's order; numbered from 1. */
export const ordered = (steps: ReadonlyArray<Step>): { waves: ReadonlyArray<ReadonlyArray<Step>>; number: (key: string) => number } => {
  const kept = steps.filter((one) => !one.dropped)
  const byKey = new Map(kept.map((one) => [one.key, one]))
  const waves = columnsOf(kept).map((column) => column.map((key) => byKey.get(key) as Step))
  const numbers = new Map(waves.flat().map((one, i) => [one.key, i + 1]))
  return { waves, number: (key) => numbers.get(key) ?? 0 }
}

/** How far the run is, a segment a task, each as it stands, in the order they start. */
export function Progress({ graph, className }: { graph: GraphView; className?: string }) {
  const order = columnsOf(graph.nodes.map((one) => ({ key: one.key, deps: one.now.deps }))).flat()
  return (
    <span className={[s.progress, className].filter(Boolean).join(' ')} aria-label={`${graph.merged} of ${graph.nodes.length} merged`}>
      {order.map((key) => {
        const node = graph.byKey.get(key)
        return node === undefined ? null : (
          <span
            key={key}
            className={[s.segment, s[`seg${node.stand.charAt(0).toUpperCase()}${node.stand.slice(1)}`]].join(' ')}
            title={`${node.spec.short}: ${node.word}`}
          />
        )
      })}
    </span>
  )
}
