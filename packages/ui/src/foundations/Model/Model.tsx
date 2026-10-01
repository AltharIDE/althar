import { useMemo, type ReactNode } from 'react'

import { cx } from '../../lib/cx'
import type { Brand } from '../brands/brands'
import { BrandMark } from '../Marks/Marks'
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
}

export interface ModelProps {
  model: ModelInfo
  /** The short name, with the full one as its title. */
  short?: boolean
  /** Weighted, for where the model is who is speaking. */
  strong?: boolean
  className?: string
}

/** A model: its mark and its name. */
export function Model({ model, short, strong, className }: ModelProps) {
  return (
    <span className={cx(s.model, strong && s.strong, className)} title={short ? model.name : undefined}>
      {model.mark && <BrandMark brand={model.mark} />}
      <span>{short ? model.short : model.name}</span>
    </span>
  )
}

const escape = (id: string) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

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
