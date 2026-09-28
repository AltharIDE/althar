import type { ReactNode } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import s from './Table.module.css'

export interface TableText {
  /** The region's name when there is no caption. */
  label: string
}

export const tableText: TableText = { label: 'Table' }

export type TableProps = RootProps<
  'div',
  {
    head: readonly ReactNode[]
    rows: readonly (readonly ReactNode[])[]
    caption?: string
    /** The first cell of each row names it, and is set in mono. On by default. */
    rowHeaders?: boolean
    text?: Partial<TableText>
  }
>

/** A small table the agent wrote: results, a comparison. It scrolls sideways rather than squeezing. */
export function Table({ head, rows, caption, rowHeaders = true, text, className, ...rest }: TableProps) {
  const t = { ...tableText, ...text }
  return (
    <div className={cx(s.wrap, className)} tabIndex={0} role="region" aria-label={caption ?? t.label} {...rest}>
      <table className={s.table}>
        {caption && <caption className={s.caption}>{caption}</caption>}
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) =>
                rowHeaders && j === 0 ? (
                  <th key={j} scope="row" className={s.first}>
                    {c}
                  </th>
                ) : (
                  <td key={j}>{c}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
