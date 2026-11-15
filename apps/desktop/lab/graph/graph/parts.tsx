import { type ReactElement, type ReactNode, type RefObject, useLayoutEffect, useState } from 'react'

import { Brand, Button, Icon, KeyValues, Model, type ModelInfo, Popover, TaskGlyph, TaskStatus } from '@althar/ui'

import { move, router } from '../state'
import { type Box, type EdgeView, type GraphView, type Laid, listed, type NodeView, type Stand, wire } from '../view'
import s from './parts.module.css'

/*
 * What every direction draws a request's graph with: a task's mark, its
 * detail with what can be done to it, and the lines between tasks. A task
 * opens on a press; pointing at it a moment opens its detail beside it,
 * where a task that waits can start now or stop waiting for one of what it
 * waits for, one that asks can be answered, one ready merged, and one that
 * failed tried again.
 */

const MODELS: Readonly<Record<string, ModelInfo>> = {
  'claude-opus-5-5': {
    id: 'claude-opus-5-5',
    name: 'Claude Opus 5.5',
    short: 'Opus 5.5',
    mark: Brand.Anthropic,
    runtime: 'claude-code',
    efforts: [],
  },
  'gpt-6.1-sol': { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', short: 'GPT-6.1 Sol', mark: Brand.OpenAI, runtime: 'codex', efforts: [] },
}
export const modelOf = (node: NodeView): ModelInfo => MODELS[node.spec.model] ?? (MODELS['claude-opus-5-5'] as ModelInfo)

/** Where a task stands, as a glyph: the board's own, with a ring for one waiting and a warning for one that failed or can't start. */
export function Mark({ stand, className }: { stand: Stand; className?: string }) {
  const glyph = (() => {
    switch (stand) {
      case 'waits':
        return <span className={s.ring} aria-hidden="true" />
      case 'stuck':
      case 'failed':
        return <Icon name="problem" size={12} className={s.danger} />
      case 'held':
        return <TaskGlyph status={TaskStatus.Stopped} />
      case 'starting':
      case 'running':
        return <TaskGlyph status={TaskStatus.Running} />
      case 'yours':
        return <TaskGlyph status={TaskStatus.Yours} />
      case 'done':
        return <Icon name="check" size={12} className={s.done} />
    }
  })()
  return <span className={[s.mark, className].filter(Boolean).join(' ')}>{glyph}</span>
}

/** How wide an element is inside its padding, as it changes; 0 until it is measured. */
export const useWidth = (ref: RefObject<HTMLElement | null>): number => {
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return
    const measure = () => {
      const style = getComputedStyle(element)
      setWidth(Math.round(element.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return width
}

/** Opens a task's page, as pressing its card on the board does. */
export const openTask = (node: NodeView) => {
  void router.current?.navigate({ to: '/threads/$threadId', params: { threadId: node.threadId } })
}

interface Act {
  readonly label: string
  readonly variant: 'signal' | 'default' | 'quiet'
  readonly run: () => void
}

/** What can be done to a task where it stands, the main one first. */
export const actsOf = (node: NodeView, graph: GraphView): ReadonlyArray<Act> => {
  const short = (key: string) => graph.byKey.get(key)?.spec.short ?? key
  switch (node.now.phase) {
    case 'waits':
      if (node.now.held) return [{ label: 'Start', variant: 'default', run: () => move({ kind: 'release', key: node.key }) }]
      return [
        { label: 'Start now', variant: 'default', run: () => move({ kind: 'start', key: node.key }) },
        ...node.waitsFor.map((dep): Act => ({
          label: `Don’t wait for ${short(dep)}`,
          variant: 'quiet',
          run: () => move({ kind: 'unlink', key: node.key, dep }),
        })),
      ]
    case 'starting':
      return [{ label: 'Hold', variant: 'quiet', run: () => move({ kind: 'hold', key: node.key }) }]
    case 'asks':
      return [{ label: 'Allow', variant: 'signal', run: () => move({ kind: 'answer', key: node.key }) }]
    case 'ready':
      return [{ label: `Merge #${node.spec.pr}`, variant: 'signal', run: () => move({ kind: 'merge', key: node.key }) }]
    case 'failed':
      return [{ label: 'Try again', variant: 'default', run: () => move({ kind: 'retry', key: node.key }) }]
    default:
      return []
  }
}

/** A task's detail: its whole name, where it stands, who leads it, what it waits for and what merging it starts, and what can be done. */
export function Detail({ node, graph }: { node: NodeView; graph: GraphView }) {
  const short = (key: string) => graph.byKey.get(key)?.spec.short ?? key
  const acts = actsOf(node, graph)
  const facts: Array<[string, ReactNode]> = [['Lead', <Model key="m" model={modelOf(node)} short />]]
  if (node.pr !== null)
    facts.push([
      'Pull request',
      <span key="pr" className={s.mono}>
        {node.pr}
      </span>,
    ])
  if (node.now.deps.length > 0 && node.stand !== 'waits' && node.stand !== 'stuck') facts.push(['After', listed(node.now.deps.map(short))])
  if (node.starts.length > 0) facts.push([node.now.phase === 'merged' ? 'Started' : 'Then starts', listed(node.starts.map(short))])
  return (
    <div className={s.detail}>
      <p className={s.detailTitle}>{node.spec.title}</p>
      <p className={[s.detailWord, s[node.tone]].join(' ')}>
        <Mark stand={node.stand} />
        {node.word}
      </p>
      <KeyValues keyWidth={84} items={facts} />
      {acts.length > 0 && (
        <div className={s.acts}>
          {acts.map((act) => (
            <Button key={act.label} size="small" variant={act.variant} onClick={act.run}>
              {act.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

/** A task in the graph: pressing it opens it, pointing at it shows its detail. */
export function Node({
  node,
  graph,
  children,
  placement = 'below',
}: {
  node: NodeView
  graph: GraphView
  children: ReactElement
  placement?: 'below' | 'above' | 'right' | 'left'
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover
      hover
      trigger={children}
      label={node.spec.title}
      placement={placement}
      align="center"
      width={288}
      open={open}
      onOpenChange={setOpen}
      initialFocus="panel"
    >
      <Detail node={node} graph={graph} />
    </Popover>
  )
}

/** The lines between tasks, drawn under them: into each task from what it depends on, each as its dependency stands. */
export function Wires({
  laid,
  edges,
  gap,
  down = false,
  lit,
  heads = true,
  className,
}: {
  laid: Laid
  edges: ReadonlyArray<EdgeView>
  gap: number
  down?: boolean
  /** A task being pointed at: its own lines come forward, the rest step back. */
  lit?: string | null
  /** Arrowheads into each task; without, where the tasks are too small for them and the order reads one way. */
  heads?: boolean
  className?: string
}) {
  const boxes = [...laid.boxes.values()]
  return (
    <svg className={[s.wires, className].filter(Boolean).join(' ')} width={laid.w} height={laid.h} aria-hidden="true">
      <defs>
        {(['met', 'waits', 'you', 'stuck'] as const).map((look) => (
          <marker
            key={look}
            id={`head-${look}`}
            viewBox="0 0 6 6"
            refX="5.5"
            refY="3"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0.6 L 5.6 3 L 0 5.4 z" className={s[`head${look.charAt(0).toUpperCase()}${look.slice(1)}`]} />
          </marker>
        ))}
      </defs>
      {edges.map((edge) => {
        const from = laid.boxes.get(edge.from) as Box | undefined
        const to = laid.boxes.get(edge.to) as Box | undefined
        if (from === undefined || to === undefined) return null
        const mine = lit == null ? null : edge.from === lit || edge.to === lit
        return (
          <path
            key={`${edge.from}>${edge.to}`}
            d={wire(from, to, boxes, gap, down)}
            className={[s.wire, s[edge.look], mine === true && s.lit, mine === false && s.dim].filter(Boolean).join(' ')}
            {...(heads ? { markerEnd: `url(#head-${edge.look})` } : {})}
          />
        )
      })}
    </svg>
  )
}
