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
    /** How each column's values sit, as markdown says: left, center or right. */
    align?: readonly (ColumnAlign | null)[]
    /** Cells wrap rather than keep to one line: for sentences in cells, as agents write. */
    wrap?: boolean
    text?: Partial<TableText>
  }
>

export type ColumnAlign = 'left' | 'center' | 'right'

/** A small table the agent wrote: results, a comparison. It scrolls sideways rather than squeezing. */
export function Table({ head, rows, caption, rowHeaders = true, align = [], wrap = false, text, className, ...rest }: TableProps) {
  const t = { ...tableText, ...text }
  const sits = (j: number) => {
    const a = align[j]
    return a === undefined || a === null ? undefined : { textAlign: a }
  }
  return (
    <div className={cx(s.wrap, className)} tabIndex={0} role="region" aria-label={caption ?? t.label} {...rest}>
      <table className={cx(s.table, wrap && s.wraps)}>
        {caption && <caption className={s.caption}>{caption}</caption>}
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col" style={sits(i)}>
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
                  <th key={j} scope="row" className={s.first} style={sits(j)}>
                    {c}
                  </th>
                ) : (
                  <td key={j} style={sits(j)}>
                    {c}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
