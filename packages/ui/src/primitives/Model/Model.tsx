import { useMemo, type ReactNode } from 'react'

import type { Brand } from '../../foundations/brands/brands'
import { BrandMark } from '../../foundations/Marks/Marks'
import { cx } from '../../lib/cx'
import { Tooltip } from '../HoverCard/HoverCard'
import { VisuallyHidden } from '../VisuallyHidden/VisuallyHidden'
import s from './Model.module.css'

/** A model as the consumer knows it, resolved from whatever runtime offers it. */
export interface ModelInfo {
  id: string
  name: string
  /** The short name (Opus 5), for lines where the full name is noise. */
  short: string
  /** The mark it is drawn with; the consumer decides it (see brands/resolve). Without one, no mark. */
  mark?: Brand
  /** The runtime that drives it, by id. */
  runtime: string
  /** Context window, in thousands of tokens, where the runtime says. */
  context?: number
  /** Effort levels in the runtime's own words, lowest first. Empty: no effort control. */
  efforts: readonly string[]
  note?: string
  /** How it is reached, shown on hover: via Claude Code · work. Who runs a model is a detail; the model is what counts. */
  via?: string
  /** Where it runs, in people's words (OpenCode Go), only where the same model is offered twice. Shown beside the name in lists, never on a chip. */
  route?: string
}

export interface ModelProps {
  model: ModelInfo
  /** The short name, with the full one as its title. */
  short?: boolean
  /** Weighted, for where the model is who is speaking. */
  strong?: boolean
  className?: string
}

/** A model: its mark and its name, and how it is reached on hover. */
export function Model({ model, short, strong, className }: ModelProps) {
  const label = (
    <span className={cx(s.model, strong && s.strong, className)} title={short && model.via === undefined ? model.name : undefined}>
      {model.mark && <BrandMark brand={model.mark} />}
      <span className={s.name}>{short ? model.short : model.name}</span>
      {!short && model.route !== undefined && <span className={s.route}>{model.route}</span>}
      {model.via !== undefined && <VisuallyHidden>, {model.via}</VisuallyHidden>}
    </span>
  )
  if (model.via === undefined) return label
  return <Tooltip label={short ? `${model.name}, ${model.via}` : model.via}>{label}</Tooltip>
}

const escape = (id: string) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// en-GB says "A, B and C", with no comma before the and, as Althar's copy reads.
const listOf = new Intl.ListFormat('en-GB', { type: 'conjunction' })

export interface ModelListProps {
  models: readonly ModelInfo[]
  /** The short name, with the full one as its title. */
  short?: boolean
  /** Weighted, for where the model is who is speaking. */
  strong?: boolean
  /** On each model's name. */
  className?: string
}

/**
 * Models as a list in words — A and B, A, B and C — each once, by id, with
 * its mark beside its own name. One list, so it wraps as text does and a
 * mark never parts from the name it belongs to.
 */
export function ModelList({ models, short, strong, className }: ModelListProps) {
  const once = models.filter((model, i) => models.findIndex((other) => other.id === model.id) === i)
  if (once.length === 0) return null
  const parts = listOf.formatToParts(once.map((model) => model.id))
  let at = 0
  return (
    <span>
      {parts.map((part, i) => {
        if (part.type === 'literal') return part.value
        const model = once[at++]
        return model === undefined ? null : <Model key={i} model={model} short={short} strong={strong} className={className} />
      })}
    </span>
  )
}

export interface WithModelsProps {
  /** The models the text may name, by id. */
  models: readonly ModelInfo[]
  children: ReactNode
}

/** Text that may name models by id, with each id shown as its mark and name. */
export function WithModels({ models, children }: WithModelsProps) {
  const [byId, pattern] = useMemo(() => {
    const map = new Map(models.map((m) => [m.id, m]))
    const ids = [...map.keys()].sort((a, b) => b.length - a.length).map(escape)
    return [map, ids.length ? new RegExp(`(${ids.join('|')})`, 'g') : null] as const
  }, [models])
  if (typeof children !== 'string' || !pattern) return <>{children}</>
  return (
    <>
      {children.split(pattern).map((part, i) => {
        const m = byId.get(part)
        return m ? <Model key={i} model={m} /> : part
      })}
    </>
  )
}
